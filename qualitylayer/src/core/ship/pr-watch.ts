// The agent stays with its pull request. After it opens one, `pr watch` waits for the checks to
// settle and answers what the agent does next: nothing (green, or the review threads and new remarks
// reviewers left by then), fix these checks (failing, each with
// the tail of its failed log), resolve this conflict, or stop for the person (gave-up, after three
// fix attempts for the pull request). Each answer is kept beside the pull request's record
// (`pr-watch-record.ts`), so the App shows the watch and a later run counts the attempts it finds.
//
// Reads of GitHub are bounded: one `gh pr view` per cadence (cached for that long), one read of a
// failed run's log per run and answer, and nothing at all when no task is being watched: the loop
// lives in the agent's own command, not in the server.

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import type { PrCheck } from "./pr-record.ts"
import type { PrRemark } from "./pr-threads.ts"
import {
  cadenceOf,
  conflictFiles,
  type FailingCheck,
  failingWithLogs,
  gaveUpSay,
  greenWords,
  nap,
  reviewersSaid,
  type Snapshot,
  snapshotOf,
} from "./pr-watch-github.ts"
import {
  MAX_ATTEMPTS,
  readWatch,
  type WatchAttempt,
  type WatchRecord,
  writeWatch,
} from "./pr-watch-record.ts"
import { ghInstalled, pullRequestOf, storedUrl } from "./pull-request.ts"

export { type FailingCheck, tailOf } from "./pr-watch-github.ts"
export { MAX_ATTEMPTS }

/** Every status the command answers with; the text Ship gives the agent names each one. */
export const WATCH_STATUSES = [
  "green",
  "pending",
  "failing",
  "conflict",
  "gave-up",
  "no-checks",
  "timed-out",
  "merged",
  "closed",
] as const

export type WatchStatus = (typeof WATCH_STATUSES)[number]

export type WatchAnswer = {
  status: WatchStatus
  url: string
  number: number | null
  /** Fix attempts used so far, of three. */
  attempt: number
  attempts_left: number
  failing?: FailingCheck[]
  conflict?: { base: string; files: string[] }
  /** On gave-up: the checks that still fail. */
  still_failing?: string[]
  /** On pending and timed-out: the checks that still run. */
  running?: string[]
  /** On green: review threads the author has not triaged yet. */
  open_threads?: number
  /** On green: comments and review texts on the pull request not told before. */
  remarks?: PrRemark[]
  /** One line for the agent to say or act on. */
  say: string
}

export type WatchOptions = {
  /** Before the first read after a push, so the checks have started: 5 minutes. */
  initialWaitMs?: number
  /** One call returns `pending` after this, to fit the agent's own command limit: 9 minutes. */
  callLimitMs?: number
  /** All the calls of one round together: an hour, then `timed-out`. */
  totalLimitMs?: number
  /** Between reads of GitHub: the poll's cadence, a minute. */
  cadenceMs?: number
  /** The person asked for three more attempts after `gave-up`. */
  again?: boolean
}

const INITIAL_WAIT_MS = 300_000
const CALL_LIMIT_MS = 540_000
const TOTAL_LIMIT_MS = 3_600_000
/** A call that finds the watch written this recently carries on the same round, without the initial wait. */
const CONTINUE_MS = 20 * 60_000
/** Reads that find no check at all before the pull request is said to have none. */
const EMPTY_READS = 3
/** Reads gh cannot answer before the watch gives up on it. */
const UNREADABLE_READS = 3

const bad = (message: string) => err({ code: "bad_args" as const, message })

const fresh = (url: string, now: number): WatchRecord => ({
  url,
  state: "watching",
  attempt: 0,
  max: MAX_ATTEMPTS,
  failing: [],
  base: "",
  files: [],
  at: now,
  started: now,
  attempts: [],
  told: [],
})

const left = (w: Pick<WatchRecord, "attempt">) => Math.max(0, MAX_ATTEMPTS - w.attempt)

/** What a watch that gave up says, from the record alone: a stop on a conflict names no failing check. */
function gaveUp(w: WatchRecord, number: number | null): WatchAnswer {
  const conflict = w.failing.length === 0
  return {
    status: "gave-up",
    url: w.url,
    number,
    attempt: w.attempt,
    attempts_left: 0,
    still_failing: w.failing,
    ...(conflict ? { conflict: { base: w.base, files: w.files } } : {}),
    say: gaveUpSay(w),
  }
}

/**
 * Watch the task's pull request until its checks settle, then answer what to do. Each failing or
 * conflicting answer is one fix attempt, three at most per pull request; the answer after the third
 * fix that still fails is `gave-up`, and a later call repeats it without reading GitHub.
 */
export async function watchPullRequest(
  ctx: Ctx,
  task: Task,
  given: WatchOptions = {},
): Promise<Result<WatchAnswer>> {
  const url = await watchedUrl(ctx, task)
  if (!url.ok) return url
  const r = await beginRound(ctx, task, url.data, given)
  if (r.w.state === "gave-up") return ok(gaveUp(r.w, null))
  let unreadable = 0
  for (;;) {
    const snapshot = await snapshotOf(ctx, task, r.url, r.opts.cadenceMs)
    unreadable = snapshot === null ? unreadable + 1 : 0
    if (unreadable >= UNREADABLE_READS) return bad("gh could not read the pull request.")
    const settled = snapshot === null ? null : await settle(r, snapshot)
    if (settled !== null) return settled
    await save(r, {})
    await nap(ctx, task, r.opts.cadenceMs)
  }
}

/** One call's watch: the record it keeps, its limits, and the reads that found no check so far. */
type Round = {
  ctx: Ctx
  task: Task
  url: string
  w: WatchRecord
  opts: Required<Omit<WatchOptions, "again">>
  /** When this call began; one call's limit is counted from here. */
  begun: number
  empty: number
}

/** The pull request to watch: the one remembered for the task, else the one its branch has. */
async function watchedUrl(ctx: Ctx, task: Task): Promise<Result<string>> {
  if (!ghInstalled(ctx))
    return bad("gh is not installed here, so the pull request cannot be watched.")
  const url = (await storedUrl(ctx, task)) ?? (await pullRequestOf(ctx, task, true))?.url ?? null
  return url === null ? bad("This task has no pull request to watch.") : ok(url)
}

/**
 * The round this call watches. A watch that gave up stays as it was (unless the person asked for
 * more attempts); otherwise it is written as watching, and a new round waits for the checks to start.
 */
async function beginRound(ctx: Ctx, task: Task, url: string, given: WatchOptions): Promise<Round> {
  const opts = {
    initialWaitMs: given.initialWaitMs ?? INITIAL_WAIT_MS,
    callLimitMs: given.callLimitMs ?? CALL_LIMIT_MS,
    totalLimitMs: given.totalLimitMs ?? TOTAL_LIMIT_MS,
    cadenceMs: given.cadenceMs ?? cadenceOf(ctx),
  }
  const begun = ctx.clock.now()
  const earlier = await readWatch(ctx, task)
  const same = earlier !== null && earlier.url === url ? earlier : null
  let w: WatchRecord = same ?? fresh(url, begun)
  if (given.again === true && w.state === "gave-up") {
    w = { ...w, state: "watching", attempt: 0, failing: [], files: [] }
  }
  const r: Round = { ctx, task, url, w, opts, begun, empty: 0 }
  if (w.state === "gave-up") return r
  const continuing = same !== null && w.state === "watching" && begun - w.at < CONTINUE_MS
  await save(r, {
    state: "watching",
    failing: continuing ? w.failing : [],
    files: continuing ? w.files : [],
    started: continuing ? w.started : begun,
  })
  if (!continuing && opts.initialWaitMs > 0) await nap(ctx, task, opts.initialWaitMs)
  return r
}

async function save(r: Round, over: Partial<WatchRecord>): Promise<void> {
  r.w = { ...r.w, ...over, at: r.ctx.clock.now() }
  await writeWatch(r.ctx, r.task, r.w)
}

function answer(
  r: Round,
  status: WatchStatus,
  snapshot: Snapshot | null,
  more: Partial<WatchAnswer> & { say: string },
): Result<WatchAnswer> {
  return ok({
    status,
    url: r.url,
    number: snapshot?.number ?? null,
    attempt: r.w.attempt,
    attempts_left: left(r.w),
    ...more,
  })
}

/** What one read of the pull request settles: its answer, or null to read again after the cadence. */
async function settle(r: Round, snapshot: Snapshot): Promise<Result<WatchAnswer> | null> {
  if (snapshot.state !== "open")
    return answer(r, snapshot.state, snapshot, {
      say: `The pull request is ${snapshot.state}. Nothing more to watch.`,
    })
  if (snapshot.mergeable === "CONFLICTING") return attemptFor(r, "conflict", snapshot, [])
  return (await checksSettled(r, snapshot)) ?? (await limitReached(r, snapshot))
}

/** Every check finished (failing or green), or none appeared in three reads: that answer. */
async function checksSettled(r: Round, snapshot: Snapshot): Promise<Result<WatchAnswer> | null> {
  if (snapshot.checks.length === 0) {
    r.empty += 1
    return r.empty >= EMPTY_READS ? noChecks(r, snapshot) : null
  }
  r.empty = 0
  if (snapshot.checks.some((c) => c.result === "running")) return null
  const failed = snapshot.checks.filter((c) => c.result === "failed")
  return failed.length > 0 ? attemptFor(r, "failing", snapshot, failed) : green(r, snapshot)
}

async function noChecks(r: Round, snapshot: Snapshot): Promise<Result<WatchAnswer>> {
  await save(r, { state: "no-checks" })
  return answer(r, "no-checks", snapshot, {
    say: "GitHub reports no checks for this pull request. Say so in one line and stop.",
  })
}

async function green(r: Round, snapshot: Snapshot): Promise<Result<WatchAnswer>> {
  const said = await reviewersSaid(r.ctx, r.task, r.url, r.w.told)
  await save(r, { state: "green", failing: [], files: [], told: said.told })
  return answer(r, "green", snapshot, { ...said.fields, say: greenWords(r.task, said.fields) })
}

/** Checks still run: past the round's hour it is `timed-out`, past one call's limit `pending`. */
async function limitReached(r: Round, snapshot: Snapshot): Promise<Result<WatchAnswer> | null> {
  const running = snapshot.checks.filter((c) => c.result === "running").map((c) => c.name)
  const now = r.ctx.clock.now()
  if (now - r.w.started >= r.opts.totalLimitMs) {
    await save(r, { state: "timed-out", failing: [] })
    return answer(r, "timed-out", snapshot, {
      running,
      say: "The checks are still running after an hour. Say which and stop for the person.",
    })
  }
  return now - r.begun >= r.opts.callLimitMs
    ? answer(r, "pending", snapshot, {
        running,
        say: "Checks are still running. Run qualitylayer pr watch again.",
      })
    : null
}

/** One more fix attempt, or the stop when the three are used. */
async function attemptFor(
  r: Round,
  kind: WatchAttempt["kind"],
  snapshot: Snapshot,
  failed: PrCheck[],
): Promise<Result<WatchAnswer>> {
  const names = failed.map((c) => c.name)
  const files = kind === "conflict" ? await conflictFiles(r.ctx, r.task, snapshot.base) : []
  if (r.w.attempt >= MAX_ATTEMPTS) {
    await save(r, { state: "gave-up", failing: names, base: snapshot.base, files })
    return ok(gaveUp(r.w, snapshot.number))
  }
  const n = r.w.attempt + 1
  const attempt: WatchAttempt = {
    n,
    kind,
    at: r.ctx.clock.now(),
    head: snapshot.head,
    failing: names,
    files,
  }
  await save(r, {
    state: kind === "conflict" ? "resolving" : "fixing",
    attempt: n,
    failing: names,
    base: snapshot.base,
    files,
    attempts: [...r.w.attempts, attempt],
  })
  return kind === "conflict"
    ? answer(r, "conflict", snapshot, {
        conflict: { base: snapshot.base, files },
        say: `The pull request conflicts with ${snapshot.base}${files.length > 0 ? ` in ${files.join(", ")}` : ""}. Fix attempt ${n} of ${MAX_ATTEMPTS}.`,
      })
    : answer(r, "failing", snapshot, {
        failing: await failingWithLogs(r.ctx, r.task, failed),
        say: `${names.join(", ")} failing. Fix attempt ${n} of ${MAX_ATTEMPTS}.`,
      })
}
