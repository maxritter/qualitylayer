import type { Ctx } from "../../ctx.ts"
import type { BatchContinuation } from "../../interaction/contracts.ts"
import { nativeRun, readConversation } from "../conversation/service.ts"
import { readGate } from "../gate/gate.ts"
import { keyOf } from "../task/binding.ts"
import { withCompletedBatch } from "../task/question-batch.ts"
import type { Task } from "../task/store.ts"
import { hasActiveWait } from "../wait.ts"
import { acceptedStopEvent } from "./bind.ts"
import { readHost, readRun } from "./registry.ts"
import { inputBoundaryMatches, sendToRun } from "./send-message.ts"

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
    if (
      !run ||
      run.generation !== owner.generation ||
      run.nativeSession !== owner.nativeSession ||
      run.taskRuntimeDir !== task.runtimeDir ||
      run.task !== owner.task ||
      !nativeRun(run)
    )
      return
    const record: BatchContinuation = { ...owner, revision, at: ctx.clock.now(), state: "paused" }
    if (
      run.intent?.state === "paused" ||
      (run.recovery?.generation === run.generation && run.recovery.state === "cancelled")
    ) {
      await save(record)
      return
    }
    if (run.status !== "running") return
    const stop = acceptedStopEvent(run)
    if (stop === undefined) return
    const sequence = stop.sequence
    const boundary = {
      generation: run.generation,
      nativeSession: owner.nativeSession,
      sequence,
      task: owner.task,
    }
    if (!inputBoundaryMatches(run, boundary)) return
    if (await hasActiveWait(ctx, task, keyOf(owner.nativeSession))) return
    const gate = await readGate(ctx, task)
    if (gate?.decision === "approved") return
    const conversation = readConversation(ctx, run)
    if (
      conversation.source === "none" ||
      conversation.state !== "idle" ||
      conversation.hasMore ||
      conversation.question ||
      conversation.approvals?.length ||
      conversation.workersIncomplete ||
      conversation.workers?.length
    )
      return
    const inputAt = readHost(ctx.home, run.id)?.lastInputAt ?? 0
    if (inputAt > Date.parse(stop.at)) return
    await save({ ...record, state: "attempted" })
    try {
      await sendToRun(
        ctx,
        run,
        `The answers to question batch ${batch.id} are saved. Read them with qualitylayer question poll --batch ${batch.id} --json and continue this Plan. This is no approval to build or ship.`,
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
      await save({ ...record, state: "sent" })
    } catch {
      await save({ ...record, state: "uncertain" })
    }
  })
}
