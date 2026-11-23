// The retention sweep: one owner for every expiry rule of the QualityLayer home. A pure plan decides
// what goes (offsets, idle live sessions and bindings, the old part of raw check logs, old cost
// months) and what a home over its size limit gives up next; a thin applier acts through the
// harness's file system under the sweep's lock. A task's event log and verdicts are never trimmed:
// the workflow reads them to decide.

import { basename, join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { archiveMonths, forgetDeadTasks, indexSessions } from "./cost/ledger.ts"
import { newestBytes } from "./home-caps.ts"
import {
  planSweep,
  RETENTION,
  type Retention,
  type SweepEntry,
  type SweepPlan,
} from "./retention-plan.ts"
import { pruneTaskRuns } from "./retention-runs.ts"
import { scanHome } from "./retention-scan.ts"
import {
  RETENTION_LOCK,
  RETENTION_STAMP,
  serverSweepDue,
  startDueSweep,
  startRetention,
  sweepDue,
} from "./retention-schedule.ts"
import { pruneCompletedRun } from "./run/lease.ts"
import { VERSION } from "./version.ts"

export {
  planSweep,
  pruneTaskRuns,
  RETENTION,
  type Retention,
  type SweepEntry,
  type SweepPlan,
  serverSweepDue,
  startDueSweep,
  startRetention,
  sweepDue,
}

export type SweepReport = {
  offsets: number
  liveSessions: number
  bindings: number
  runs: number
  cut: number
  archivedMonths: string[]
  /** Entries of `cost/tasks.json` whose task folder was gone. */
  taskIndex: number
  /** Deletes and cuts that failed (a file another process holds): retried at the next sweep. */
  skipped: number
  /** The home outside task folders, before the sweep. */
  homeBytes: number
  overLimit: boolean
  /** Another sweep held the lock: nothing was done. */
  busy?: true
}

const CRASH_LOG = "crash.log"
const CRASH_CAP_BYTES = 256 * 1024

const emptyReport = (): SweepReport => ({
  offsets: 0,
  liveSessions: 0,
  bindings: 0,
  runs: 0,
  cut: 0,
  archivedMonths: [],
  taskIndex: 0,
  skipped: 0,
  homeBytes: 0,
  overLimit: false,
})

/** Rewrite a log as its newest `keepBytes`, reading only the tail when the file system can. */
async function cutLog(ctx: Ctx, path: string, keepBytes: number): Promise<void> {
  const size = (await ctx.fs.stat?.(path))?.size ?? 0
  const text =
    ctx.fs.readRange !== undefined && size > keepBytes
      ? await ctx.fs.readRange(path, size - keepBytes - 8, keepBytes + 8)
      : await ctx.fs.readFile(path)
  if (!(await ctx.fs.exists(ctx.home))) return
  await ctx.fs.atomicWrite(path, newestBytes(text, keepBytes))
}

/** One plain line in `<home>/crash.log`, cut back first when over its cap. Never throws. */
async function note(ctx: Ctx, text: string): Promise<void> {
  try {
    if (!(await ctx.fs.exists(ctx.home))) return
    const path = join(ctx.home, CRASH_LOG)
    if (((await ctx.fs.stat?.(path))?.size ?? 0) > CRASH_CAP_BYTES)
      await cutLog(ctx, path, CRASH_CAP_BYTES / 2)
    await ctx.fs.append(path, `${new Date().toISOString()} retention v${VERSION} ${text}\n`)
  } catch {
    // A log that cannot be written costs the line, never the sweep.
  }
}

async function applyRemovals(
  ctx: Ctx,
  plan: SweepPlan,
  entries: readonly SweepEntry[],
  report: SweepReport,
): Promise<void> {
  const kinds = new Map(entries.map((e) => [e.path, e.kind]))
  const generations = new Map(entries.map((e) => [e.path, e.generation]))
  for (const path of plan.remove) {
    const kind = kinds.get(path)
    const isRun = kind === "run-completed" || kind === "run-failed-unbound"
    try {
      if (isRun && !(await pruneCompletedRun(ctx, basename(path), generations.get(path) ?? -1))) {
        report.skipped++
        continue
      }
      if (!isRun) await ctx.fs.remove(path)
    } catch {
      report.skipped++
      continue
    }
    if (kind === "offset") report.offsets++
    else if (kind === "live-session") report.liveSessions++
    else if (isRun) report.runs++
    else report.bindings++
  }
}

async function applyArchives(
  ctx: Ctx,
  months: readonly string[],
  report: SweepReport,
): Promise<void> {
  if (months.length === 0) return
  // The cutoff an archive sets drops every call of an archived month that a transcript read brings
  // later, so each known task's transcripts are indexed first. When that fails nothing is archived.
  try {
    await indexSessions(ctx)
  } catch {
    report.skipped++
    return
  }
  // One month at a time: a month Windows holds open is skipped, and the next sweep retries it.
  for (const month of months) {
    try {
      report.archivedMonths.push(...(await archiveMonths(ctx, [month])))
    } catch {
      report.skipped++
    }
  }
}

async function sweepLocked(ctx: Ctx, now: number, limits: Retention): Promise<SweepReport> {
  await ctx.fs.atomicWrite(
    join(ctx.home, RETENTION_STAMP),
    `${JSON.stringify({ startedAt: now })}\n`,
  )
  const entries = await scanHome(ctx, now)
  const plan = planSweep(entries, now, limits)
  const report = emptyReport()
  report.homeBytes = entries.reduce((sum, e) => (e.area === "tasks" ? sum : sum + e.size), 0)
  await applyRemovals(ctx, plan, entries, report)
  for (const { path, keepBytes } of plan.cut) {
    try {
      await cutLog(ctx, path, keepBytes)
      report.cut++
    } catch {
      report.skipped++
    }
  }
  await applyArchives(ctx, plan.archive, report)
  if (plan.pruneTaskIndex) {
    const gone = await forgetDeadTasks(ctx).catch(() => 0)
    report.taskIndex = gone
    if (gone > 0) await note(ctx, `home over its limit: dropped ${gone} entries of dead tasks`)
  }
  for (const what of plan.early) await note(ctx, `home over its limit: removed ${what} early`)
  if (plan.overLimit !== null) {
    report.overLimit = true
    const shares = Object.entries(plan.overLimit.shares)
      .sort((a, b) => b[1] - a[1])
      .map(([area, bytes]) => `${area}=${bytes}`)
      .join(" ")
    await note(
      ctx,
      `home still over its limit: size=${plan.overLimit.size} limit=${limits.homeBytes} ${shares}`,
    )
  }
  return report
}

/**
 * Sweep the home once: the plan over what is there, applied under `retention.lock`. The start time
 * goes to `retention.json` first, so a sweep that is slow or fails is not started again at every
 * prompt. A delete that fails is skipped and the sweep goes on.
 */
export async function sweepHome(
  ctx: Ctx,
  now: number,
  limits: Retention = RETENTION,
): Promise<SweepReport> {
  // A home that is gone (a machine being cleaned, a test's folder removed under a late sweep) has
  // nothing to sweep, and a sweep must never bring its folder back.
  if (!(await ctx.fs.exists(ctx.home))) return emptyReport()
  try {
    // The lock never creates the home: one removed after the check above ends the sweep here.
    return await ctx.fs.withLock(
      join(ctx.home, RETENTION_LOCK),
      () => sweepLocked(ctx, now, limits),
      { waitMs: 0, label: "the retention sweep", createParent: false },
    )
  } catch (cause) {
    if (/busy at/.test(String((cause as Error)?.message))) return { ...emptyReport(), busy: true }
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT" && !(await ctx.fs.exists(ctx.home)))
      return emptyReport()
    throw cause
  }
}
