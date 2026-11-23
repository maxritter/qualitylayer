// Timestamped, stable call revisions and incremental transcript parser state.
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { taskCost } from "./index.ts"
import { addTotals, archiveMonths, readArchive } from "./ledger-archive.ts"
import {
  bytesRevision,
  type LedgerCall,
  ledgerFiles,
  ledgerFolder,
  lineKey,
  readJsonFile,
  type TaskCostTotal,
  walkLedger,
} from "./ledger-bytes.ts"
import { readLedger, readTaskLedger } from "./ledger-scan.ts"
import { indexedTranscript, offsetFile } from "./ledger-transcript.ts"
import { upsertLedger } from "./ledger-upsert.ts"

export type { LedgerCall, TaskCostTotal }
export {
  addTotals,
  archiveMonths,
  indexedTranscript,
  offsetFile,
  readArchive,
  readLedger,
  readTaskLedger,
  upsertLedger,
}

export async function rememberTask(
  ctx: Ctx,
  task: Partial<Task> & { runtimeDir: string },
): Promise<void> {
  const root = ledgerFolder(ctx)
  await ctx.fs.mkdir(root, { mode: 0o700 })
  await ctx.fs.withLock(join(root, "tasks.lock"), async () => {
    const path = join(root, "tasks.json")
    const tasks = await readJsonFile<Record<string, Partial<Task>>>(ctx, path, {})
    const details = {
      runtimeDir: task.runtimeDir,
      repoId: task.repoId,
      repoRoot: task.repoRoot,
      slug: task.slug,
      title: task.title,
      stage: task.stage,
    }
    tasks[task.runtimeDir] = {
      ...tasks[task.runtimeDir],
      ...Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)),
    }
    await ctx.fs.atomicWrite(path, `${JSON.stringify(tasks)}\n`)
  })
}

/** Drop the task index's entries whose task folder is gone; how many went. */
export async function forgetDeadTasks(ctx: Ctx): Promise<number> {
  const root = ledgerFolder(ctx)
  const path = join(root, "tasks.json")
  if (!(await ctx.fs.exists(path))) return 0
  return ctx.fs.withLock(join(root, "tasks.lock"), async () => {
    const tasks = await readJsonFile<Record<string, Partial<Task>>>(ctx, path, {})
    const alive: Record<string, Partial<Task>> = {}
    for (const [dir, task] of Object.entries(tasks)) if (await ctx.fs.exists(dir)) alive[dir] = task
    const gone = Object.keys(tasks).length - Object.keys(alive).length
    if (gone > 0) await ctx.fs.atomicWrite(path, `${JSON.stringify(alive)}\n`)
    return gone
  })
}

/**
 * The highest revision in the months still kept. Every write to the ledger takes the next revision,
 * so the difference between two reads is the number of rows written between them.
 */
async function highestRevision(ctx: Ctx): Promise<number> {
  const archive = await readArchive(ctx)
  let highest = 0
  for (const path of await ledgerFiles(ctx, archive.months)) {
    try {
      await walkLedger(ctx, path, null, (bytes, from, end) => {
        const found =
          bytesRevision(bytes, from, end) ??
          lineKey(bytes.toString("utf8", from, end))?.revision ??
          null
        if (found !== null && found > highest) highest = found
      })
    } catch {
      // A month archived (its file deleted) while the others are read: its calls are in the archive.
    }
  }
  return highest
}

/**
 * Read every known task's transcripts into the ledger, one task and one session at a time (a task's
 * cost read does exactly that), and say how many rows that wrote.
 */
export async function indexSessions(ctx: Ctx): Promise<number> {
  const before = await highestRevision(ctx)
  const tasks = await readJsonFile<Record<string, Task>>(
    ctx,
    join(ledgerFolder(ctx), "tasks.json"),
    {},
  )
  for (const task of Object.values(tasks)) await taskCost(ctx, task)
  return Math.max(0, (await highestRevision(ctx)) - before)
}

export type Spent = {
  usd: number
  unpriced: { model: string; tokens: number }[]
  tasks: { id: string; title: string; usd: number; unpricedTokens?: number }[]
}

export function spentIn(rows: LedgerCall[], from: number, to: number): Spent {
  const tasks = new Map<string, Spent["tasks"][number]>()
  const unpriced = new Map<string, number>()
  let usd = 0
  for (const row of rows) {
    if (row.at === null || row.at < from || row.at >= to) continue
    const task = tasks.get(row.taskId) ?? { id: row.taskId, title: row.title, usd: 0 }
    if (row.usd === null) {
      const tokens = row.input + row.output + row.cacheRead + row.cacheWrite
      task.unpricedTokens = (task.unpricedTokens ?? 0) + tokens
      unpriced.set(
        row.model,
        (unpriced.get(row.model) ?? 0) + row.input + row.output + row.cacheRead + row.cacheWrite,
      )
    } else {
      usd += row.usd
      task.usd += row.usd
    }
    tasks.set(task.id, task)
  }
  return {
    usd,
    unpriced: [...unpriced].map(([model, tokens]) => ({ model, tokens })),
    tasks: [...tasks.values()].sort((a, b) => b.usd - a.usd),
  }
}
