import { CHECKS_RECORD } from "../../core/docs/names.ts"
import type { FlowStepId } from "../../core/flow.ts"
import { type Api, api as liveApi } from "../api.ts"

export function checksForAgent(api: Api, task: string, step: FlowStepId) {
  const list = api.taskRecords
  if (step !== "implement" || !list || (api !== liveApi && list === liveApi.taskRecords))
    return undefined
  return async () => {
    const records = await list(task)
    return records.some((entry) => entry.name === CHECKS_RECORD)
      ? api.record(task, CHECKS_RECORD)
      : null
  }
}
