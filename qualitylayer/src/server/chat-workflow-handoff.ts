import { join } from "node:path"
import { promoteChat } from "../core/chat/promote.ts"
import { taskLaunchPrompt } from "../core/run/launch-spec.ts"
import { runDir } from "../core/run/registry.ts"
import { sendToRun } from "../core/run/send-message.ts"
import { isArchived } from "../core/task/archive.ts"
import type { Task } from "../core/task/store.ts"
import type { Ctx } from "../ctx.ts"
import { locate } from "./api.ts"
import {
  assertRetryablePromotion,
  type HandoffAuthority,
  type HandoffRequest,
  matchingReceiptStatus,
  recordFailureReceipt,
  recordHandoffStatus,
  requireControlledRun,
} from "./chat-workflow-handoff-helpers.ts"

export type WorkflowController = {
  run: string
  generation: number
  nativeSession: string
  proof: string
}
type Send = typeof sendToRun

type HandoffChatWorkflowArgs = [
  ctx: Ctx,
  id: string,
  type: "feature" | "bugfix",
  expected: WorkflowController,
  retry: boolean,
  authority: HandoffAuthority,
  send?: Send,
  /** Start the Plan from the Chat's saved plan (kept as the original). */
  fromSavedPlan?: boolean,
]

async function promoteIfChat(req: HandoffRequest, task: Task): Promise<Task> {
  if (task.type !== "chat") return task
  const promoted = await promoteChat(req.ctx, task, req.type, {
    beforeAdvance: () => {
      requireControlledRun(req)
    },
    fromSavedPlan: req.fromSavedPlan,
  })
  if (!promoted.ok) throw new Error(promoted.error.message)
  return promoted.data.task
}

async function deliverPlanPrompt(req: HandoffRequest, task: Task, send: Send, step: "plan") {
  let wrote = false
  try {
    if (!(await req.authority.capable()) || (await isArchived(req.ctx, task))) {
      throw new Error("Control changed before the Plan request was sent. Take control and retry.")
    }
    // A crash or lost acknowledgement after this point must never trigger an automatic duplicate.
    const run = recordHandoffStatus(req, "uncertain")
    const prompt = taskLaunchPrompt(run.agent, req.id, step, run.settings?.answers)
    await send(req.ctx, run, prompt, {
      strictFlush: true,
      beforeSend: () => {
        requireControlledRun(req)
      },
      onWrite: () => {
        wrote = true
      },
    })
    recordHandoffStatus(req, "sent")
    return { task, handoff: "sent" as const }
  } catch (cause) {
    return { task, handoff: recordFailureReceipt(req, wrote, cause) }
  }
}

async function executeLockedHandoff(req: HandoffRequest, send: Send) {
  const step = "plan" as const
  const run = requireControlledRun(req)
  const found = await locate(req.ctx, req.id)
  if (!found.ok) throw new Error(found.error.message)
  let task = found.data.task
  if (await isArchived(req.ctx, task)) throw new Error("Restore this task before starting the Plan")
  const receiptStatus = matchingReceiptStatus(run, req)
  if (receiptStatus === "sent") return { task, handoff: "already_sent" as const }
  if (receiptStatus === "uncertain") {
    throw new Error(
      "The Plan request may already have been sent. Inspect the same agent's Terminal before sending anything again.",
    )
  }
  if (task.type !== "chat") await assertRetryablePromotion(req, task, step)
  recordHandoffStatus(req, "pending")
  task = await promoteIfChat(req, task)
  requireControlledRun(req)
  return deliverPlanPrompt(req, task, send, step)
}

/** One user-requested handoff, bound to the existing native window; no session or task is created. */
export async function handoffChatWorkflow(...args: HandoffChatWorkflowArgs) {
  const [ctx, id, type, expected, retry, authority, send = sendToRun, fromSavedPlan = false] = args
  const req: HandoffRequest = { ctx, id, type, expected, retry, authority, fromSavedPlan }
  if (!(await authority.capable()))
    throw new Error("Take control of the current agent window before starting the Plan")
  requireControlledRun(req)
  return ctx.fs.withLock(join(runDir(ctx.home, expected.run), "workflow-handoff.lock"), () =>
    executeLockedHandoff(req, send),
  )
}
