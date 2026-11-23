import type { Ctx } from "../../ctx.ts"
import { RUN_LEASES_MAX_BYTES } from "../home-caps.ts"
import type { ProcessIdentity, RunRecord } from "./contracts.ts"
import {
  assertNoLeaseConflicts,
  branchChangePending,
  leaseFile,
  runTaskLeaseKey,
  stillHeld,
} from "./lease-checks.ts"
import {
  attachPlanningHandoff,
  checkoutLeaseStatus,
  repairDeadLeases,
  validateRefreshPatch,
  withLeaseLock,
  writeLeasesSync,
} from "./lease-status.ts"
import { readRun, removeCompletedRun, updateRun } from "./registry.ts"

export { checkoutLeaseStatus, runTaskLeaseKey }

export type RunLease = {
  run: string
  generation: number
  checkout: string
  branch?: boolean
  task?: string
  session?: string
  planningHandoff?: { run: string; generation: number; branchAcknowledged: boolean }
}

export type LeasePatch = Partial<
  Pick<
    RunRecord,
    | "nativeSession"
    | "task"
    | "taskRuntimeDir"
    | "cwd"
    | "branch"
    | "intent"
    | "lastPrompt"
    | "runEvents"
    | "guardedRestart"
  >
>

export async function acquireRunLeases(
  ctx: Ctx,
  run: Pick<RunRecord, "id" | "generation">,
  input: Omit<RunLease, "run" | "generation" | "planningHandoff">,
  options: { approvedPlanningHandoff?: boolean; startAnyway?: boolean } = {},
): Promise<void> {
  await repairDeadLeases(ctx, input.checkout)
  await withLeaseLock(ctx, async (saved) => {
    const record = readRun(ctx.home, run.id)
    if (!record || record.generation !== run.generation) throw new Error("stale run generation")
    const rows = saved.filter((row) => stillHeld(ctx, row))
    const own = rows.find((row) => row.run === run.id)
    if (own && own.generation !== run.generation) throw new Error("stale lease generation")
    const others = rows.filter((row) => row.run !== run.id)
    const claim: RunLease = {
      ...input,
      run: run.id,
      generation: run.generation,
      ...(own?.planningHandoff ? { planningHandoff: own.planningHandoff } : {}),
    }
    attachPlanningHandoff(ctx, record, claim, others, options)
    assertNoLeaseConflicts(ctx, claim, others)
    const text = JSON.stringify([...others, claim])
    if (Buffer.byteLength(text) > RUN_LEASES_MAX_BYTES)
      throw new Error("run leases exceed their byte bound")
    await ctx.fs.atomicWrite(leaseFile(ctx), text)
  })
}

export async function releaseRunLeases(ctx: Ctx, run: string, generation: number): Promise<void> {
  await withLeaseLock(ctx, async (rows) => {
    const record = readRun(ctx.home, run)
    if (!record || record.generation !== generation) throw new Error("stale run generation")
    const held = rows.find((row) => row.run === run)
    if (held && held.generation !== generation) throw new Error("stale lease generation")
    if (held && stillHeld(ctx, held))
      throw new Error("run still owns processes; lease remains held")
    await ctx.fs.atomicWrite(leaseFile(ctx), JSON.stringify(rows.filter((row) => row.run !== run)))
  })
}

function buildRefreshedClaim(
  ctx: Ctx,
  run: Pick<RunRecord, "id" | "generation">,
  next: RunRecord,
  own: RunLease | undefined,
): RunLease {
  const task = runTaskLeaseKey(next)
  return {
    run: run.id,
    generation: run.generation,
    checkout: next.artifactBinding?.root ?? next.cwd,
    branch: own ? branchChangePending(ctx, own) : false,
    ...(task ? { task } : {}),
    ...(next.nativeSession ? { session: next.nativeSession } : {}),
    ...(own?.planningHandoff ? { planningHandoff: own.planningHandoff } : {}),
  }
}

/** Claim binding metadata and its lease together, with the retirement transaction's lock order. */
export async function refreshRunLeases(
  ctx: Ctx,
  run: Pick<RunRecord, "id" | "generation">,
  patch: LeasePatch = {},
  resume?: { previousSession: string; lead: ProcessIdentity },
): Promise<RunRecord> {
  return withLeaseLock(ctx, async (saved) => {
    const rows = saved.filter((row) => stillHeld(ctx, row))
    const own = rows.find((row) => row.run === run.id)
    if (own && own.generation !== run.generation) throw new Error("stale lease generation")
    const others = rows.filter((row) => row.run !== run.id)
    const path = leaseFile(ctx)
    let published = false
    try {
      return updateRun(ctx.home, run.id, run.generation, (current) => {
        validateRefreshPatch(ctx, current, patch, resume)
        const claim = buildRefreshedClaim(ctx, run, { ...current, ...patch }, own)
        assertNoLeaseConflicts(ctx, claim, others)
        writeLeasesSync(path, [...others, claim])
        published = true
        return patch
      })
    } catch (cause) {
      if (published) writeLeasesSync(path, saved)
      throw cause
    }
  })
}

/** Retire only proven terminal evidence: leases → registry → record is the lock order. */
export async function pruneCompletedRun(
  ctx: Ctx,
  run: string,
  generation: number,
): Promise<boolean> {
  if (!(await ctx.fs.exists(ctx.home))) return false
  try {
    return await withLeaseLock(
      ctx,
      async (rows) => {
        if (rows.some((row) => row.run === run && row.generation !== generation))
          throw new Error("stale lease generation; run recording retained")
        return removeCompletedRun(ctx.home, run, generation, () => {
          const kept = rows.filter((row) => row.run !== run || row.generation !== generation)
          if (kept.length !== rows.length) writeLeasesSync(leaseFile(ctx), kept)
        })
      },
      false,
    )
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT" && !(await ctx.fs.exists(ctx.home)))
      return false
    throw cause
  }
}
