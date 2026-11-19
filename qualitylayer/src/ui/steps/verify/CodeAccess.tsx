// Verify's way into the changed files (Workflow model: verify.html, Code): the number of changed files and
// View changes, which opens the task's code viewer. It is the Review page's code row in the same frame,
// without its blue button, viewed bar or count of files read: nothing waits for the person here. The count
// is the one the Files card published; the page reads nothing itself, and a task with no count yet still
// opens the viewer.

import { FileDiffIcon } from "lucide-react"
import type { VerifyRevision } from "../../../core/verify-activity.ts"
import { openReviewWorkspace, useCodeSummary } from "../../review-workspace/open.ts"
import { plural } from "../../timeline/parts.tsx"

export function CodeAccess({
  taskId,
  checkout,
  changedCount,
}: {
  taskId: string
  checkout?: VerifyRevision | undefined
  changedCount?: number | undefined
}) {
  const summary = useCodeSummary(taskId)
  const files = summary?.files ?? changedCount
  const empty = files === 0 && checkout !== undefined
  return (
    <div className="review-final-code verify-code">
      <div className="review-code-entry" data-testid="verify-code-row">
        <FileDiffIcon className="review-code-icon" aria-hidden="true" />
        <b>
          {files !== undefined && files > 0
            ? plural(files, "changed file")
            : empty
              ? `No registered changes${checkout.branch ? ` on ${checkout.branch}` : ""}`
              : "Changed files"}
        </b>
        {empty ? null : (
          <button type="button" className="q-btn" onClick={() => openReviewWorkspace(taskId)}>
            View changes
          </button>
        )}
      </div>
    </div>
  )
}
