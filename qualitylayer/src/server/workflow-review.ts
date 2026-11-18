import type { DiffAnchor } from "../core/gate/comments.ts"
import { TaskReviewHistoryError } from "../core/git/task-diff.ts"
import {
  ownedPartOf,
  type WorkflowProjection,
  workflowChanges,
} from "../core/git/workflow-changes.ts"
import { committedSource } from "../core/git/workflow-parts.ts"
import { workingSource } from "../core/git/working-records.ts"
import type { ReviewFileSource, SourceRequest } from "../core/review/file-source.ts"
import type { Task } from "../core/task/store.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"

const unavailable = () =>
  err({ code: "bad_args", message: "This workflow’s changes could not be read. Try again." })

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

/** Historical source is authorized by its workflow record, never by an arbitrary object hash. */
export async function workflowReviewSource(
  ctx: Ctx,
  task: Task,
  request: SourceRequest,
): Promise<Result<ReviewFileSource>> {
  const read = await workflowProjection(ctx, task, { metadata: true, browse: true })
  if (!read.ok) return read
  const part = ownedPartOf(read.data, request.path, request.stamp)
  if (!part)
    return err({
      code: "bad_args",
      message: "This file version is not available in this workflow. Refresh the change.",
    })
  const source = request.side === "old" ? part.before : part.after
  if (!source)
    return err({
      code: "bad_args",
      message: "This side of the file does not exist. Read its diff instead.",
    })
  try {
    const content =
      source.kind === "git"
        ? await committedSource(ctx, task, source)
        : await workingSource(ctx, source.hash)
    const current = await workflowProjection(ctx, task, { metadata: true, browse: true })
    if (!current.ok) return current
    if (!ownedPartOf(current.data, request.path, request.stamp))
      return err({
        code: "bad_args",
        message: "This file version changed while it was read. Refresh the change.",
      })
    return ok({ ...request, content })
  } catch {
    return err({
      code: "bad_args",
      message: "This source is unavailable or exceeds the file reading limit.",
    })
  }
}
