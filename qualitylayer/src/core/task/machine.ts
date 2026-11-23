// advance() is the only writer of `stage`. The table itself lives in
// stages.ts, import-free, so the Cockpit renders from the same data.

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { recordCards } from "../gate/baseline.ts"
import { reopenWorkingRecords } from "../git/working-records.ts"
import { originalIntact } from "./adoption.ts"
import { clearTaskBindings } from "./binding.ts"
import { nextStage, type Stage, type TaskEvent } from "./stages.ts"
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

async function validateAdvance(
  ctx: Ctx,
  task: Task,
  event: TaskEvent,
  type: Exclude<TaskType, "chat"> | undefined,
): Promise<Result<Stage>> {
  if (!isCurrentLayout(task)) return err({ code: "earlier_layout", message: EARLIER_LAYOUT_REASON })
  // A Chat changes kind when it starts the workflow at the Plan, from the talk or its saved plan.
  const choosesType =
    event === "workflow_started" || (event === "plan_adopted" && task.stage === "chat")
  const badType =
    (choosesType && type !== "feature" && type !== "bugfix") || (!choosesType && type !== undefined)
  if (badType)
    return err({
      code: "bad_args",
      message: "Only a Chat starting the workflow may choose a Feature or Bugfix type",
    })
  const to = nextStage(task, event)
  if (to === null)
    return err({
      code: "illegal_transition",
      message: `event "${event}" is not legal at stage "${task.stage}"`,
      from: task.stage,
      event,
    })
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
  return ok(to)
}

async function applyAdvanceEffect(
  ctx: Ctx,
  task: Task,
  updated: Task,
  options: {
    type?: Exclude<TaskType, "chat">
    effect?: (updated: Task) => Promise<Result<unknown>>
  },
): Promise<Result<void>> {
  if (!options.effect) return ok(undefined)
  const rollback = () =>
    saveStage(ctx, updated, task.stage, options.type === undefined ? undefined : task.type)
  try {
    const applied = await options.effect(updated)
    if (!applied.ok) {
      await rollback()
      return applied
    }
    return ok(undefined)
  } catch (cause) {
    await rollback()
    return err({
      code: "bad_args",
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

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
  const checked = await validateAdvance(ctx, task, event, options.type)
  if (!checked.ok) return checked
  const to = checked.data
  const updated = await saveStage(ctx, task, to, options.type)
  const applied = await applyAdvanceEffect(ctx, task, updated, options)
  if (!applied.ok) return applied
  if (isTerminal(to)) await clearTaskBindings(ctx, updated)
  // The build is declared ready: its cards are fixed in the baseline (a box open again is reopened).
  if (to === "verify") await recordCards(ctx, updated)
  if (event === "follow_up") await reopenWorkingRecords(ctx, updated).catch(() => {})
  await appendEvent(ctx, task, { event, from: task.stage, to })

  return ok(updated)
}
