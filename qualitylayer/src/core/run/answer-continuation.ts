import type { Ctx } from "../../ctx.ts"
import type { BatchContinuation, QuestionBatch } from "../../interaction/contracts.ts"
import { nativeRun, readConversation } from "../conversation/service.ts"
import { readGate } from "../gate/gate.ts"
import { keyOf } from "../task/binding.ts"
import { withCompletedBatch } from "../task/question-batch.ts"
import type { Task } from "../task/store.ts"
import { hasActiveWait } from "../wait.ts"
import { acceptedStopEvent } from "./bind.ts"
import type { RunRecord } from "./contracts.ts"
import type { InputBoundary } from "./protocol.ts"
import { readHost, readRun } from "./registry.ts"
import { inputBoundaryMatches, sendToRun } from "./send-message.ts"

type PlannerOwner = NonNullable<QuestionBatch["planner"]>

type NativeRunRecord = RunRecord & {
  agent: Parameters<typeof readConversation>[1]["agent"]
}

function matchesPlannerOwner(
  run: RunRecord | null | undefined,
  owner: PlannerOwner,
  task: Task,
): run is NativeRunRecord {
  if (!run || !nativeRun(run)) return false
  const sameRun = run.generation === owner.generation && run.nativeSession === owner.nativeSession
  return sameRun && run.taskRuntimeDir === task.runtimeDir && run.task === owner.task
}

function isRunPausedOrCancelled(run: RunRecord): boolean {
  const cancelled =
    run.recovery?.generation === run.generation && run.recovery.state === "cancelled"
  return run.intent?.state === "paused" || cancelled
}

function isConversationIdleForContinuation(ctx: Ctx, run: NativeRunRecord): boolean {
  const conversation = readConversation(ctx, run)
  const idle =
    conversation.source !== "none" && conversation.state === "idle" && !conversation.hasMore
  const noPendingWork =
    !conversation.question &&
    !conversation.approvals?.length &&
    !conversation.workersIncomplete &&
    !conversation.workers?.length
  return idle && noPendingWork
}

async function resolveReadyBoundary(
  ctx: Ctx,
  task: Task,
  run: NativeRunRecord,
  owner: PlannerOwner,
): Promise<InputBoundary | null> {
  const stop = run.status === "running" ? acceptedStopEvent(run) : undefined
  if (stop === undefined) return null
  const boundary: InputBoundary = {
    generation: run.generation,
    nativeSession: owner.nativeSession,
    sequence: stop.sequence,
    task: owner.task,
  }
  const inputAt = readHost(ctx.home, run.id)?.lastInputAt ?? 0
  if (!inputBoundaryMatches(run, boundary) || inputAt > Date.parse(stop.at)) return null
  if (
    (await hasActiveWait(ctx, task, keyOf(owner.nativeSession))) ||
    (await readGate(ctx, task))?.decision === "approved"
  )
    return null
  return isConversationIdleForContinuation(ctx, run) ? boundary : null
}

async function deliverContinuation(
  ctx: Ctx,
  task: Task,
  run: RunRecord,
  batchId: string,
  boundary: InputBoundary,
): Promise<"sent" | "uncertain"> {
  try {
    await sendToRun(
      ctx,
      run,
      `The answers to question batch ${batchId} are saved. Read them with qualitylayer question poll --batch ${batchId} --json and continue this Plan. This is no approval to build or ship.`,
      {
        boundary,
        strictFlush: true,
        beforeSend: async () => {
          const currentGate = await readGate(ctx, task)
          const current = readRun(ctx.home, run.id)
          if (
            currentGate?.decision === "approved" ||
            !current ||
            !inputBoundaryMatches(current, boundary)
          )
            throw new Error("The planner changed before its answers could be sent")
        },
      },
    )
    return "sent"
  } catch {
    return "uncertain"
  }
}

/** Completing an App batch authorizes one input to its original idle planning conversation. */
export async function continueAnsweredBatch(
  ctx: Ctx,
  task: Task,
  questionId: string,
): Promise<void> {
  await withCompletedBatch(ctx, task, questionId, async (batch, revision, save) => {
    const owner = batch.planner
    if (!owner || owner.task !== `${task.repoId}~${task.slug}`) return
    const run = readRun(ctx.home, owner.run)
    if (!matchesPlannerOwner(run, owner, task)) return
    const record: BatchContinuation = { ...owner, revision, at: ctx.clock.now(), state: "paused" }
    if (isRunPausedOrCancelled(run)) {
      await save(record)
      return
    }
    const boundary = await resolveReadyBoundary(ctx, task, run, owner)
    if (!boundary) return
    await save({ ...record, state: "attempted" })
    const state = await deliverContinuation(ctx, task, run, batch.id, boundary)
    await save({ ...record, state })
  })
}
