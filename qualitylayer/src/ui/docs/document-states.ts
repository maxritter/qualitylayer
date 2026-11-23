// The state of each of a task's documents, for the Files tab: not yet, started early (a file
// written before its step), being written, your turn, done. Derived from the files that exist and
// where the task is, never stored.

import type { Step, TaskFile } from "../../core/docs/names.ts"
import { FLOW_STEPS, flowStepOf } from "../../core/flow.ts"
import type { TaskDetail } from "../api.ts"
import { stageTabs } from "../model.ts"

export type DocumentState =
  | "not yet"
  | "started early"
  | "being written"
  | "your turn"
  | "stopped"
  | "done"

export type DocumentRow = {
  step: Step
  /** The step's file; undefined only when the server listed none. */
  file: TaskFile | undefined
  state: DocumentState
}

function currentStepState(args: {
  step: Step
  exists: boolean
  action: TaskDetail["action"]
  tone: string | undefined
  yours: boolean
}): DocumentState {
  const { step, exists, action, tone, yours } = args
  // Approved, and the build session has not written the Implement file yet: it is written once the
  // person starts the build; the control does not claim that the file is written.
  if (!exists && step === "implement" && action === "implement") return "not yet"
  if (!exists) return tone === "live" ? "being written" : "not yet"
  if (yours || tone === "you") return "your turn"
  return tone === "bad" ? "stopped" : "being written"
}

function stepDocumentState(args: {
  step: Step
  index: number
  current: number
  shipped: boolean
  exists: boolean
  action: TaskDetail["action"]
  tone: string | undefined
  yours: boolean
}): DocumentState {
  const { step, index, current, shipped, exists, action, tone, yours } = args
  // The approved Plan waits to be started: Implement holds the build start. An absent file still
  // remains unwritten.
  if (step === "implement" && exists && action === "implement") return "your turn"
  if (shipped || (current !== -1 && index < current)) return exists ? "done" : "not yet"
  if (index > current) return exists ? "started early" : "not yet"
  return currentStepState({ step, exists, action, tone, yours })
}

/**
 * One row per step of a task, in flow order. `yours` says the person is needed in the step
 * the task is at (a question of its batch is open); the step's own tab says it for an approval.
 */
export function documentStates(
  task: Pick<TaskDetail, "files" | "stage" | "type"> & Partial<TaskDetail>,
  yours = false,
): DocumentRow[] {
  const steps = FLOW_STEPS
  const current = steps.findIndex((step) => step.id === flowStepOf(task.stage))
  const shipped = task.stage === "shipped"
  const tabs = stageTabs(task as TaskDetail)
  return steps.map((step, index) => {
    const file = task.files.find((f) => f.role === step.id)
    const tab = tabs.find((t) => t.step === step.id)
    const state = stepDocumentState({
      step: step.id,
      index,
      current,
      shipped,
      exists: file?.exists === true,
      action: task.action ?? null,
      tone: tab?.tone,
      yours,
    })
    return { step: step.id, file, state }
  })
}

/** How many of the documents are on the list as written, early ones included. */
export const writtenCount = (rows: DocumentRow[]): number =>
  rows.filter((row) => row.state !== "not yet").length
