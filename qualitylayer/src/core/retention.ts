// The retention sweep: one owner for every expiry rule of the QualityLayer home. A pure plan decides
// what goes (offsets, idle live sessions and bindings, the old part of raw check logs, old cost
// months) and what a home over its size limit gives up next; a thin applier acts through the
// harness's file system under the sweep's lock. A task's event log and verdicts are never trimmed:
// the workflow reads them to decide.

import { spawn } from "node:child_process"
import { basename, join, resolve, sep } from "node:path"
import type { Ctx } from "../ctx.ts"
import { archiveMonths, forgetDeadTasks, indexSessions } from "./cost/ledger.ts"
import {
  CHECK_LOG_MAX_BYTES,
  LOG_CAP_BYTES,
  newestBytes,
  RUN_RECORD_MAX_BYTES,
  RUNS_COMPLETED_DAYS,
  RUNS_COMPLETED_KEPT,
  RUNS_UNBOUND_FAILED_HOURS,
  THUMB_CACHE_BYTES,
  THUMB_FILES_KEPT,
} from "./home-caps.ts"
import { isUnderTempDir } from "./platform.ts"
import type { RunRecord } from "./run/contracts.ts"
import { pruneCompletedRun } from "./run/lease.ts"
import { identityState } from "./run/registry.ts"
import { pidAlive, selfCommand } from "./self.ts"
import { VERSION } from "./version.ts"
import { VIEWING_FRESH_MS } from "./viewing.ts"

const MB = 1024 * 1024
const DAY = 24 * 60 * 60 * 1000

export const RETENTION = {
  /** Calendar months of cost detail kept: the current one and the two before it. */
  costMonthsKept: 3,
  /** Above this, the oldest kept month is archived early. */
  costDetailBytes: 300 * MB,
  /** `cost/offsets/<sha>.json` not touched for this long goes. */
  offsetIdleDays: 90,
  /** Never more offset files than this, oldest first. */
  offsetsKept: 2_000,
  /** `tasks/<slug>/live/<session>/` with no hook write for this long goes. */
  liveSessionDays: 7,
  /** `projects/<id>/sessions/<key>.json` older than this goes. */
  bindingDays: 30,
  /** Each task's raw check logs and `windows-process-query.log` keep their newest bytes. */
  appendLogBytes: CHECK_LOG_MAX_BYTES,
  /** The home outside task folders and installed tools. */
  homeBytes: 400 * MB,
  runsKept: RUNS_COMPLETED_KEPT,
  runDays: RUNS_COMPLETED_DAYS,
  failedRunHours: RUNS_UNBOUND_FAILED_HOURS,
}
export type Retention = typeof RETENTION

export type SweepEntryKind =
  | "offset"
  | "live-session"
  | "binding"
  | "viewing"
  | "append-log"
  | "thumbnail"
  | "cost-month"
  | "other"
  | "run-completed"
  | "run-failed-unbound"
  | "run-live"

/** What the sweep knows about one thing in the home: `area` is its top folder, `tasks` for a task folder. */
export type SweepEntry = {
  path: string
  kind: SweepEntryKind
  area: string
  mtimeMs: number
  size: number
  expiredTask?: boolean
  capBytes?: number
  generation?: number
}

export type SweepPlan = {
  /** Offsets, live sessions and bindings to delete. */
  remove: string[]
  /** Logs to rewrite as their newest bytes. */
  cut: { path: string; keepBytes: number }[]
  /** Cost months (`YYYY-MM`) to archive, oldest first. */
  archive: string[]
  /** Drop `cost/tasks.json` entries whose task folder is gone. */
  pruneTaskIndex: boolean
  /** One crash.log line for each kind of removal the size limit forced. */
  early: string[]
  /** The home's size and each top folder's share, when it is still over the limit. */
  overLimit: { size: number; shares: Record<string, number> } | null
}

/** Files a task's workflow reads to decide: never part of a plan. */
const PROTECTED = /^(?:events\.ndjson|verdicts.*)$/

const monthOf = (entry: SweepEntry): string | null =>
  /^(\d{4}-\d{2})\.ndjson$/.exec(basename(entry.path))?.[1] ?? null

const byAge = (a: SweepEntry, b: SweepEntry) =>
  a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path)

/** The oldest calendar month (`YYYY-MM`) whose cost detail is still kept at `now`. */
function keptMonthsFrom(now: number, limits: Retention): string {
  const at = new Date(now)
  const first = at.getFullYear() * 12 + at.getMonth() - (limits.costMonthsKept - 1)
  return `${Math.floor(first / 12)}-${String((first % 12) + 1).padStart(2, "0")}`
}

/** What to remove or cut, and what a home over its limit gives up. Pure: the same entries give the same plan. */
export function planSweep(entries: SweepEntry[], now: number, limits: Retention): SweepPlan {
  const live = entries.filter((e) => !PROTECTED.test(basename(e.path)))
  const left = new Map<SweepEntry, number>(live.map((e) => [e, e.size]))
  const remove: string[] = []
  const cut: SweepPlan["cut"] = []
  const archive: string[] = []
  const early: string[] = []
  const counted = (e: SweepEntry) => e.area !== "tasks"
  const sizeNow = () => {
    let total = 0
    for (const [e, bytes] of left) if (counted(e)) total += bytes
    return total
  }
  const drop = (e: SweepEntry) => {
    remove.push(e.path)
    left.set(e, 0)
  }

  // Age rules.
  const offsets = live.filter((e) => e.kind === "offset").sort(byAge)
  const idle = now - limits.offsetIdleDays * DAY
  for (const e of offsets) if (e.mtimeMs < idle) drop(e)
  const fresh = offsets.filter((e) => left.get(e) !== 0)
  for (const e of fresh.slice(0, Math.max(0, fresh.length - limits.offsetsKept))) drop(e)
  for (const e of live) {
    const age = now - e.mtimeMs
    if (e.kind === "live-session" && age > limits.liveSessionDays * DAY) drop(e)
    if (e.kind === "binding" && age > limits.bindingDays * DAY) drop(e)
    if (e.kind === "viewing" && (e.expiredTask || age >= VIEWING_FRESH_MS)) drop(e)
    if (e.kind === "append-log" && e.size > (e.capBytes ?? limits.appendLogBytes)) {
      const keepBytes = e.capBytes ?? limits.appendLogBytes
      cut.push({ path: e.path, keepBytes })
      left.set(e, keepBytes)
    }
  }
  const thumbnails = live.filter((entry) => entry.kind === "thumbnail").sort(byAge)
  let thumbnailBytes = thumbnails.reduce((sum, entry) => sum + entry.size, 0)
  let thumbnailFiles = thumbnails.length
  for (const thumbnail of thumbnails) {
    if (thumbnailFiles <= THUMB_FILES_KEPT && thumbnailBytes <= THUMB_CACHE_BYTES) break
    drop(thumbnail)
    thumbnailFiles--
    thumbnailBytes -= thumbnail.size
  }
  const completed = live
    .filter((e) => e.kind === "run-completed" || e.kind === "run-failed-unbound")
    .sort(byAge)
  for (const e of completed) {
    const age = now - e.mtimeMs
    if (
      e.expiredTask ||
      age > limits.runDays * DAY ||
      (e.kind === "run-failed-unbound" && age > limits.failedRunHours * 3_600_000)
    )
      drop(e)
  }
  const remainingRuns = completed.filter((e) => left.get(e) !== 0)
  for (const e of remainingRuns.slice(0, Math.max(0, remainingRuns.length - limits.runsKept)))
    drop(e)
  const keptFrom = keptMonthsFrom(now, limits)
  const months = live
    .filter((e) => e.kind === "cost-month" && monthOf(e) !== null)
    .sort((a, b) => (monthOf(a) as string).localeCompare(monthOf(b) as string))
  const archived = (e: SweepEntry) => {
    archive.push(monthOf(e) as string)
    left.set(e, 0)
  }
  for (const e of months) if ((monthOf(e) as string) < keptFrom) archived(e)
  const keptMonths = () => months.filter((e) => left.get(e) !== 0)
  const detail = () => keptMonths().reduce((sum, e) => sum + (left.get(e) ?? 0), 0)
  // The newest month stays: it is where the next calls are written.
  const archiveOldestKept = (): boolean => {
    const kept = keptMonths()
    if (kept.length < 2 || kept[0] === undefined) return false
    archived(kept[0])
    return true
  }
  while (detail() > limits.costDetailBytes && archiveOldestKept()) early.push("cost detail")

  // Size pass: offsets, then the task index, then the oldest kept month.
  let pruneTaskIndex = false
  if (sizeNow() > limits.homeBytes) {
    let dropped = 0
    for (const e of fresh) {
      if (sizeNow() <= limits.homeBytes) break
      drop(e)
      dropped++
    }
    if (dropped > 0) early.push("offsets")
  }
  if (sizeNow() > limits.homeBytes) pruneTaskIndex = true
  while (sizeNow() > limits.homeBytes && archiveOldestKept()) early.push("cost month")

  let overLimit: SweepPlan["overLimit"] = null
  const size = sizeNow()
  if (size > limits.homeBytes) {
    const shares: Record<string, number> = {}
    for (const [e, bytes] of left)
      if (counted(e) && bytes > 0) shares[e.area] = (shares[e.area] ?? 0) + bytes
    overLimit = { size, shares }
  }
  return { remove, cut, archive, pruneTaskIndex, early, overLimit }
}

// ---------------------------------------------------------------------------- the applier

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

const RETENTION_STAMP = "retention.json"
const RETENTION_LOCK = "retention.lock"
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

type Walked = { size: number; newest: number | null }

async function retentionRun(ctx: Ctx, dir: string): Promise<RunRecord | null> {
  const path = join(dir, "run.json")
  try {
    const stat = await ctx.fs.stat?.(path)
    if (!stat || stat.size > RUN_RECORD_MAX_BYTES) return null
    if (ctx.fs.lstat && (await ctx.fs.lstat(path))?.kind !== "file") return null
    const run = JSON.parse(await ctx.fs.readFile(path)) as RunRecord
    return run?.id === basename(dir) && run.purpose && typeof run.purpose.kind === "string"
      ? run
      : null
  } catch {
    return null
  }
}

function terminalRun(run: RunRecord): boolean {
  if (!["stopped", "failed"].includes(run.status) || (run.cleanup && !run.cleanup.complete))
    return false
  // A terminal record is insufficient while a precise owned process remains or cannot be verified.
  return [run.host, run.lead].every((identity) => {
    if (!identity) return true
    try {
      return identityState(identity) === "dead"
    } catch {
      return false
    }
  })
}

async function runTaskGone(ctx: Ctx, run: RunRecord): Promise<boolean> {
  const task = run.task ?? (run.purpose.kind === "task" ? run.purpose.task : undefined)
  if (!task) return false
  const [project, slug, extra] = task.split("~")
  const fallback =
    project && slug && !extra && /^[a-zA-Z0-9_-]+$/.test(project) && /^[a-zA-Z0-9_-]+$/.test(slug)
      ? join(ctx.home, "projects", project, "tasks", slug)
      : undefined
  const runtime = run.taskRuntimeDir ?? fallback
  if (!runtime || !resolve(runtime).startsWith(`${resolve(ctx.home)}${sep}`)) return false
  return !(await ctx.fs.exists(runtime)) || (await ctx.fs.exists(join(runtime, "archived.json")))
}

/** Archive and deletion discard only finished recordings; a live run keeps its files. */
export async function pruneTaskRuns(ctx: Ctx, task: string): Promise<number> {
  let removed = 0
  const dir = join(ctx.home, "runs")
  for (const child of await ctx.fs.entries(dir).catch(() => [])) {
    if (child.kind !== "directory") continue
    const path = join(dir, child.name)
    const run = await retentionRun(ctx, path)
    if (
      run &&
      terminalRun(run) &&
      (run.task === task || (run.purpose.kind === "task" && run.purpose.task === task))
    ) {
      if (await pruneCompletedRun(ctx, run.id, run.generation)) removed++
    }
  }
  return removed
}

/** Total bytes and newest change of everything under a folder. */
async function measure(ctx: Ctx, dir: string): Promise<Walked> {
  const total: Walked = { size: 0, newest: null }
  for (const child of await ctx.fs.entries(dir).catch(() => [])) {
    const path = join(dir, child.name)
    if (child.kind === "directory") {
      const inner = await measure(ctx, path)
      total.size += inner.size
      if (inner.newest !== null) total.newest = Math.max(total.newest ?? 0, inner.newest)
    } else if (child.kind === "file") {
      const s = await ctx.fs.stat?.(path)
      if (s == null) continue
      total.size += s.size
      total.newest = Math.max(total.newest ?? 0, s.mtimeMs)
    }
  }
  return total
}

/** Every file of the home as an entry; what no rule names is summed per top folder. */
async function scanHome(ctx: Ctx, now: number): Promise<SweepEntry[]> {
  const out: SweepEntry[] = []
  const other = new Map<string, number>()
  const stat = ctx.fs.stat?.bind(ctx.fs) ?? (async () => null)

  async function runsOf(dir: string): Promise<void> {
    for (const entry of await ctx.fs.entries(dir).catch(() => [])) {
      const path = join(dir, entry.name)
      if (entry.kind === "file") {
        const s = await stat(path)
        if (s) out.push({ path, kind: "other", area: "runs", mtimeMs: s.mtimeMs, size: s.size })
        continue
      }
      if (entry.kind !== "directory") continue
      const seen = await measure(ctx, path)
      const run = await retentionRun(ctx, path)
      if (!run || !terminalRun(run)) {
        const logPath = join(path, "host.log")
        const log = await stat(logPath)
        if (log && (!ctx.fs.lstat || (await ctx.fs.lstat(logPath))?.kind === "file"))
          out.push({
            path: logPath,
            kind: "append-log",
            area: "runs",
            mtimeMs: log.mtimeMs,
            size: log.size,
            capBytes: LOG_CAP_BYTES,
          })
        out.push({
          path,
          kind: "run-live",
          area: "runs",
          mtimeMs: now,
          size: seen.size - (log?.size ?? 0),
        })
        continue
      }
      const stopped = Date.parse(run.stoppedAt ?? run.updatedAt)
      if (!Number.isFinite(stopped)) {
        out.push({ path, kind: "run-live", area: "runs", mtimeMs: now, size: seen.size })
        continue
      }
      const expiredTask = await runTaskGone(ctx, run)
      out.push({
        path,
        kind:
          run.status === "failed" && !run.task && run.purpose.kind === "new-task"
            ? "run-failed-unbound"
            : "run-completed",
        area: "runs",
        mtimeMs: stopped,
        size: seen.size,
        expiredTask,
        generation: run.generation,
      })
    }
  }

  async function tasksOf(dir: string): Promise<void> {
    for (const task of await ctx.fs.entries(dir).catch(() => [])) {
      if (task.kind !== "directory") continue
      const base = join(dir, task.name)
      for (const session of await ctx.fs.entries(join(base, "live")).catch(() => [])) {
        if (session.kind !== "directory") continue
        const path = join(base, "live", session.name)
        const seen = await measure(ctx, path)
        const own = seen.newest ?? (await stat(path))?.mtimeMs ?? now
        out.push({ path, kind: "live-session", area: "tasks", mtimeMs: own, size: seen.size })
      }
      for (const log of await ctx.fs.entries(join(base, "checks")).catch(() => [])) {
        if (log.kind !== "file" || !log.name.endsWith(".log")) continue
        const path = join(base, "checks", log.name)
        const s = await stat(path)
        if (s !== null)
          out.push({ path, kind: "append-log", area: "tasks", mtimeMs: s.mtimeMs, size: s.size })
      }
    }
  }

  async function walk(dir: string, rel: string[]): Promise<void> {
    for (const child of await ctx.fs.entries(dir).catch(() => [])) {
      const path = join(dir, child.name)
      const at = [...rel, child.name]
      if (child.kind === "directory") {
        // Installed quality tools are pinned programs the install owns, not data that grows with use.
        if (at.length === 1 && at[0] === "tools") continue
        if (at.length === 1 && at[0] === "runs") await runsOf(path)
        else if (at.length === 3 && at[0] === "projects" && at[2] === "tasks") await tasksOf(path)
        else await walk(path, at)
        continue
      }
      if (child.kind !== "file") continue
      const s = await stat(path)
      if (s === null) continue
      const area = at.length === 1 ? "." : (at[0] as string)
      const entry = { path, area, mtimeMs: s.mtimeMs, size: s.size }
      if (
        at[0] === "cost" &&
        at.length === 3 &&
        at[1] === "offsets" &&
        child.name.endsWith(".json")
      )
        out.push({ ...entry, kind: "offset" })
      else if (at[0] === "cost" && at.length === 2 && /^\d{4}-\d{2}\.ndjson$/.test(child.name))
        out.push({ ...entry, kind: "cost-month" })
      else if (
        at[0] === "projects" &&
        at.length === 5 &&
        at[2] === "artifacts" &&
        at[3] === "thumbs" &&
        /^[a-f0-9]{20}\.png$/.test(child.name)
      )
        out.push({ ...entry, kind: "thumbnail" })
      else if (
        ((at[0] === "projects" && at.length === 4 && at[2] === "sessions") ||
          (at[0] === "session-bindings" && at.length === 2)) &&
        /^[a-f0-9]{16}\.json$/.test(child.name)
      )
        out.push({ ...entry, kind: "binding" })
      else if (at[0] === "viewing" && at.length === 2) {
        let expiredTask = true
        try {
          const raw = JSON.parse(await ctx.fs.readFile(path))
          if (
            typeof raw.repoId === "string" &&
            typeof raw.slug === "string" &&
            /^[A-Za-z0-9_.-]+$/.test(raw.repoId) &&
            /^[A-Za-z0-9_.-]+$/.test(raw.slug)
          )
            expiredTask = !(await ctx.fs.exists(
              join(ctx.home, "projects", raw.repoId, "tasks", raw.slug),
            ))
        } catch {
          /* A torn record has no task. */
        }
        out.push({ ...entry, kind: "viewing", expiredTask })
      } else if (at.length === 1 && child.name === "windows-process-query.log")
        out.push({ ...entry, kind: "append-log" })
      else other.set(area, (other.get(area) ?? 0) + s.size)
    }
  }

  await walk(ctx.home, [])
  for (const [area, size] of other) out.push({ path: area, kind: "other", area, mtimeMs: 0, size })
  return out
}

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

async function sweepLocked(ctx: Ctx, now: number, limits: Retention): Promise<SweepReport> {
  await ctx.fs.atomicWrite(
    join(ctx.home, RETENTION_STAMP),
    `${JSON.stringify({ startedAt: now })}\n`,
  )
  const entries = await scanHome(ctx, now)
  const plan = planSweep(entries, now, limits)
  const report = emptyReport()
  report.homeBytes = entries.reduce((sum, e) => (e.area === "tasks" ? sum : sum + e.size), 0)
  const kinds = new Map(entries.map((e) => [e.path, e.kind]))
  const generations = new Map(entries.map((e) => [e.path, e.generation]))
  for (const path of plan.remove) {
    try {
      const kind = kinds.get(path)
      if (kind === "run-completed" || kind === "run-failed-unbound") {
        if (!(await pruneCompletedRun(ctx, basename(path), generations.get(path) ?? -1))) {
          report.skipped++
          continue
        }
      } else await ctx.fs.remove(path)
    } catch {
      report.skipped++
      continue
    }
    const kind = kinds.get(path)
    if (kind === "offset") report.offsets++
    else if (kind === "live-session") report.liveSessions++
    else if (kind === "run-completed" || kind === "run-failed-unbound") report.runs++
    else report.bindings++
  }
  for (const { path, keepBytes } of plan.cut) {
    try {
      await cutLog(ctx, path, keepBytes)
      report.cut++
    } catch {
      report.skipped++
    }
  }
  // The cutoff an archive sets drops every call of an archived month that a transcript read brings
  // later, so each known task's transcripts are indexed first: a call nobody read yet is in the
  // ledger, and so in the archive's totals. When that fails nothing is archived, and the next sweep retries.
  let indexed = plan.archive.length === 0
  if (!indexed) {
    try {
      await indexSessions(ctx)
      indexed = true
    } catch {
      report.skipped++
    }
  }
  // One month at a time: a month Windows holds open is skipped, and the next sweep retries it.
  for (const month of indexed ? plan.archive : []) {
    try {
      report.archivedMonths.push(...(await archiveMonths(ctx, [month])))
    } catch {
      report.skipped++
    }
  }
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

// ---------------------------------------------------------------------------- when it runs

/** A sweep older than this is due again. */
const DUE_MS = DAY
/** The server's first sweep waits out its start-up, then sweeps on this period. */
const FIRST_SWEEP_MS = 2 * 60_000
const SWEEP_EVERY_MS = 6 * 60 * 60_000

/** True while a live process holds `retention.lock`. A lock whose owner is gone is free. */
async function sweepHeld(ctx: Ctx): Promise<boolean> {
  const lock = join(ctx.home, RETENTION_LOCK)
  const owners = await ctx.fs.readdir(lock).catch(() => null)
  if (owners === null) return false
  for (const owner of owners) {
    try {
      const held = JSON.parse(await ctx.fs.readFile(join(lock, owner))) as { pid?: unknown }
      if (typeof held.pid === "number" && !pidAlive(held.pid)) continue
    } catch {
      // A lock being taken or released at this moment counts as held.
    }
    return true
  }
  return false
}

/** Whether the last sweep started over 24 hours ago (or never) and no sweep holds the lock. */
export async function sweepDue(ctx: Ctx, now: number): Promise<boolean> {
  try {
    const stamp = JSON.parse(await ctx.fs.readFile(join(ctx.home, RETENTION_STAMP))) as {
      startedAt?: unknown
    }
    if (typeof stamp.startedAt === "number" && now - stamp.startedAt < DUE_MS) return false
  } catch {
    // No stamp, or an unreadable one: nothing swept yet.
  }
  return !(await sweepHeld(ctx))
}

/**
 * From the prompt hook: when a sweep is due, start `qualitylayer retention sweep` detached and
 * return at once. The sweep itself writes the stamp, so a slow or failing one is not restarted.
 */
export async function startDueSweep(ctx: Ctx): Promise<boolean> {
  if (!(await sweepDue(ctx, ctx.clock.now()))) return false
  spawnSweep(ctx)
  return true
}

/**
 * `qualitylayer retention sweep` as a short-lived process of its own, detached and `unref`'d, started
 * through the counted spawn path. A sweep reads transcripts and cost months, and the memory that takes
 * goes back to the system when the process exits: the long-lived server and the prompt hook never run
 * one themselves.
 */
function spawnSweep(ctx: Ctx): void {
  const [exe, ...args] = selfCommand(["retention", "sweep"])
  const child = spawn(exe ?? process.execPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, QUALITYLAYER_HOME: ctx.home },
  })
  child.on("error", () => {
    // A program that cannot start costs one sweep, never the message.
  })
  child.unref()
}

/** The wait before the server's first sweep; a test under a temp home may shorten it. */
function firstSweepMs(ctx: Ctx): number {
  const asked = Number(ctx.env.get("QUALITYLAYER_RETENTION_FIRST_MS"))
  return Number.isFinite(asked) && asked >= 0 && isUnderTempDir(ctx.home) ? asked : FIRST_SWEEP_MS
}

/** A sweep that started this recently has just done the server's job. */
const RECENT_SWEEP_MS = 60 * 60_000

/**
 * Whether the server's timer has work for a sweep child: a cost month older than the kept window, more
 * cost detail than its limit, or more offset files than are kept. It reads two folder listings and the
 * month files' sizes and decodes nothing, so an idle server with nothing due starts no process. The
 * daily prompt hook still starts the full sweep (offsets, live sessions, bindings, log cuts) on its own.
 */
export async function serverSweepDue(
  ctx: Ctx,
  now: number,
  limits: Retention = RETENTION,
): Promise<boolean> {
  try {
    const stamp = JSON.parse(await ctx.fs.readFile(join(ctx.home, RETENTION_STAMP))) as {
      startedAt?: unknown
    }
    if (typeof stamp.startedAt === "number" && now - stamp.startedAt < RECENT_SWEEP_MS) return false
  } catch {
    // No stamp, or an unreadable one: nothing swept yet.
  }
  let completed = 0
  const runs = join(ctx.home, "runs")
  for (const child of await ctx.fs.entries(runs).catch(() => [])) {
    if (child.kind !== "directory") continue
    const run = await retentionRun(ctx, join(runs, child.name))
    if (!run || !terminalRun(run)) continue
    completed++
    const age = now - Date.parse(run.stoppedAt ?? run.updatedAt)
    if (
      completed > limits.runsKept ||
      age > limits.runDays * DAY ||
      (run.status === "failed" &&
        !run.task &&
        run.purpose.kind === "new-task" &&
        age > limits.failedRunHours * 3_600_000) ||
      (await runTaskGone(ctx, run))
    )
      return true
  }
  const costDir = join(ctx.home, "cost")
  let thumbnailFiles = 0
  let thumbnailBytes = 0
  for (const project of await ctx.fs.entries(join(ctx.home, "projects")).catch(() => [])) {
    if (project.kind !== "directory") continue
    const dir = join(ctx.home, "projects", project.name, "artifacts", "thumbs")
    for (const file of await ctx.fs.entries(dir).catch(() => [])) {
      if (file.kind !== "file" || !/^[a-f0-9]{20}\.png$/.test(file.name)) continue
      if (++thumbnailFiles > THUMB_FILES_KEPT) return true
      thumbnailBytes += (await ctx.fs.stat?.(join(dir, file.name)))?.size ?? 0
      if (thumbnailBytes > THUMB_CACHE_BYTES) return true
    }
  }
  const months = (await ctx.fs.readdir(costDir).catch(() => []))
    .map((name) => /^(\d{4}-\d{2})\.ndjson$/.exec(name)?.[1])
    .filter((month): month is string => month !== undefined)
    .sort()
  const keptFrom = keptMonthsFrom(now, limits)
  if (months.some((month) => month < keptFrom)) return true
  if ((await ctx.fs.readdir(join(costDir, "offsets")).catch(() => [])).length > limits.offsetsKept)
    return true
  if (months.length < 2 || ctx.fs.stat === undefined) return false
  let detail = 0
  for (const month of months)
    detail += (await ctx.fs.stat(join(costDir, `${month}.ndjson`)))?.size ?? 0
  return detail > limits.costDetailBytes
}

/**
 * The server's sweeps: the first after `firstMs`, so it stays out of the start-up idle window, then
 * every `everyMs`. Each one starts the sweep as a child process (`start`, which a test replaces) only
 * when `serverSweepDue` says archiving or the size pass has work and no sweep holds the lock; the
 * server itself reads nothing of the ledger. Both timers are `unref`'d and the returned function
 * stops them.
 */
export function startRetention(
  ctx: Ctx,
  options: { firstMs?: number; everyMs?: number; start?: (ctx: Ctx) => void } = {},
): () => void {
  const start = options.start ?? spawnSweep
  const sweep = () => {
    serverSweepDue(ctx, ctx.clock.now())
      .then(async (due) => {
        if (due && !(await sweepHeld(ctx))) start(ctx)
      })
      .catch(() => {
        // The next one tries again.
      })
  }
  let every: ReturnType<typeof setInterval> | undefined
  const first = setTimeout(() => {
    sweep()
    every = setInterval(sweep, options.everyMs ?? SWEEP_EVERY_MS)
    every.unref?.()
  }, options.firstMs ?? firstSweepMs(ctx))
  first.unref?.()
  return () => {
    clearTimeout(first)
    clearInterval(every)
  }
}
