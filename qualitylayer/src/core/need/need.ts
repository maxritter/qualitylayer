// A need of the autonomous build: the one thing only the person can do (a secret, a login, an
// account, a paid service, a permission the sandbox refuses), recorded without stopping anything.
// Implement and Verify's checks continue with available work; unresolved needs wait for the
// person's review in Verify.
// The person sets it in their own environment and says so in the App
// ("Done, it's set", with an optional note that may never hold a key); the agent checks that the
// variable or file exists, without printing it, and marks it resolved or reopens it.
//
//   needs.json   every need of the task, in the order they were recorded

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { KEY_REFUSED, looksLikeKey } from "./key.ts"
import { defaultSteps, secretPlace, validateNeedInput } from "./need-input.ts"

export { needQuestionText, recordPickedNeed, terminalNeed } from "./need-terminal.ts"
export {
  NEED_HEARTBEAT_MS,
  NEED_UNTIL_EVENT_MS,
  NEED_WAIT_SLICE_MS,
  needSlackDue,
  waitForNeed,
} from "./need-wait.ts"
export { KEY_REFUSED, looksLikeKey, secretPlace }

export const NEED_KINDS = ["secret", "login", "account", "service", "permission"] as const
export type NeedKind = (typeof NEED_KINDS)[number]

export type NeedState =
  /** Recorded; the build goes on without it. */
  | "open"
  /** The person said it is set; the agent has not checked yet. */
  | "set"
  /** The agent found it. */
  | "resolved"

export type Need = {
  /** The task that waits for it: `T14`. */
  for: string
  /** What is needed, one sentence: the card's title. */
  what: string
  /** Why, in the agent's words: what the task does with it and why the agent cannot get it. */
  why: string
  kind: NeedKind
  /** The environment variable or the file the agent checks for. */
  check: string | null
  /** At most two steps for the person, in the agent's words or the kind's own. */
  steps: string[]
  /** Where a secret goes: the project's own convention, else `.env.local` in the worktree. */
  place: string | null
  /** Git ignores the place, so a secret put there is never committed. */
  ignored: boolean
  state: NeedState
  opened: number
  /** Since when the build waits for it alone (`need wait` runs); null while the build goes on. */
  waiting: number | null
  /** The person's "Done, it's set": when, and their note (never a key). */
  set: { at: number; note: string } | null
  /** The agent did not find it: when and why. */
  reopened: { at: number; why: string } | null
  resolved: number | null
  /** The set was handed to the agent (by `need wait` or the next call): it is not told twice. */
  told: boolean
}

const MAX_STEPS = 2
const path = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "needs.json")

export async function readNeeds(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<Need[]> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(path(task))) as { needs?: unknown }
    return Array.isArray(parsed.needs) ? (parsed.needs as Need[]) : []
  } catch {
    return []
  }
}

export async function writeNeeds(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  needs: Need[],
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(path(task), `${JSON.stringify({ needs }, null, 2)}\n`)
}

/** The needs a task still waits for: open, or set and not checked yet. */
export const openNeeds = (needs: readonly Need[]): Need[] =>
  needs.filter((n) => n.state !== "resolved")

/** The task ids that wait for a need, upper case. */
export const neededTasks = (needs: readonly Need[]): Set<string> =>
  new Set(openNeeds(needs).map((n) => n.for.toUpperCase()))

export const parseNeedTaskId = (word: string): string | null => {
  const match = /^t?(\d+)$/i.exec(word.trim())
  return match !== null ? `T${match[1]}` : null
}

export type NeedInput = {
  words: string
  for: string
  kind?: string
  check?: string
  steps?: string[]
}

/** Record a need, or update the same active need. The build goes on. */
export async function recordNeed(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "repoRoot">,
  input: NeedInput,
): Promise<Result<Need>> {
  const validated = validateNeedInput(input)
  if (!validated.ok) return validated
  const { id, kind, what, why, check } = validated.data
  const { place, ignored } =
    kind === "secret" ? await secretPlace(ctx, task.repoRoot) : { place: null, ignored: false }
  const steps = (input.steps ?? []).map((s) => s.trim()).filter((s) => s !== "")
  const named = [
    ...steps,
    ...(steps.length < MAX_STEPS ? defaultSteps(kind, check, place, ignored) : []),
  ]
  const needs = await readNeeds(ctx, task)
  const now = ctx.clock.now()
  const before = needs.find((n) => n.for === id && n.state !== "resolved")
  if (
    before !== undefined &&
    (before.kind !== kind || before.what !== what || before.check !== check)
  )
    return err({
      code: "bad_args",
      message: `${id} already has an active ${before.kind} need: "${before.what}". It was kept unchanged. Only one active need per card is supported; keep the same title, kind and check to update its explanation or steps. Resolve it with \`qualitylayer need resolved ${id}\` only after checking it is satisfied, then record the next need, or use another actual card that waits for the new need.`,
    })
  const need: Need = {
    for: id,
    what,
    why,
    kind,
    check,
    steps: named.slice(0, MAX_STEPS),
    place,
    ignored,
    state: before?.state ?? "open",
    opened: before?.opened ?? now,
    waiting: before?.waiting ?? null,
    set: before?.set ?? null,
    reopened: before?.reopened ?? null,
    resolved: null,
    told: before?.told ?? false,
  }
  await writeNeeds(
    ctx,
    task,
    before !== undefined ? needs.map((n) => (n === before ? need : n)) : [...needs, need],
  )
  return ok(need)
}

export async function updateNeed(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  word: string,
  change: (need: Need) => Need | string,
): Promise<Result<Need>> {
  const id = parseNeedTaskId(word)
  if (id === null)
    return err({ code: "bad_args", message: `name the task, like T14 (not "${word}")` })
  const needs = await readNeeds(ctx, task)
  const at = needs.findLastIndex((n) => n.for === id)
  const found = needs[at]
  if (found === undefined)
    return err({ code: "bad_args", message: `no need is recorded for ${id}` })
  const changed = change(found)
  if (typeof changed === "string") return err({ code: "bad_args", message: changed })
  await writeNeeds(
    ctx,
    task,
    needs.map((n, i) => (i === at ? changed : n)),
  )
  return ok(changed)
}

/** The person's "Done, it's set", from the App. A note that looks like a key is refused. */
export function markSet(ctx: Ctx, task: Pick<Task, "runtimeDir">, word: string, note: string) {
  const said = note.replace(/\s+/g, " ").trim().slice(0, 300)
  if (looksLikeKey(said)) return Promise.resolve(err({ code: "bad_args", message: KEY_REFUSED }))
  return updateNeed(ctx, task, word, (need) =>
    need.state === "resolved"
      ? "the agent found it already"
      : { ...need, state: "set", set: { at: ctx.clock.now(), note: said }, told: false },
  )
}

/** The agent found the variable or the file. */
export const markResolved = (ctx: Ctx, task: Pick<Task, "runtimeDir">, word: string) =>
  updateNeed(ctx, task, word, (need) => ({
    ...need,
    state: "resolved",
    resolved: ctx.clock.now(),
    waiting: null,
  }))

/** The agent did not find it: the need is open again, with why. */
export const markReopened = (ctx: Ctx, task: Pick<Task, "runtimeDir">, word: string, why: string) =>
  updateNeed(ctx, task, word, (need) => {
    const said = why.replace(/\s+/g, " ").trim()
    if (said === "") return 'say why: need reopen T14 "<what you did not find>"'
    if (looksLikeKey(said)) return "a need never carries a key: name it, never paste it"
    return {
      ...need,
      state: "open",
      set: null,
      told: false,
      reopened: { at: ctx.clock.now(), why: said },
    }
  })

/** What the agent is told once the person said it is set: check it, never print it, and say how it went. */
export const checkThen = (need: Need): string =>
  `${need.check !== null ? `Check that ${need.check} exists` : "Check that it is there"} without printing its value, then run \`qualitylayer need resolved ${need.for}\`, or \`qualitylayer need reopen ${need.for} "<what you did not find>"\`.`

/** The build has work again: no need is waited for alone. */
export async function stopWaiting(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<void> {
  const needs = await readNeeds(ctx, task)
  if (!needs.some((n) => n.waiting !== null)) return
  await writeNeeds(
    ctx,
    task,
    needs.map((n) => ({ ...n, waiting: null })),
  )
}

/** The needs the person set that the agent has not been told about yet; they are marked told. */
export async function takeSetNeeds(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<Need[]> {
  const needs = await readNeeds(ctx, task)
  const fresh = needs.filter((n) => n.state === "set" && !n.told)
  if (fresh.length === 0) return []
  await writeNeeds(
    ctx,
    task,
    needs.map((n) => (fresh.includes(n) ? { ...n, told: true } : n)),
  )
  return fresh
}
