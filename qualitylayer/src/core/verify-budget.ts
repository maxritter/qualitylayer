// Verification's recorded judge runs and when the build was delivered.
//
// A build is delivered when its last task is ticked (`tasks_complete`, or `work_deferred` when only
// human needs remain). A fix the person asks for in Review starts its own delivery.

import type { Ctx } from "../ctx.ts"
import { fixRoundsOf } from "./task/stages.ts"
import { readEvents, type Task } from "./task/store.ts"

export type VerifyBudget = {
  /** Recorded runs. A null limit means there is no fixed count. */
  rounds: { used: number; limit: null }
  /** When the build was delivered; null before its last task is ticked. */
  since: number | null
}

const DELIVERED = new Set(["tasks_complete", "work_deferred"])

/**
 * When the current build was delivered, from its events: the first completion after the build
 * (re)started, at the beginning of the task or after Review sent it back to Implement.
 */
export function deliveryOf(events: readonly Record<string, unknown>[]): number | null {
  let since: number | null = null
  for (const event of events) {
    const at = typeof event.ts === "number" ? event.ts : null
    if (at === null) continue
    if (event.from === "review" || event.from === "shipped") since = null
    if (since === null && typeof event.event === "string" && DELIVERED.has(event.event)) since = at
  }
  return since
}

export async function verifyBudget(ctx: Ctx, task: Task): Promise<VerifyBudget> {
  const events = await readEvents(ctx, task)
  const rounds = fixRoundsOf(events)
  return {
    rounds: { used: rounds.judgeRuns, limit: null },
    since: deliveryOf(events),
  }
}
