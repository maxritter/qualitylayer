// While the server runs and Settings › Git and editor › Watch pull requests is on, it reads the open
// pull request of each shipped task through `gh` every two minutes, so a new thread, a failing check,
// a request for changes, a conflict or a merge reaches the sidebar and Home without anyone
// opening the task. Something new on it may also wake the task's build session, within the limits of
// core/ship/pr-wake.ts. With the setting off, or without `gh`, it reads nothing at all: the pull
// request is not followed. The writes land in each task's `pull-request.json`, which the file
// watcher already turns into an event for the page. Each tick also lets server/landing-poll.ts read,
// from git alone, whether an approved task landed; that runs with the setting off as well.

import { readConfig } from "../core/config.ts"
import { followPullRequest, pullRequestLife } from "../core/ship/pr-life.ts"
import { readPullRequestRecord } from "../core/ship/pr-record.ts"
import { type WakeDeps, wakeSession } from "../core/ship/pr-wake.ts"
import type { PullRequestLife } from "../core/ship/pr-words.ts"
import { ghInstalled, pullRequestOf } from "../core/ship/pull-request.ts"
import type { Task } from "../core/task/store.ts"
import type { Ctx } from "../ctx.ts"
import { shippedWithOpenPullRequest } from "./api.ts"
import { pollLanding, resetLandingSchedule } from "./landing-poll.ts"
import { cachePullRequest, subscribePullRequestCache } from "./pull-request-poll-cache.ts"
import { afterRead, HostBackoff, meet, type Watched } from "./pull-request-schedule.ts"
import { wakeDeps } from "./pull-request-wake.ts"
import { Pace } from "./resource-guard.ts"
import type { Hub } from "./watch.ts"

export {
  cachedPullRequest,
  cachePullRequest,
  dropPullRequestCache,
  PULL_REQUEST_CACHE_ENTRIES,
  pullRequestCacheSize,
} from "./pull-request-poll-cache.ts"

/** How often an open pull request is read. */
export const PULL_REQUEST_POLL_MS = 120_000

/** The time a test gives the poll (`QUALITYLAYER_TEAM_POLL_MS`, as for the team poll), or the two minutes. */
export function pullRequestInterval(ctx: Ctx): number {
  const ms = Number(ctx.env.get("QUALITYLAYER_TEAM_POLL_MS"))
  return Number.isFinite(ms) && ms > 0 ? ms : PULL_REQUEST_POLL_MS
}

/** A round is due at a tick while Settings says to watch pull requests; read each time, so the switch acts at once. */
export const pullRequestRoundDue = async (ctx: Ctx): Promise<boolean> =>
  (await readConfig(ctx)).pullRequests.watch

/** What a person would notice of a task's pull request: what it holds and what waits on them. */
const looksOf = (life: PullRequestLife | null): string =>
  life === null ? "" : JSON.stringify({ ...life, readAt: 0 })

/**
 * What each task's pull request looked like when this poll last saw it. Another read (the task's
 * page, the agent's `next`) can keep a change before the poll's own read does; comparing with
 * what the poll last saw still tells the page.
 */
const lastSeen = new Map<string, string>()

/** The wake-up of a poll that was given no run service: a stopped session cannot be resumed. */
const withoutResume = async (): Promise<never> => {
  throw new Error("this server has no run service to resume it with")
}

/** Each followed pull request's schedule, by task folder: how quiet it is and when it is read next. */
const watched = new Map<string, Watched>()
/** Whether this server follows an open pull request: a computer served as a machine stays up for it. */
export const pullRequestWatched = (): boolean => watched.size > 0
/** The poll's wait after rounds in which `gh` answered nothing. */
const hostBackoff = new HostBackoff()

/** Forget every schedule and wait: a new poll starts afresh (and so does a test). */
export function resetPullRequestSchedule(): void {
  watched.clear()
  hostBackoff.reset()
  lastSeen.clear()
  resetLandingSchedule()
}

/**
 * Read one pull request now and wake its agent when something new is on it: whether the read
 * succeeded (it kept a record newer than the moment it began), and the pull request as it is then.
 * The pull request's life is computed once, and again only when a wake-up decision changed it.
 * `waiting`: something new is on it that the busy session could not be told yet, so it is read again
 * at the next round (not while the agent or the person has it held, which a quiet pull request waits out).
 */
async function readAndWake(
  ctx: Ctx,
  wake: WakeDeps,
  who: { id: string; task: Task },
): Promise<{ ok: boolean; life: PullRequestLife | null; waiting: boolean }> {
  const began = ctx.clock.now()
  const record = await followPullRequest(ctx, who.task)
  let life = await pullRequestLife(ctx, who.task)
  if (record === null || record.readAt < began) return { ok: false, life, waiting: false }
  // The agent that watches or fixes its own pull request (`pr watch`) is already on it, and what the
  // person chose to leave is not to be put to the agent.
  const state = life?.watch?.state
  const agentOnIt = state === "watching" || state === "fixing" || state === "resolving"
  const held = agentOnIt || life?.waiting.left === true
  const outcome = await wakeSession(ctx, { ...who, record, held }, wake)
  if (outcome === "woken" || outcome === "skipped" || outcome === "sending")
    life = await pullRequestLife(ctx, who.task)
  return { ok: true, life, waiting: outcome === "waiting" && !held }
}

/** One round: read every shipped task's open pull request that is due; true when anything changed since the last. */
export async function pollPullRequests(
  ctx: Ctx,
  wake: WakeDeps = wakeDeps(ctx, withoutResume),
): Promise<boolean> {
  const interval = pullRequestInterval(ctx)
  if (!ghInstalled(ctx) || hostBackoff.blocked(ctx.clock.now())) return false
  let changed = false
  const listed = await shippedWithOpenPullRequest(ctx)
  // Only the tasks of this listing are kept: a task that closed or left stops being remembered.
  const dirs = new Set(listed.map(({ task }) => task.dir))
  for (const dir of [...lastSeen.keys(), ...watched.keys()])
    if (!dirs.has(dir)) {
      lastSeen.delete(dir)
      watched.delete(dir)
    }
  let ok = 0
  let failed = 0
  for (const { id, task } of listed) {
    const now = ctx.clock.now()
    const schedule =
      watched.get(task.dir) ?? meet(now, (await readPullRequestRecord(ctx, task))?.readAt ?? 0)
    if (now < schedule.nextAt) {
      watched.set(task.dir, schedule)
      continue
    }
    const before = lastSeen.get(task.dir) ?? looksOf(await pullRequestLife(ctx, task))
    const read = await readAndWake(ctx, wake, { id, task })
    const after = looksOf(read.life)
    lastSeen.set(task.dir, after)
    const differs = before !== after
    watched.set(
      task.dir,
      afterRead(
        schedule,
        { ok: read.ok, changed: differs, waiting: read.waiting },
        interval,
        ctx.clock.now(),
      ),
    )
    if (!read.ok) {
      failed++
      continue
    }
    ok++
    // `followPullRequest` just read it, so this answers from the core's own short memory, not `gh`.
    cachePullRequest(task.dir, await pullRequestOf(ctx, task), ctx.clock.now())
    if (differs) changed = true
  }
  hostBackoff.settle(ok, failed, interval, ctx.clock.now())
  return changed
}

/** The tick's answer: Settings says to watch, and the resource guard has not stretched the wait past now. */
async function roundWanted(ctx: Ctx, pace: Pace, lastRound: number): Promise<boolean> {
  return paceElapsed(ctx, pace, lastRound) && (await pullRequestRoundDue(ctx))
}

/** Over its resource budget the server asks less often: every wait is `pace.factor` times longer. */
function paceElapsed(ctx: Ctx, pace: Pace, last: number): boolean {
  return pace.factor <= 1 || ctx.clock.now() - last >= pullRequestInterval(ctx) * pace.factor
}

/** Which approved tasks landed is read from git on this schedule, whatever Settings says of pull requests. */
async function landingRound(ctx: Ctx, hub: Hub, pace: Pace, last: number): Promise<number> {
  if (!paceElapsed(ctx, pace, last)) return last
  const at = ctx.clock.now()
  if (await pollLanding(ctx)) hub.publish({ type: "task-changed" })
  return at
}

/** Start the poll; returns the stop function. Rounds never overlap. */
export function startPullRequestPoll(
  ctx: Ctx,
  hub: Hub,
  pace: Pace = new Pace(),
  wake: WakeDeps = wakeDeps(ctx, withoutResume),
): () => void {
  resetPullRequestSchedule()
  let running = false
  let stopped = false
  let lastRound = ctx.clock.now()
  let lastLanding = lastRound
  // A page that opened a task before its pull request was read hears of the answer at once.
  const unsubscribe = subscribePullRequestCache(() => hub.publish({ type: "task-changed" }))
  const timer = setInterval(async () => {
    if (stopped || running) return
    running = true
    try {
      lastLanding = await landingRound(ctx, hub, pace, lastLanding)
      if (!(await roundWanted(ctx, pace, lastRound))) return
      lastRound = ctx.clock.now()
      if (await pollPullRequests(ctx, wake)) hub.publish({ type: "task-changed" })
    } catch {
      // a failed round is tried again at the next tick
    } finally {
      running = false
    }
  }, pullRequestInterval(ctx))
  return () => {
    stopped = true
    unsubscribe()
    clearInterval(timer)
  }
}
