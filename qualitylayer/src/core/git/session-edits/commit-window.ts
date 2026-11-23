import { join } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import { projectRuntimeDir } from "../../paths.ts"
import {
  CommitSettlement,
  type CommitWindow,
  callName,
  type SettlementEvent,
} from "./commit-settlement.ts"
import type { HookCall } from "./process.ts"
import { asObject, COMMIT_ID, editsDir, keptRecord, readEdits, writeRecord } from "./records.ts"
import { shellCommits } from "./shell.ts"

/** Beside the edit records, not among them: their readers take every file there for a session's. */
const startsFile = (ctx: Ctx, repoId: string, key: string) =>
  join(projectRuntimeDir(ctx, repoId), "commit-starts", `${key}.json`)

async function readWindow(ctx: Ctx, file: string): Promise<CommitWindow> {
  const window: CommitWindow = { starts: Object.create(null) }
  const point = (value: unknown) => {
    const read = asObject(value)
    return typeof read?.head === "string" && COMMIT_ID.test(read.head) && Number.isFinite(read.at)
      ? { head: read.head, at: read.at as number }
      : null
  }
  try {
    const read = asObject(JSON.parse(await ctx.fs.readFile(file))) ?? {}
    for (const [name, value] of Object.entries(asObject(read.starts) ?? {})) {
      const start = point(value)
      if (start === null) continue
      const proc = asObject(value)?.proc
      window.starts[name] =
        asObject(value)?.yielded === true
          ? { ...start, yielded: true, ...(typeof proc === "string" ? { proc } : {}) }
          : start
    }
    const seen = point(read.seen)
    if (seen !== null) window.seen = seen
  } catch {
    // None noted yet.
  }
  return window
}

async function writeWindow(
  ctx: Ctx,
  repoId: string,
  file: string,
  window: CommitWindow,
): Promise<void> {
  // A call whose end never came leaves its note behind: the newest few are kept.
  const starts = Object.entries(window.starts)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, 16)
  await ctx.fs.mkdir(join(projectRuntimeDir(ctx, repoId), "commit-starts"))
  await ctx.fs.atomicWrite(
    file,
    `${JSON.stringify({ starts: Object.fromEntries(starts), seen: window.seen })}\n`,
  )
}

async function headCommit(ctx: Ctx, root: string): Promise<string | null> {
  const head = await ctx.git.run(root, ["rev-parse", "--verify", "HEAD^{commit}"], { fresh: true })
  const sha = head.stdout.trim()
  return head.code === 0 && COMMIT_ID.test(sha) ? sha : null
}

/**
 * Before a shell call that can commit runs (`shellCommits`), notes where HEAD stands and when: the
 * call's second hook (`settleCommits`) then knows which commits the call itself created.
 * `id` is the tool call's id where the agent gives one.
 */
type CommitStartObservation = {
  repo: { id: string; root: string }
  key: string
  call: Pick<HookCall, "tool" | "input" | "id">
}

export async function noteCommitStart(
  ctx: Ctx,
  observation: CommitStartObservation,
): Promise<void> {
  const {
    repo,
    key,
    call: { tool, input, id },
  } = observation
  if (!shellCommits(tool, input)) return
  const head = await headCommit(ctx, repo.root)
  if (head === null) return
  const file = startsFile(ctx, repo.id, key)
  const window = await readWindow(ctx, file)
  window.starts[callName(id, input)] = { head, at: ctx.clock.now() }
  // HEAD as the session's hooks last found it, for a later call whose first hook does not run.
  if (window.seen?.head !== head) window.seen = { head, at: ctx.clock.now() }
  await writeWindow(ctx, repo.id, file, window)
}

/**
 * Reads HEAD at a hook event of the session `key`, building `task`, and says which commits its
 * shell calls created by hand (`git commit` and the other commands `shellCommits` knows): the
 * task's own, although no `commit slice` or `commit fix` registered them. Every hook event calls
 * it: a tool call's end (`call`, whether it succeeded or failed), any other event, and the end of
 * a turn or a session (`ended`).
 */
export async function settleCommits(
  ctx: Ctx,
  repo: { id: string; root: string },
  key: string,
  task: string,
  event: SettlementEvent = {},
): Promise<{ made: string[]; gained: string[]; unsure: boolean }> {
  const call = event.call
  const capable = call !== undefined && shellCommits(call.tool, call.input)
  const file = startsFile(ctx, repo.id, key)
  const window = await readWindow(ctx, file)
  if (!capable && event.ended === undefined && Object.keys(window.starts).length === 0)
    return { made: [], gained: [], unsure: false }
  const head = await headCommit(ctx, repo.root)
  if (head === null) return { made: [], gained: [], unsure: capable }
  const before = JSON.stringify(window)
  const settlement = new CommitSettlement(ctx, repo.root, window, event, head)
  const noted = settlement.name !== null && window.starts[settlement.name] !== undefined
  await settlement.reconcileNoted()
  if (settlement.name !== null && !noted) await settlement.reconcileUnnoted()
  settlement.closeEndedProcess()
  const { made, gained, unsure } = settlement
  if (window.seen?.head !== head) window.seen = { head, at: ctx.clock.now() }
  if (JSON.stringify(window) !== before) await writeWindow(ctx, repo.id, file, window)
  for (const sha of made) gained.delete(sha)
  if (made.size > 0) {
    const record = join(editsDir(ctx, repo.id), `${key}.json`)
    const now = ctx.clock.now()
    const kept = keptRecord(await readEdits(ctx, record), task, now)
    // The first time a commit was seen stands.
    for (const sha of made) kept.commits[sha] ??= now
    await writeRecord(ctx, repo.id, record, kept)
  }
  return { made: [...made], gained: [...gained], unsure }
}
