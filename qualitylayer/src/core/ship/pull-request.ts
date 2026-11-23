// The pull request of a reviewed change: found by `gh` for the branch, opened on the author's
// click. QualityLayer pushes and opens nothing by itself: this module is only called for a click,
// or to look.

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { currentBranch } from "../git/repo.ts"
import type { PullRequestView } from "../review/summary.ts"
import type { Task } from "../task/store.ts"
import { ensureDraftDescription } from "./closing-record.ts"
import { bodyFilePath, pullRequestBody, writeBodyFile } from "./pr-body.ts"
import { recordSeen } from "./pr-life.ts"
// pr-notes posts and pr-threads reads through this module's `run`: they only call each other, never at load.
import { postPullRequestNotes } from "./pr-notes.ts"
import { checkOf, readPullRequestRecord, recordPath, writePullRequestRecord } from "./pr-record.ts"
import { readConversation, remarkRowOf, rowOf } from "./pr-threads.ts"
import { approvedPush, branchHolds, wrongBranch } from "./pull-request-commands.ts"
import {
  beforeTask,
  changesReviewOf,
  FIELDS,
  type GhPull,
  PULL_URL,
  reviewersOf,
  stateOf,
  statsOf,
  viewOf,
  withRunOutput,
} from "./pull-request-gh.ts"
import { ghInstalled, run } from "./pull-request-run.ts"

export {
  branchPushed,
  commandsFor,
  manualCommands,
  pullRequestPossible,
  wrongBranch,
} from "./pull-request-commands.ts"
export { ghInstalled, run } from "./pull-request-run.ts"

/** Looking is cheap for the Cockpit to ask for often, and slow for GitHub to answer. */
const LOOK_EVERY_MS = 30_000

const bad = (message: string) => err({ code: "bad_args" as const, message })

export async function storedUrl(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<string | null> {
  return (await readPullRequestRecord(ctx, task))?.url ?? null
}

async function remember(ctx: Ctx, task: Task, url: string): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(recordPath(task), `${JSON.stringify({ url })}\n`)
  looked.delete(task.dir)
}

/**
 * A read of the pull request is kept with the task: its state, checks and, while it is open, the
 * threads that wait. A read of the threads that fails leaves the ones last known for this pull
 * request. The file is a note for the App; failing to write it never fails the read.
 */
async function keepRecord(ctx: Ctx, task: Task, pull: GhPull, branch: string): Promise<void> {
  try {
    const state = stateOf(pull)
    const earlier = await readPullRequestRecord(ctx, task)
    const same = earlier?.url === pull.url ? earlier : null
    const read =
      state === "open" ? await readConversation(ctx, task, pull.url) : { threads: [], remarks: [] }
    const threads = read !== null ? read.threads.map(rowOf) : (same?.threads ?? [])
    const remarks = read !== null ? read.remarks.map(remarkRowOf) : (same?.remarks ?? [])
    const checks = (pull.statusCheckRollup ?? []).map(checkOf)
    await writePullRequestRecord(ctx, task, {
      url: pull.url,
      number: pull.number,
      state,
      head: pull.headRefOid ?? "",
      base: pull.baseRefName ?? "",
      branch: pull.headRefName ?? branch,
      checks:
        state === "open"
          ? await withRunOutput(ctx, task, pull.url, checks, same?.checks ?? [])
          : checks,
      threads,
      remarks,
      changesRequested: state === "open" && pull.reviewDecision === "CHANGES_REQUESTED",
      ...(state === "open" && changesReviewOf(pull) !== undefined
        ? { changesReview: changesReviewOf(pull) as string }
        : {}),
      ...(state === "open" && (pull.mergeable ?? "").toUpperCase() === "CONFLICTING"
        ? { conflicting: true as const }
        : {}),
      reviewers: reviewersOf(pull),
      stats: statsOf(pull),
      readAt: ctx.clock.now(),
    })
    // Whoever made this read, a merge and the time something began to wait are noted from it.
    await recordSeen(ctx, task)
    // Comments left open at the approval go to the pull request as notes, whoever opened it: the
    // App, or the person with the git commands or on GitHub. Each goes once.
    if (state === "open") await postPullRequestNotes(ctx, task, pull.url)
  } catch {
    // The next read writes it again.
  }
}

const looked = new Map<string, { at: number; pr: PullRequestView | null }>()

/**
 * The task's pull request, from the address kept with it or else the one `gh` finds for the task's
 * own branch (`own`; the checkout's branch plays no part, and a task with no branch of its own and
 * no address follows nothing); null when there is none, or when `gh` is not there to ask.
 * Remembered for a short while.
 */
export async function pullRequestOf(
  ctx: Ctx,
  task: Task,
  fresh = false,
  own: string | undefined = task.branch,
): Promise<PullRequestView | null> {
  const known = looked.get(task.dir)
  if (!fresh && known !== undefined && ctx.clock.now() - known.at < LOOK_EVERY_MS) return known.pr
  const url = await storedUrl(ctx, task)
  if (url === null && own === undefined) {
    looked.set(task.dir, { at: ctx.clock.now(), pr: null })
    return null
  }
  const branch = own ?? (await currentBranch(ctx, task.repoRoot)) ?? "HEAD"
  let pr: PullRequestView | null = null
  const seen = await run(ctx, task.repoRoot, [
    "gh",
    "pr",
    "view",
    ...(url !== null ? [url] : own !== undefined ? [own] : []),
    "--json",
    FIELDS,
  ])
  if (seen !== null && seen.code === 0) {
    try {
      const pull = JSON.parse(seen.stdout) as GhPull
      // One this module opened and remembered is the task's; one found by the branch must come from
      // that branch (a name can also match another repository's) and after the task began.
      if (url === null && (pull.headRefName !== own || beforeTask(pull, task))) pr = null
      else {
        pr = viewOf(pull, branch)
        await keepRecord(ctx, task, pull, branch)
      }
    } catch {
      pr = null
    }
  }
  // Without `gh`, or when it cannot say, the address remembered when it opened the pull request still names it.
  if (pr === null && url !== null) {
    const number = url.match(PULL_URL)?.[1]
    pr = {
      number: number === undefined ? null : Number(number),
      title: task.title,
      url,
      state: "open",
      checks: "checks not read",
      branch,
    }
  }
  looked.set(task.dir, { at: ctx.clock.now(), pr })
  return pr
}

/** The body of a task's pull request as it goes out: the Review document's export. */
async function sevenBody(ctx: Ctx, task: Task): Promise<string> {
  return pullRequestBody(await ensureDraftDescription(ctx, task))
}

/**
 * Push the branch and open its pull request with the drafted description, on the author's click.
 * A branch that already has a pull request shows it instead.
 */
export async function createPullRequest(
  ctx: Ctx,
  task: Task,
  /** The commit the person's approval covers, when it was applied later than it was given. */
  approvedHead?: string,
): Promise<Result<PullRequestView>> {
  const where = await whereToOpen(ctx, task)
  if (!where.ok) return where
  if ("existing" in where.data) return ok(where.data.existing)
  // The body is the records file: the Review document's export, which already holds the links line
  // and the generated sections.
  const body = await sevenBody(ctx, task)
  const opened = await pushAndOpen(ctx, task, body, where.data.branch, approvedHead)
  if (!opened.ok) return opened
  await remember(ctx, task, opened.data)
  const pr = await pullRequestOf(ctx, task)
  return pr === null ? bad("The pull request was opened but could not be read back.") : ok(pr)
}

/**
 * Whether a click can open a pull request here: `gh` is there and the checkout is on the task's own
 * branch (the push sends its HEAD). A branch that already has a pull request gives that one.
 */
async function whereToOpen(
  ctx: Ctx,
  task: Task,
): Promise<Result<{ existing: PullRequestView } | { branch: string }>> {
  if (!ghInstalled(ctx)) return bad("gh is not installed here. Run the two commands shown.")
  looked.delete(task.dir)
  const branch = await currentBranch(ctx, task.repoRoot)
  const wrong = wrongBranch(task, branch)
  if (wrong !== null) return bad(`${wrong}. Check ${task.branch} out first.`)
  // A task with no branch of its own looks for the pull request of the branch this click pushes.
  const existing = await pullRequestOf(ctx, task, false, task.branch ?? branch ?? undefined)
  if (existing !== null) return ok({ existing })
  return branch === null
    ? bad("The checkout is on no branch; check one out first.")
    : ok({ branch })
}

async function verifyApprovedCommit(
  ctx: Ctx,
  task: Task,
  branch: string,
  approved: string,
): Promise<Result<true>> {
  const held = await branchHolds(ctx, task, branch, approved)
  const short = approved.slice(0, 7)
  if (held === false)
    return bad(
      `${branch} no longer holds the commit you approved (${short}): it was amended or rebased after your approval. Nothing was pushed.`,
    )
  if (held === null)
    return bad(
      `git could not tell whether ${branch} still holds the commit you approved (${short}). Nothing was pushed.`,
    )
  return ok(true)
}

/**
 * Push what the person approved and open its pull request with this body: the address `gh` gives.
 * With the approved commit known, that commit goes out by its id, never whatever HEAD is at the
 * push: commits made after the approval stay local, where the task lists them as changes since the
 * approval. A branch that no longer holds the approved commit, or a git that cannot say, opens
 * nothing: HEAD is never pushed in its place, and the person decides. Nothing local is rewritten.
 * Without a recorded approved commit the checkout's HEAD goes out, as it always did.
 */
async function pushAndOpen(
  ctx: Ctx,
  task: Task,
  body: string,
  branch: string,
  approvedHead?: string,
): Promise<Result<string>> {
  const approved = approvedHead === undefined || approvedHead === "" ? null : approvedHead
  if (approved !== null) {
    const verified = await verifyApprovedCommit(ctx, task, branch, approved)
    if (!verified.ok) return verified
  }
  const pushed = await ctx.git.run(
    task.repoRoot,
    approved === null ? ["push", "-u", "origin", "HEAD"] : approvedPush(approved, branch),
  )
  if (pushed.code !== 0)
    return bad(`git push failed: ${pushed.stderr.trim() || pushed.stdout.trim()}`)
  // A commit is no branch to track: the branch follows its remote as `-u` sets it, so the local
  // commits after the approved one read as ahead of it. Never fails the opening.
  if (approved !== null)
    await ctx.git
      .run(task.repoRoot, ["branch", `--set-upstream-to=origin/${branch}`, branch])
      .catch(() => undefined)
  await writeBodyFile(ctx, task, body)
  const made = await run(ctx, task.repoRoot, [
    "gh",
    "pr",
    "create",
    "--title",
    task.title,
    "--body-file",
    bodyFilePath(task),
    // The pull request is of the branch as pushed, whatever the checkout holds beyond it.
    ...(approved !== null ? ["--head", branch] : []),
  ])
  if (made === null || made.code !== 0)
    return bad(`gh could not open the pull request: ${made?.stderr.trim() || "no answer"}`)
  const url = made.stdout.match(/https:\/\/\S+\/pull\/\d+/)?.[0]
  return url === undefined ? bad("gh opened the pull request but did not say where.") : ok(url)
}
