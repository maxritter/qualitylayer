import type { DiffAnchor } from "../core/gate/comments.ts"
import { TaskReviewHistoryError } from "../core/git/task-diff.ts"
import { type VerifyRange, verifyRange } from "../core/git/verify-range.ts"
import {
  ownedPartOf,
  type WorkflowProjection,
  workflowChanges,
} from "../core/git/workflow-changes.ts"
import { committedSource } from "../core/git/workflow-parts.ts"
import { workingSource } from "../core/git/working-records.ts"
import type { ReviewFileSource, SourceRequest } from "../core/review/file-source.ts"
import { selectedReviewCandidate } from "../core/review-candidate.ts"
import type { Task } from "../core/task/store.ts"
import { type Assignment, readAssignment } from "../core/verification.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"

const unavailable = () =>
  err({ code: "bad_args", message: "This workflow’s changes could not be read. Try again." })

export async function checkedReviewRange(ctx: Ctx, task: Task, saved?: Assignment | null) {
  if (task.stage !== "verify") return null
  const assignment = saved === undefined ? await readAssignment(ctx, task) : saved
  if (assignment?.source !== null || !assignment.note) return null
  let scoped = task
  if (assignment.recovery) {
    const selected = await selectedReviewCandidate(ctx, task).catch(() => null)
    if (selected?.id !== assignment.recovery || selected.choice.head !== assignment.head)
      return null
    scoped = { ...task, repoRoot: selected.choice.checkout }
  }
  const range = await verifyRange(ctx, scoped, assignment.head, assignment.recovery !== undefined)
  return range ? { task: scoped, range } : null
}

export async function workflowProjection(
  ctx: Ctx,
  task: Task,
  options: Parameters<typeof workflowChanges>[2] = {},
): Promise<Result<WorkflowProjection>> {
  try {
    return ok(await workflowChanges(ctx, task, options))
  } catch (cause) {
    if (cause instanceof TaskReviewHistoryError)
      return err({ code: "bad_args", message: cause.message })
    return unavailable()
  }
}

export function ownsWorkflowAnchor(projection: WorkflowProjection, anchor: DiffAnchor): boolean {
  if (!anchor.stamp) return false
  const part = ownedPartOf(projection, anchor.file, anchor.stamp)
  return part !== null && (anchor.side === "old" ? part.before : part.after) !== null
}

async function readVerifiedSource(
  ctx: Ctx,
  task: Task,
  request: SourceRequest,
  options: Parameters<typeof workflowChanges>[2],
  source: NonNullable<ReturnType<typeof ownedPartOf>>["before" | "after"],
): Promise<Result<ReviewFileSource>> {
  if (!source) {
    return err({
      code: "bad_args",
      message: "This side of the file does not exist. Read its diff instead.",
    })
  }
  try {
    const content =
      source.kind === "git"
        ? await committedSource(ctx, task, source)
        : await workingSource(ctx, source.hash)
    const current = await workflowProjection(ctx, task, options)
    if (!current.ok) return current
    if (!ownedPartOf(current.data, request.path, request.stamp)) {
      return err({
        code: "bad_args",
        message: "This file version changed while it was read. Refresh the change.",
      })
    }
    return ok({ ...request, content })
  } catch {
    return err({
      code: "bad_args",
      message: "This source is unavailable or exceeds the file reading limit.",
    })
  }
}

/** Historical source is authorized by its workflow record, never by an arbitrary object hash. */
export async function workflowReviewSource(
  ctx: Ctx,
  task: Task,
  request: SourceRequest,
  range?: VerifyRange,
): Promise<Result<ReviewFileSource>> {
  const options = { metadata: true, browse: true, ...(range ? { range } : {}) }
  const read = await workflowProjection(ctx, task, options)
  if (!read.ok) return read
  const part = ownedPartOf(read.data, request.path, request.stamp)
  if (!part)
    return err({
      code: "bad_args",
      message: "This file version is not available in this workflow. Refresh the change.",
    })
  const source = request.side === "old" ? part.before : part.after
  return readVerifiedSource(ctx, task, request, options, source)
}
