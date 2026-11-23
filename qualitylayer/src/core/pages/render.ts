// The plain Markdown QualityLayer writes into a task's documents: the text of each marked section.
// Pure: state.ts reads what it is drawn from, refresh.ts writes it. GitHub, an editor or anyone
// without the App reads exactly this.

import type { Marker } from "../docs/markers.ts"
import type { DocRole } from "../docs/names.ts"
import { codeEnds } from "../text-boundaries.ts"
import { fallbackOf } from "./render-fallbacks.ts"
import type { EvidenceRow, PageState, SectionWriters } from "./render-types.ts"
import { implementSections } from "./sections/implement.ts"
import { planSections } from "./sections/plan.ts"
import { reviewSections } from "./sections/review.ts"
import { verifySections } from "./sections/verify.ts"

export {
  type Answered,
  type DesignReviewState,
  type DonePoint,
  type EvidenceRow,
  type PageState,
  type PlanReviewState,
  type ProofRow,
  type SectionWriters,
  type SliceRow,
  when,
} from "./render-types.ts"

/** A sentence's first sentence, for a table cell. */
export const firstSentence = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  const code = codeEnds(flat)
  let proseFrom = 0
  for (const mark of flat.matchAll(/`+|[.!?](?=\s|$)/g)) {
    if (mark.index < proseFrom) continue
    if (mark[0].startsWith("`")) proseFrom = code.get(mark.index) ?? mark.index
    else return flat.slice(0, mark.index + 1)
  }
  return flat
}

/** The shape of an answered question the decided record reads (task/question.ts). */
type AnsweredLike = {
  number: number
  question: string
  choice: string
  kind?: "unsure"
  gate?: string
  settles?: string[]
  /** Free words that named options keep their words; the options are shown beside them. */
  words?: true
  pickedLabels?: string[]
}

function answerTextOf(q: AnsweredLike): string {
  if (q.kind === "unsure") return `Not known · assumed ${q.choice}`
  if (q.words === true && q.pickedLabels && q.pickedLabels.length > 0)
    return `${q.choice} (${q.pickedLabels.join(" + ")})`
  return q.choice
}

/**
 * What was decided with the person in the Plan: each question asked and answered, in order, without
 * the questions of a gate's review and the last one that confirms the problem and Done means.
 */
export function decidedRows(answered: readonly AnsweredLike[]): PageState["decided"] {
  // A question answered again (undone, then answered anew) keeps only its latest answer.
  const latest = new Map<number, AnsweredLike>()
  for (const q of answered) latest.set(q.number, q)
  return [...latest.values()]
    .filter((q) => q.gate === undefined && (q.settles ?? []).length === 0)
    .map((q) => ({ n: q.number, what: q.question, answer: answerTextOf(q) }))
}

/**
 * The evidence of the questions answered in a step, for the agents: the card never shows it. A
 * question answered again keeps its latest record; one asked without evidence has no row.
 */
export function evidenceRows(
  answered: readonly (AnsweredLike & { evidence?: EvidenceRow["rows"] })[],
): EvidenceRow[] {
  const latest = new Map<number, AnsweredLike & { evidence?: EvidenceRow["rows"] }>()
  for (const q of answered) latest.set(q.number, q)
  return [...latest.values()]
    .filter((q) => (q.evidence?.length ?? 0) > 0)
    .map((q) => ({ n: q.number, question: q.question, chosen: q.choice, rows: q.evidence ?? [] }))
}

/** A source as the agents read it: linked when it has an address, in code type when it is a path. */
const sourceText = (item: { label: string; href?: string }) =>
  item.href !== undefined ? `[${item.label}](${item.href})` : `\`${item.label}\``

/** The agents' files' heading for the evidence QualityLayer keeps of each answered choice. */
export const EVIDENCE_HEADING = "Evidence behind the choices"

function evidenceWho(choice: string | null, chosen: string): string {
  if (choice === null) return "Tell me more"
  return choice === chosen ? `${choice} (taken)` : choice
}

/** *Evidence behind the choices*: per question, each choice's sources, the one taken first. */
export function evidenceText(rows: readonly EvidenceRow[], none: string): string {
  if (rows.length === 0) return none
  return rows
    .map((q) => {
      const ordered = [
        ...q.rows.filter((r) => r.choice === q.chosen),
        ...q.rows.filter((r) => r.choice !== q.chosen),
      ]
      const lines = ordered.map(
        (r) => `- **${evidenceWho(r.choice, q.chosen)}:** ${r.items.map(sourceText).join(", ")}`,
      )
      return [`**Q${q.n} · ${q.question}**`, "", ...lines].join("\n")
    })
    .join("\n\n")
}

/**
 * A task's Plan: its own sections, the answers of its questions and (agents' file) their evidence,
 * and each artifact and decision's call drawn by `fallbackOf`.
 */
const stepPlanSections: SectionWriters = {
  ...planSections,
  decided: (state, marker) => fallbackOf(marker, state),
  evidence: (state) =>
    state.evidence === undefined ? null : evidenceText(state.evidence, "No evidence so far."),
  artifact: (state, marker) => fallbackOf(marker, state),
  decide: (state, marker) => fallbackOf(marker, state),
}

/** A task's Implement: its summary, and the slices and the decisions drawn by `fallbackOf`. */
const stepImplementSections: SectionWriters = {
  ...implementSections,
  slices: (state, marker) => fallbackOf(marker, state),
  decisions: (state, marker) => fallbackOf(marker, state),
}

/**
 * A task's Verify: while the agents check, its stages, findings, checks, rounds and second opinion
 * with Done means and its proof; once the person reviews, the code line, the screens, Done means as
 * it ran and the shipping (the review's writers write nothing before there is a walkthrough).
 */
const stepVerifySections: SectionWriters = {
  ...verifySections,
  proof: (state, marker) => fallbackOf(marker, state),
  ...reviewSections,
  ship: (state, marker) => fallbackOf(marker, state),
}

/** The writers of each step's documents. */
const STEP_SECTIONS: Record<DocRole, SectionWriters> = {
  plan: stepPlanSections,
  implement: stepImplementSections,
  verify: stepVerifySections,
}

/**
 * The text of each marker of a task's document, as `fill` for `fillMarkers`: dispatched to
 * the module of the document's role. A marker no writer knows keeps what is there.
 */
export function stepFill(role: DocRole, state: PageState): (marker: Marker) => string | null {
  const writers = STEP_SECTIONS[role]
  return (marker) => writers[marker.name]?.(state, marker) ?? null
}
