// Whose a red project check is. A red check is a red gate: a reviewer's verdict never clears it. It
// stops being the task's to fix only for a reason the evidence shows, and this module is the one
// place that rule is read, for the final gate, the open items, the exit and the Review row:
//
//   on_base       the same command failed in the recorded run on the task's base commit
//                 (`check all --base`) and every test that fails now failed there too, by name;
//   kept          the person chose to keep it red at this revision (`next keep`);
//   new_failures  some tests fail now that did not fail on the base: the check stays open, naming them;
//   unmatched     red on the base too, but the failing tests cannot be matched by name (a lint, type
//                 or build check, or output with no test names): it stays open, the person decides.
//
// A check absent from the map has no such standing: it is the task's own to fix.

import type { Ctx } from "../ctx.ts"
import { compareFailures, failingTests } from "./check-failures.ts"
import {
  type CheckRecord,
  checksRanSinceAsked,
  commandsFor,
  latestRuns,
  readCheckRecords,
} from "./checks.ts"
import { buildRevision } from "./gate/revision.ts"
import { buildBase } from "./git/base.ts"
import { skippedRequiredRuns } from "./required-skips.ts"
import { readEvents, type Task } from "./task/store.ts"

export type RedStanding =
  | { state: "on_base" }
  | { state: "kept" }
  | { state: "new_failures"; names: string[]; known: number }
  | { state: "unmatched" }

export type Excusal = {
  standing: ReadonlyMap<CheckRecord, RedStanding>
  /** Dependency files the task changed: the base run borrowed this checkout's installed ones, so it proves nothing. */
  unfair: string[]
}

/** What a log shows when its middle was cut away to stay within its budget. */
const TRIMMED = "[Earlier command output was trimmed"

/**
 * The tests a recorded run's log reports as failed, or null when it names none that could be read.
 * A log that was trimmed may have lost a failure, so it is unread.
 */
async function failuresOf(ctx: Ctx, record: CheckRecord): Promise<string[] | null> {
  if (record.log === undefined) return null
  try {
    const text = await ctx.fs.readFile(record.log)
    return text.includes(TRIMMED) ? null : failingTests(text)
  } catch {
    return null
  }
}

/**
 * A run that ended the ordinary way for a failing check: it ran, did its work, exited with a small
 * failure code, and did not run out of time. A signal, a missing command or a timeout is none of
 * these, and proves nothing about which tests failed.
 */
const ordinaryRed = (run: CheckRecord | undefined): run is CheckRecord => {
  if (!run?.ran || run.notRun !== undefined || run.timedOut === true) return false
  return run.exit !== null && run.exit > 0 && run.exit < 126
}

/** A manifest or lockfile: what the base checkout's borrowed dependencies stand in for. */
const DEPENDENCY_FILE =
  /(?:^|\/)(?:package\.json|bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|pyproject\.toml|requirements[^/]*\.txt|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum)$/

/** The dependency files the task changed against the base. */
async function changedDependencies(ctx: Ctx, task: Task, base: string): Promise<string[]> {
  const changed = await ctx.git.run(task.repoRoot, ["diff", "--name-only", base, "--"])
  const added = await ctx.git.run(task.repoRoot, ["ls-files", "--others", "--exclude-standard"])
  if (changed.code !== 0 || added.code !== 0)
    return ["(the changes against the base could not be listed)"]
  return [...new Set(`${changed.stdout}\n${added.stdout}`.split("\n"))].filter((file) =>
    DEPENDENCY_FILE.test(file.trim()),
  )
}

/** A red result and the base run of its command, both ended the ordinary way: how they compare. */
async function againstBase(
  ctx: Ctx,
  now: CheckRecord,
  base: CheckRecord,
  unfair: boolean,
): Promise<RedStanding> {
  if (unfair) return { state: "unmatched" }
  const same = compareFailures(await failuresOf(ctx, now), await failuresOf(ctx, base))
  if (same.state === "known") return { state: "on_base" }
  return same.state === "fresh"
    ? { state: "new_failures", names: same.fresh, known: same.known }
    : { state: "unmatched" }
}

/**
 * The standing of each red project result of the current revision that has one. A run that did not
 * end the ordinary way is never compared, and neither is any run when the task changed a dependency
 * file (`unfair`). Red on the base wins over kept by the person. With the revision unreadable
 * nothing can be said to be excused.
 */
export async function excusedChecks(
  ctx: Ctx,
  task: Task,
  records: readonly CheckRecord[],
  revision: string | null,
  asRecorded = false,
): Promise<Excusal> {
  const standing = new Map<CheckRecord, RedStanding>()
  const current = latestRuns(records.filter((r) => r.scope === "all"))
  if (current.length === 0 || revision === null) return { standing, unfair: [] }
  const baseRuns = records.filter((r) => r.scope === "base")
  const base = baseRuns.length > 0 ? await buildBase(ctx, task).catch(() => null) : null
  const baseOf = new Map(
    latestRuns(baseRuns.filter((r) => r.revision === base)).map((r) => [r.command, r]),
  )
  const unfair = base !== null && baseOf.size > 0 ? await changedDependencies(ctx, task, base) : []
  const kept = new Set(
    (await readEvents(ctx, task))
      .filter((e) => e.event === "check_kept_red" && e.revision === revision)
      .flatMap((e) => (Array.isArray(e.commands) ? (e.commands as string[]) : [])),
  )
  for (const result of current) {
    // A run that stands as recorded is excused like one on this revision: the person's Keep and
    // the base run cover it too.
    if (!asRecorded && result.revision !== revision) continue
    const ran = baseOf.get(result.command)
    const found =
      ordinaryRed(result) && ordinaryRed(ran)
        ? await againstBase(ctx, result, ran, unfair.length > 0)
        : undefined
    if (found?.state === "on_base") standing.set(result, found)
    else if (kept.has(result.command)) standing.set(result, { state: "kept" })
    else if (found !== undefined) standing.set(result, found)
  }
  return { standing, unfair }
}

/** The new failures in a red result's standing, or none. */
export const newFailures = (excusal: Excusal, record: CheckRecord): string[] => {
  const standing = excusal.standing.get(record)
  return standing?.state === "new_failures" ? standing.names : []
}

/**
 * The approved project checks whose latest result on the current inputs is red (a failure, a
 * timeout, an interruption) and is the task's to fix: not red on the base too, not kept red by the
 * person, not a required line skipped with a reason. They keep the task from Review whatever the
 * reviewer ruled. `excused` is what the same read found about the red results: one rule for the
 * final gate and for the open items.
 */
function isUnexcusedRed(
  last: CheckRecord | undefined,
  skipped: readonly string[],
  command: string,
  currentRevision: { asRecorded: boolean; revision: string | null },
  excused: Excusal,
): last is CheckRecord {
  if (!last?.ran || (last.exit === 0 && !last.timedOut)) return false
  if (skipped.includes(command)) return false
  const matchesRevision =
    currentRevision.asRecorded ||
    currentRevision.revision === null ||
    last.revision === currentRevision.revision
  const state = excused.standing.get(last)?.state
  return matchesRevision && state !== "on_base" && state !== "kept"
}

export async function projectRedState(
  ctx: Ctx,
  task: Task,
  known?: readonly CheckRecord[],
  recorded?: boolean,
): Promise<{ red: CheckRecord[]; excused: Excusal }> {
  const records = known ?? (await readCheckRecords(ctx, task))
  const revision = await buildRevision(ctx, task).catch(() => null)
  const found = await commandsFor(ctx, task, { kind: "all" })
  if (!found.ok)
    return { red: [], excused: await excusedChecks(ctx, task, records, revision, recorded) }
  const runs = records.filter((r) => r.scope === "all")
  // A red run whose inputs moved since still counts when the agent ran the checks after it was
  // asked and only another session's files moved: the gate, the open items and the person's Keep
  // all read it the same way.
  const stale = found.data.now.some((command) => {
    const last = runs.filter((r) => r.command === command).at(-1)
    return last?.ran && (last.exit !== 0 || last.timedOut) && last.revision !== revision
  })
  const asRecorded =
    recorded ?? (stale && revision !== null && (await checksRanSinceAsked(ctx, task)))
  const excused = await excusedChecks(ctx, task, records, revision, asRecorded)
  const skipped = await skippedRequiredRuns(ctx, task)
  const red: CheckRecord[] = []
  for (const command of found.data.now) {
    const last = runs.filter((r) => r.command === command).at(-1)
    if (isUnexcusedRed(last, skipped, command, { asRecorded, revision }, excused)) red.push(last)
  }
  return { red, excused }
}

export async function redProjectChecks(ctx: Ctx, task: Task): Promise<CheckRecord[]> {
  return (await projectRedState(ctx, task)).red
}
