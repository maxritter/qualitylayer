// advance() is the only writer of `stage`. The table itself lives in
// stages.ts, import-free, so the Cockpit renders from the same data.

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { recordCards } from "../gate/baseline.ts"
import { reopenWorkingRecords } from "../git/working-records.ts"
import { originalIntact } from "./adoption.ts"
import { clearTaskBindings } from "./binding.ts"
import { nextStage, type TaskEvent } from "./stages.ts"
import {
  appendEvent,
  EARLIER_LAYOUT_REASON,
  isCurrentLayout,
  isTerminal,
  saveStage,
  type Task,
  type TaskType,
} from "./store.ts"

export {
  STAGE_ORDER,
  type Stage,
  type TaskEvent,
} from "./stages.ts"

/** Advance a task through the transition table; the single writer of `stage`. */
export async function advance(
  ctx: Ctx,
  task: Task,
  event: TaskEvent,
  options: {
    type?: Exclude<TaskType, "chat">
    effect?: (updated: Task) => Promise<Result<unknown>>
  } = {},
): Promise<Result<Task>> {
  if (!isCurrentLayout(task)) return err({ code: "earlier_layout", message: EARLIER_LAYOUT_REASON })
  // A Chat changes kind when it starts the workflow at the Plan, from the talk or its saved plan.
  const choosesType =
    event === "workflow_started" || (event === "plan_adopted" && task.stage === "chat")
  if (
    (choosesType && options.type !== "feature" && options.type !== "bugfix") ||
    (!choosesType && options.type !== undefined)
  )
    return err({
      code: "bad_args",
      message: "Only a Chat starting the workflow may choose a Feature or Bugfix type",
    })
  const to = nextStage(task, event)
  if (to === null) {
    return err({
      code: "illegal_transition",
      message: `event "${event}" is not legal at stage "${task.stage}"`,
      from: task.stage,
      event,
    })
  }
  // Entering the Plan from a plan the person handed over needs that original, intact, and its record.
  if (
    event === "plan_adopted" &&
    !(task.origin === "existing-plan" && (await originalIntact(ctx, task)))
  )
    return err({
      code: "bad_args",
      message:
        "Only a task started from an existing plan, with its original and record intact, enters the Plan this way.",
    })
  const updated = await saveStage(ctx, task, to, options.type)
  if (options.effect) {
    try {
      const applied = await options.effect(updated)
      if (!applied.ok) {
        await saveStage(
          ctx,
          updated,
          task.stage,
          options.type === undefined ? undefined : task.type,
        )
        return applied
      }
    } catch (cause) {
      await saveStage(ctx, updated, task.stage, options.type === undefined ? undefined : task.type)
      return err({
        code: "bad_args",
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  if (isTerminal(to)) await clearTaskBindings(ctx, updated)
  // The build is declared ready: its cards are fixed in the baseline (a box open again is reopened).
  if (to === "verify") await recordCards(ctx, updated)
  if (event === "follow_up") await reopenWorkingRecords(ctx, updated).catch(() => {})
  await appendEvent(ctx, task, { event, from: task.stage, to })

  return ok(updated)
}
