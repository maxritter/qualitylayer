// Verify's mode for a task, read from its record: what the App, `next` and `status` show while a task is
// in Verify. Reading only: an exit whose cause is gone no longer counts as asked here, and the verbs
// (`pendingExit`) remove its record.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { type CheckRecord, checksReadyForReview, latestRuns, readCheckRecords } from "../checks.ts"
import { lastIteration, readBuildRecord } from "../docs/build-log.ts"
import { buildOwnPaths } from "../gate/revision.ts"
import { revisionPaths } from "../git/revision-paths.ts"
import { releaseWaiting } from "../judge-environment.ts"
import { openNeeds, readNeeds } from "../need/need.ts"
import { openExitQuestion, readVerifyExit, type VerifyExit } from "../next/verify-exit.ts"
import { projectRedState, redProjectChecks } from "../red-checks.ts"
import { passStanding, readAssignment } from "../verification.ts"
import { answeredQuestions } from "./question.ts"
import { type VerifyMode, verifyModeOf } from "./stages.ts"
import { readEvents, type Task } from "./store.ts"

function isFreshPassingRun(r: CheckRecord, at: number): boolean {
  if (r.at <= at || !r.ran || r.reused === true) return false
  return r.exit === 0 && !r.notRun && r.timedOut !== true
}

/** The project checks show the environment works again: each latest run is a fresh pass after the exit. */
async function checksWorkSince(ctx: Ctx, task: Task, at: number): Promise<boolean> {
  const latest = latestRuns(await readCheckRecords(ctx, task)).filter((r) => r.scope === "all")
  return (
    latest.length > 0 &&
    latest.every((r) => isFreshPassingRun(r, at)) &&
    (await checksReadyForReview(ctx, task))
  )
}

const exitGoneChecks: Partial<
  Record<VerifyExit["reason"], (ctx: Ctx, task: Task, exit: VerifyExit) => Promise<boolean>>
> = {
  fix_cap: async (ctx, task, exit) => {
    // Old automatic stops lift unless this exact question already reached the person.
    const base = exit.id.replace(/-r\d+$/, "")
    return (
      (await openExitQuestion(ctx, task, exit.id)) === null &&
      !(await answeredQuestions(ctx, task)).some((a) => a.id?.replace(/-r\d+$/, "") === base)
    )
  },
  person_needed: async (ctx, task) => openNeeds(await readNeeds(ctx, task)).length === 0,
  release_wait: async (ctx, task) => (await releaseWaiting(ctx, task))?.exhausted !== true,
  check_budget: async (ctx, task) =>
    (await checksReadyForReview(ctx, task)) &&
    (await redProjectChecks(ctx, task)).every((record) => record.timedOut !== true),
  environment: async (ctx, task, exit) => {
    const open = openNeeds(await readNeeds(ctx, task)).map((need) => need.for)
    const needs = exit.needs ?? []
    if (needs.length > 0 && needs.every((id) => !open.includes(id))) return true
    return checksWorkSince(ctx, task, exit.at)
  },
  red_base: async (ctx, task) => {
    const { red, excused } = await projectRedState(ctx, task)
    return !red.some((r) => excused.standing.get(r)?.state === "unmatched")
  },
}

/**
 * Whether what an exit was written for is gone: the needs done, the release no longer waited for,
 * the timed-out checks passed since, the environment working again, the red base matched or fixed.
 */
export async function exitCauseGone(ctx: Ctx, task: Task, exit: VerifyExit): Promise<boolean> {
  const check = exitGoneChecks[exit.reason]
  return check ? check(ctx, task, exit) : false
}

/** The mode of a task in Verify, or null for a task in any other stage. */
export async function readVerifyMode(ctx: Ctx, task: Task): Promise<VerifyMode | null> {
  if (task.stage !== "verify") return null
  const events = await readEvents(ctx, task)
  const exit = await readVerifyExit(ctx, task)
  const answered =
    exit !== null &&
    events
      .slice(exit.seen)
      .some((e) => e.event === "fix_round_asked" || (e.event === "plan_amended" && e.by === "user"))
  const stands = exit !== null && !answered && !(await exitCauseGone(ctx, task, exit))
  const mode = verifyModeOf(events, stands)
  // A recheck pass still awaiting `check all` + `verify judge` has counted `last.result === "pass"`
  // without recording `verify_result { passed: true }` yet; report `checking` instead of stale `fixing`.
  if (mode === "fixing") {
    const last = lastIteration(await readBuildRecord(ctx, task))
    const withdrawnLatest = events.some(
      (e) => e.event === "verify_withdrawn" && e.iteration === task.iterations,
    )
    if (last?.result === "pass" && last.n === task.iterations && !withdrawnLatest) return "checking"
  }
  // A change by the task's own sessions withdraws its passed review (Max): read only once HEAD
  // moved past the judged commit.
  return mode === "yours" && (await ownChangeSincePass(ctx, task, events.length))
    ? "rechecking"
    : mode
}

/** What `.git/HEAD` and the ref it names look like now: HEAD is read again only when this changes. */
async function headKey(ctx: Ctx, root: string): Promise<string | null> {
  try {
    const git = join(root, ".git")
    const head = (await ctx.fs.readFile(join(git, "HEAD"))).trim()
    const stamp = async (path: string) => {
      const info = await ctx.fs.stat?.(path).catch(() => null)
      return info ? `${info.mtimeMs}:${info.size}` : "-"
    }
    const ref = /^ref:\s*(\S+)/.exec(head)?.[1]
    if (ctx.fs.stat === undefined) return null
    return [
      head,
      ref ? await stamp(join(git, ref)) : "",
      await stamp(join(git, "packed-refs")),
    ].join("|")
  } catch {
    return null
  }
}

const heads = new Map<string, { key: string; sha: string }>()

/** HEAD's commit: one `git rev-parse HEAD`, cached on the HEAD and ref files. */
async function headCommit(ctx: Ctx, root: string): Promise<string | null> {
  const key = await headKey(ctx, root)
  const cached = heads.get(root)
  if (key !== null && cached?.key === key) return cached.sha
  const out = await ctx.git.run(root, ["rev-parse", "HEAD"]).catch(() => null)
  const sha = out?.code === 0 ? out.stdout.trim() : null
  if (sha !== null && key !== null) heads.set(root, { key, sha })
  return sha
}

const standings = new Map<string, { key: string; withdrawn: boolean }>()

/**
 * Whether the passed review no longer stands because the code moved since the judge ruled. No git
 * call while HEAD is the judged commit; once it moved, the pass rule (`passStanding`) decides, once
 * per HEAD and record.
 */
/**
 * `git status` of the task's own production files, empty when they are as committed. The server's
 * git keeps a status answer until a watched file changes (server/git-cache.ts), so an App poll
 * reuses it.
 */
async function ownFilesDirty(ctx: Ctx, task: Task): Promise<string> {
  const own = await buildOwnPaths(ctx, task).catch(() => null)
  if (own === null || own.length === 0) return ""
  const local = revisionPaths(task.repoRoot, own).local
  if (local.length === 0) return ""
  const status = await ctx.git
    .run(task.repoRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...local.map((path) => `:(literal)${path}`),
      ":(exclude)docs/plans/**",
    ])
    .catch(() => null)
  return status?.code === 0 ? status.stdout : ""
}

async function passCacheKey(
  ctx: Ctx,
  task: Task,
  judged: string,
  seen: number,
): Promise<string | null> {
  const head = await headCommit(ctx, task.repoRoot)
  if (head === null) return null
  // HEAD is the judged commit: only the task's own files left changed uncommitted can withdraw it.
  const dirty = head === judged ? await ownFilesDirty(ctx, task) : ""
  if (head === judged && dirty === "") return null
  return `${head}|${dirty}|${seen}`
}

async function ownChangeSincePass(ctx: Ctx, task: Task, seen: number): Promise<boolean> {
  const receipt = await readAssignment(ctx, task)
  // A judge handed out after the pass and not ruled yet: Verify rechecks.
  if (receipt !== null && receipt.result !== "pass") return true
  const judged = receipt?.head
  const key = judged === undefined ? null : await passCacheKey(ctx, task, judged, seen)
  if (key === null) return false
  const cached = standings.get(task.runtimeDir)
  if (cached?.key === key) return cached.withdrawn
  const withdrawn = !(await passStanding(ctx, task)).stands
  standings.set(task.runtimeDir, { key, withdrawn })
  return withdrawn
}
