// The reviews a task has had, read back from the documents that summarize them: *Reviewed by*
// in the Plan and the Second opinion lane in Verify. Each is a
// file under `reviews/` holding the other agent's text; a review that did not run has no row.

import { REVIEW_FILES } from "../../../core/docs/names.ts"
import type { FlowStepId } from "../../../core/flow.ts"
import type { TaskDetail } from "../../api.ts"
import { stepDocumentOf } from "../../step-page/document.ts"
import { reviewOf } from "../../steps/plan/plan-model.ts"
import { lanesOfTask } from "../../steps/verify/lanes.tsx"

export type ReviewRow = {
  /** The file under `reviews/` that holds it, opened in the Reader. */
  file: string
  step: FlowStepId
  title: string
  /** Who read it: "Codex, GPT-6.1 Sol", "a fresh agent". */
  who: string
  /** How it ended, in a few words. */
  line: string
}

const FILES = REVIEW_FILES

/**
 * How a review ended, in the row's few words: the reviewer's raw verdict ("REVISE: 1 items") gives
 * way to the findings and what became of them, and a count of none is left out.
 * "REVISE: 1 items · 1 finding: 1 taken, 0 kept." → "1 finding, 1 taken".
 */
export function reviewLine(summary: string): string {
  let total: string | null = null
  const rest: string[] = []
  for (const part of summary
    .trim()
    .replace(/\.$/, "")
    .split(/(?<!\s)\s+·\s+/)) {
    // The verdict, raw ("REVISE: 1 items") or in words ("asked for 1 change", "approved", "blocked").
    const verdict =
      part.match(/^(?:APPROVE|REVISE|BLOCK)\b(?:\W+(\d+)\s+items?\b)?/i) ??
      part.match(/^(?:approved$|blocked\b|asked for (?:(\d+) changes?|changes)$)/)
    if (verdict === null) rest.push(part)
    else total = verdict[1] ?? total
  }
  const counts = rest
    .join(", ")
    .replace(/^(\d+ findings?):\s*/, "$1, ")
    .split(/,\s*|(?<!\s)\s+,\s*/)
    .filter((part) => part !== "" && !/^0 /.test(part))
  if (total !== null && !counts.some((part) => /^\d+ findings?$/.test(part)))
    counts.unshift(`${total} ${total === "1" ? "finding" : "findings"}`)
  return counts.length > 0 ? counts.join(", ") : "nothing to change"
}

function withoutReviewerAside(who: string): string {
  const text = who.trimEnd()
  if (!text.endsWith(")")) return who
  const previous = text.lastIndexOf(")", text.length - 2)
  const open = text.indexOf("(", previous + 1)
  return open < 0 ? who : text.slice(0, open).trimEnd()
}

export function reviewsOf(task: Pick<TaskDetail, "pages" | "verifyLanes">): ReviewRow[] {
  const rows: ReviewRow[] = []
  const plan = stepDocumentOf(task, "plan")?.markers.find((m) => m.name === "reviews")
  const reviewed = plan === undefined ? null : reviewOf(plan.fallback)
  if (reviewed !== null) {
    const [kind = "", ...who] = reviewed.label.split(" · ")
    rows.push({
      file: FILES.plan,
      step: "plan",
      title: /^second opinion/i.test(kind) ? "Second opinion on the Plan" : "Plan review",
      // "GPT-6.1 Sol (no second vendor installed)": the row names the reader; the review says why.
      who: withoutReviewerAside(who.join(" · ").replace(/\*\*/g, "")),
      line: reviewLine(reviewed.summary),
    })
  }
  const second = lanesOfTask(task)?.find((lane) => lane.id === "second")
  if (second !== undefined && (second.state === "done" || second.state === "fail"))
    rows.push({
      file: FILES.verify,
      step: "verify",
      title: "Second opinion on the change",
      who: second.who,
      line: reviewLine(second.result),
    })
  return rows
}
