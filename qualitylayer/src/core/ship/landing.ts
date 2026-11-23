// After the person approves, the task is "landing" until its change reached the base branch, and
// "landed" after. `landing.json` in the task's runtime folder keeps what the approval covered (the
// head it approved, the branch and base), the person's later approvals of changes made after it, and
// how the task landed, recorded once. Landing is read from git alone (no `gh`, no network): the
// base holds the approved head, or a merge of the branch changes nothing (squash, rebase and
// cherry-pick merges), or the pull request record says merged, or the person says so.

import { randomUUID } from "node:crypto"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { branchState } from "../git/branch.ts"
import { headSha } from "../git/repo.ts"
import { commitOf, type LandingCommit } from "./landing-git.ts"
import {
  approvalOf,
  type LandingRecord,
  landingPath,
  landingScope,
  markUnknown,
  noteOwnCommit,
  readRecord,
  recordUnreadable,
  unknownPath,
  updateRecord,
} from "./landing-record.ts"
import {
  branchTip,
  detect,
  type LandingState,
  legacyState,
  type Scope,
  type Shipped,
  settle,
  stateOf,
  withoutRecord,
} from "./landing-state.ts"

export type { LandingCommit, LandingState }
export { landingPath, noteOwnCommit }

/**
 * The closing record calls this after saving the final decision: current HEAD is what the approval
 * covers. Workflow documents stay on disk. A task reopened and shipped again keeps its earlier
 * approvals and starts landing again.
 */
export async function recordApproval(ctx: Ctx, task: Scope, branch: string | null): Promise<void> {
  const cycle = randomUUID()
  try {
    const head = await headSha(ctx, task.repoRoot)
    if (head === null) throw new Error("The approved head could not be read")
    const base = (await branchState(ctx, task)).base
    await updateRecord(ctx, task, async (previous) => {
      await ctx.fs.remove(unknownPath(task)).catch(() => undefined)
      return {
        cycle,
        approvedHead: head,
        base,
        branch,
        approvals: previous?.approvals ?? [],
        landed: null,
      }
    })
  } catch (cause) {
    await markUnknown(ctx, task, cycle).catch(() => undefined)
    throw cause
  }
}

/**
 * What the App shows of a shipped task: its record as it stands, no detection. A landed or older task
 * costs one small file read; a landing one adds the branch tip and the commits since the approval.
 */
export async function landingView(ctx: Ctx, task: Shipped): Promise<LandingState | null> {
  if (task.stage !== "shipped") return null
  const record = await readRecord(ctx, task)
  if (record === null) return withoutRecord(ctx, task)
  if (record.landed !== null) return stateOf(ctx, task, record, null)
  return stateOf(ctx, task, record, await branchTip(ctx, task, record))
}

/**
 * The landing poll's read: like `landingView`, after asking whether the work has landed. The first
 * rule that holds is written down and stays. Null for a task that is not shipped.
 */
export async function landingState(ctx: Ctx, task: Shipped): Promise<LandingState | null> {
  if (task.stage !== "shipped") return null
  const record = await readRecord(ctx, task)
  if (record === null) return withoutRecord(ctx, task)
  const tip = await branchTip(ctx, task, record)
  const current = record.landed === null ? await settle(ctx, task, record, tip) : record
  return stateOf(ctx, task, current, tip)
}

/**
 * The record with the person's word in it. A record that could not be read (`head` is the head now)
 * is replaced by one holding just that word; a landed one stays as it is (null: nothing to write).
 */
function personSaid(
  fresh: LandingRecord | null,
  head: string | null,
  branch: string | null,
  at: number,
): LandingRecord | null {
  const landed = { how: "person" as const, at }
  if (fresh === null && head !== null)
    return { approvedHead: head, base: null, branch, approvals: [], landed }
  return fresh !== null && fresh.landed === null ? { ...fresh, landed } : null
}

const refuse = (message: string) => err({ code: "bad_args" as const, message })

async function nextMergedRecord(
  ctx: Ctx,
  task: Shipped,
  fresh: LandingRecord | null,
  expected: string,
  head: string | null,
): Promise<{ next: LandingRecord | null; stale: boolean }> {
  const scope = await landingScope(ctx, task, fresh)
  if (scope !== expected) {
    const repeated =
      fresh?.landed?.how === "person" &&
      fresh.markedFrom?.from === expected &&
      fresh.markedFrom.to === scope
    return { next: null, stale: !repeated }
  }
  const next = personSaid(fresh, head, task.branch ?? null, ctx.clock.now())
  if (next) {
    await ctx.fs.remove(unknownPath(task)).catch(() => undefined)
    next.markedFrom = { from: expected, to: await landingScope(ctx, task, next) }
  }
  return { next, stale: false }
}

/** The person says it landed (Mark as merged): for a merge git cannot see. Landed stays landed. */
export async function markMerged(
  ctx: Ctx,
  task: Shipped,
  observed?: string,
): Promise<Result<LandingState>> {
  if (task.stage !== "shipped") return refuse("Only a shipped task can be marked as merged.")
  const before = await readRecord(ctx, task)
  const expected = observed ?? (await landingScope(ctx, task, before))
  const unreadable = before === null
  if (unreadable && !(await recordUnreadable(ctx, task))) return ok(legacyState(task))
  // A record that could not be read is replaced by the person's word, kept with the head now.
  const head = unreadable ? ((await headSha(ctx, task.repoRoot)) ?? "unknown") : null
  let stale = false
  const record = await updateRecord(ctx, task, async (fresh) => {
    const step = await nextMergedRecord(ctx, task, fresh, expected, head)
    stale = step.stale
    return step.next
  })
  if (stale) return refuse("The approval changed. Refresh Review before marking it as merged.")
  const state =
    record === null
      ? legacyState(task)
      : await stateOf(ctx, task, record, await branchTip(ctx, task, record))
  return ok(state)
}

function isRepeatedApproval(
  record: LandingRecord | null,
  full: string,
  expected: string,
  scope: string,
): boolean {
  return (
    record?.approvedHead === full &&
    record.approvals.some(
      (entry) => entry.sha === full && entry.scope?.from === expected && entry.scope.to === scope,
    )
  )
}

async function nextApprovedRecord(
  ctx: Ctx,
  task: Shipped,
  fresh: LandingRecord | null,
  full: string,
  expected: string,
): Promise<{ next: LandingRecord | null; tip: string | null; why: string | null }> {
  const scope = await landingScope(ctx, task, fresh)
  if (scope !== expected) {
    const why = isRepeatedApproval(fresh, full, expected, scope)
      ? null
      : "The approval changed. Refresh Review before approving this change."
    return { next: null, tip: null, why }
  }
  const tip = fresh === null ? null : await branchTip(ctx, task, fresh)
  if (fresh !== null && fresh.landed === null && (await detect(ctx, task, fresh, tip)).how !== null)
    return {
      next: null,
      tip,
      why: "This change has landed. Further changes go in a follow-up task.",
    }
  const to =
    fresh === null ? scope : await landingScope(ctx, task, { ...fresh, approvedHead: full })
  const step = approvalOf(fresh, full, tip, ctx.clock.now(), { from: expected, to })
  return { next: step.next, tip, why: step.why }
}

/**
 * The person approves a change made after the approval: `sha` must be the branch's current head and
 * build on the approved head. It never reopens the workflow. Approving what is approved already does
 * nothing; once the task has landed, further changes belong to a follow-up task.
 */
export async function approveChange(
  ctx: Ctx,
  task: Shipped,
  sha: string,
  observed?: string,
): Promise<Result<LandingState>> {
  const record = task.stage === "shipped" ? await readRecord(ctx, task) : null
  if (record === null)
    return refuse(
      task.stage === "shipped"
        ? "This change has landed. Further changes go in a follow-up task."
        : "Only a shipped task has changes after its approval to approve.",
    )
  const full = /^[0-9a-f]{4,64}$/i.test(sha) ? await commitOf(ctx, task.repoRoot, sha) : null
  if (full === null) return refuse(`${sha.slice(0, 40)} is not a commit in this repository.`)
  const viewed = await landingScope(ctx, task, record)
  const expected = observed ?? viewed
  if (viewed !== expected && !isRepeatedApproval(record, full, expected, viewed))
    return refuse("The approval changed. Refresh Review before approving this change.")
  let tip: string | null = null
  let why: string | null = null
  const kept = await updateRecord(ctx, task, async (fresh) => {
    const step = await nextApprovedRecord(ctx, task, fresh, full, expected)
    tip = step.tip
    why = step.why
    return step.next
  })
  return why !== null ? refuse(why) : ok(await stateOf(ctx, task, kept ?? record, tip))
}
