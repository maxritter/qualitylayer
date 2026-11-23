// The pull request after the approval, until it is merged. Reading it through `gh` keeps its last
// known state with the task (`pr-record.ts`); this module says what of that waits on the person (a
// thread nobody has answered, a failing check, a request for changes, a fix ready to push), closes
// the task once when the merge is seen, lets the person leave what waits for now, and pushes the
// fix on their click. QualityLayer never pushes or merges by itself.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { currentBranch } from "../git/repo.ts"
import { appendEvent, readEvents, type Task } from "../task/store.ts"
import {
  askedPath,
  askingOf,
  branchTip,
  commitsAhead,
  keptTime,
  leftPath,
  settledThreads,
  unpushedTimes,
} from "./pr-life-state.ts"
import { type PullRequestRecord, readPullRequestRecord } from "./pr-record.ts"
import { wakeField } from "./pr-wake.ts"
import { watchOf } from "./pr-watch-record.ts"
import { type PrWaiting, type PullRequestLife, waitingWords } from "./pr-words.ts"
import { ghInstalled, pullRequestOf, wrongBranch } from "./pull-request.ts"

export { commitsAhead } from "./pr-life-state.ts"
export type { PullRequestLife, PullRequestRecord }
export { readPullRequestRecord, waitingWords }

const NONE: PrWaiting = {
  threads: 0,
  threadIds: [],
  failing: 0,
  changes: false,
  fixReady: false,
  left: false,
  since: null,
}

const bad = (message: string) => ({ code: "bad_args" as const, message })

/** The pull request as last read, with what waits on the person; null for a task that has none. */
export async function pullRequestLife(ctx: Ctx, task: Task): Promise<PullRequestLife | null> {
  const record = await readPullRequestRecord(ctx, task)
  if (record === null) return null
  const followed = ghInstalled(ctx)
  const settled = (await settledThreads(ctx, task)).size
  if (record.state !== "open") return { ...record, followed, waiting: NONE, settled }
  const asking = await askingOf(ctx, task, record)
  const left =
    asking.signature !== "" && (await keptTime(ctx, leftPath(task), asking.signature)) !== null
  const watch = await watchOf(ctx, task, record.url)
  // The failing check or the conflict the agent is fixing is its work for now, not the person's.
  const agentFixing = watch?.state === "fixing" || watch?.state === "resolving"
  return {
    ...record,
    followed,
    settled,
    ...(watch !== null ? { watch } : {}),
    ...(await wakeField(ctx, task, record)),
    waiting: {
      threads: left ? 0 : asking.threads.length,
      threadIds: left ? [] : asking.threads.map((t) => t.id),
      failing: left || agentFixing ? 0 : asking.failing.length,
      changes: left ? false : asking.changes,
      // A conflict the agent is resolving is its work for now, as a failing check it is fixing is.
      ...(!left && !agentFixing && asking.conflict ? { conflict: true } : {}),
      fixReady: followed && (await commitsAhead(ctx, task, record.head)) > 0,
      left,
      since: left ? null : await keptTime(ctx, askedPath(task), asking.signature),
    },
  }
}

/** Leave what waits now: the pull request asks again only when a new thread, a new failing check or a new request comes. */
export async function leavePullRequest(ctx: Ctx, task: Task): Promise<Result<null>> {
  const record = await readPullRequestRecord(ctx, task)
  if (record === null || record.state !== "open")
    return err(bad("This task has no open pull request."))
  const { signature } = await askingOf(ctx, task, record)
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    leftPath(task),
    `${JSON.stringify({ signature, at: ctx.clock.now() })}\n`,
  )
  return ok(null)
}

/**
 * When what waits began to wait: the first read that saw it, kept until something else asks, with
 * the commit the task's branch was at then, so a fix is told from what was committed before.
 */
async function noteAsking(ctx: Ctx, task: Task, record: PullRequestRecord): Promise<void> {
  if (record.state !== "open") return
  const { signature } = await askingOf(ctx, task, record)
  if (signature === "" || (await keptTime(ctx, askedPath(task), signature)) !== null) return
  const tip = await branchTip(ctx, task)
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    askedPath(task),
    `${JSON.stringify({ signature, at: ctx.clock.now(), ...(tip !== "" ? { tip } : {}) })}\n`,
  )
}

/** The merge is on the task's record once: the first read that sees it appends `task_merged`. */
async function recordMerged(ctx: Ctx, task: Task, record: PullRequestRecord): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.withLock(join(task.runtimeDir, "task-merged.lock"), async () => {
    if ((await readEvents(ctx, task)).some((e) => e.event === "task_merged")) return
    await appendEvent(ctx, task, {
      event: "task_merged",
      url: record.url,
      number: record.number,
      base: record.base,
    })
  })
}

/**
 * Read the pull request through `gh` now (the cache is skipped) and keep it with the task; a merge
 * is recorded. Null when `gh` is not installed: the pull request is not followed, and the task is
 * as the approval left it.
 */
export async function followPullRequest(ctx: Ctx, task: Task): Promise<PullRequestRecord | null> {
  if (!ghInstalled(ctx)) return null
  await pullRequestOf(ctx, task, true)
  return recordSeen(ctx, task)
}

/**
 * What every read of the pull request does once it kept the record, whoever made the read (the poll,
 * the task's page, the agent's `next`, a triage): a merge goes on the task's record once, and when
 * something began to wait is kept. Both are safe to repeat.
 */
export async function recordSeen(ctx: Ctx, task: Task): Promise<PullRequestRecord | null> {
  const record = await readPullRequestRecord(ctx, task)
  if (record?.state === "merged") await recordMerged(ctx, task, record)
  if (record !== null) await noteAsking(ctx, task, record)
  return record
}

async function checkPushTarget(
  ctx: Ctx,
  task: Task,
): Promise<Result<{ record: PullRequestRecord; branch: string }>> {
  const record = await readPullRequestRecord(ctx, task)
  if (record === null) return err(bad("This task has no pull request to push a fix to."))
  if (record.state !== "open")
    return err(bad(`The pull request is ${record.state}; nothing to push to.`))
  const branch = await currentBranch(ctx, task.repoRoot)
  const wrong = wrongBranch(task, branch)
  if (wrong !== null) return err(bad(`${wrong}. Check ${task.branch} out first.`))
  if (branch === null) return err(bad("The checkout is on no branch; check one out first."))
  return ok({ record, branch })
}

/**
 * Push the task's branch to its remote on the person's click, after a fix: the commits made since
 * the pull request was last pushed. The checkout must be on the task's branch, and the pull request
 * must still be open. The pull request is read again afterwards, so its checks start showing.
 */
export async function pushFix(
  ctx: Ctx,
  task: Task,
): Promise<Result<{ branch: string; pr: PullRequestRecord | null }>> {
  const target = await checkPushTarget(ctx, task)
  if (!target.ok) return target
  const { record, branch } = target.data
  const unpushed = await unpushedTimes(ctx, task, record.head)
  if (unpushed !== null && unpushed.length === 0)
    return err(bad(`Nothing to push: ${branch} has no commit that its remote branch lacks.`))
  const pushed = await ctx.git.run(task.repoRoot, ["push", "origin", "HEAD"])
  if (pushed.code !== 0)
    return err(bad(`git push failed: ${pushed.stderr.trim() || pushed.stdout.trim()}`))
  await appendEvent(ctx, task, { event: "fix_pushed", branch, url: record.url })
  return ok({ branch, pr: await followPullRequest(ctx, task) })
}
