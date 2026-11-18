// The demo's recorded verification runs while Verify checks and fixes.
// A small change's own rounds are `light.ts`'s.

import type { TaskDetail } from "../../api.ts"
import type { Area } from "./area.ts"
import type { Moment } from "./moments.ts"

export const budget: Area = {
  patch: (task: TaskDetail, moment: Moment): TaskDetail => {
    const now = Date.now()
    if ((moment === "verify-checking" || moment === "verify-red") && task.checklist != null)
      return {
        ...task,
        checklist: {
          ...task.checklist,
          budget: { rounds: { used: 1, limit: null }, since: now - 38 * 60_000 },
        },
      }
    if ((moment === "verify-fixing" || moment === "verify-asked") && task.checklist != null)
      return {
        ...task,
        checklist: {
          ...task.checklist,
          budget: { rounds: { used: 2, limit: null }, since: now - 70 * 60_000 },
        },
      }
    if (moment === "verify-rechecking")
      return {
        ...task,
        ...(task.checklist != null
          ? {
              checklist: {
                ...task.checklist,
                budget: { rounds: { used: 2, limit: null }, since: now - 61 * 60_000 },
              },
            }
          : {}),
      }
    return task
  },
}
