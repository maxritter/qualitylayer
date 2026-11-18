// The plain Markdown QualityLayer writes into a task's documents: the text of each marked section.
// Pure: state.ts reads what it is drawn from, refresh.ts writes it. GitHub, an editor or anyone
// without the App reads exactly this.

import { parseArtifactReference } from "../artifact/reference.ts"
import type { Marker } from "../docs/markers.ts"
import type { DocRole } from "../docs/names.ts"
import type { Limit } from "../limits-text.ts"
import type { Walkthrough } from "../review/walkthrough.ts"
import { codeEnds } from "../text-boundaries.ts"
import type { StepRecords } from "./records.ts"
import { implementSections } from "./sections/implement.ts"
import { planSections } from "./sections/plan.ts"
import { reviewSections } from "./sections/review.ts"
import { verifySections } from "./sections/verify.ts"

/** When something was decided, as a person reads it: `4 Oct, 10:40`, in this machine's time. */
export function when(ms: number): string {
  const d = new Date(ms)
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ]
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getDate()} ${months[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A cell of a Markdown table: one line, its pipes escaped. */
const cell = (text: string) => text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()

/** A table row; an empty cell is one space wide. */
const row = (cells: string[]) => `|${cells.map((c) => (c === "" ? " " : ` ${c} `)).join("|")}|`

const table = (head: string[], rows: string[][]) =>
  [
    row(head),
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((cells) => row(cells.map(cell))),
  ].join("\n")

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

export type Answered = { kind: string; at: number; note?: string }

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
    .map((q) => ({
      n: q.number,
      what: q.question,
      answer:
        q.kind === "unsure"
          ? `Not known · assumed ${q.choice}`
          : q.words === true && q.pickedLabels !== undefined && q.pickedLabels.length > 0
            ? `${q.choice} (${q.pickedLabels.join(" + ")})`
            : q.choice,
    }))
}

/** One question's evidence, as the step's agents file lists it. */
export type EvidenceRow = {
  n: number
  question: string
  /** The choice the person took, so its sources read first. */
  chosen: string
  rows: { choice: string | null; items: { label: string; href?: string }[] }[]
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

/** *Evidence behind the choices*: per question, each choice's sources, the one taken first. */
export function evidenceText(rows: readonly EvidenceRow[], none: string): string {
  if (rows.length === 0) return none
  return rows
    .map((q) => {
      const ordered = [
        ...q.rows.filter((r) => r.choice === q.chosen),
        ...q.rows.filter((r) => r.choice !== q.chosen),
      ]
      const lines = ordered.map((r) => {
        const who =
          r.choice === null
            ? "Tell me more"
            : r.choice === q.chosen
              ? `${r.choice} (taken)`
              : r.choice
        return `- **${who}:** ${r.items.map(sourceText).join(", ")}`
      })
      return [`**Q${q.n} · ${q.question}**`, "", ...lines].join("\n")
    })
    .join("\n\n")
}

export type DonePoint = { n: number; outcome: string; how: string }

/** One slice as the Plan and the Implement page list it. */
export type SliceRow = {
  n: number
  title: string
  /** What works afterwards, in the Plan's words: the slice's first sentence. */
  plain: string
  tasks: number
  checked: number
  /** Where it stands in the build: done, task 4 of 7, waits for …, next, after 3. */
  now: string
}

export type ProofRow = {
  n: number
  outcome: string
  proof: string
  picture: { file: string; caption: string } | null
  status: "passed" | "failed" | "missing" | "yours to confirm" | "confirmed by you" | "checking"
}

/** A line of the last judgement's review the build session has to answer, with its answer. */
export type Finding = { text: string; answer?: Answered }

/** What the last judgement left failing: one point, scenario or task and what it says. */
export type FixNeed = { kind: string; subject: string; text: string }

/** A task's Plan review as its document names it: who read it, how it ended, what it found. */
export type PlanReviewState = {
  /** "Second opinion · Codex, GPT-6.1 Sol", or "Plan review · Sonnet 5.5 (no second vendor installed)". */
  label: string
  state: "running" | "done" | "failed" | "timed_out"
  /** When it failed: why, in plain words. The page says so on this line (D19). */
  reason?: string
  /** What did not run, when not the Plan's review: "The second opinion on the change". */
  subject?: string
  /** `APPROVE`, `REVISE: 2 items` or `BLOCK: …`, once it answered. */
  verdict: string | null
  /** A panel while it runs: the round it is in (1 reads the Plan, 2 answers the others' findings). */
  round?: 1 | 2
  findings: {
    what: string
    /** A panel's backing of the finding, as its review file says it (`all` and "Codex, Grok, Pi"). */
    panel?: { backing: "all" | "split" | "one"; who: string }
    stance?: "taken" | "kept" | "ask"
    answer?: string
  }[]
}

/** What the fresh checks of a task's Plan artifacts found: all their findings, and how many the planner took or kept. */
export type DesignReviewState = { findings: number; fixed: number; kept: number }

/** What the fallbacks are drawn from, read once per refresh (state.ts). */
export type PageState = {
  title: string
  checkedWithoutJudge?: boolean
  done: DonePoint[]
  /** The person's answer to Done means as a whole, once given. */
  doneAnswer?: Answered
  decided: { n: number; what: string; answer: string }[]
  /** The evidence behind the Plan's answered questions (its agents' file only). */
  evidence?: EvidenceRow[]
  /** Each artifact the Plan names, by name: its title and purpose, or null when it is not drawn. */
  artifacts: Record<
    string,
    { title: string; purpose: string; picture?: { file: string; state: string } } | null
  >
  /** The person's call on each engineering decision, by its `ql:decide` id. */
  decides: Record<string, Answered | undefined>
  /**
   * The decisions that are a Your call (`late: true`), by id; the others are documented decisions
   * that wait for no one. Absent when the state is built without the Plan: then every decision is asked.
   */
  yourCalls?: string[]
  slices: SliceRow[]
  /** The Plan's approval: waiting, approved or changes asked, and when. */
  approval: { state: "waiting" | "approved" | "changes"; at?: number }
  /**
   * The amendments the build recorded, each once with the slice it was made in (null: the Plan's);
   * `replaced` holds the earlier ones the amendment stands for.
   */
  decisions: { slice: number | null; text: string; replaced?: string[] }[]
  /** The review lines of the last judgement, with the build session's answer to each. */
  findings: Finding[]
  /** What the last judgement left failing; absent before the first judgement. */
  fixNeeds?: FixNeed[]
  proof: ProofRow[]
  /** The checking agents' passes: the security review. */
  checks: { label: string; result: string }[]
  /** A task's Plan: its review, once one started. */
  planReview?: PlanReviewState
  /** A task's Plan: the design review of its artifacts, once a report stands. */
  designReview?: DesignReviewState
  /** A task's Plan: every answer the Plan rests on (its questions and the Your calls), with its kind. */
  byYou?: { step: string; what: string; answer: string }[]
  /** A task's Implement and Verify documents: the lanes, the checks, the summaries. */
  records?: StepRecords
  /** A task the person reviews: its change top to bottom, which Verify's generated sections write. */
  walkthrough?: Walkthrough
  /** The limits the build and its reviews recorded (`qualitylayer limit add`). */
  limits?: Limit[]
  ship: { branch: string | null; shipped: boolean; pr: number | null; approvedAt?: number }
}

const ANSWER_WORDS: Record<string, string> = {
  agree: "agreed",
  change: "change asked",
  accept: "accepted",
  confirm: "confirmed",
  fix: "fix asked",
  record: "recorded",
  fine: "fine",
  kept: "kept",
  taken: "taken",
}

const answerWords = (answer: Answered) => ANSWER_WORDS[answer.kind] ?? answer.kind

/** The text QualityLayer writes between a marker's lines; null for a marker it does not fill. */
export function fallbackOf(marker: Pick<Marker, "name" | "args">, state: PageState): string | null {
  const [arg] = marker.args
  switch (marker.name) {
    case "done-means":
      return doneMeansText(state)
    case "decided":
      return state.decided.length === 0
        ? "No questions so far."
        : table(
            ["#", "Question", "Your answer"],
            state.decided.map((d) => [String(d.n), d.what, d.answer]),
          )
    case "artifact":
      return artifactText(arg ?? "", state)
    case "decide":
      return decideText(
        state.decides[arg ?? ""],
        state.yourCalls === undefined || state.yourCalls.includes(arg ?? ""),
      )
    case "slices":
      return arg === "live" ? liveSlicesText(state) : planSlicesText(state)
    case "approve":
      return state.approval.state === "approved"
        ? `Approved${state.approval.at !== undefined ? ` · ${when(state.approval.at)}` : ""}.`
        : state.approval.state === "changes"
          ? `Changes asked${state.approval.at !== undefined ? ` · ${when(state.approval.at)}` : ""}.`
          : "Waits for your approval."
    case "decisions":
      return state.decisions.length === 0
        ? "None so far: the build follows the Plan as approved."
        : state.decisions
            .flatMap((d) => [
              `- ${d.slice === null ? "The Plan" : `Slice ${d.slice}`} · ${d.text}`,
              ...(d.replaced ?? []).map((earlier) => `  - Replaced · ${earlier}`),
            ])
            .join("\n")
    case "proof":
      return proofText(state)
    case "ship":
      return shipText(state)
    default:
      return null
  }
}

function doneMeansText(state: PageState): string {
  if (state.done.length === 0) return "Not written yet."
  const points = state.done.map(
    (p) => `${p.n}. **${p.outcome}.**${p.how !== "" ? ` ${p.how}` : ""}`,
  )
  const answer = state.doneAnswer
  return answer === undefined
    ? points.join("\n")
    : `${points.join("\n")}\n\n**Your answer:** ${answer.kind === "agree" ? "looks right" : answerWords(answer)} · ${when(answer.at)}`
}

function artifactText(name: string, state: PageState): string {
  const artifact = state.artifacts[name]
  if (artifact === undefined || artifact === null)
    return parseArtifactReference(name)?.scope === "project"
      ? `**Project artifact: ${name}.** Unavailable in this view. Open it in the owning project.`
      : `**Artifact: ${name}.** Not drawn yet.`
  const purpose = artifact.purpose !== "" ? ` ${artifact.purpose.replace(/\.?$/, ".")}` : ""
  const title = artifact.title.replace(/\.$/, "")
  // A two-file Plan links its picture of this exact source revision, so the file reads on its own.
  if (artifact.picture !== undefined)
    return `![${title.replace(/[[\]]/g, "")} · ${artifact.picture.state}](${artifact.picture.file})\n\n**Artifact: ${title}.**${purpose} The picture shows its ${artifact.picture.state}; what it does is described in this Plan.`
  return `**Artifact: ${title}.**${purpose} Shown in QualityLayer, on the author's Mac only.`
}

/** Under a decision: the person's answer, or that it waits for them, which only a Your call does. */
function decideText(answer: Answered | undefined, asked: boolean): string {
  if (answer === undefined) return asked ? "**Your call:** waits for your review." : ""
  const note =
    answer.note !== undefined && answer.note.trim() !== "" ? `: ${answer.note.trim()}` : ""
  return `**Your call:** ${answerWords(answer)} · ${when(answer.at)}${note}`
}

function planSlicesText(state: PageState): string {
  if (state.slices.length === 0) return "No slices yet."
  return table(
    ["#", "Slice", "Tasks"],
    state.slices.map((s) => [String(s.n), s.title, String(s.tasks)]),
  )
}

function liveSlicesText(state: PageState): string {
  if (state.slices.length === 0) return "No slices yet."
  return table(
    ["#", "Slice", "In plain words", "Now"],
    state.slices.map((s) => [String(s.n), s.title, s.plain, s.now]),
  )
}

function proofText(state: PageState): string {
  if (state.proof.length === 0) return "Not checked yet."
  return table(
    ["Done means", "Proof", ""],
    state.proof.map((p) => [
      `${p.n}. ${p.outcome}`,
      p.picture !== null ? `![${p.picture.caption}](${p.picture.file})` : p.proof,
      p.status,
    ]),
  )
}

function shipText(state: PageState): string {
  const base = state.walkthrough?.ship.base
  const branch =
    state.ship.branch !== null
      ? ` Branch \`${state.ship.branch}\`${base ? `, to \`${base}\`` : ""}.`
      : ""
  if (state.ship.pr !== null)
    return `${state.ship.shipped ? "Shipped" : "Opened"} as pull request #${state.ship.pr}.${branch}`
  if (state.ship.shipped) return `Shipped.${branch}`
  if (state.ship.approvedAt !== undefined)
    return `Approved · ${when(state.ship.approvedAt)}.${branch}`
  return `Not shipped yet.${branch}`
}

/** One `ql:` section's writer: its text from the state, or null to leave the marker as it is. */
export type SectionWriter = (
  state: PageState,
  marker: Pick<Marker, "name" | "args">,
) => string | null
/** The writers of one document's `ql:` sections, by marker name. */
export type SectionWriters = Record<string, SectionWriter>

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
