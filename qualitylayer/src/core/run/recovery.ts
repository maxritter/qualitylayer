import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { RUNS_RECONCILE_BATCH } from "../home-caps.ts"
import { launchOwnerState, reconcileAbandonedStarts } from "./abandoned.ts"
import type { RunRecord } from "./contracts.ts"
import type { ControlOptions } from "./control.ts"
import {
  isEligibleForAutoRecovery,
  isPendingRecovery,
  markRecoveryAttempted,
  markRecoveryPending,
  resumeRecoveredRun,
  shouldInspectForRecovery,
  verifyDeadOwnedHost,
} from "./recovery-helpers.ts"
import { listRuns, readRun, reconcileRuns, runDir } from "./registry.ts"

const ACTIVE_OR_STOPPING = new Set(["running", "starting", "stopping"])

async function reconcileLockedCandidate(ctx: Ctx, saved: RunRecord): Promise<boolean> {
  let run = readRun(ctx.home, saved.id)
  if (!run || run.generation !== saved.generation) return false
  const pending = isPendingRecovery(run)
  const inspectable =
    (run.status !== "starting" || launchOwnerState(run) !== "live") &&
    (pending || ACTIVE_OR_STOPPING.has(run.status))
  const host = inspectable ? verifyDeadOwnedHost(ctx, run) : null
  if (!host) return false
  const eligible = isEligibleForAutoRecovery(run, host, pending)
  if (eligible && !pending) run = markRecoveryPending(ctx, run)
  if (run.status !== "stopped") await reconcileRuns(ctx.home, [run])
  const current = readRun(ctx.home, run.id)
  return eligible && current?.generation === run.generation
    ? markRecoveryAttempted(ctx, run)
    : false
}

async function reconcileSingleCandidate(ctx: Ctx, saved: RunRecord): Promise<boolean> {
  return ctx.fs.withLock(join(runDir(ctx.home, saved.id), ".bind.lock"), () =>
    reconcileLockedCandidate(ctx, saved),
  )
}

/** Called once by an authorized App startup, never by a watcher or an unpaired reader. */
export async function recoverInterruptedRuns(ctx: Ctx, options: ControlOptions): Promise<void> {
  if (!(await ctx.fs.exists(join(ctx.home, "runs")))) return
  await ctx.fs.withLock(join(ctx.home, "runs", "recovery.lock"), async () => {
    const abandoned = await reconcileAbandonedStarts(ctx)
    const blocked = new Set(abandoned.blocked.map((run) => run.run))
    const snapshot = listRuns(ctx.home).filter((run) => shouldInspectForRecovery(run, blocked))
    for (const [index, saved] of snapshot.entries()) {
      if (index > 0 && index % RUNS_RECONCILE_BATCH === 0)
        await new Promise<void>((resolve) => setImmediate(resolve))
      if (!(await reconcileSingleCandidate(ctx, saved))) continue
      const current = readRun(ctx.home, saved.id)
      if (current?.generation === saved.generation) await resumeRecoveredRun(ctx, current, options)
    }
  })
}
