import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { readCheckRecords, recordsPath } from "./check-receipts.ts"
import type { CheckRecord } from "./checks.ts"
import { pidAlive } from "./self.ts"
import type { Task } from "./task/store.ts"

/** What one command of a run did, from the same result its record in checks.json is written from. */
export type CommandResult = {
  command: string
  ran: boolean
  passed: boolean
  reused?: true
  timedOut?: true
  timeoutMs?: number
}

export type CheckProgress = {
  check: string
  scope: string
  started: number
  /** While `queued`, the first command the run will start; after that, the one it runs now. */
  command: string
  i: number
  of: number
  files: { done: number; total: number | null }
  passed: number
  failed: number
  pid: number
  heartbeat: number
  /** A parsed result changed; the liveness heartbeat does not move this timestamp. */
  updated?: number
  running: boolean
  exit?: number | null
  ended?: number
  reused?: boolean
  notRun?: string
  /** The command is split: this is part n of N. */
  part?: { n: number; of: number }
  /** The worker waits for the task's check lock and runs no command yet. */
  queued?: true
  /** Each command that ended, in run order. */
  results?: CommandResult[]
}
export const checkProgressPath = (task: Pick<Task, "runtimeDir">, id: string) =>
  join(task.runtimeDir, "checks", `${id}.progress.json`)

/** Incremental line parsing tolerates pipes splitting a runner's summary anywhere. */
export function progressParser(progress: CheckProgress, now = () => Date.now()) {
  let pending = ""
  return (chunk: string) => {
    pending += chunk
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) {
      const total = line.match(/^Selected (\d+) test files\b/)
      if (total && progress.files.total !== Number(total[1])) {
        progress.files.total = Number(total[1])
        progress.updated = now()
      }
      const file = line.match(/^(?:ok\s+|FAIL\s+)\S+\s+\((\d+) pass, (\d+) fail(?:, [\d.]+s)?\)$/)
      if (file) {
        progress.files.done++
        progress.passed += Number(file[1])
        progress.failed += Number(file[2])
        progress.updated = now()
      }
    }
  }
}

export async function writeCheckProgress(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  progress: CheckProgress,
) {
  await ctx.fs.mkdir(join(task.runtimeDir, "checks"))
  await ctx.fs.atomicWrite(checkProgressPath(task, progress.check), `${JSON.stringify(progress)}\n`)
}

async function recoverCommands(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  progress: CheckProgress & { ended: number },
): Promise<CheckRecord[] | null> {
  const path = recordsPath(task)
  return ctx.fs.withLock(`${path}.lock`, async () => {
    const records = await readCheckRecords(ctx, task)
    const own = records.filter((record) => record.check === progress.check)
    // The process can stop after the receipt commits and before its last progress write.
    if (own.some((record) => record.display?.version === 1))
      return own.filter((record) => record.revision !== "worker-stopped")
    if (
      records.some(
        (record) =>
          record.check === progress.check &&
          record.command === progress.command &&
          record.revision === "worker-stopped",
      )
    )
      return null
    records.push({
      scope: progress.scope,
      command: progress.command,
      exit: null,
      revision: "worker-stopped",
      at: progress.ended,
      ran: true,
      notRun: "worker stopped",
      check: progress.check,
    })
    await ctx.fs.atomicWrite(path, `${JSON.stringify(records)}\n`)
    return null
  })
}

function finishedProgress(progress: CheckProgress, records: CheckRecord[]): CheckProgress {
  const results = records.map((record) => ({
    command: record.command,
    ran: record.ran,
    passed: record.ran && record.exit === 0 && !record.notRun && !record.timedOut,
    ...(record.reused ? { reused: true as const } : {}),
    ...(record.timedOut ? { timedOut: true as const, timeoutMs: record.timeoutMs } : {}),
  }))
  const failed = results.findIndex((result) => !result.passed)
  return { ...progress, exit: failed === -1 ? 0 : (records[failed]?.exit ?? null), results }
}

async function finalizeStaleProgress(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  filePath: string,
  progress: CheckProgress,
  isStale: (entry: CheckProgress) => boolean,
): Promise<void> {
  await ctx.fs.withLock(`${checkProgressPath(task, progress.check)}.lock`, async () => {
    const current = JSON.parse(await ctx.fs.readFile(filePath)) as CheckProgress
    if (!isStale(current)) {
      Object.assign(progress, current)
      return
    }
    const stopped = {
      ...current,
      running: false,
      exit: null,
      ended: ctx.clock.now(),
    }
    // A worker that stopped while it waited for the lock ran no command: nothing to record.
    const receipt = current.queued ? null : await recoverCommands(ctx, task, stopped)
    const terminal =
      receipt === null
        ? { ...stopped, notRun: "worker stopped" }
        : finishedProgress(stopped, receipt)
    // Terminal progress is visible only after its command record is durable.
    await writeCheckProgress(ctx, task, terminal)
    Object.assign(progress, terminal)
  })
}

async function readProgressFile(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  filePath: string,
  isStale: (entry: CheckProgress) => boolean,
): Promise<CheckProgress | null> {
  try {
    const progress = JSON.parse(await ctx.fs.readFile(filePath)) as CheckProgress
    if (isStale(progress)) await finalizeStaleProgress(ctx, task, filePath, progress, isStale)
    return progress
  } catch {
    /* a partial or obsolete record cannot hold a turn open */
    return null
  }
}

/** A worker, rather than its starter, keeps a check alive. Dead and stale workers are terminal. */
export async function readCheckProgress(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  alive: (pid: number) => boolean = pidAlive,
): Promise<CheckProgress[]> {
  const dir = join(task.runtimeDir, "checks")
  if (!(await ctx.fs.exists(dir))) return []
  const isStale = (progress: CheckProgress) =>
    progress.running && (!alive(progress.pid) || ctx.clock.now() - progress.heartbeat > 30_000)
  const rows: CheckProgress[] = []
  for (const file of await ctx.fs.readdir(dir)) {
    if (!file.endsWith(".progress.json")) continue
    const entry = await readProgressFile(ctx, task, join(dir, file), isStale)
    if (entry !== null) rows.push(entry)
  }
  return rows.sort((a, b) => a.started - b.started)
}
