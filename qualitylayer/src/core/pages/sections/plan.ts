// The sections QualityLayer writes in a task's Plan (01-plan.md), one writer per `ql:` marker:
// *Decided with you* (every answer the Plan rests on) and *Reviewed by* (who read the Plan, how they
// ended and each finding with the planner's answer). Each artifact and each decision's call are
// drawn by `fallbackOf` (render.ts). Plain Markdown: GitHub and an editor read exactly this, and the
// App draws its own parts over it.

import { isLineText } from "../../text-boundaries.ts"
import type { PageState, SectionWriters } from "../render.ts"

/** A finding's answer as the line says it: Taken, Kept or Ask, with the words under it. */
function answerWords(finding: { stance?: "taken" | "kept" | "ask"; answer?: string }): string {
  if (finding.stance === undefined)
    return finding.answer !== undefined ? "answered" : "not answered yet"
  const word = { taken: "Taken", kept: "Kept", ask: "Asked of you" }[finding.stance]
  return finding.answer !== undefined && finding.answer !== "" ? `${word}: ${finding.answer}` : word
}

/** One line per answer of the Plan's questions and its Your calls, with its kind. */
export function decidedByYouText(state: PageState): string | null {
  if (state.byYou === undefined) return null
  if (state.byYou.length === 0) return "None: the request and the code settled every choice."
  return state.byYou.map((row) => `- ${row.step} · ${row.what} — ${row.answer}`).join("\n")
}

/**
 * A reviewer's verdict line in words: `APPROVE` → "approved", `REVISE: 1 items` → "asked for 1
 * change", `BLOCK: reason` → "blocked: reason". Never the reviewer's protocol word itself.
 */
export function verdictWords(verdict: string | null): string | null {
  if (verdict === null) return null
  const text = verdict.trim()
  if (/^APPROVE\b/.test(text)) return "approved"
  const revise = text.match(/^REVISE\b[:\s]*(\d+)?/)
  if (revise !== null) {
    const n = revise[1] === undefined ? null : Number(revise[1])
    return n === null ? "asked for changes" : `asked for ${n} ${n === 1 ? "change" : "changes"}`
  }
  const block = /^BLOCK\b[:\s]*/.exec(text)
  if (block !== null) {
    const reason = text.slice(block[0].length)
    if (isLineText(reason)) return reason ? `blocked: ${reason}` : "blocked"
  }
  return text
}

/** The reviewer, its verdict and each finding with its answer, from reviews/plan.md. */
export function reviewedByText(state: PageState): string | null {
  const review = state.planReview
  if (review === undefined) return null
  if (review.state === "running" && review.round !== undefined)
    return `**${review.label}** · round ${review.round} of 2, ${review.round === 1 ? "reading the Plan" : "answering each other's findings"}.`
  if (review.state === "running") return `**${review.label}** · reading the Plan now.`
  if (review.state === "timed_out") return `**${review.label}** · ran out of time; no findings.`
  // A review that could not run is said plainly, never passed over (D19); the details stay in reviews/plan.md.
  if (review.state === "failed")
    return `**${review.subject ?? "The Plan review"} could not run:** ${review.reason ?? "the reviewer stopped before it answered"}.`
  const taken = review.findings.filter((f) => f.stance === "taken").length
  const kept = review.findings.filter((f) => f.stance === "kept").length
  const asked = review.findings.filter((f) => f.stance === "ask").length
  const count = review.findings.length
  const tally =
    count === 0
      ? "nothing to change"
      : `${count} ${count === 1 ? "finding" : "findings"}: ${taken} taken, ${kept} kept${asked > 0 ? `, ${asked} asked of you` : ""}`
  const verdict = verdictWords(review.verdict)
  const head = `**${review.label}** · ${verdict !== null ? `${verdict} · ` : ""}${tally}.`
  return count === 0
    ? head
    : [
        head,
        // A panel's finding says who backs it before the planner's answer, as its review file does.
        ...review.findings.map(
          (f) =>
            `- ${f.what} · ${f.panel !== undefined ? `Panel: ${f.panel.backing} · ${f.panel.who} · ` : ""}${answerWords(f)}`,
        ),
      ].join("\n")
}

/** The fresh check of the Plan's designs in one line: how many findings were fixed, kept or are still open. */
export function designReviewedText(state: PageState): string | null {
  const review = state.designReview
  if (review === undefined) return null
  if (review.findings === 0) return "**Design reviewed** · nothing to change."
  const open = review.findings - review.fixed - review.kept
  const fixed = `${review.fixed} ${review.fixed === 1 ? "finding" : "findings"} fixed`
  return `**Design reviewed** · ${fixed}${review.kept > 0 ? `, ${review.kept} kept` : ""}${open > 0 ? `, ${open} not answered yet` : ""}.`
}

export const planSections: SectionWriters = {
  /** One line per answer of the Plan's questions and its Your calls. */
  "decided-by-you": (state) => decidedByYouText(state),
  /** The Plan review's verdict and each finding with its answer, then the design review's line. */
  reviews: (state) => {
    const parts = [reviewedByText(state), designReviewedText(state)].filter((p) => p !== null)
    return parts.length > 0 ? parts.join("\n\n") : null
  },
}
