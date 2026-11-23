// The person's last message in each agent session, as the prompt hook saw it: kept in the runtime
// folder of the task that session joined, overwritten by the next message, never sent
// anywhere. It names the agent and checkout whose own record holds every message of the session.
// With them the agent may record what the person said in their own words (`gate decide approve
// --asked "<their words>"`, `question answered "<their words>"`): the words must be in a message the
// person typed in this session since the question or gate opened, any of them, not only the last.
//
// The hook also marks a message that starts the workflow (`/ql`, `$ql`): the next question asked
// in the App brings it to the front; later ones only notify.

import type { Ctx } from "../../ctx.ts"
import { sessionIdentity } from "../agents/detect.ts"
import type { NativeAgent } from "../agents/ids.ts"
import { isNativeAgent } from "../agents/ids.ts"
import { terminalTaskFor } from "./chat-questions.ts"
import { activePromptTask, KEPT, pendingPath, promptPath, safeSession } from "./prompt-record.ts"
import { approves, heldIn, plain } from "./prompt-words.ts"
import { latestUserMessage, userMessages } from "./session-proof.ts"
import type { Task } from "./store.ts"

export { FRONT_DUE, recordPrompt } from "./prompt-record.ts"
export {
  ASK_REFUSAL,
  approves,
  chatApproval,
  explicitApproval,
  heldIn,
  NOT_AN_APPROVAL,
} from "./prompt-words.ts"

/**
 * The latest message in the chat this command itself runs in, read from the agent's own record,
 * for an agent whose prompt hook left nothing (Cursor's and Antigravity's terminal chats): only
 * for a Terminal task bound to that very chat, as a typed answer is proven.
 */
async function ownChatMessage(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  session: string,
  after: number,
): Promise<string | null> {
  const own = sessionIdentity(ctx.env)
  if (own?.id !== session) return null
  if ((await terminalTaskFor(ctx, session))?.runtimeDir !== task.runtimeDir) return null
  const proof = await latestUserMessage(ctx, { agent: own.agent, session, cwd: ctx.env.cwd() })
  return proof !== null && proof.recordedAt > after ? proof.prompt : null
}

type ParsedPrompt = { prompt: string; agent: NativeAgent; recordedAt?: number; cwd: string }

function parsePromptRecord(raw: unknown, session: string, trusted: boolean): ParsedPrompt | null {
  const parsed = raw as Record<string, unknown> | null
  if (!parsed || typeof parsed.prompt !== "string" || typeof parsed.cwd !== "string") return null
  if (!isNativeAgent(parsed.agent) || parsed.session !== session) return null
  if (trusted && typeof parsed.recordedAt !== "number") return null
  return {
    prompt: parsed.prompt,
    agent: parsed.agent,
    recordedAt: typeof parsed.recordedAt === "number" ? parsed.recordedAt : undefined,
    cwd: parsed.cwd,
  }
}

async function readVerifiedPrompt(
  ctx: Ctx,
  file: string,
  session: string,
  trusted: boolean,
  after: number,
): Promise<string | null> {
  const info = await ctx.fs.stat?.(file)
  if (info && info.size > KEPT * 4) return null
  const parsed = parsePromptRecord(JSON.parse(await ctx.fs.readFile(file)), session, trusted)
  if (!parsed) return null
  const proof = await latestUserMessage(ctx, { agent: parsed.agent, session, cwd: parsed.cwd })
  const matches =
    proof !== null &&
    proof.recordedAt > after &&
    (!trusted || proof.recordedAt === parsed.recordedAt) &&
    plain(proof.prompt.slice(0, KEPT)) === plain(parsed.prompt)
  return matches ? proof.prompt : null
}

/** The last message of `session` the hook kept for this task, or null. */
export async function lastPrompt(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  session: string | null,
  after = -Infinity,
): Promise<string | null> {
  if (session === null || !safeSession(session)) return null
  try {
    if ((await activePromptTask(ctx, session))?.task.runtimeDir !== task.runtimeDir) return null
    const trusted = await ctx.fs.exists(promptPath(task, session))
    if (!trusted && !(await ctx.fs.exists(pendingPath(task, session))))
      return await ownChatMessage(ctx, task, session, after)
    const file = trusted ? promptPath(task, session) : pendingPath(task, session)
    return await readVerifiedPrompt(ctx, file, session, trusted, after)
  } catch {
    return null
  }
}

/** The agent and checkout a session's messages are read for: the hook's note of it, else this very chat. */
async function promptIdentity(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  session: string,
): Promise<{ agent: NativeAgent; cwd: string } | null> {
  for (const file of [promptPath(task, session), pendingPath(task, session)]) {
    try {
      const noted = JSON.parse(await ctx.fs.readFile(file)) as {
        agent?: unknown
        session?: unknown
        cwd?: unknown
      }
      if (isNativeAgent(noted.agent) && noted.session === session && typeof noted.cwd === "string")
        return { agent: noted.agent, cwd: noted.cwd }
    } catch {}
  }
  const own = sessionIdentity(ctx.env)
  return own?.id === session ? { agent: own.agent, cwd: ctx.env.cwd() } : null
}

/**
 * What the person typed in `session` after `after`, oldest first, from the agent's own record. A
 * message the agent took in while it worked counts as one it took at the end of a turn, and the
 * prompt hook need not have seen it. A message the record cuts off or leaves undated is skipped.
 */
export async function typedMessages(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  session: string | null,
  after = -Infinity,
): Promise<string[]> {
  if (session === null || !safeSession(session)) return []
  try {
    if ((await activePromptTask(ctx, session))?.task.runtimeDir !== task.runtimeDir) return []
    const identity = await promptIdentity(ctx, task, session)
    const found = identity ? await userMessages(ctx, { ...identity, session }) : null
    return found ? found.flatMap((m) => (m !== null && m.recordedAt > after ? [m.prompt] : [])) : []
  } catch {
    return []
  }
}

/** Every message the person typed in `session` since `after`: the agent's own record, and the hook's verified copy of the last. */
async function personMessages(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  session: string | null,
  after = -Infinity,
): Promise<string[]> {
  const typed = await typedMessages(ctx, task, session, after)
  const last = await lastPrompt(ctx, task, session, after)
  return last === null || typed.includes(last) ? typed : [...typed, last]
}

/** Retry only a pending prompt, after the native client has had a chance to persist it. */
export async function verifyPendingPrompt(ctx: Ctx, session: string): Promise<string | null> {
  if (!safeSession(session)) return null
  const current = await activePromptTask(ctx, session)
  if (!current || !(await ctx.fs.exists(pendingPath(current.task, session)))) return null
  return lastPrompt(ctx, current.task, session)
}

/**
 * Whether the person said `quote` in any message of theirs in `session` since `after` (the
 * question was asked, the gate opened). Answers typed back to back, or several in one message, each
 * count, though the agent took them in together and the person went on to something else.
 */
export async function quoteAsked(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  session: string | null,
  quote: string,
  after = -Infinity,
): Promise<boolean> {
  return (await personMessages(ctx, task, session, after)).some((said) => heldIn(said, quote))
}

/** A gate's remark or other response, in the person's words since the gate opened. */
export const responseAsked = quoteAsked

/** A question's answer, in the person's words since it was asked. */
export const answerAsked = quoteAsked

/**
 * Whether the person typed the approval `quote` in a message since `after`: the quote approves
 * ("approve", "1. Approve", "yeah approve it for me") and stands as a clause of that message, typed
 * rather than pasted, so "do not approve" or "approve it once the tests pass" never count.
 */
export async function approvalAsked(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  session: string | null,
  quote: string,
  after = -Infinity,
): Promise<boolean> {
  if (!approves(quote)) return false
  return (await personMessages(ctx, task, session, after)).some((said) => heldIn(said, quote, true))
}
