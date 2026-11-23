// Whether a checkout is contested before a build starts in it: another agent session works there, or
// it holds uncommitted work from elsewhere. The Implement start card reads this to propose a worktree.
//
// Both answers come from files and one git call, never from a process list:
// - an App run is a lease in `runs/leases.json` whose process ownership is still held;
// - a terminal session is another task's `session.json` in this checkout whose owner process is alive.
// The answer is kept for a few seconds, so a polling page costs one read per interval, not per poll.

import { realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { RUN_LEASES_MAX_BYTES } from "../home-caps.ts"
import { projectRuntimeDir } from "../paths.ts"
import { pidAlive } from "../self.ts"
import { readSession } from "../task/store.ts"
import { changedFiles, overlapCount, type Place } from "./checkout-overlap.ts"
import { activeRun, readRun } from "./registry.ts"

export type CheckoutBusy = { kind: "overlap" | "session" | "changes"; count?: number }

/** How long an answer is reused. A session or an edit that starts later shows within this time. */
const KEEP_MS = 5000
const kept = new Map<string, { at: number; answer: Promise<CheckoutBusy | null> }>()

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

async function json(ctx: Ctx, path: string, limit = 16 * 1024): Promise<unknown> {
  try {
    if (!(await ctx.fs.exists(path))) return null
    const text = await ctx.fs.readFile(path)
    return Buffer.byteLength(text) > limit ? null : JSON.parse(text)
  } catch {
    return null
  }
}

const isOwn = (task: Place, key: unknown) =>
  key === task.slug || key === `${task.repoId}~${task.slug}`

/** An App run whose lease is still held in this checkout; this task's own runs do not count. */
async function appRunHere(ctx: Ctx, task: Place, here: string): Promise<boolean> {
  const rows = await json(ctx, join(ctx.home, "runs", "leases.json"), RUN_LEASES_MAX_BYTES)
  if (!Array.isArray(rows)) return false
  for (const row of rows as Record<string, unknown>[]) {
    if (
      typeof row?.run !== "string" ||
      typeof row.checkout !== "string" ||
      isOwn(task, row.task) ||
      (await canonical(row.checkout)) !== here
    )
      continue
    let run: ReturnType<typeof readRun>
    try {
      run = readRun(ctx.home, row.run)
    } catch {
      return true
    }
    if (run === null || run.generation !== row.generation || activeRun(ctx.home, run)) return true
  }
  return false
}

async function liveTerminalInRuntime(ctx: Ctx, runtimeDir: string, here: string): Promise<boolean> {
  const session = await readSession(ctx, { runtimeDir })
  if (typeof session?.checkout !== "string" || (await canonical(session.checkout)) !== here)
    return false
  const owner = (await json(ctx, join(runtimeDir, "live", "owner.json"))) as {
    key?: unknown
  } | null
  if (typeof owner?.key !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(owner.key)) return false
  const proc = (await json(ctx, join(runtimeDir, "live", owner.key, "process.json"))) as {
    pid?: unknown
  } | null
  return (
    typeof proc?.pid === "number" &&
    Number.isSafeInteger(proc.pid) &&
    proc.pid > 0 &&
    pidAlive(proc.pid)
  )
}

/** Another task's terminal session in this checkout, by the files its hooks left and one pid probe. */
async function terminalHere(ctx: Ctx, task: Place, here: string): Promise<boolean> {
  const tasks = join(projectRuntimeDir(ctx, task.repoId), "tasks")
  const slugs = await ctx.fs.readdir(tasks).catch(() => [] as string[])
  for (const slug of slugs) {
    if (slug !== task.slug && (await liveTerminalInRuntime(ctx, join(tasks, slug), here)))
      return true
  }
  return false
}

async function read(ctx: Ctx, task: Place): Promise<CheckoutBusy | null> {
  const here = await canonical(task.repoRoot)
  const changed = await changedFiles(ctx, task)
  // A new worktree starts from HEAD, without the uncommitted edits to a file the Plan changes: the
  // build stays where those edits are, whatever else holds the checkout.
  const overlap = await overlapCount(ctx, task, changed)
  if (overlap > 0) return { kind: "overlap", count: overlap }
  if ((await appRunHere(ctx, task, here)) || (await terminalHere(ctx, task, here)))
    return { kind: "session" }
  return changed.paths.size > 0 ? { kind: "changes", count: changed.paths.size } : null
}

/**
 * Why a build should not start in this task's checkout: "overlap" with the number of files the
 * approved Plan names that hold uncommitted edits here (a worktree would start without them), else
 * "session" when another agent session works there (this task's own planning session does not
 * count), else "changes" with the number of files that hold uncommitted work outside the task's
 * plan folder, else null.
 */
export function checkoutBusy(ctx: Ctx, task: Place): Promise<CheckoutBusy | null> {
  const key = `${ctx.home}\0${task.repoRoot}\0${task.slug}`
  const now = ctx.clock.now()
  const found = kept.get(key)
  if (found !== undefined && now - found.at < KEEP_MS) return found.answer
  const answer = read(ctx, task).catch(() => null)
  kept.set(key, { at: now, answer })
  if (kept.size > 64) kept.delete(kept.keys().next().value as string)
  return answer
}
