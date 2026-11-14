// The lanes recorded in the task's Verify document, shared with the reviews reader.

import type { LaneRow } from "../../../core/pages/lanes.ts"
import type { TaskDetail } from "../../api.ts"

/** The lanes the last refresh recorded, in the order they run; null when it recorded none. */
export function lanesOfTask(task: Pick<TaskDetail, "verifyLanes">): LaneRow[] | null {
  const rows = task.verifyLanes ?? []
  return rows.length === 0 ? null : rows
}
