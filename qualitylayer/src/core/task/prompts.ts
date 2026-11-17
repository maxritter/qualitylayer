// The person's last message in each agent session, as the prompt hook saw it: kept in the runtime
// folder of the task that session joined, overwritten by the next message, never sent
// anywhere. It names the agent and checkout whose own record holds every message of the session.
// With them the agent may record what the person said in their own words (`gate decide approve
// --asked "<their words>"`, `question answered "<their words>"`): the words must be in a message the
// person typed in this session since the question or gate opened, any of them, not only the last.
//
// The hook also marks a message that starts the workflow (`/ql`, `$ql`): the next question asked
// in the App brings it to the front; later ones only notify.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { detectAgent, sessionIdentity } from "../agents/detect.ts"
import type { NativeAgent } from "../agents/ids.ts"
import { isNativeAgent } from "../agents/ids.ts"
import { projectRuntimeDir, resolveRepo } from "../paths.ts"
import { trimEndCharacters } from "../text-boundaries.ts"
import { isArchived } from "./archive.ts"
import { keyOf } from "./binding.ts"
import { observedTarget } from "./bound-target.ts"
import { terminalTaskFor } from "./chat-questions.ts"
import { latestUserMessage, userMessages } from "./session-proof.ts"
import { isTerminal, loadTask, type Task } from "./store.ts"

/** The marker a `/ql` message leaves in the project's runtime folder. */
export const FRONT_DUE = "question-front-due"

/** Longest message kept: enough for any request, short enough to read at every check. */
const KEPT = 8000

const safe = (session: string) => /^[A-Za-z0-9_.-]{1,128}$/.test(session)
const promptPath = (task: Pick<Task, "runtimeDir">, session: string) =>
  join(task.runtimeDir, `prompt-${session}.json`)
const pendingPath = (task: Pick<Task, "runtimeDir">, session: string) =>
  join(task.runtimeDir, `pending-prompt-${session}.json`)

async function activePromptTask(
  ctx: Ctx,
  session: string,
): Promise<{ task: Task; project: string } | null> {
  const target = await observedTarget(ctx, keyOf(session))
  if (target.kind === "blocked") return null
  if (target.kind === "bound") {
    const task = await loadTask(ctx, target.repo, target.slug)
    return task === null || isTerminal(task.stage) || (await isArchived(ctx, task))
      ? null
      : { task, project: target.repo.id }
  }
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return null
  let slug = ctx.env.get("QUALITYLAYER_TASK")
  if (!slug) {
    try {
      const binding = JSON.parse(
        await ctx.fs.readFile(
          join(ctx.home, "projects", repo.data.id, "sessions", `${keyOf(session)}.json`),
        ),
      )
      if (binding.source === "workflow" && typeof binding.slug === "string") slug = binding.slug
    } catch {}
  }
  if (!slug) return null
  const task = await loadTask(ctx, repo.data, slug)
  return task === null || isTerminal(task.stage) || (await isArchived(ctx, task))
    ? null
    : { task, project: repo.data.id }
}

/** Keep the person's last message of `session`, and mark `/ql` for the next question. */
export async function recordPrompt(
  ctx: Ctx,
  input: { session: string; prompt: string; agent?: NativeAgent; pending?: boolean },
): Promise<boolean> {
  if (!safe(input.session)) return false
  const current = await activePromptTask(ctx, input.session)
  if (!current) return false
  const { task, project } = current
  const agent = input.agent ?? detectAgent(ctx.env)
  if (!isNativeAgent(agent)) return false
  const proof =
    !input.pending && isNativeAgent(agent)
      ? await latestUserMessage(ctx, { agent, session: input.session, cwd: ctx.env.cwd() })
      : null
  const verified = proof !== null && plain(proof.prompt) === plain(input.prompt)
  if (verified && /^\s*[/$]ql\b/i.test(input.prompt)) {
    const dir = projectRuntimeDir(ctx, project)
    await ctx.fs.mkdir(dir)
    await ctx.fs.writeFile(join(dir, FRONT_DUE), `${ctx.clock.now()}\n`)
  }
  // A hook runs for every conversation in the checkout. Its payload's session, not the newest
  // task or the hook process's inherited session, decides where the person's words belong.
  if (!verified) {
    await ctx.fs.remove(promptPath(task, input.session))
    await ctx.fs.mkdir(task.runtimeDir)
    await ctx.fs.atomicWrite(
      pendingPath(task, input.session),
      JSON.stringify({
        agent,
        session: input.session,
        cwd: ctx.env.cwd(),
        prompt: input.prompt.slice(0, KEPT),
      }),
    )
    return false
  }
  const line = `${JSON.stringify({
    at: ctx.clock.now(),
    agent,
    session: input.session,
    cwd: proof?.cwd,
    recordedAt: proof?.recordedAt,
    prompt: proof?.prompt.slice(0, KEPT),
  })}\n`
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(promptPath(task, input.session), line)
  await ctx.fs.remove(pendingPath(task, input.session))
  return true
}

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

/** The last message of `session` the hook kept for this task, or null. */
export async function lastPrompt(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  session: string | null,
  after = -Infinity,
): Promise<string | null> {
  if (session === null || !safe(session)) return null
  try {
    if ((await activePromptTask(ctx, session))?.task.runtimeDir !== task.runtimeDir) return null
    const trusted = await ctx.fs.exists(promptPath(task, session))
    if (!trusted && !(await ctx.fs.exists(pendingPath(task, session))))
      return await ownChatMessage(ctx, task, session, after)
    const file = trusted ? promptPath(task, session) : pendingPath(task, session)
    const info = await ctx.fs.stat?.(file)
    if (info && info.size > KEPT * 4) return null
    const parsed = JSON.parse(await ctx.fs.readFile(file)) as {
      prompt?: unknown
      agent?: unknown
      session?: unknown
      recordedAt?: unknown
      cwd?: unknown
    }
    if (
      typeof parsed.prompt !== "string" ||
      !isNativeAgent(parsed.agent) ||
      parsed.session !== session ||
      (trusted && typeof parsed.recordedAt !== "number") ||
      typeof parsed.cwd !== "string"
    )
      return null
    const proof = await latestUserMessage(ctx, { agent: parsed.agent, session, cwd: parsed.cwd })
    return proof !== null &&
      proof.recordedAt > after &&
      (!trusted || proof.recordedAt === parsed.recordedAt) &&
      plain(proof.prompt.slice(0, KEPT)) === plain(parsed.prompt)
      ? proof.prompt
      : null
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
  if (session === null || !safe(session)) return []
  try {
    if ((await activePromptTask(ctx, session))?.task.runtimeDir !== task.runtimeDir) return []
    const identity = await promptIdentity(ctx, task, session)
    if (identity === null) return []
    const found = await userMessages(ctx, { ...identity, session })
    if (found === null) return []
    return found.flatMap((m) => (m !== null && m.recordedAt > after ? [m.prompt] : []))
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
  if (!safe(session)) return null
  const current = await activePromptTask(ctx, session)
  if (!current || !(await ctx.fs.exists(pendingPath(current.task, session)))) return null
  return lastPrompt(ctx, current.task, session)
}

const plain = (words: string) =>
  words
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()

/**
 * A message without what is not the person's own: harness envelopes, a paste marked as another's,
 * and quoted lines (`> …`). `typed` also leaves out every paste, for an approval.
 */
function ownWords(message: string, typed: boolean): string {
  const text = message
    .replace(
      /<(system-reminder|cross-session-message|task-notification)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "\n",
    )
    .replace(
      /<pasted_content\b[^>]*\borigin="(?!human")[^"]*"[^>]*>[\s\S]*?<\/pasted_content>/gi,
      "\n",
    )
  return (
    typed
      ? text.replace(/<pasted_content\b[^>]*>[\s\S]*?(?:<\/pasted_content>|$)/gi, "\n")
      : text.replace(/<\/?pasted_content\b[^>]*>/gi, "\n")
  )
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
}

/** Lower case, without quotation marks, `/ql` in front or extra spaces; line breaks stay. */
const lines = (words: string) =>
  words
    .replace(/^\s*[/$](?:ql|qualitylayer)\b[ \t]*/i, "")
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[ \t\r]+/g, " ")
    .replace(/ ?\n\s*/g, "\n")
    .trim()

const LETTER = /[\p{L}\p{N}]/u
/** A word right before that turns the words around ("do not approve"). */
const NEGATED = /(?:^|[^\p{L}\p{N}])(?:not|no|never|dont|without|isnt|wont|cant|shouldnt|nor)\s*$/u
/** A plain yes in front of the words, as in "ok approve it". */
const YES = /(?:^|[\s,.!])(?:yes|yeah|yep|ok|okay|sure)[ \t]*$/
/** Where a clause starts: the message's start, a line, punctuation, a list mark or a plain yes. */
const OPENS = new RegExp(String.raw`(?:(?:^|\n|[.!?;:,(]|(?:^|\s)[-*•])[ \t]*$)|${YES.source}`)
/** Where it ends: the message's end, a line, punctuation, or the next numbered or bulleted item. */
const CLOSES = /^[ \t]*(?:$|\n|[.!?;:,)]|(?:\d+[.)]|[-*•])\s)/

/**
 * Whether `message` holds `quote` as the person's own words, case, quotation marks and spacing
 * aside: whole words, never right after a "not". A short quote (a number, "ok") must be a clause
 * of its own; a `strict` one (an approval, a gate's answer) must also be typed, not pasted.
 */
export function heldIn(message: string, quote: string, strict = false): boolean {
  const q = trimEndCharacters(lines(ownWords(quote, false)).replace(/\n/g, " "), ".!").trim()
  if (q === "") return false
  const clause = strict || q.length <= 2 || /^\d+$/.test(q)
  const said = lines(ownWords(message, strict))
  const flat = said.replace(/\n/g, " ")
  for (let at = flat.indexOf(q); at >= 0; at = flat.indexOf(q, at + 1)) {
    const before = said.slice(0, at)
    const after = said.slice(at + q.length)
    if (LETTER.test(q[0] ?? "") && LETTER.test(before.at(-1) ?? "")) continue
    if (LETTER.test(q.at(-1) ?? "") && LETTER.test(after[0] ?? "")) continue
    if (NEGATED.test(before.replace(YES, ""))) continue
    if (!clause || (OPENS.test(before) && CLOSES.test(after))) return true
  }
  return false
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

/** "1." or "1)" before Approve, as a gate lists its choices: Approve is always the first. */
const FIRST = String.raw`(?:(?:option\s+|choice\s+|number\s+|no\.?\s+|#)?1\s*[.):–—-]?\s+)?`

export const explicitApproval = (words: string): boolean =>
  new RegExp(
    String.raw`^(?:[/$](?:ql|qualitylayer)\s+)?${FIRST}(?:(?:yes|yeah|yep|ok|okay|sure)[,.!]?\s+)?(?:(?:please|i)\s+)?approved?(?:\s+it|(?:\s+(?:the|this))?\s+(?:plan|change|review))?(?:\s+for me)?[\s.!]*$`,
    "i",
  ).test(words.trim())

export function chatApproval(words: string): boolean {
  const first = words.trimStart().split("\n", 1)[0] ?? ""
  return new RegExp(String.raw`^(?:\/ql\s+)?${FIRST}(?:approve|approved)[\s.!,;:]*$`, "i").test(
    first,
  )
}

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

/** Whether `quote` approves at all ("approve", "1. Approve"), wherever it was typed. */
export const approves = (quote: string): boolean => explicitApproval(quote) || chatApproval(quote)

/** What the CLI says when the words are not the person's: the one move the agent has. */
export const ASK_REFUSAL =
  "These words are not in a message the person typed in this chat since it was asked; do not quote again: ask them to answer in the App and run `qualitylayer wait`."

/**
 * What the CLI says when the quoted words are no approval ("go with your recommendation"): the
 * person may well have typed them, so the refusal says what is missing, not that they never did.
 */
export const NOT_AN_APPROVAL =
  "These words do not approve; only the person's own approve does. Run `qualitylayer wait --for approval`: they approve in the App or type approve here."
