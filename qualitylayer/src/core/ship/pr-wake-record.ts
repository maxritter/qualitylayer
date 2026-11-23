// What was decided about each thing that could wake the agent, kept with the task in
// `pull-request-wakes.json`: one row per event, and the times of the wake-ups of the last day. A
// decision is made under a lock of the task's own before anything is sent, as `sending`, so a crash,
// a restart or a second server never sends the same event twice; a send that fails gives it back.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import {
  type CleanupPending,
  cleanupField,
  commentsField,
  coverageField,
  coverComments,
  type Decision,
  EMPTY_WAKE_RECORD,
  type Ending,
  keptDecisions,
  parseWakeRecord,
  settledDecisions,
  WAKE_PERIOD_MS,
  type WakeEvent,
  type WakeRecord,
} from "./pr-wake-codec.ts"

export {
  type CleanupPending,
  type CommentCoverage,
  coverComments,
  type Ending,
  WAKE_PERIOD_MS,
  type WakeEvent,
  type WakeRecord,
} from "./pr-wake-codec.ts"

/** Wake-ups per pull request in one rolling period for checks, change requests and conflicts. */
export const WAKE_CAP = 3
/** Wake-ups for people's comments alone, in the same period, on top of `WAKE_CAP`. */
export const COMMENT_WAKE_CAP = 2

/** An event about people's comments, as opposed to the pull request's checks, reviews or conflicts. */
export const isCommentEvent = (event: Pick<WakeEvent, "key">): boolean =>
  event.key.startsWith("comment:")

type Where = Pick<Task, "runtimeDir">

const recordPath = (task: Where) => join(task.runtimeDir, "pull-request-wakes.json")
const lockPath = (task: Where) => join(task.runtimeDir, "pull-request-wakes.lock")

export async function readWakes(ctx: Ctx, task: Where): Promise<WakeRecord> {
  try {
    return parseWakeRecord(JSON.parse(await ctx.fs.readFile(recordPath(task))))
  } catch {
    return EMPTY_WAKE_RECORD
  }
}

async function writeWakes(ctx: Ctx, task: Where, record: WakeRecord) {
  await ctx.fs.atomicWrite(recordPath(task), `${JSON.stringify(record)}\n`)
}

/** Run `action` holding the task's wake lock: one decision at a time, across servers and restarts. */
export async function underWakeLock<T>(
  ctx: Ctx,
  task: Where,
  action: () => Promise<T>,
): Promise<T> {
  await ctx.fs.mkdir(task.runtimeDir)
  return ctx.fs.withLock(lockPath(task), action)
}

/** The wake-ups of the last 24 hours. */
export const recentWakes = (record: WakeRecord, now: number): number[] =>
  record.wakes.filter((at) => now - at < WAKE_PERIOD_MS)

/** The wake-ups of the last 24 hours that were for people's comments alone. */
export const recentCommentWakes = (record: WakeRecord, now: number): number[] =>
  record.commentWakes.filter((at) => now - at < WAKE_PERIOD_MS)

/** The wake-ups of the last 24 hours for checks, change requests and conflicts (comments may have ridden along). */
export const recentCodeWakes = (record: WakeRecord, now: number): number[] => {
  const comments = new Set(recentCommentWakes(record, now))
  return recentWakes(record, now).filter((at) => !comments.has(at))
}

/** What `decide` keeps: the record as read, the events decided on, how, and why when it is a skip. */
type Choice = {
  kept: WakeRecord
  fresh: readonly WakeEvent[]
  outcome: Decision["outcome"]
  reason?: string
}

/** Keep a decision for each event, and (for a wake-up) its time. Call under the lock. */
export async function decide(
  ctx: Ctx,
  task: Where,
  { kept, fresh, outcome, reason }: Choice,
): Promise<number> {
  const now = ctx.clock.now()
  const made = fresh.map(
    (event): Decision => ({
      key: event.key,
      at: now,
      outcome,
      what: event.what,
      ...(reason === undefined ? {} : { reason }),
      ...commentsField(event.comments),
    }),
  )
  const woke = outcome !== "skipped"
  await writeWakes(ctx, task, {
    version: 1,
    decisions: keptDecisions([...kept.decisions, ...made], now),
    wakes: [...recentWakes(kept, now), ...(woke ? [now] : [])],
    commentWakes: [
      ...recentCommentWakes(kept, now),
      ...(woke && fresh.every(isCommentEvent) ? [now] : []),
    ],
    ...coverageField(
      outcome === "skipped"
        ? fresh.reduce((covered, event) => coverComments(covered, event.comments), kept.covered)
        : kept.covered,
    ),
    ...cleanupField(kept.cleanup),
  })
  return now
}

/** How a claimed wake-up ended, and the stop it left to do (for the run generation that was resumed). */
export type Delivered = { ending: Ending; cleanup?: Omit<CleanupPending, "attempts"> }

/**
 * Settle the `sending` decisions made at `at`: say how it ended. `cleanup` is a stop that is still
 * to be done for a session resumed for this wake-up, kept in the same write. Takes the lock itself.
 */
export async function finish(
  ctx: Ctx,
  task: Where,
  fresh: readonly WakeEvent[],
  at: number,
  { ending, cleanup }: Delivered,
): Promise<void> {
  await underWakeLock(ctx, task, async () => {
    const kept = await readWakes(ctx, task)
    await writeWakes(ctx, task, {
      version: 1,
      decisions: settledDecisions(kept.decisions, fresh, at, ending),
      wakes: ending === "woken" ? kept.wakes : kept.wakes.filter((time) => time !== at),
      commentWakes:
        ending === "woken" ? kept.commentWakes : kept.commentWakes.filter((time) => time !== at),
      ...coverageField(
        ending === "release"
          ? kept.covered
          : fresh.reduce((covered, event) => coverComments(covered, event.comments), kept.covered),
      ),
      ...cleanupField(cleanup === undefined ? kept.cleanup : { ...cleanup, attempts: 0 }),
    })
  })
}

/**
 * Keep how a retried cleanup went, for the generation it was kept for: done clears it, a failed
 * round counts, and the last of the `rounds` allowed gives it up. Takes the lock itself.
 */
export async function settleCleanup(
  ctx: Ctx,
  task: Where,
  of: Pick<CleanupPending, "run" | "generation">,
  result: "done" | "failed",
  rounds: number,
): Promise<void> {
  await underWakeLock(ctx, task, async () => {
    const kept = await readWakes(ctx, task)
    if (kept.cleanup?.run !== of.run || kept.cleanup.generation !== of.generation) return
    const attempts = kept.cleanup.attempts + 1
    await writeWakes(ctx, task, {
      version: 1,
      decisions: kept.decisions,
      wakes: kept.wakes,
      commentWakes: kept.commentWakes,
      ...coverageField(kept.covered),
      ...cleanupField(
        result === "failed" && attempts < rounds ? { ...kept.cleanup, attempts } : undefined,
      ),
    })
  })
}
