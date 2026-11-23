// GET /api/agent-runs/<id>/conversation?after=<cursor>: the run's session as the agent's own record shows it:
// the last turns, then what is new since the cursor (conversation-wire.ts says what a read carries).
// ?before=<event id> gives the turns before that event and ?event=<event id> that event whole.
// POST /api/agent-runs/<id>/conversation/closed: the view is no longer open on the session (it closed, switched
// to the terminal or its window went), so a permission the agent asks for is left to the agent's own dialog.
// POST /api/agent-runs/<id>/approvals/<approval>: the person's answer to a permission the agent asks for.
// Access is the caller's to check (a paired session, as for watching a window; typing rights to answer).
// Only a caller with those typing rights renews the view's short lease or sees the prompts; a watch-only
// browser reads the conversation and nothing more. A read is the only renewal: nothing on the server
// renews it for a browser that stopped reading (hidden, suspended, crashed).

import { decide, listPending, markViewing, stopViewing } from "../core/conversation/approvals.ts"
import { qualifiedCodexPickerVersion } from "../core/conversation/codex-picker.ts"
import { listPickers } from "../core/conversation/pickers.ts"
import {
  cachedEvents,
  clearWorkerConversationCache,
  type NativeRun,
  nativeRun,
  readConversation,
  readWorkerConversation,
} from "../core/conversation/service.ts"
import type { ConversationQuestion, ConversationSnapshot } from "../core/conversation/types.ts"
import type { RunRecord } from "../core/run/contracts.ts"
import { readRun } from "../core/run/registry.ts"
import type { Ctx } from "../ctx.ts"
import { prepareAttachmentEvents } from "./conversation-files.ts"
import { conversationAttachmentResponse, wireAttachmentEvents } from "./conversation-images.ts"
import {
  attachmentSnapshot,
  conversationReply,
  cursorParam,
  preparePage,
} from "./conversation-outside.ts"
import {
  boundedAttachmentPage,
  earlierPage,
  WIRE_ID_CHARS,
  wholeEvent,
  wireSnapshot,
} from "./conversation-wire.ts"

export {
  outsideConversationBinding,
  outsideConversationResponse,
} from "./conversation-outside.ts"

/** The run id in a conversation route, or undefined for any other path. */
export const conversationRunId = (path: string) =>
  /^\/api\/agent-runs\/([a-f0-9-]{1,128})\/conversation$/.exec(path)?.[1]

/** The run id in a route that says the view closed, or undefined for any other path. */
export const conversationClosedId = (path: string) =>
  /^\/api\/agent-runs\/([a-f0-9-]{1,128})\/conversation\/closed$/.exec(path)?.[1]

/** The run and approval ids in an approval route, or undefined for any other path. */
export function approvalRoute(path: string): { run: string; approval: string } | undefined {
  const match = /^\/api\/agent-runs\/([a-f0-9-]{1,128})\/approvals\/([a-f0-9]{32})$/.exec(path)
  return match ? { run: match[1] as string, approval: match[2] as string } : undefined
}

const reply = conversationReply
const live = (run: RunRecord) => !["stopped", "failed"].includes(run.status)

/** Who asks: whether the browser may answer for the agent, and what to tell the server about its lease. */
export type Viewer = {
  canAnswer: boolean
  canPick?: boolean
  submitted?: (callId: string) => NonNullable<ConversationQuestion["submitted"]>
  /** The browser read the view and renewed the lease on a run's session. */
  viewing?: () => void
  /** The browser said it closed the view; true when no one else keeps it open. */
  closed?: () => boolean
}

function shown(ctx: Ctx, id: string): NativeRun | Response {
  const run = readRun(ctx.home, id)
  if (!run) return reply({ error: "Agent run not found" }, 404)
  if (!nativeRun(run))
    return reply({ error: "This run has no agent session record to show as a conversation" }, 409)
  if (run.purpose.kind === "terminal" && run.purpose.shell === true)
    return reply({ error: "A shell has no agent conversation" }, 409)
  return run
}

/** The older turns or the whole event a request names; undefined when it names neither. */
async function detail(
  ctx: Ctx,
  run: NativeRun,
  params: URLSearchParams,
  pathname: string,
): Promise<Response | undefined> {
  const named = (name: string) => {
    const value = params.get(name)
    return value && value.length <= WIRE_ID_CHARS ? value : undefined
  }
  const before = named("before")
  if (before)
    return reply(
      boundedAttachmentPage(
        wireAttachmentEvents(
          await preparePage(ctx, run, earlierPage(readConversation(ctx, run).events, before)),
          pathname,
          run,
        ),
      ),
    )
  const id = named("event")
  if (!id) return undefined
  const event = wholeEvent(readConversation(ctx, run).events, id)
  return event
    ? reply(
        wireAttachmentEvents(
          { event: (await prepareAttachmentEvents(ctx, run, [event]))[0] },
          pathname,
          run,
        ),
      )
    : reply({ error: "This message is no longer kept" }, 404)
}

function applyQuestionAvailability(
  run: NativeRun,
  question: ConversationQuestion | null | undefined,
  viewer: Viewer,
): ConversationQuestion | null | undefined {
  if (question?.agent === "codex") {
    const qualified = qualifiedCodexPickerVersion(run.binary?.version)
    return {
      ...question,
      answerable: question.answerable && viewer.canAnswer && qualified,
      availability: !viewer.canAnswer
        ? "read-only"
        : !qualified
          ? "unsupported"
          : question.availability,
      submitted: viewer.submitted?.(question.id) ?? [],
    }
  }
  if (question?.agent === "claude-code") {
    const canPick = viewer.canPick ?? viewer.canAnswer
    return {
      ...question,
      answerable: question.answerable && canPick,
      availability: canPick ? question.availability : "read-only",
    }
  }
  return question
}

async function resolveConversationQuestion(
  ctx: Ctx,
  run: NativeRun,
  snapshot: ConversationSnapshot,
  viewer: Viewer,
): Promise<ConversationQuestion | null | undefined> {
  let question = snapshot.question
  if (run.agent === "claude-code" && live(run) && run.nativeSession) {
    const pending = (await listPickers(ctx, run.nativeSession))[0]
    if (pending) {
      question = {
        ...pending.question,
        answerable: pending.question.answerable && !snapshot.hasMore,
        availability: snapshot.hasMore ? "catching-up" : "ready",
      }
    } else if (viewer.canAnswer) {
      question = null
    }
  }
  return applyQuestionAvailability(run, question, viewer)
}

async function specialConversationRequest(
  ctx: Ctx,
  run: NativeRun,
  url: URL,
): Promise<Response | undefined> {
  const params = url.searchParams
  if (params.has("attachment")) return conversationAttachmentResponse(ctx, run, params)
  if (params.has("worker")) {
    const snapshot = readWorkerConversation(
      ctx,
      run,
      params.get("worker") ?? "",
      cursorParam(params),
    )
    return snapshot
      ? reply(wireAttachmentEvents(snapshot, url.pathname, run, false))
      : reply({ error: "This subagent's history is unavailable" }, 404)
  }
  return detail(ctx, run, params, url.pathname)
}

export async function conversationResponse(
  ctx: Ctx,
  request: Request,
  id: string,
  viewer: Viewer,
): Promise<Response> {
  const run = shown(ctx, id)
  if (run instanceof Response) return run
  const url = new URL(request.url)
  const special = await specialConversationRequest(ctx, run, url)
  if (special) return special
  const after = cursorParam(url.searchParams)
  const read = wireAttachmentEvents(
    readConversation(ctx, run, after),
    url.pathname,
    run,
    true,
    true,
  )
  const snapshot = wireSnapshot(read, after, () => ({
    ...read,
    events: wireAttachmentEvents(cachedEvents(run), url.pathname, run, true, true),
  }))
  snapshot.question = (await resolveConversationQuestion(ctx, run, snapshot, viewer)) ?? null
  // Only a browser that may answer renews the lease and sees the prompts; a watcher just reads.
  if (viewer.canAnswer && live(run) && nativeRun(run) && run.nativeSession) {
    await markViewing(ctx, run.agent, run.nativeSession)
    viewer.viewing?.()
    const approvals = await listPending(ctx, run.agent, run.nativeSession)
    if (approvals.length > 0)
      return reply({ ...(await attachmentSnapshot(ctx, run, snapshot, url.pathname)), approvals })
  }
  return reply(await attachmentSnapshot(ctx, run, snapshot, url.pathname))
}

export async function conversationClosedResponse(
  ctx: Ctx,
  id: string,
  viewer: Viewer,
): Promise<Response> {
  const run = shown(ctx, id)
  if (run instanceof Response) return run
  clearWorkerConversationCache(id)
  // A watcher holds no lease, so its closing changes nothing.
  if (viewer.canAnswer && nativeRun(run) && run.nativeSession && (viewer.closed?.() ?? true))
    await stopViewing(ctx, run.agent, run.nativeSession)
  return reply({ ok: true })
}

export async function approvalResponse(
  ctx: Ctx,
  request: Request,
  route: { run: string; approval: string },
): Promise<Response> {
  const run = shown(ctx, route.run)
  if (run instanceof Response) return run
  if (!nativeRun(run) || !run.nativeSession || !live(run))
    return reply({ error: "This agent session is no longer running" }, 409)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return reply({ error: "Send the answer as JSON" }, 400)
  }
  const value = (body ?? {}) as { behavior?: unknown; scope?: unknown; message?: unknown }
  if (value.behavior !== "allow" && value.behavior !== "deny")
    return reply({ error: "The answer must be allow or deny" }, 400)
  const decided = await decide(ctx, run.agent, run.nativeSession, route.approval, {
    behavior: value.behavior,
    ...(value.scope === "session" ? { scope: "session" as const } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  })
  return decided
    ? reply({ ok: true })
    : reply({ error: "This request was already answered or is no longer waiting" }, 409)
}
