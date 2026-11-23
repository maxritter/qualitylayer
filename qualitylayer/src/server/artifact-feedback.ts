import { commentsHolder } from "../core/artifact/store.ts"
import { startAnswering } from "../core/review/answers.ts"
import { isArchived } from "../core/task/archive.ts"
import type { Ctx } from "../ctx.ts"
import { locate } from "./api.ts"
import {
  type CreateThreadContext,
  failFeedback,
  handleAttachmentGet,
  handleCreateThreadPost,
  handleHelperPost,
  handleThreadStatePost,
  handleThreadsGet,
} from "./artifact-feedback-handlers.ts"
import { locateArtifact } from "./artifacts.ts"
import { ArtifactBodyError, readArtifactInput } from "./request-body.ts"

export type ArtifactFeedbackAddress = { scope: "task" | "project"; id: string; file: string }
export type ArtifactFeedbackAction =
  | "threads"
  | "thread"
  | "resolve"
  | "reopen"
  | "helper"
  | "attachment"

const standalone = (address: ArtifactFeedbackAddress) => address.scope === "project"

function isValidAddress(address: ArtifactFeedbackAddress): boolean {
  const validScope = address.scope === "task" || address.scope === "project"
  const validId = typeof address.id === "string" && address.id.length <= 200
  const validFile = typeof address.file === "string" && address.file.length <= 512
  return validScope && validId && validFile
}

async function resolveWritableTask(
  ctx: Ctx,
  address: ArtifactFeedbackAddress,
): Promise<
  { ok: true; task?: Awaited<ReturnType<typeof locate>> } | { ok: false; response: Response }
> {
  if (address.scope !== "task") return { ok: true }
  const task = await locate(ctx, address.id)
  if (!task.ok) return { ok: false, response: failFeedback(task.error.message, 404) }
  const blocked =
    (await isArchived(ctx, task.data.task)) ||
    ["shipped", "abandoned"].includes(task.data.task.stage)
  if (blocked)
    return {
      ok: false,
      response: failFeedback("Restore or reopen this task before changing its artifact feedback."),
    }
  return { ok: true, task }
}

async function dispatchFeedbackPost(
  env: CreateThreadContext,
  action: "thread" | "resolve" | "reopen" | "helper",
  request: Request,
): Promise<Response> {
  try {
    const { body, files } = await readArtifactInput(request, "comment")
    const allowed =
      action === "thread" ? ["remark", "quote", "for", "thread", "spot", "revision"] : ["thread"]
    if (Object.keys(body).some((key) => !allowed.includes(key)))
      return failFeedback("Unknown feedback field.")
    // "Answer now with a helper": the thread's unanswered comments go to a fresh helper at once.
    if (action === "helper")
      return await handleHelperPost(env.ctx, env.holder, env.address.file, body, env.backstop)
    if (action === "resolve" || action === "reopen")
      return await handleThreadStatePost(env.ctx, env.holder, env.address.file, action, {
        body,
        files,
      })
    return await handleCreateThreadPost(env, body, files)
  } catch (cause) {
    return failFeedback(
      cause instanceof Error ? cause.message : "The feedback could not be saved.",
      cause instanceof ArtifactBodyError ? cause.status : 400,
    )
  }
}

async function runLocatedFeedbackRoute(
  ctx: Ctx,
  address: ArtifactFeedbackAddress,
  action: ArtifactFeedbackAction,
  request: Request,
  located: Extract<Awaited<ReturnType<typeof locateArtifact>>, { ok: true }>["data"],
): Promise<Response> {
  const holder = commentsHolder(ctx, located.home)
  // The backstop: a comment the artifact's agent does not read in time goes to a fresh helper. The
  // worker also starts again here when the App restarted while a comment waited.
  const backstop = async () => {
    if (address.scope === "task") {
      const owner = await locate(ctx, address.id)
      if (owner.ok) await startAnswering(ctx, owner.data.task).catch(() => {})
    }
  }
  if (request.method === "GET" && action === "threads")
    return handleThreadsGet(ctx, holder, located, address.file, backstop)
  if (request.method === "GET" && action === "attachment")
    return handleAttachmentGet(ctx, holder, address.file, request)
  if (request.method !== "POST" || !["thread", "resolve", "reopen", "helper"].includes(action))
    return failFeedback("Unsupported artifact feedback action.", 405)
  const writable = await resolveWritableTask(ctx, address)
  if (!writable.ok) return writable.response
  return dispatchFeedbackPost(
    { ctx, address, holder, task: writable.task, backstop },
    action as "thread" | "resolve" | "reopen" | "helper",
    request,
  )
}

/** Auth and origin checks precede this adapter; its threads share the existing comment store. */
export async function artifactFeedbackRoute(
  ctx: Ctx,
  address: ArtifactFeedbackAddress,
  action: ArtifactFeedbackAction,
  request: Request,
): Promise<Response> {
  if (standalone(address))
    return failFeedback("Standalone artifact feedback is retired; its history is read-only.", 410)
  if (!isValidAddress(address)) return failFeedback("Invalid artifact address.")
  const found = await locateArtifact(ctx, address.scope, address.id, address.file)
  if (!found.ok) return failFeedback(found.error.message, 404)
  return runLocatedFeedbackRoute(ctx, address, action, request, found.data)
}
