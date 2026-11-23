import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { RUNS_RECONCILE_BATCH } from "../home-caps.ts"
import {
  cleanupConfirmed,
  collectRunWitnesses,
  isDeadIdentity,
  isPreviousHostClean,
  launchOwnerState,
  launchPhaseBlockReason,
  preHost,
  verifyHostLock,
} from "./abandoned-checks.ts"
import type { RunRecord } from "./contracts.ts"
import { assertNativeAvailable, nativeSessionFile } from "./control.ts"
import { releaseRunLeases } from "./lease.ts"
import { listRuns, readHost, readRun, runDir, updateRun } from "./registry.ts"

export { launchOwnerState }

export type AbandonedStarts = {
  retired: string[]
  blocked: { run: string; checkout: string; reason: string }[]
}

function recordBlockedStart(
  ctx: Ctx,
  result: AbandonedStarts,
  run: RunRecord,
  detail: string,
): void {
  const reason = `Run ${run.id} cannot be retired: ${detail}. Its native conversation, task and launch choices were kept. Inspect the recorded launch before a guarded retry or isolate its checkout.`
  const current = readRun(ctx.home, run.id)
  if (!current || current.generation !== run.generation || !preHost(current)) return
  try {
    updateRun(ctx.home, run.id, run.generation, (latest) =>
      preHost(latest) && latest.error !== reason ? { error: reason } : null,
    )
    result.blocked.push({ run: run.id, checkout: run.sourceCheckout ?? run.cwd, reason })
  } catch (cause) {
    if (readRun(ctx.home, run.id)?.generation === run.generation) throw cause
  }
}

async function blockReasonForHostCleanup(ctx: Ctx, run: RunRecord): Promise<string | null> {
  const host = readHost(ctx.home, run.id)
  if (host && (host.run !== run.id || host.generation > run.generation))
    return "the recorded host belongs to a different run generation"
  const hostLock = join(runDir(ctx.home, run.id), "host.lock")
  const hasHostLock = await ctx.fs.exists(hostLock)
  const witnesses = collectRunWitnesses(run, host)
  if (witnesses.some((identity) => !isDeadIdentity(identity)))
    return "a recorded native process is still alive or unverified"
  const previousHostClean = isPreviousHostClean(run, host)
  const needsCleanupProof = witnesses.length > 0 || hasHostLock || Boolean(run.cleanup)
  if (needsCleanupProof && !cleanupConfirmed(run.cleanup) && !previousHostClean)
    return "native process cleanup has not been proved complete"
  if (hasHostLock && !(await verifyHostLock(ctx, hostLock, host, previousHostClean)))
    return "the host lock's process ownership is unverified"
  return null
}

async function blockReasonForAbandoned(ctx: Ctx, run: RunRecord): Promise<string | null> {
  return launchPhaseBlockReason(run.launchOwner?.phase) ?? blockReasonForHostCleanup(ctx, run)
}

async function retireAbandonedLocked(
  ctx: Ctx,
  saved: RunRecord,
  result: AbandonedStarts,
): Promise<void> {
  const run = readRun(ctx.home, saved.id)
  if (!run || run.generation !== saved.generation || !preHost(run)) return
  if (launchOwnerState(run) !== "dead") return
  const reason = await blockReasonForAbandoned(ctx, run)
  if (reason) {
    recordBlockedStart(ctx, result, run, reason)
    return
  }
  if (nativeSessionFile(ctx, run)) assertNativeAvailable(ctx, run)
  const retired = updateRun(ctx.home, run.id, run.generation, {
    status: "failed",
    stoppedAt: new Date().toISOString(),
    cleanup: {
      complete: true,
      remaining: [],
      unverified: [],
      errors: [],
      at: new Date().toISOString(),
    },
    error: `Run ${run.id} was interrupted before native launch. Its task, native conversation and launch choices were kept; retry this run explicitly.`,
  })
  await releaseRunLeases(ctx, retired.id, retired.generation)
  result.retired.push(run.id)
}

async function reconcileOneAbandoned(
  ctx: Ctx,
  saved: RunRecord,
  result: AbandonedStarts,
): Promise<void> {
  const state = launchOwnerState(saved)
  if (state === "live") return
  if (state === "unknown") {
    recordBlockedStart(
      ctx,
      result,
      saved,
      "the starter's generation and process ownership cannot be verified",
    )
    return
  }
  try {
    const lockOpts = { waitMs: 0, label: "checking abandoned launch" }
    await ctx.fs.withLock(
      join(runDir(ctx.home, saved.id), "start.lock"),
      () =>
        ctx.fs.withLock(
          join(runDir(ctx.home, saved.id), ".bind.lock"),
          () => retireAbandonedLocked(ctx, saved, result),
          lockOpts,
        ),
      lockOpts,
    )
  } catch (cause) {
    const run = readRun(ctx.home, saved.id)
    if (run?.generation === saved.generation && preHost(run))
      recordBlockedStart(
        ctx,
        result,
        run,
        cause instanceof Error ? cause.message : "launch ownership could not be checked",
      )
  }
}

/** Explicit startup/admission work only. No age heuristic, process signals or native relaunch. */
export async function reconcileAbandonedStarts(ctx: Ctx): Promise<AbandonedStarts> {
  const result: AbandonedStarts = { retired: [], blocked: [] }
  const snapshot = listRuns(ctx.home).filter(preHost)
  for (const [index, saved] of snapshot.entries()) {
    if (index > 0 && index % RUNS_RECONCILE_BATCH === 0)
      await new Promise<void>((resolve) => setImmediate(resolve))
    await reconcileOneAbandoned(ctx, saved, result)
  }
  return result
}
