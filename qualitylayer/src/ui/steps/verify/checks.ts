// The project check that holds the check lock now: Verify's board says what runs.

import type { CheckProgress } from "../../../core/check-progress.ts"
import type { VerifyCheck } from "../../../core/verify-activity.ts"

/** The Project checks run that holds the task's check lock now: a waiting run names no command. */
export function executingCheck(rows: readonly CheckProgress[] | undefined): CheckProgress | null {
  return rows?.filter((row) => row.scope === "all" && row.running && !row.queued).at(-1) ?? null
}

export const failedChecks = (rows: readonly VerifyCheck[]) =>
  rows.filter((row) => row.outcome === "failed" || row.outcome === "timed-out").length

/** Receipt outcomes stay separate from independent acceptance verdicts. */
export function projectCheckWords(rows: readonly VerifyCheck[]) {
  const failed = failedChecks(rows)
  const noun = rows.length === 1 ? "project check" : "project checks"
  if (failed > 0) return `${failed} of ${rows.length} ${noun} failed`
  const passed = rows.filter((row) => row.outcome === "passed").length
  return passed === rows.length
    ? `${passed} ${noun} passed`
    : `${passed} of ${rows.length} ${noun} passed`
}
