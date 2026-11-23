// A pull request on GitHub for approval (Max, 11 Nov 2026: GitHub only, the person creates it in GitHub's
// own UI). `gate open plan --via github` puts the people's Plan (01-plan.md and its assets as readers see
// them, never the agents' file) on a branch `ql/plan/<slug>` built from the base without touching the
// person's working tree and pushes it; `gate open final --via github` pushes the task's own branch. Each
// send answers with GitHub's compare page, prefilled with a title and a short description ending in
// QualityLayer's marker line: the person creates the pull request there. QualityLayer then finds it by
// its branch; `wait --for approval` reads it: an approving review on the pushed commit, by someone other
// than the sender who can write to the repository, settles the gate as that named approver; every comment
// comes back as feedback, to the planner on the Plan and to the fixing agents on the change. A Plan
// approved in QualityLayer instead closes its request with a note and deletes its branch. Everything runs
// with the person's own git and gh login; nothing goes through a QualityLayer service.

import { join, relative } from "node:path"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import { NAMES } from "../docs/names.ts"
import { gateRevision } from "../gate/revision.ts"
import { currentBranch } from "../git/repo.ts"
import { refused } from "../next/refusal.ts"
import { ensureDraftDescription } from "../ship/closing-record.ts"
import { pullRequestBody } from "../ship/pr-body.ts"
import type { Task } from "../task/store.ts"
import {
  compareUrl,
  finalBranchProblem,
  fitBody,
  preflight,
  requestFor,
  senderOf,
  standing,
} from "./approval-git.ts"
import { planCommit } from "./approval-plan-commit.ts"
import {
  exec,
  failed,
  GH,
  git,
  MAX_LINK,
  readSent,
  type Sent,
  writeSent,
} from "./approval-store.ts"

export {
  compareUrl,
  finalBranchProblem,
  fitBody,
  hostProblem,
  originHost,
  originUrl,
  requestFor,
} from "./approval-git.ts"
export { outsidePoller } from "./approval-poll.ts"
export {
  linkOf,
  readSent,
  SEND_REFUSAL,
  type Sent,
  type Target,
  type Via,
  viaOf,
  viaUsage,
} from "./approval-store.ts"

async function pushPlanRevision(
  ctx: Ctx,
  task: Task,
  spec: { base: string; branch: string; live: Sent | null; revision: string },
): Promise<Result<{ commit: string; lines: number[] }>> {
  const { base, branch, live, revision } = spec
  const root = task.repoRoot
  const fetched = await git(ctx, root, ["fetch", "--quiet", "origin", `refs/heads/${base}`])
  if (fetched.code !== 0)
    return failed(`origin's ${base} could not be read`, fetched, [
      { what: `${base} on origin`, move: `git push origin ${base}` },
    ])
  const baseCommit = (await git(ctx, root, ["rev-parse", "FETCH_HEAD"])).stdout.trim()
  // A Plan sent before gets the new revision on top of what its branch shows.
  const kept =
    live !== null
      ? await git(ctx, root, ["fetch", "--quiet", "origin", `refs/heads/${branch}`])
      : null
  const parent =
    kept !== null && kept.code === 0
      ? (await git(ctx, root, ["rev-parse", "FETCH_HEAD"])).stdout.trim()
      : baseCommit
  const commit = await planCommit(ctx, task, parent, revision)
  if (!commit.ok) return commit
  // The branch is QualityLayer's own: after a closed request it starts again from the base.
  const pushed = await git(ctx, root, [
    "push",
    "--quiet",
    "--force",
    "origin",
    `${commit.data.commit}:refs/heads/${branch}`,
  ])
  if (pushed.code !== 0)
    return failed(`The Plan's branch could not be pushed to origin`, pushed, [
      { what: "push access to origin", move: `${GH.login}, or check the remote` },
    ])
  return commit
}

/**
 * Send the Plan for approval: commit it on `ql/plan/<slug>`, push, and answer with GitHub's compare page
 * for it. Sending a changed Plan again pushes the new revision; an open request follows by itself.
 */
export async function sendPlan(ctx: Ctx, task: Task): Promise<Result<Sent>> {
  const root = task.repoRoot
  const ready = await preflight(ctx, root, "plan")
  if (!ready.ok) return ready
  const { sender, base, repo } = ready.data
  const branch = `ql/plan/${task.slug}`
  const previous = await readSent(ctx, task, "plan")
  const live = await standing(ctx, task, "plan")
  const revision = await gateRevision(ctx, task, NAMES.plan)
  if (live !== null && live.revision === revision) return ok(live)
  const commit = await pushPlanRevision(ctx, task, { base, branch, live, revision })
  if (!commit.ok) return commit
  const file = relative(root, join(task.dir, NAMES.plan)).split("\\").join("/")
  const body =
    `The Plan for **${task.title}**: \`${file}\` in this pull request. Approve to approve it; comments go to the planner.\n\n` +
    `QualityLayer-Plan-Revision: ${revision}`
  const sent: Sent = {
    version: 1,
    via: "github",
    compare: compareUrl(repo, base, branch, `Plan: ${task.title}`, body),
    ...(live?.url !== undefined && live.number !== undefined
      ? { url: live.url, number: live.number }
      : {}),
    branch,
    base,
    head: commit.data.commit,
    revision,
    planLines: commit.data.lines,
    sender,
    at: ctx.clock.now(),
    seen: previous?.seen ?? [],
  }
  await writeSent(ctx, task, sent)
  return ok(sent)
}

/** The change's description: the Verify page while it fits in a link, then how an approval counts. */
async function finalBody(ctx: Ctx, task: Task, head: string, room: number): Promise<string> {
  const page = pullRequestBody(await ensureDraftDescription(ctx, task)).trim()
  return fitBody(
    page,
    `---\n\nQualityLayer: approve to approve this commit; comments go to the agents.\n\nQualityLayer-Commit: ${head}`,
    room,
  )
}

/**
 * Send the change for its final review: push the task's own branch as it is now and answer with GitHub's
 * compare page for it, the Verify page as its description. A change on the base branch has none.
 */
export async function sendFinal(ctx: Ctx, task: Task): Promise<Result<Sent>> {
  const root = task.repoRoot
  const ready = await preflight(ctx, root, "final")
  if (!ready.ok) return ready
  const { sender, base, repo } = ready.data
  const inApp = {
    what: "the person's approval in the App",
    move: "qualitylayer wait --for approval",
  }
  const problem = await finalBranchProblem(ctx, task)
  const branch = await currentBranch(ctx, root)
  if (problem !== null || branch === null)
    return refused(
      `${problem ?? "The checkout is on no branch"}: the person approves it in the App.`,
      [
        ...(task.branch !== undefined && task.branch !== branch
          ? [{ what: "the task's branch", move: `git switch ${task.branch}` }]
          : []),
        inApp,
      ],
    )
  const head = (await git(ctx, root, ["rev-parse", "HEAD"])).stdout.trim()
  const previous = await readSent(ctx, task, "final")
  const live = await standing(ctx, task, "final")
  if (live !== null && live.head === head) return ok(live)
  const pushed = await git(ctx, root, ["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`])
  if (pushed.code !== 0)
    return failed(`${branch} could not be pushed to origin`, pushed, [
      { what: "push access to origin", move: `${GH.login}, or check the remote` },
      inApp,
    ])
  const link = compareUrl(repo, base, branch, task.title, "")
  const body = await finalBody(ctx, task, head, MAX_LINK - link.length)
  const sent: Sent = {
    version: 1,
    target: "final",
    via: "github",
    compare: compareUrl(repo, base, branch, task.title, body),
    ...(live?.url !== undefined && live.number !== undefined
      ? { url: live.url, number: live.number }
      : {}),
    branch,
    base,
    head,
    revision: head,
    sender,
    at: ctx.clock.now(),
    seen: previous?.seen ?? [],
  }
  await writeSent(ctx, task, sent)
  return ok(sent)
}

/**
 * After the Plan is approved in QualityLayer (the App, the person's terminal or their words), its pull
 * request is done: a note says so, the request closes and its branch goes. A branch pushed but never
 * opened as a request just goes. Only what QualityLayer pushed itself; best effort, never in the way.
 */
export async function closeAfterApproval(ctx: Ctx, task: Task): Promise<void> {
  const before = await readSent(ctx, task, "plan")
  if (before === null || before.closed === true) return
  const sent = (await requestFor(ctx, task, before)) ?? before
  const root = task.repoRoot
  if (sent.url !== undefined) {
    const login = (await senderOf(ctx, root)) ?? sent.sender
    const closed = await exec(ctx, root, [
      "gh",
      "pr",
      "close",
      sent.url,
      "--comment",
      `Approved in QualityLayer by @${login}.`,
    ])
    if (closed === null || closed.code !== 0) return
  }
  // The branch held only the Plan: it goes with the request.
  await git(ctx, root, ["push", "--quiet", "origin", "--delete", sent.branch])
  await writeSent(ctx, task, { ...sent, closed: true })
}
