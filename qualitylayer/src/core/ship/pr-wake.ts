// What the pull request says to the agent while the person is away. After a read of an open pull
// request (`server/pull-request-poll.ts`), a failing check, a review that asks for changes, a
// conflict, or people's new comments are something new: if the build session waits, QualityLayer
// sends it one message about it, the way the App sends its own. Each wake-up is a real agent turn on
// the person's plan, so these limits hold:
//
//   - once per event: a failing check on a head commit, a given review, a conflict on a head commit,
//     a batch of comments; the same failure on the same commit never wakes twice;
//   - at most three wake-ups per pull request in any 24 hours for checks, reviews and conflicts, and
//     two more for comments alone (comments that come with a failing check ride along);
//   - comments wake only once the reviewer paused five minutes, only people's (never a bot's or the
//     person's own), only when younger than a day, and never what `pr watch` already told the agent;
//   - none while the agent's tightest plan window has under 10 % left.
//
// Past a limit the event only shows in Needs you, with why the agent was not woken. What was decided
// is kept with the task (`pull-request-wakes.json`), so a restart of the server forgets nothing.
// A session that was stopped (by the idle stop, say) is resumed first, as Resume does, and then told;
// no session is kept alive because of a pull request.
// An agent that is watching its own pull request (`pr watch`), what the person chose to leave, a
// session that is working or waits on the person, or one the person wrote in a moment ago is left
// alone and asked again next round.

import type { Ctx } from "../../ctx.ts"
import type { RunRecord } from "../run/contracts.ts"
import type { Task } from "../task/store.ts"
import type { PullRequestRecord } from "./pr-record.ts"
import { type CommentsSeen, wakeEvents, wakeMessage } from "./pr-wake-events.ts"
import {
  COMMENT_WAKE_CAP,
  type CommentCoverage,
  coverComments,
  type Delivered,
  decide,
  finish,
  isCommentEvent,
  readWakes,
  recentCodeWakes,
  recentCommentWakes,
  settleCleanup,
  underWakeLock,
  WAKE_CAP,
  WAKE_PERIOD_MS,
  type WakeEvent,
  type WakeRecord,
} from "./pr-wake-record.ts"
import { readWatch } from "./pr-watch-record.ts"
import type { PrWake } from "./pr-words.ts"

export { wakeEvents, wakeMessage } from "./pr-wake-events.ts"
export { COMMENT_WAKE_CAP, WAKE_CAP, WAKE_PERIOD_MS }

/** No wake-up when the agent's tightest plan window has less than this share left. */
export const WAKE_PLAN_FLOOR = 10
/** A session with input or an event younger than this may have someone typing in it. */
export const WAKE_QUIET_MS = 30_000
/** Rounds a stop that failed is tried again, each time finding out first whether the session was taken over. */
export const WAKE_CLEANUP_ROUNDS = 5

/**
 * Where the task's build session stands for a wake-up: `ready` (up and waiting, or stopped and able
 * to be resumed), `wait` (working, being typed in, or starting or stopping: ask again next round),
 * or `skip` for good with the reason (no session, or one that cannot be resumed).
 */
export type Place =
  | { say: "ready"; run: RunRecord; stopped: boolean }
  | { say: "wait" }
  | { say: "skip"; reason: string }

/** The run generation a cleanup is for: a later generation of the same session is never touched by it. */
export type StopTarget = Pick<RunRecord, "id" | "generation">

/** How ending a resumed session went: it is stopped, someone took it over first, or it could not be done. */
export type StopOutcome = "stopped" | "taken-over" | "failed"

/** What a wake-up needs from the server: where the session stands, its plan, the resuming and the sending. */
export type WakeDeps = {
  /** The task's build session (by the task's id) and what can be done with it now. */
  place(id: string): Promise<Place>
  /** The share left of the agent's tightest plan window; null when it reports none. */
  planLeft(run: RunRecord): Promise<number | null>
  /**
   * Resume a stopped session's own native session in its detached host, with nobody attached, and
   * answer the run once it is up; throws when it cannot.
   */
  resume(run: RunRecord): Promise<RunRecord>
  /** Put the message into the session as the App's own messages are put; throws when it cannot (or someone is typing). */
  send(run: RunRecord, message: string): Promise<void>
  /**
   * End a session that was resumed for a wake-up and could not be told, so no agent is left running
   * for a pull request. It leaves the session alone when someone has taken it over (`taken-over`),
   * and keeps its record so it can be resumed again. Failing to reach the session is `failed`, as
   * is a throw: the stop is tried again at a later round.
   */
  stop(run: StopTarget): Promise<StopOutcome>
  /** Tell whoever shows the pull request that a wake-up in the background has ended. */
  changed?(): void
}

/**
 * `none`: nothing new. `waiting`: asked again next round. `woken` and `skipped`: decided and kept.
 * `sending`: claimed for a stopped session, which is resumed and told in the background.
 */
type WakeOutcome = "none" | "waiting" | "woken" | "skipped" | "sending"

/** The pull request as last read, the task it belongs to, and whether something says not now. */
type WakeTarget = {
  task: Task
  id: string
  record: PullRequestRecord
  /** The agent is watching or fixing this pull request itself (`pr watch`), or the person chose to leave what is on it. */
  held: boolean
}

/** A stopped session that must not be resumed, with the words that say why (the card shows them as they are). */
export class NotResumed extends Error {}

type Verdict =
  | { say: "send"; run: RunRecord; stopped: boolean }
  | { say: "wait" }
  | { say: "skip"; reason: string }

/** Whether the task's session may be woken now: `send`, `wait` for a later round, or `skip` for good with the reason. */
async function assess(
  ctx: Ctx,
  kept: WakeRecord,
  { id, held }: Pick<WakeTarget, "id" | "held">,
  deps: WakeDeps,
  fresh: readonly WakeEvent[],
): Promise<Verdict> {
  if (held) return { say: "wait" }
  const place = await deps.place(id)
  if (place.say !== "ready") return place
  const full = capReached(kept, fresh, ctx.clock.now())
  if (full !== null) return { say: "skip", reason: full }
  const left = await deps.planLeft(place.run)
  return left !== null && left < WAKE_PLAN_FLOOR
    ? { say: "skip", reason: `The agent's plan has ${Math.round(left)} % left` }
    : { say: "send", run: place.run, stopped: place.stopped }
}

/**
 * Why this wake-up would pass its day's allowance; null when it would not. Checks, change requests
 * and conflicts have theirs (comments that came with them ride along); comments alone have their own.
 */
function capReached(kept: WakeRecord, fresh: readonly WakeEvent[], now: number): string | null {
  if (fresh.some((event) => !isCommentEvent(event)))
    return recentCodeWakes(kept, now).length >= WAKE_CAP
      ? `Already woken ${WAKE_CAP} times in the last 24 hours`
      : null
  return recentCommentWakes(kept, now).length >= COMMENT_WAKE_CAP
    ? `People's comments already woke it ${COMMENT_WAKE_CAP} times in the last 24 hours`
    : null
}

/** Durable completed coverage plus in-flight batches; failed sends release their pending coverage. */
async function commentsSeen(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  kept: WakeRecord,
): Promise<CommentsSeen> {
  const watch = await readWatch(ctx, task)
  const covered = kept.decisions.reduce<CommentCoverage | undefined>(
    (known, decision) => coverComments(known, decision.comments),
    kept.covered,
  )
  return {
    told: new Set(watch?.told ?? []),
    since: covered?.at ?? 0,
    boundary: new Set(covered?.keys ?? []),
  }
}

/**
 * Put the message to the session, resuming it first when it was stopped: how the claim ends. A
 * message that could not reach a session that was up gives the claim back (asked again). A stopped
 * session that cannot be resumed, or was resumed and could not be told, ends it for good with the
 * reason: a resumed agent has no turn behind it, so nothing would ever make it idle for the next
 * round, and it is stopped again. If someone took the resumed session over meanwhile (typing is why
 * it could not be told), it is theirs and is left running: the claim is given back, and the usual
 * quiet rule tells it later. A stop that could not be done is kept for a later round to finish.
 */
async function deliver(
  message: string,
  verdict: Extract<Verdict, { say: "send" }>,
  deps: WakeDeps,
): Promise<Delivered> {
  let run = verdict.run
  try {
    if (verdict.stopped) run = await deps.resume(verdict.run)
  } catch (cause) {
    if (cause instanceof NotResumed) return { ending: { skipped: cause.message } }
    const why = cause instanceof Error ? cause.message : String(cause)
    return { ending: { skipped: `The session could not be resumed: ${why}` } }
  }
  try {
    await deps.send(run, message)
  } catch {
    return verdict.stopped ? undelivered(run, deps) : { ending: "release" }
  }
  return { ending: "woken" }
}

/** A resumed session that could not be told: stopped again, or left to the person who took it over. */
async function undelivered(run: RunRecord, deps: WakeDeps): Promise<Delivered> {
  const stopped = await deps.stop(run).catch((): StopOutcome => "failed")
  if (stopped === "taken-over") return { ending: "release" }
  return {
    ending: { skipped: "Resumed, but the message could not be delivered" },
    ...(stopped === "failed" ? { cleanup: { run: run.id, generation: run.generation } } : {}),
  }
}

/** The wake-ups that go on in the background (a stopped session takes a while to resume). */
const inflight = new Set<Promise<unknown>>()

/** Every background wake-up has ended: for tests, and for a server that is closing. */
export const pendingWakes = async (): Promise<void> => {
  await Promise.all([...inflight])
}

type Claim = { verdict: Extract<Verdict, { say: "send" }>; fresh: WakeEvent[]; at: number }

async function carryOut(
  ctx: Ctx,
  { task, record }: WakeTarget,
  deps: WakeDeps,
  { verdict, fresh, at }: Claim,
): Promise<WakeOutcome> {
  const delivered = await deliver(wakeMessage(record, fresh, task.slug), verdict, deps)
  await finish(ctx, task, fresh, at, delivered)
  deps.changed?.()
  const { ending } = delivered
  if (ending === "release") return "waiting"
  return ending === "woken" ? "woken" : "skipped"
}

/**
 * The decision, made and kept as `sending` under the task's lock before anything is sent: the claim
 * for the caller to carry out, or the outcome when there is nothing to send.
 */
async function claimEvent(
  ctx: Ctx,
  target: WakeTarget,
  deps: WakeDeps,
): Promise<Claim | WakeOutcome> {
  const { task, record } = target
  return underWakeLock(ctx, task, async (): Promise<Claim | WakeOutcome> => {
    const kept = await readWakes(ctx, task)
    const fresh = wakeEvents(record, await commentsSeen(ctx, task, kept)).filter(
      (event) => !kept.decisions.some((decision) => decision.key === event.key),
    )
    if (fresh.length === 0) return "none"
    const verdict = await assess(ctx, kept, target, deps, fresh)
    if (verdict.say === "wait") return "waiting"
    if (verdict.say === "skip") {
      await decide(ctx, task, { kept, fresh, outcome: "skipped", reason: verdict.reason })
      return "skipped"
    }
    return { verdict, fresh, at: await decide(ctx, task, { kept, fresh, outcome: "sending" }) }
  })
}

/** Tasks whose kept stop is being tried now: a round never starts a second one beside it. */
const cleaning = new Set<string>()

/**
 * Finish a stop that failed after a wake-up: tried again in the background, once per round, for the
 * run generation it was kept for. The stop dependency finds out first whether the session was taken
 * over; done or taken over ends it, a failure counts, and after `WAKE_CLEANUP_ROUNDS` it is given up.
 */
async function retryCleanup(ctx: Ctx, task: Task, deps: WakeDeps): Promise<void> {
  const pending = (await readWakes(ctx, task)).cleanup
  if (pending === undefined || cleaning.has(task.runtimeDir)) return
  cleaning.add(task.runtimeDir)
  const work = deps
    .stop({ id: pending.run, generation: pending.generation })
    .catch((): StopOutcome => "failed")
    .then((outcome) =>
      settleCleanup(
        ctx,
        task,
        pending,
        outcome === "failed" ? "failed" : "done",
        WAKE_CLEANUP_ROUNDS,
      ),
    )
    .catch(() => {})
    .finally(() => {
      cleaning.delete(task.runtimeDir)
      inflight.delete(work)
    })
  inflight.add(work)
}

/** Look at the pull request as last read and, when something new is on it, wake the agent within the limits. */
export async function wakeSession(
  ctx: Ctx,
  target: WakeTarget,
  deps: WakeDeps,
): Promise<WakeOutcome> {
  await retryCleanup(ctx, target.task, deps)
  const claim = await claimEvent(ctx, target, deps)
  if (typeof claim === "string") return claim
  const work = carryOut(ctx, target, deps, claim)
  if (!claim.verdict.stopped) return work
  const tracked = work.finally(() => inflight.delete(tracked))
  inflight.add(tracked)
  return "sending"
}

/** The last decision about something the pull request still holds; null when there is none. */
export async function wakeNote(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  record: PullRequestRecord,
): Promise<PrWake | null> {
  const kept = await readWakes(ctx, task)
  // The comments of a decided batch stay current while they are new, so its decision still shows.
  const seen = { ...(await commentsSeen(ctx, task, kept)), since: 0 }
  const current = new Set(
    wakeEvents(record, seen).flatMap((event) => [event.key, ...(event.comments?.keys ?? [])]),
  )
  if (current.size === 0) return null
  const last = kept.decisions
    .filter((decision) => current.has(decision.key))
    .sort((a, b) => a.at - b.at)
    .at(-1)
  return last === undefined
    ? null
    : {
        state: last.outcome === "skipped" ? "skipped" : "woken",
        at: last.at,
        what: last.what,
        ...(last.reason === undefined ? {} : { reason: last.reason }),
      }
}

/** `{ wake }` for the pull request's life when there is a decision to show, else nothing. */
export async function wakeField(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  record: PullRequestRecord,
): Promise<{ wake?: PrWake }> {
  const wake = await wakeNote(ctx, task, record)
  return wake === null ? {} : { wake }
}
