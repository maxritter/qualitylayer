// Questions retain stable ids across App waits, native Terminal pickers and Tell me more.
// App asks wait here; Terminal asks return the picker input without starting a wait.
//
//   question.json        the one question waiting for an answer, in the task's runtime folder
//   questions.json       every question answered so far, in order
//   question-heartbeat   the `ask` that waits writes its time here every 20 s (liveness reads it)
//
// A question that names a `gate` (and an `item`) is one of a gate's review questions: the App's
// answer is recorded on the gate (core/task/question-app.ts). A pick the person made in the
// agent's own picker is recorded by `hook activity` only with proof from the native session.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { recommendedIndices } from "../../interaction/question-recommendations.ts"
import { agentSession } from "../agents/detect.ts"
import { parseArtifactReference } from "../artifact/reference.ts"
import { sectionText } from "../docs/build-log.ts"
import { agentFileOf, folderDoc, RESEARCH_DIR } from "../docs/names.ts"
import { proseLines } from "../docs/rules/types.ts"
import { doneMeansOf } from "../done-means.ts"
import { addAnswers, answerKind, putItemAnswer } from "../gate/comments.ts"
import { type GateFile, readGate } from "../gate/gate.ts"
import type { Attachment } from "../interaction-docs/attachments.ts"
import type { AnswerKind, Item } from "../items.ts"
import type { RepoRef } from "../paths.ts"
import { waitFor } from "../wait.ts"
import { ANSWER_FILES_HINT } from "./answer-files.ts"
import { findingHeading } from "./finding-heading.ts"
import { applyPlacePick, PLACE_QUESTION_ID } from "./place.ts"
import { questionsAhead } from "./question-ahead.ts"
import { readBatch } from "./question-batch.ts"
import { appendEvent, listTasks, type Task } from "./store.ts"
import { requiresChoice, typedAnswer, typedChoiceRefusal } from "./typed-choice.ts"

export { questionsAhead }

/** A piece of evidence for a choice: a file, a passage or a page, linked when it has an address. */
export type QuestionEvidence = { label: string; href?: string }

export type QuestionChoice = {
  label: string
  /** What taking it costs or buys, one sentence. The App's card never shows it. */
  detail?: string
  /** What taking this choice answers an App item with: `agree`, `change`, … (needed with `settles`). */
  kind?: AnswerKind
  /** The choice asks for the person's words: the card moves to the field instead of sending (Change…). */
  words?: true
  /** Grade 2 and 3: up to three facts, each at most 200 characters. */
  facts?: string[]
  /** Grade 3: one small mermaid diagram of what the choice changes. */
  diagram?: string
  /** Grade 3: where the facts come from. The card never shows it; the step's agents file lists it. */
  evidence?: QuestionEvidence[]
  /**
   * The screen this choice leads to, as a task artifact reference (`artifacts/<name>.html`,
   * `artifacts/<name>/<page>.html`, optionally `#<section id>`): the card draws it under the facts.
   */
  artifact?: string
}

/**
 * How much the App explains a question, by how hard it is to decide: 1 one line of why and the
 * passage it settles, 2 a few facts per choice, 3 a diagram per choice with facts and evidence.
 */
export type QuestionGrade = 1 | 2 | 3

/** The most facts a choice carries, and the largest diagram the App draws for one. */
export const MAX_FACTS = 3
const MAX_FACT_LENGTH = 200
export const MAX_DIAGRAM_BYTES = 4096

/**
 * What a question is about, so the App opens only that: a passage (the document, the section's
 * heading and, optionally, the words asked about) or a Plan item (its id).
 */
export type QuestionAbout = { doc?: string; section?: string; quote?: string; item?: string }

/** The person asked for more context (Tell me more): what they asked, and how far the agent got. */
export type MoreRequest = {
  /** Their words, or "" when they asked for nothing in particular. */
  request: string
  at: number
  /** When a waiting `ask` handed the request to the agent. */
  taken?: number
  /** A newer request replaced an earlier one; legacy uncorrelated updates are ambiguous. */
  replaces?: number
  /** The person cancelled it: the card is back to plain waiting, and no `found` is kept. */
  cancelled?: number
  /** What the agent says it is doing while it looks (`question progress`), newest last. */
  lines?: string[]
}

/** What the agent found after Tell me more: the answer to what was asked, on top of the card. */
export type Found = {
  asked: string
  text: string
  evidence: QuestionEvidence[]
  at: number
  requestAt?: number
}

export type Question = {
  /** Stable across a Tell me more and every re-run of `ask`: `q<number>` unless the agent names one. */
  id: string
  /** The decision, short: the App's card uses it as its title. */
  question: string
  choices: QuestionChoice[]
  /** Which choice the agent recommends (an index into `choices`). */
  recommended: number
  /** Explicit recommendations for a multi question; the scalar remains the first for older clients. */
  recommendedChoices?: number[]
  /** How much context the App shows; 1 when not given. */
  grade?: QuestionGrade
  /** Grade 1: the one line of why, the App's own words. */
  why?: string
  /** The passage or Plan item the question is about; the App links to it and marks it. */
  about?: QuestionAbout
  /** The screen the whole question is about (a task artifact reference): the card draws it above the choices. */
  artifact?: string
  /** The App items (`plan:asked:1`) this question answers: the person's choice settles them. */
  settles?: string[]
  /** The gate this question decides (`03-plan.md`, `final`): the answer is recorded on the gate. */
  gate?: string
  /** The review that asked this question; reopening the gate asks it afresh. */
  gateId?: string
  /** The gate's item (`plan:decision:2`) it is about; without one, the gate's approval question. */
  item?: string
  /** The agent session that asked it (null for an agent that names none). */
  session?: string | null
  /** The agent that asked (`claude-code`, `codex`), for the card's "Claude Code waits". */
  agent?: string
  /** This is the Nth question of the task. */
  number: number
  /** The agent's estimate of the questions still to come after this one. */
  ahead?: number
  /** A choice that appeared while writing the Plan; the Plan shows it as Your call. */
  late?: true
  /** The person may pick several choices (`choices: [indices]` in the answer). */
  multi?: true
  /** Grade 3: the title of the helper's report finding (its H3 in `research/rN.md`) the choices rest on; the App links to it. */
  finding?: string
  asked: number
  /** Tell me more, asked and not yet answered by a `found`. */
  more?: MoreRequest
  /** What the agent found for the last Tell me more. */
  found?: Found
  /** Earlier wordings, oldest first: the question and its choices as they were before a reword. */
  earlier?: { question: string; choices: { label: string; detail?: string }[]; at: number }[]
  /** The `ask` that waited was interrupted (Esc, Ctrl-C, its shell killed). */
  stopped?: { at: number; how: "interrupted" }
  /** This question brought the App to the front (the first after `/ql`); later ones only notify. */
  front?: true
}

export type AnsweredQuestion = {
  files?: Attachment[]
  originReceipt?: string
  /** Undo reopens a batch member while retaining its answer in the audit trail. */
  reopened?: boolean
  /** The question's id, when it has one. */
  id?: string
  question: string
  number: number
  /** The label picked, the person's own words, or for Not sure the recommended label. */
  choice: string
  at: number
  /** The passage or Plan item the question settled, so the App marks it there (Q12). */
  about?: QuestionAbout
  /** Where it was answered: in the App, or in the agent's own chat. */
  via?: "app" | "chat"
  /** `unsure`: Not sure, use your recommendation. */
  kind?: "unsure"
  /** The person typed their own answer instead of picking a label. */
  words?: true
  /** The words typed beside the choice they picked ("1, but call it hi.py"), as they wrote them. */
  note?: string
  /** The choices' labels, recommended first as asked, so Change can offer them again. */
  choices?: string[]
  /**
   * The choices (indices into `choices`) a multi answer picked, or that a free-text answer clearly
   * named ("1 and 2", "both"); `pickedLabels` are their labels. The words stay as written.
   */
  picked?: number[]
  pickedLabels?: string[]
  /** The question allowed several answers, so Change offers every pick again and saves the whole set. */
  multi?: true
  recommended?: number
  recommendedChoices?: number[]
  /** The estimate of what was still to come, so the card knows whether another question follows. */
  ahead?: number
  agent?: string
  gate?: string
  gateId?: string
  /** The App items the question settled (the last planning question's confirmation). */
  settles?: string[]
  /** False until the agent has been handed this App answer (by `ask` or `next`). */
  delivered?: boolean
  pickedAt?: number
  /** The person corrected it with Change: what it was, and whether the agent heard of it. */
  changed?: { at: number; was: string; delivered?: boolean }
  /**
   * Where each choice's facts came from, and what a Tell me more found: the agents' record. The card
   * never shows it; the step's agents file lists it under *Evidence behind the choices*.
   */
  evidence?: AnsweredEvidence[]
}

/** One choice's evidence as asked, or (`choice` null) the evidence of what Tell me more found. */
export type AnsweredEvidence = { choice: string | null; items: QuestionEvidence[] }

/** The evidence an answered question keeps for the agents: each choice's, then Tell me more's. */
export function evidenceAsAsked(question: Pick<Question, "choices" | "found">): AnsweredEvidence[] {
  const rows: AnsweredEvidence[] = question.choices
    .filter((c) => (c.evidence?.length ?? 0) > 0)
    .map((c) => ({ choice: c.label, items: c.evidence ?? [] }))
  if ((question.found?.evidence.length ?? 0) > 0)
    rows.push({ choice: null, items: question.found?.evidence ?? [] })
  return rows
}

type Runtime = Pick<Task, "runtimeDir">

const openPath = (task: Runtime) => join(task.runtimeDir, "question.json")
const donePath = (task: Runtime) => join(task.runtimeDir, "questions.json")
const lockOf = (task: Runtime) => join(task.runtimeDir, "question.lock")
/** The file the waiting `ask` touches every 20 s: `{at, id, pid, waiting}`. */
export const heartbeatPath = (task: Runtime) => join(task.runtimeDir, "question-heartbeat")

export { agentSession }

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined

/** What the agent said a question is about: kept only when it names a section or an item. */
function aboutOf(value: unknown): QuestionAbout | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const given = value as Record<string, unknown>
  const doc = text(given.doc, 120)
  const section = text(given.section, 160)
  const quote = text(given.quote, 400)
  const item = text(given.item, 160)
  if (section === undefined && item === undefined) return undefined
  return {
    ...(doc !== undefined ? { doc } : {}),
    ...(section !== undefined ? { section } : {}),
    ...(quote !== undefined && section !== undefined ? { quote } : {}),
    ...(item !== undefined ? { item } : {}),
  }
}

/** A list as the agent gives it: one entry written without its brackets counts as a list of one. */
const listOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]

/**
 * Evidence as the agent gives it: a string, `{label, href}` or a list of them, at most four. An
 * entry with no readable label is counted, so the caller can refuse it instead of losing it.
 */
function readEvidence(value: unknown): { items: QuestionEvidence[]; unreadable: number } {
  const items: QuestionEvidence[] = []
  let unreadable = 0
  for (const entry of listOf(value)) {
    const given =
      typeof entry === "string"
        ? { label: entry }
        : typeof entry === "object" && entry !== null
          ? (entry as Record<string, unknown>)
          : null
    const name = text(given?.label, 160)
    if (name === undefined) {
      // A blank string or an empty object is nothing; anything else said something that is lost.
      const said =
        typeof entry === "string"
          ? entry.trim() !== ""
          : given !== null
            ? Object.keys(given).length > 0
            : entry !== null && entry !== undefined
      if (said) unreadable++
      continue
    }
    const href = text(given?.href, 400)
    items.push({ label: name, ...(href !== undefined ? { href } : {}) })
  }
  return { items: items.slice(0, 4), unreadable }
}

const evidenceOf = (value: unknown): QuestionEvidence[] => readEvidence(value).items

/** The warning a question's reply carries when a fact was trimmed to its limit; null when all fit. */
export function longFactsWarning(input: unknown): string | null {
  const raw = (input as { choices?: unknown } | null)?.choices
  const labels = (Array.isArray(raw) ? raw : []).flatMap((entry) => {
    const choice = entry as Record<string, unknown> | null
    const long = listOf(choice?.facts).some(
      (fact) => typeof fact === "string" && fact.trim().length > MAX_FACT_LENGTH,
    )
    return long ? [`"${String(choice?.label ?? "")}"`] : []
  })
  return labels.length === 0
    ? null
    : `facts over ${MAX_FACT_LENGTH} characters were trimmed to fit (${labels.join(", ")}); keep each fact shorter next time`
}

/**
 * A choice's graded context: its facts (at most three, each trimmed to its limit), its diagram (at
 * most 4 KB of mermaid) and its evidence. Too many facts or too large a diagram is refused, so the
 * agent shortens them.
 */
function choiceContext(
  choice: Record<string, unknown>,
  label: string,
): Result<Pick<QuestionChoice, "facts" | "diagram" | "evidence" | "artifact">> {
  const given = listOf(choice.facts)
  const facts = given
    .map((fact) => text(fact, MAX_FACT_LENGTH))
    .filter((fact): fact is string => fact !== undefined)
  if (facts.length > MAX_FACTS) {
    return err({
      code: "bad_args",
      message: `the choice "${label}" has ${facts.length} facts; give it at most ${MAX_FACTS}`,
    })
  }
  const diagram =
    typeof choice.diagram === "string" && choice.diagram.trim() !== ""
      ? choice.diagram.trim()
      : undefined
  if (diagram !== undefined && new TextEncoder().encode(diagram).length > MAX_DIAGRAM_BYTES) {
    return err({
      code: "bad_args",
      message: `the diagram of "${label}" is over 4 KB; draw at most six nodes`,
    })
  }
  const { items: evidence, unreadable } = readEvidence(choice.evidence)
  if (unreadable > 0)
    return err({
      code: "bad_args",
      message: `evidence for the choice "${label}" is a list of {"label": "<file or passage>", "href": "<address, optional>"}; ${unreadable} entr${unreadable === 1 ? "y has" : "ies have"} no label`,
    })
  const artifact = screenOf(choice.artifact, `the choice "${label}"`)
  if (!artifact.ok) return artifact
  return ok({
    ...(facts.length > 0 ? { facts } : {}),
    ...(diagram !== undefined ? { diagram } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(artifact.data !== undefined ? { artifact: artifact.data } : {}),
  })
}

/**
 * The screen a question or a choice shows: a reference to one of the task's own artifacts. A name the
 * card could not draw is refused, so the agent hears it before the person sees an empty card.
 */
function screenOf(value: unknown, owner: string): Result<string | undefined> {
  if (value === undefined || value === null || value === "") return ok(undefined)
  const reference = typeof value === "string" ? parseArtifactReference(value.trim()) : null
  if (reference === null || reference.scope !== "task")
    return err({
      code: "bad_args",
      message: `"artifact" of ${owner} names a task artifact the card draws: "artifacts/<name>.html" or "artifacts/<name>/<page>.html", optionally with "#<section id>"`,
    })
  return ok(reference.section ? `${reference.file}#${reference.section}` : reference.file)
}

/** The questions answered so far, oldest first. */
export async function answeredQuestions(ctx: Ctx, task: Runtime): Promise<AnsweredQuestion[]> {
  const path = donePath(task)
  if (!(await ctx.fs.exists(path))) return []
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(path)) as unknown
    return Array.isArray(parsed) ? (parsed as AnsweredQuestion[]) : []
  } catch {
    return []
  }
}

export async function writeAnswered(
  ctx: Ctx,
  task: Runtime,
  all: AnsweredQuestion[],
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(donePath(task), `${JSON.stringify(all, null, 2)}\n`)
}

/** The question file as written, whatever answered it since: `openQuestion` decides that. */
async function readOpen(ctx: Ctx, task: Runtime): Promise<Question | null> {
  const path = openPath(task)
  if (!(await ctx.fs.exists(path))) return null
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(path)) as Question
    if (typeof parsed.question !== "string" || !Array.isArray(parsed.choices)) return null
    return typeof parsed.id === "string" && parsed.id !== "" ? parsed : null
  } catch {
    return null
  }
}

async function writeOpen(ctx: Ctx, task: Runtime, question: Question): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(openPath(task), `${JSON.stringify(question, null, 2)}\n`)
}

/**
 * A question about a gate is over once that gate was decided (in the App, by a typed approve,
 * by any route that never ran `question answered`), including before the agent showed the question,
 * or once a later gate opened.
 */
async function gatePassed(ctx: Ctx, task: Runtime, question: Question): Promise<boolean> {
  const path = join(task.runtimeDir, "gate.json")
  if (!(await ctx.fs.exists(path))) return false
  try {
    const gate = JSON.parse(await ctx.fs.readFile(path)) as {
      id?: unknown
      target?: unknown
      opened?: unknown
      decision?: unknown
      decided?: unknown
      earlier?: unknown
    }
    if (gate.target !== question.gate)
      return typeof gate.opened === "number" && gate.opened > question.asked
    // The final Review's approval question (it names no item) is not over because the same Review
    // opened again under a new id: the gate keeps its earlier ids, and the person's Approve on the
    // question they were shown still counts (`questionIsOf`). An item question, or an id this
    // Review never had, is over.
    const retained =
      gate.target === "final" &&
      question.item === undefined &&
      Array.isArray(gate.earlier) &&
      gate.earlier.includes(question.gateId)
    if (
      question.gateId !== undefined &&
      question.gateId !== (gate.id ?? String(gate.opened)) &&
      !retained
    )
      return true
    return gate.decision !== "pending" && typeof gate.decided === "number"
  } catch {
    return false
  }
}

/**
 * The person's decision on the very review a question asks about, once they took it by any route,
 * or null while it is pending (or the question asks about no gate, or about another review).
 */
async function reviewDecision(
  ctx: Ctx,
  task: Runtime,
  question: Pick<Question, "gate" | "gateId">,
): Promise<GateFile["decision"] | null> {
  if (question.gate === undefined) return null
  const gate = await readGate(ctx, task)
  if (gate === null || gate.target !== question.gate) return null
  if (question.gateId !== undefined && question.gateId !== (gate.id ?? String(gate.opened)))
    return null
  return gate.decision !== "pending" && typeof gate.decided === "number" ? gate.decision : null
}

/**
 * The task a review question (one that names a `gate`) is asked on: `open`, the task this command
 * resolved, when its gate is that review; else the task whose gate it is, even one that review
 * shipped (a final approval ships the task and releases the session, so no open task names it
 * any more). `gateId` names that very review; without it, the newest review of that target counts.
 * Null when no task has that review: a review question never moves to the App's home page.
 */
export async function reviewedTask(
  ctx: Ctx,
  repo: RepoRef,
  review: { gate: string; gateId?: string },
  open: Task | null,
): Promise<Task | null> {
  const names = (gate: GateFile | null): gate is GateFile =>
    gate !== null &&
    gate.target === review.gate &&
    (review.gateId === undefined || review.gateId === (gate.id ?? String(gate.opened)))
  if (open !== null && names(await readGate(ctx, open))) return open
  let newest: { task: Task; opened: number } | null = null
  for (const task of await listTasks(ctx, repo)) {
    const gate = await readGate(ctx, task)
    if (names(gate) && (newest === null || gate.opened > newest.opened))
      newest = { task, opened: gate.opened }
  }
  return newest?.task ?? open
}

/** The question that waits for an answer, or null. */
export async function openQuestion(ctx: Ctx, task: Runtime): Promise<Question | null> {
  const parsed = await readOpen(ctx, task)
  if (parsed === null) return (await readBatch(ctx, task))?.questions[0] ?? null
  // A question the person answered since it was shown is over, whatever left its file behind.
  const answered = (await answeredQuestions(ctx, task)).findLast(
    (a) => a.id === parsed.id || (a.id === undefined && a.at > parsed.asked),
  )
  if (answered !== undefined && !answered.reopened) return null
  if (parsed.gate !== undefined && (await gatePassed(ctx, task, parsed))) return null
  return parsed
}

/**
 * `question show`: the question as the agent asks it. Accepts a choice as a plain string or as
 * `{label, detail}`; `recommended` names an index or label, or an array for `multi: true`.
 * Choice flags supply the recommendation when it is unnamed; otherwise it is the first choice.
 */
export async function showQuestion(
  ctx: Ctx,
  task: Runtime,
  input: unknown,
  extra: { agent?: string } = {},
): Promise<Result<Question>> {
  const parsed = parseQuestion(ctx, input, await answeredQuestions(ctx, task))
  if (!parsed.ok) return parsed
  const shown: Question = {
    ...parsed.data,
    ...(await questionScope(ctx, task, parsed.data, parsed.data.id)),
    ...(extra.agent !== undefined && extra.agent !== "unknown" ? { agent: extra.agent } : {}),
    asked: ctx.clock.now(),
  }
  await writeOpen(ctx, task, shown)
  return ok(shown)
}

/** Show and ask name the same question in a review, even if the person answers between them. */
async function questionScope(
  ctx: Ctx,
  task: Runtime,
  question: Pick<Question, "gate">,
  named: string,
): Promise<{ id: string; gateId?: string }> {
  const gate = question.gate !== undefined ? await readGate(ctx, task) : null
  const gateId =
    gate !== null && gate.target === question.gate ? (gate.id ?? String(gate.opened)) : undefined
  return {
    id: gateId === undefined || named.endsWith(`-${gateId}`) ? named : `${named}-${gateId}`,
    ...(gateId !== undefined ? { gateId } : {}),
  }
}

/** A question as the agent wrote it, checked; `asked` is the caller's. */
export function parseQuestion(
  ctx: Ctx,
  input: unknown,
  history: AnsweredQuestion[],
): Result<Omit<Question, "asked">> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err({
      code: "bad_args",
      message:
        'usage: qualitylayer question ask \'{"id": "q7", "question": "…", "choices": [{"label": "…"}], "recommended": 0, "grade": 1, "why": "…", "ahead": 3}\'',
    })
  }
  const given = input as Record<string, unknown>
  const allowed = new Set([
    "id",
    "question",
    "choices",
    "recommended",
    "grade",
    "why",
    "lead",
    "ahead",
    "number",
    "about",
    "settles",
    "gate",
    "item",
    "hold",
    "found",
    "points",
    "gateId",
    "late",
    "finding",
    "multi",
    "artifact",
  ])
  const unknown = Object.keys(given).filter((key) => !allowed.has(key))
  if (unknown.length)
    return err({
      code: "bad_args",
      message:
        `unknown question fields: ${unknown.join(", ")}. facts, diagram and evidence belong on each choice: ` +
        `"choices": [{"label": "<six words>", "facts": ["<fact>", "<fact>"]}, …], one object per choice instead of a plain string.`,
    })
  const question = text(given.question, 300)
  const grade = given.grade
  if (grade !== undefined && grade !== 1 && grade !== 2 && grade !== 3) {
    return err({ code: "bad_args", message: '"grade" is 1, 2 or 3' })
  }
  if (given.multi !== undefined && typeof given.multi !== "boolean")
    return err({ code: "bad_args", message: '"multi" is true or false' })
  if (given.late !== undefined && typeof given.late !== "boolean")
    return err({ code: "bad_args", message: '"late" is true or false' })
  if (given.finding !== undefined && text(given.finding, 160) === undefined)
    return err({ code: "bad_args", message: '"finding" names a finding of the research document' })
  const raw = Array.isArray(given.choices) ? given.choices : []
  const choices: QuestionChoice[] = []
  const flagged: number[] = []
  for (const entry of raw.slice(0, 6)) {
    const choice = typeof entry === "string" ? { label: entry } : (entry as Record<string, unknown>)
    if (choice && typeof choice === "object") {
      const allowedChoice = new Set([
        "label",
        "detail",
        "kind",
        "words",
        "facts",
        "diagram",
        "evidence",
        "artifact",
        "recommended",
      ])
      const unknownChoice = Object.keys(choice).filter((key) => !allowedChoice.has(key))
      if (unknownChoice.length)
        return err({
          code: "bad_args",
          message: `unknown choice fields: ${unknownChoice.join(", ")}`,
        })
    }
    const label = text(choice?.label, 200)
    if (label === undefined) continue
    const detail = text(choice.detail, 400)
    const kind = answerKind(choice.kind)
    const context = choiceContext(choice, label)
    if (!context.ok) return context
    if (choice.recommended === true) flagged.push(choices.length)
    choices.push({
      label,
      ...(detail !== undefined ? { detail } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(choice.words === true ? { words: true as const } : {}),
      ...context.data,
    })
  }
  if (question === undefined || choices.length < 2) {
    return err({
      code: "bad_args",
      message: "a question needs its text and at least two choices",
    })
  }
  const settles = (Array.isArray(given.settles) ? given.settles : [])
    .map((id) => text(id, 120))
    .filter((id): id is string => id !== undefined)
    .slice(0, 12)
  // A question that settles App items needs every choice's kind: one left out is the recommended
  // choice's agree, any other's change.
  if (settles.length > 0) {
    const agreed = typeof given.recommended === "number" ? given.recommended : (flagged[0] ?? 0)
    choices.forEach((c, i) => {
      if (c.kind === undefined) choices[i] = { ...c, kind: i === agreed ? "agree" : "change" }
    })
  }
  const named = given.recommended
  const many = Array.isArray(named)
    ? named
    : named === undefined && given.multi === true && flagged.length > 1
      ? flagged
      : null
  let recommendedChoices: number[] | undefined
  if (many !== null) {
    if (given.multi !== true || given.gate !== undefined)
      return err({
        code: "bad_args",
        message: "multiple recommendations belong to a multi question without a review gate",
      })
    const indices = many.map((value) =>
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? choices.findIndex((c) => c.label.toLowerCase() === value.toLowerCase())
          : -1,
    )
    if (
      !indices.length ||
      new Set(indices).size !== indices.length ||
      indices.some((i) => !Number.isInteger(i) || i < 0 || i >= choices.length || choices[i]?.words)
    )
      return err({
        code: "bad_args",
        message:
          "recommend at least one valid choice, each at most once; choices that ask for words need a text answer",
      })
    recommendedChoices = indices.sort((a, b) => a - b)
  }
  const index =
    recommendedChoices !== undefined
      ? (recommendedChoices[0] as number)
      : typeof named === "number" && Number.isInteger(named)
        ? named
        : typeof named === "string"
          ? choices.findIndex((c) => c.label.toLowerCase() === named.toLowerCase())
          : (flagged[0] ?? -1)
  if (
    named !== undefined &&
    !Array.isArray(named) &&
    ((typeof named !== "number" && typeof named !== "string") ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= choices.length)
  )
    return err({ code: "bad_args", message: "recommended must name a valid choice index or label" })
  const number =
    typeof given.number === "number" && Number.isInteger(given.number) && given.number > 0
      ? given.number
      : history.length + 1
  // The estimate of what is still to come.
  const ahead =
    typeof given.ahead === "number" && Number.isInteger(given.ahead) && given.ahead >= 0
      ? Math.min(given.ahead, 99)
      : undefined
  const id = text(given.id, 80)?.replace(/[^A-Za-z0-9_.:-]/g, "-") ?? `q${number}`
  // A chat_review entry carries its context as `lead`; asked as it is, that is the line of why.
  const why = text(given.why, 400) ?? text(given.lead, 400)
  const gate = text(given.gate, 120)
  const item = gate !== undefined ? text(given.item, 160) : undefined
  const finding =
    text(given.finding, 160)
      ?.replace(/^#+\s*/, "")
      .trim() || undefined
  const about = aboutOf(given.about)
  const artifact = screenOf(given.artifact, "the question")
  if (!artifact.ok) return artifact
  return ok({
    id,
    question,
    choices,
    recommended: index >= 0 && index < choices.length ? index : 0,
    ...(recommendedChoices ? { recommendedChoices } : {}),
    ...(grade !== undefined ? { grade } : {}),
    ...(why !== undefined ? { why } : {}),
    ...(about !== undefined ? { about } : {}),
    ...(artifact.data !== undefined ? { artifact: artifact.data } : {}),
    ...(settles.length > 0 ? { settles } : {}),
    ...(gate !== undefined ? { gate } : {}),
    ...(item !== undefined ? { item } : {}),
    ...(given.late === true ? { late: true as const } : {}),
    ...(given.multi === true ? { multi: true as const } : {}),
    ...(finding !== undefined ? { finding } : {}),
    session: agentSession(ctx.env),
    number,
    ...(ahead !== undefined ? { ahead } : {}),
  })
}

const CONNECTOR =
  /^\s*(?:(?:,|;|&|\+|\/|and|und|or|oder|plus|with|sowie)\s*)+(?:(?:option|choice|number|no\.?|nr\.?|#)\s*)?$/i
const BOTH = /\b(?:both|beide|beides|beiden)\b/i
const ALL = /\b(?:all|alle|alles)\b/i

/**
 * The choices a free-text answer clearly names: two or more option numbers joined by "and", "und",
 * a comma or a plus ("1 and 2"), "both"/"beide" for a question of two choices, or "all"/"alle"
 * for a short answer. Null when it names none, or when any of it is doubtful. The words are never
 * replaced by this: it only says what they point at.
 */
export function matchOptions(
  words: string,
  choices: { label: string; words?: true }[],
): number[] | null {
  const text = words.trim()
  const open = choices.map((c, i) => (c.words === true ? -1 : i)).filter((i) => i >= 0)
  if (text === "" || text.length > 200 || open.length < 2) return null
  const count = text.split(/\s+/).length
  if (BOTH.test(text) && count <= 8 && open.length === 2 && choices.length === 2) return open
  if (ALL.test(text) && count <= 6) return open
  const found = [...text.matchAll(/(?<![\w.\-/])(\d{1,2})(?!\w)(?!\.\d)/g)]
  if (found.length < 2) return null
  for (let i = 1; i < found.length; i++) {
    const before = found[i - 1]
    const here = found[i]
    if (!before || !here) return null
    const gap = text.slice((before.index ?? 0) + before[0].length, here.index ?? 0)
    if (!CONNECTOR.test(gap)) return null
  }
  const picks = [...new Set(found.map((m) => Number(m[1]) - 1))].sort((a, b) => a - b)
  if (picks.length < 2 || picks.some((i) => !open.includes(i))) return null
  return picks
}

/** Why these picks are not an answer to the question, or null when they are. */
export function picksProblem(question: Question, picks: number[]): string | null {
  if (question.multi !== true) return "this question takes one choice, not several"
  if (question.gate !== undefined) return "a review question takes one choice"
  if (
    picks.length < 1 ||
    new Set(picks).size !== picks.length ||
    picks.some((i) => !Number.isInteger(i) || question.choices[i] === undefined)
  )
    return "pick at least one choice, each at most once"
  if (picks.some((i) => question.choices[i]?.words === true))
    return "a choice that asks for words cannot be one of several; send the words as text"
  return null
}

/** How a question is answered: by the person in the App, or as they said it in the agent's chat. */
export type AnswerOptions = {
  /** Files already validated and stored by the App answer writer. */
  files?: Attachment[]
  originReceipt?: string
  via?: "app" | "chat"
  /** Not sure, use your recommendation: the recommended choice is taken, marked as assumed. */
  unsure?: boolean
  /** The question as read before a gate decision that closes it was recorded. */
  open?: Question
  /** Batch members do not own the single-question file. */
  preserveOpen?: boolean
  /** An App text field is literal, including a number or a choice's label. */
  literalWords?: boolean
  /** The words the person wrote beside the choice they picked. */
  note?: string
  /** A multi question's picks (indices into its choices): the answer is all their labels. */
  picks?: number[]
  /** The caller already holds the question's lock (`withQuestionLock`). */
  held?: boolean
}

/** Run `action` holding the question's lock: what happens inside is seen whole or not at all by `waitForAnswer`. */
export function withQuestionLock<T>(ctx: Ctx, task: Runtime, action: () => Promise<T>): Promise<T> {
  return ctx.fs.withLock(lockOf(task), action)
}

/**
 * Cancel the open singleton question `id`. Only the session that asked may, unless QualityLayer
 * itself withdraws a question whose cause is gone (`lifted`).
 */
export async function cancelQuestion(
  ctx: Ctx,
  task: Runtime,
  id: string,
  options: { lifted?: true } = {},
): Promise<Result<{ cancelled: string }>> {
  return withQuestionLock(ctx, task, async () => {
    const question = await readOpen(ctx, task)
    if (question === null || question.id !== id || (await openQuestion(ctx, task))?.id !== id)
      return err({ code: "bad_args", message: "that singleton question is not open" })
    if (options.lifted !== true && question.session && question.session !== agentSession(ctx.env))
      return err({
        code: "bad_args",
        message: "only the session that asked this question can cancel it",
      })
    const audit = join(task.runtimeDir, `question-cancelled-${encodeURIComponent(id)}.json`)
    await ctx.fs.atomicWrite(audit, JSON.stringify({ question, cancelled_at: ctx.clock.now() }))
    await ctx.fs.remove(openPath(task))
    return ok({ cancelled: id })
  })
}

/**
 * Close the question that waits and record what was chosen. A choice named by its number (1, 2,
 * …) or by its label is stored as the label; any other words (the person's own) are stored as
 * they are. For each App item the question settles, the answer is kept: the choice's kind for a
 * choice, a `reply` (which settles nothing) for the person's own words. With no question open it
 * says so and changes nothing, so an agent that already answered never fails here.
 */
export async function answerQuestion(
  ctx: Ctx,
  task: Runtime & Partial<Pick<Task, "dir">>,
  words: string,
  options: AnswerOptions = {},
): Promise<
  Result<{ closed: boolean; question?: string; choice?: string; entry?: AnsweredQuestion }>
> {
  const close = async () => {
    const open = options.open ?? (await openQuestion(ctx, task))
    if (open === null) return ok({ closed: false })
    const said = options.unsure === true ? String(open.recommended + 1) : words.trim()
    // The exact label first, then the one label that differs only in case; a number, "the first
    // one" or "your recommendation" is a choice too. A question that takes no words is also
    // answered by the beginning of its one fitting label. Two fitting labels are asked about.
    const typed =
      options.literalWords === true
        ? null
        : typedAnswer(said, open.choices, {
            recommended: open.recommended,
            own: !requiresChoice(open),
          })
    if (typed?.kind === "ambiguous" && options.picks === undefined && options.unsure !== true)
      return err({
        code: "bad_args",
        message: typedChoiceRefusal(said, open.choices, typed, open.gate),
      })
    // Words that name none of the place question's choices save nothing: it stays open.
    if (
      open.id === PLACE_QUESTION_ID &&
      typed !== null &&
      typed.kind !== "choice" &&
      options.picks === undefined &&
      options.unsure !== true
    )
      return err({ code: "bad_args", message: typedChoiceRefusal(said, open.choices, typed) })
    const byWords = typed?.kind === "choice" ? open.choices[typed.index] : undefined
    const note = options.note ?? (typed?.kind === "choice" ? typed.note : undefined)
    const picks =
      options.unsure && open.multi && open.recommendedChoices
        ? recommendedIndices(open)
        : options.picks && [...options.picks].sort((a, b) => a - b)
    if (picks) {
      const problem = picksProblem(open, picks)
      if (problem) return err({ code: "bad_args", message: problem })
    }
    const several = picks?.map((i) => open.choices[i]?.label ?? "")
    const picked = several !== undefined || options.literalWords ? undefined : byWords
    const choice =
      several !== undefined
        ? several.join(" + ")
        : (picked?.label ?? (said !== "" ? said : "(no answer)"))
    // Free words that clearly name options keep their words; the options are recorded beside them.
    const named =
      several === undefined && picked === undefined && options.unsure !== true
        ? matchOptions(said, open.choices)
        : null
    const history = await answeredQuestions(ctx, task)
    if (open.settles !== undefined && open.settles.length > 0) {
      await addAnswers(
        ctx,
        task,
        open.settles.map((item) => ({
          doc: folderDoc("plan"),
          item,
          kind: picked?.kind ?? "reply",
          remark: choice,
        })),
      )
      if (picked?.kind === "agree" && open.settles.includes("plan:done:1") && task.dir) {
        const points = await doneMeansOf(ctx, { dir: task.dir })
        for (const point of points) {
          const item: Item = {
            id: `plan:done:1:${point.n}`,
            step: "plan",
            kind: "done",
            family: "decide",
            kindLabel: "Done means",
            what: point.outcome,
            ...(point.how ? { why: point.how } : {}),
            state: "open",
            blocking: true,
            answers: { options: ["agree", "change"] },
          }
          await putItemAnswer(ctx, task, item, { kind: "agree", at: ctx.clock.now() })
        }
      }
    }
    const at = Math.max(ctx.clock.now(), (history.at(-1)?.at ?? 0) + 1)
    const entry: AnsweredQuestion = {
      ...(options.files?.length ? { files: options.files } : {}),
      ...(options.originReceipt ? { originReceipt: options.originReceipt } : {}),
      id: open.id,
      question: open.question,
      number: open.number,
      choice,
      at,
      // Where it was asked, so the App marks the passage it settled.
      ...(open.about !== undefined ? { about: open.about } : {}),
      ...(options.via !== undefined ? { via: options.via } : {}),
      ...(options.unsure === true ? { kind: "unsure" as const } : {}),
      ...(several === undefined && picked === undefined && said !== ""
        ? { words: true as const }
        : {}),
      ...(note !== undefined ? { note } : {}),
      ...(open.multi === true && open.gate === undefined ? { multi: true as const } : {}),
      ...(picks !== undefined
        ? { picked: picks, pickedLabels: several ?? [] }
        : named !== null
          ? { picked: named, pickedLabels: named.map((i) => open.choices[i]?.label ?? "") }
          : {}),
      choices: open.choices.map((c) => c.label),
      ...(evidenceAsAsked(open).length > 0 ? { evidence: evidenceAsAsked(open) } : {}),
      recommended: open.recommended,
      ...(open.recommendedChoices ? { recommendedChoices: [...open.recommendedChoices] } : {}),
      ...(open.ahead !== undefined ? { ahead: open.ahead } : {}),
      ...(open.agent !== undefined ? { agent: open.agent } : {}),
      ...(open.gate !== undefined ? { gate: open.gate } : {}),
      ...(open.gateId !== undefined ? { gateId: open.gateId } : {}),
      // A question that settles App items confirms them: it is no decision of its own.
      ...(open.settles !== undefined && open.settles.length > 0 ? { settles: open.settles } : {}),
      // The agent hears of an App answer from the `ask` that waits, or from its next reply.
      ...(options.via === "app" ? { delivered: false } : {}),
      ...(options.via === "chat" ? { delivered: true, pickedAt: at } : {}),
    }
    await writeAnswered(ctx, task, [...history, entry])
    if (!options.preserveOpen) await ctx.fs.remove(openPath(task))
    // The place question's pick is saved as the person's rows, wherever it was answered.
    if (open.id === PLACE_QUESTION_ID && task.dir !== undefined)
      await applyPlacePick(ctx, { dir: task.dir }, entry.choices ?? [], choice)
    // The task log says that it was answered, by its id alone: what was said stays in questions.json.
    await appendEvent(ctx, task, {
      event: "question_answered",
      id: open.id,
      ...(open.gate !== undefined ? { gate: open.gate } : {}),
      ...(open.item !== undefined ? { item: open.item } : {}),
    })
    return ok({ closed: true, question: open.question, choice, entry })
  }
  return options.held === true ? close() : ctx.fs.withLock(lockOf(task), close)
}

// ---------------------------------------------------------------- ask: the agent waits

/** The H3 titles of a document, fenced code left out. */
export function h3Titles(markdown: string): string[] {
  const titles: string[] = []
  for (const { text: line } of proseLines(markdown)) {
    const heading = findingHeading(line)
    if (heading !== null) titles.push(heading)
  }
  return titles
}

/**
 * Whether `finding` names a finding of the task: a line of *Findings* in `agents/01-plan.md`, or
 * an H3 of a helper's report under `research/`. Null when it does, else what to tell the agent. The
 * title may be written with or without its `###`.
 */
export async function findingProblem(
  ctx: Ctx,
  task: Partial<Pick<Task, "dir">>,
  finding: string,
): Promise<string | null> {
  if (task.dir === undefined) return null
  const file = agentFileOf("plan")
  const read = async (path: string) =>
    (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""
  const findings = sectionText(await read(join(task.dir, file)), "Findings").toLowerCase()
  const reports = join(task.dir, RESEARCH_DIR)
  const titles: string[] = []
  if (await ctx.fs.exists(reports))
    for (const entry of await ctx.fs.entries(reports))
      if (entry.kind === "file" && /^r\d+\.md$/.test(entry.name))
        titles.push(...h3Titles(await read(join(reports, entry.name))))
  const wanted = finding
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase()
  if (
    wanted !== "" &&
    (findings.includes(wanted) || titles.some((t) => t.toLowerCase() === wanted))
  )
    return null
  return `"finding" must name a finding: words of a line under "Findings" in ${file}, or the ### title of a finding in a report under ${RESEARCH_DIR}/`
}

/** What `ask` saved: the question, or the answer it already has (given while no `ask` waited). */
export type Asked = {
  question: Question
  answered: AnsweredQuestion | null
  /** A re-run after Tell me more replaced its context. */
  replaced: boolean
  /** The question is new: never shown before under this id. */
  fresh: boolean
  /** The review it asks about was decided already (in the App, by a typed approve): nothing was asked. */
  decided?: GateFile["decision"]
}

/**
 * `question ask`: save the question as `question show` does, under its stable id. The same id
 * asked again is the same question: a re-run after `waiting` keeps it as it is; a re-run after
 * Tell me more replaces its context and adds `found`, unless the person cancelled the request.
 * An answer the person gave meanwhile wins: it is returned, and nothing is written.
 */
export async function askQuestion(
  ctx: Ctx,
  task: Runtime & Pick<Task, "stage"> & Partial<Pick<Task, "dir">>,
  input: unknown,
  extra: { agent?: string } = {},
): Promise<Result<Asked>> {
  return ctx.fs.withLock(lockOf(task), async () => {
    const history = await answeredQuestions(ctx, task)
    const parsed = parseQuestion(ctx, input, history)
    if (!parsed.ok) return parsed
    if (parsed.data.late)
      return err({
        code: "batch_step_closed",
        message: 'ask a Your call with `question ask --batch` ("late": true, in the Plan)',
      })
    if (parsed.data.finding) {
      const problem = await findingProblem(
        ctx,
        { ...(task.dir ? { dir: task.dir } : {}) },
        parsed.data.finding,
      )
      if (problem) return err({ code: "bad_args", message: problem })
    }
    const given = input as Record<string, unknown>
    if (parsed.data.gate !== undefined) {
      const gate = await readGate(ctx, task)
      if (
        gate === null ||
        gate.target !== parsed.data.gate ||
        (given.gateId !== undefined && given.gateId !== (gate.id ?? String(gate.opened))) ||
        (gate.decision === "pending" && gate.settled === true) ||
        (gate.decision !== "pending" && typeof gate.decided !== "number")
      )
        return err({
          code: "bad_args",
          message: "that review is no longer open; use its current gate id",
        })
    }
    const standing = await readOpen(ctx, task)
    // Without an id the same words are the same question: the one open, or one the App answered
    // that the agent has not heard yet.
    const named =
      given.id !== undefined
        ? parsed.data.id
        : (history.findLast((a) => a.delivered === false && a.question === parsed.data.question)
            ?.id ?? (standing?.question === parsed.data.question ? standing.id : parsed.data.id))
    // A new review needs a new answer, even when the agent reuses its question id and words.
    const { id: scoped, gateId } = await questionScope(ctx, task, parsed.data, named)
    // An id used again for another question, once its first answer was heard, names a new one.
    const reused = history.findLast((a) => a.id === scoped)
    const id =
      reused !== undefined && reused.delivered !== false && reused.question !== parsed.data.question
        ? `${scoped}-${parsed.data.number}`
        : scoped
    const done = history.findLast((a) => a.id === id)
    if (done !== undefined) {
      return ok({
        question:
          standing?.id === id
            ? standing
            : { ...parsed.data, id, number: done.number, asked: done.at },
        answered: done,
        replaced: false,
        fresh: false,
      })
    }
    const agent =
      extra.agent !== undefined && extra.agent !== "unknown" ? { agent: extra.agent } : {}
    // A review the person decided before the agent asked about it (the App, a typed approve) needs
    // no card: nothing is written, and the `ask` returns at once.
    const decided = await reviewDecision(ctx, task, {
      ...parsed.data,
      ...(gateId !== undefined ? { gateId } : {}),
    })
    if (decided !== null) {
      const over: Question = {
        ...parsed.data,
        id,
        ...agent,
        ...(gateId !== undefined ? { gateId } : {}),
        asked: ctx.clock.now(),
      }
      return ok({ question: over, answered: null, replaced: false, fresh: false, decided })
    }
    if (standing !== null && standing.id === id) {
      const { stopped: _stopped, ...kept } = standing
      const more = standing.more
      if (more?.taken !== undefined && more.cancelled === undefined && given.found !== undefined) {
        const found = foundOf(given.found, more.request, ctx.clock.now(), more.at)
        const {
          more: _more,
          found: _found,
          ...rest
        } = { ...kept, ...parsed.data, number: standing.number, asked: standing.asked }
        const replaced: Question = { ...rest, ...agent, ...(found !== null ? { found } : {}) }
        await writeOpen(ctx, task, replaced)
        return ok({ question: replaced, answered: null, replaced: true, fresh: false })
      }
      // A cancelled Tell me more is over: what the agent found for it is not shown.
      const { more: _more, ...withoutMore } = kept
      const again: Question = more?.cancelled !== undefined ? withoutMore : kept
      await writeOpen(ctx, task, again)
      return ok({ question: again, answered: null, replaced: false, fresh: false })
    }
    const shown: Question = {
      ...parsed.data,
      id,
      ...agent,
      ...(gateId !== undefined ? { gateId } : {}),
      asked: ctx.clock.now(),
    }
    await writeOpen(ctx, task, shown)
    return ok({ question: shown, answered: null, replaced: false, fresh: true })
  })
}

export function foundOf(
  value: unknown,
  asked: string,
  at: number,
  requestAt?: number,
): Found | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const given = value as Record<string, unknown>
  const said = text(given.text, 1200)
  if (said === undefined) return null
  return {
    asked: text(given.asked, 300) ?? asked,
    text: said,
    evidence: evidenceOf(given.evidence),
    at,
    ...(requestAt !== undefined ? { requestAt } : {}),
  }
}

/** Mark the question as brought to the front (the first after `/ql`). */
export async function markFront(ctx: Ctx, task: Runtime, id: string): Promise<void> {
  await ctx.fs.withLock(lockOf(task), async () => {
    const open = await readOpen(ctx, task)
    if (open?.id === id) await writeOpen(ctx, task, { ...open, front: true })
  })
}

/** What one `ask` hands back to the agent. */
export type AskReply =
  | {
      status: "answered"
      id: string
      number: number
      question: string
      choice: string
      words?: string
      /** What the person wrote beside the choice they picked. */
      note?: string
      kind?: AnswerKind
      /** A multi answer, or words that name options: the indices picked and their labels. */
      choices?: number[]
      labels?: string[]
      files?: Attachment[]
      files_hint?: string
    }
  | {
      status: "unsure"
      id: string
      number: number
      question: string
      recommended: string
      files?: Attachment[]
      files_hint?: string
    }
  | { status: "more"; id: string; request: string }
  | { status: "cancelled"; id: string }
  /** The review the question asks about was decided another way: nothing waits on it. */
  | { status: "decided"; id: string; gate: string; decision: GateFile["decision"] }
  | { status: "waiting"; id: string }

/** An answered question as the agent reads it. */
export function replyOf(entry: AnsweredQuestion, kinds?: QuestionChoice[]): AskReply {
  const id = entry.id ?? `q${entry.number}`
  const files = entry.files?.length ? { files: entry.files, files_hint: ANSWER_FILES_HINT } : {}
  if (entry.kind === "unsure")
    return {
      status: "unsure",
      id,
      number: entry.number,
      question: entry.question,
      recommended: entry.choice,
      ...files,
    }
  const kind = kinds?.find((c) => c.label === entry.choice)?.kind
  return {
    status: "answered",
    id,
    number: entry.number,
    question: entry.question,
    choice: entry.choice,
    ...files,
    ...(entry.words === true ? { words: entry.choice } : {}),
    ...(entry.note !== undefined ? { note: entry.note } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(entry.picked !== undefined
      ? { choices: entry.picked, labels: entry.pickedLabels ?? [] }
      : {}),
  }
}

/** How long one `ask` waits before it says `waiting` (under a 10-minute shell cap), and its beat. */
export const ASK_SLICE_MS = 8.5 * 60_000
export const HEARTBEAT_MS = 20_000

export type Heartbeat = { at: number; id: string; pid: number; waiting: boolean }

async function beat(ctx: Ctx, task: Runtime, id: string, waiting: boolean): Promise<void> {
  const heart: Heartbeat = { at: ctx.clock.now(), id, pid: process.pid, waiting }
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(heartbeatPath(task), `${JSON.stringify(heart)}\n`)
}

/** The last heartbeat of an `ask`, or null. */
export async function readHeartbeat(ctx: Ctx, task: Runtime): Promise<Heartbeat | null> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(heartbeatPath(task))) as Heartbeat
    return typeof parsed.at === "number" ? parsed : null
  } catch {
    return null
  }
}

/** Hand an answered question to the agent once: it is delivered from now on. */
async function deliver(ctx: Ctx, task: Runtime, entry: AnsweredQuestion): Promise<void> {
  if (entry.delivered !== false) return
  await ctx.fs.withLock(lockOf(task), async () => {
    const all = await answeredQuestions(ctx, task)
    await writeAnswered(
      ctx,
      task,
      all.map((a) => (a.id === entry.id && a.at === entry.at ? { ...a, delivered: true } : a)),
    )
  })
}

/**
 * Wait for the App to answer question `id`: a choice or words (`answered`), Not sure (`unsure`),
 * Tell me more (`more`, the question stays open), the question withdrawn (`cancelled`), the
 * review it asks about decided another way (`decided`, within a poll of that decision), or the
 * slice over (`waiting`: run the same command again). The heartbeat is written at once and every
 * `beatMs` while it waits.
 */
export async function waitForAnswer(
  ctx: Ctx,
  task: Runtime,
  question: Question,
  options: { sliceMs?: number; beatMs?: number } = {},
): Promise<AskReply> {
  const { id } = question
  const slice = options.sliceMs ?? ASK_SLICE_MS
  const every = options.beatMs ?? HEARTBEAT_MS
  let lastBeat = -Infinity
  const done = async (reply: AskReply): Promise<AskReply> => {
    await beat(ctx, task, id, false)
    return reply
  }
  return waitFor<AskReply>(
    ctx,
    { ...task, stage: "plan" },
    {
      seconds: slice / 1000,
      kinds: ["answer"],
      pending: () => ({ status: "waiting", id }),
      poll: async () => {
        const now = ctx.clock.now()
        if (now - lastBeat >= every) {
          lastBeat = now
          await beat(ctx, task, id, true)
        }
        const answered = async () =>
          (await answeredQuestions(ctx, task)).findLast((a) => a.id === id)
        let entry = await answered()
        if (entry === undefined) {
          const read = await readOpen(ctx, task)
          // A review question whose gate was decided another way (a typed approve) is over too.
          const open = read?.gate !== undefined && (await gatePassed(ctx, task, read)) ? null : read
          if (open === null || open.id !== id) {
            // An answer lands as the question file goes, and an App answer to a review decides the
            // gate a moment before it is recorded: look again once the answerer has let go of the
            // lock, before calling it withdrawn.
            entry = await ctx.fs.withLock(lockOf(task), answered)
            if (entry === undefined) {
              const decision = await reviewDecision(ctx, task, question)
              return decision !== null && question.gate !== undefined
                ? { status: "decided", id, gate: question.gate, decision }
                : { status: "cancelled", id }
            }
          } else {
            const more = open.more
            if (more !== undefined && more.taken === undefined && more.cancelled === undefined) {
              const taken = await ctx.fs.withLock(lockOf(task), async () => {
                const fresh = await readOpen(ctx, task)
                if (fresh?.id !== id || fresh.more === undefined || fresh.more.taken !== undefined)
                  return null
                await writeOpen(ctx, task, {
                  ...fresh,
                  more: { ...fresh.more, taken: ctx.clock.now() },
                })
                return fresh.more
              })
              if (taken !== null) return { status: "more", id, request: taken.request }
            }
          }
        }
        if (entry !== undefined) {
          await deliver(ctx, task, entry)
          return replyOf(entry, question.choices)
        }
        return null
      },
    },
  ).then(done)
}

/** The `ask` that waited was interrupted: the card says so, and an answer given now is kept. */
export async function markStopped(ctx: Ctx, task: Runtime, id: string): Promise<void> {
  const open = await readOpen(ctx, task)
  if (open?.id === id)
    await writeOpen(ctx, task, { ...open, stopped: { at: ctx.clock.now(), how: "interrupted" } })
  await beat(ctx, task, id, false)
}

// ---------------------------------------------------------------- the App's side

/** Tell me more from the App: the request waits for the `ask`, which hands it to the agent. */
export async function requestMore(
  ctx: Ctx,
  task: Runtime,
  id: string,
  request: string,
  expected?: Question,
): Promise<Result<Question>> {
  return ctx.fs.withLock(lockOf(task), async () => {
    const open = await openQuestion(ctx, task)
    if (open === null || open.id !== id)
      return err({ code: "bad_args", message: "that question is not the one waiting any more" })
    if (
      expected &&
      (open.asked !== expected.asked ||
        open.question !== expected.question ||
        open.found?.at !== expected.found?.at ||
        open.gateId !== expected.gateId)
    )
      return err({
        code: "bad_args",
        message: "that question changed before the request was recorded",
      })
    const updated: Question = {
      ...open,
      more: { request: request.trim().slice(0, 600), at: ctx.clock.now() },
    }
    await writeOpen(ctx, task, updated)
    return ok(updated)
  })
}

/** Reword a single question after Tell me more without republishing it as a new question. */
export async function answerSingleMore(
  ctx: Ctx,
  task: Runtime,
  id: string,
  patch: unknown,
): Promise<Result<{ id: string; question: Question }>> {
  return withQuestionLock(ctx, task, async () => {
    const q = await readOpen(ctx, task)
    const given =
      patch && typeof patch === "object" && !Array.isArray(patch)
        ? (patch as Record<string, unknown>)
        : null
    if (!q || q.id !== id || !q.more || q.more.cancelled !== undefined)
      return err({ code: "bad_args", message: "no open Tell me more request for that question" })
    if (
      !given ||
      Object.keys(given).some(
        (key) => !["question", "choices", "why", "grade", "found", "request_at"].includes(key),
      )
    )
      return err({
        code: "bad_args",
        message: "question more takes question, choices, why, grade, found and request_at",
      })
    if (given.request_at !== undefined && given.request_at !== q.more.at)
      return err({ code: "bad_args", message: "that Tell me more request changed" })
    const found = foundOf(
      given.found,
      q.more.request,
      Math.max(ctx.clock.now(), q.more.at + 1),
      q.more.at,
    )
    if (!found)
      return err({ code: "bad_args", message: "give the requested context in found.text" })
    const edits = given.choices
    if (edits !== undefined && (!Array.isArray(edits) || edits.length !== q.choices.length))
      return err({ code: "bad_args", message: "keep the same number and order of choices" })
    const choices = q.choices.map((choice, index) => {
      const edit = (edits as unknown[] | undefined)?.[index]
      return typeof edit === "string"
        ? { ...choice, label: edit }
        : edit && typeof edit === "object" && !Array.isArray(edit)
          ? { ...choice, ...edit }
          : choice
    })
    const {
      asked: _asked,
      session: _session,
      agent: _agent,
      more: _more,
      found: _found,
      stopped: _stopped,
      front: _front,
      earlier: _earlier,
      recommendedChoices: _recommended,
      ...wording
    } = q
    const parsed = parseQuestion(
      ctx,
      {
        ...wording,
        choices,
        recommended: q.recommendedChoices ?? q.recommended,
        question: given.question ?? q.question,
        why: given.why ?? q.why,
        grade: given.grade ?? q.grade,
      },
      await answeredQuestions(ctx, task),
    )
    if (!parsed.ok) return parsed
    const updated: Question = {
      ...q,
      ...parsed.data,
      found,
      earlier: [...(q.earlier ?? []), { question: q.question, choices: q.choices, at: found.at }],
    }
    delete updated.more
    await writeOpen(ctx, task, updated)
    return ok({ id, question: updated })
  })
}

/** Cancel on Tell me more: the card is back to plain waiting; what the agent finds is not shown. */
export async function cancelMore(ctx: Ctx, task: Runtime): Promise<Result<Question>> {
  return ctx.fs.withLock(lockOf(task), async () => {
    // `openQuestion` falls back to a batch's first member; that one is cancelled on its own route.
    if (
      (await readOpen(ctx, task)) === null &&
      ((await readBatch(ctx, task))?.questions.length ?? 0) > 0
    )
      return err({
        code: "bad_args",
        message:
          "this question belongs to a batch: cancel its Tell me more on the question itself (turn/cancel-more)",
      })
    const open = await openQuestion(ctx, task)
    if (open === null || open.more === undefined || open.more.cancelled !== undefined)
      return err({ code: "bad_args", message: "nothing is being looked into for this question" })
    const updated: Question = { ...open, more: { ...open.more, cancelled: ctx.clock.now() } }
    await writeOpen(ctx, task, updated)
    return ok(updated)
  })
}

/** A line the agent writes while it looks into Tell me more; the card shows the last two. */
export async function moreProgress(ctx: Ctx, task: Runtime, line: string): Promise<boolean> {
  return ctx.fs.withLock(lockOf(task), async () => {
    const open = await openQuestion(ctx, task)
    if (open?.more === undefined || open.more.cancelled !== undefined) return false
    const lines = [...(open.more.lines ?? []), line.trim().slice(0, 200)].slice(-4)
    await writeOpen(ctx, task, { ...open, more: { ...open.more, lines } })
    return true
  })
}

/** What Change on a receipt sends: one choice, the whole set of picks of a several-answer question, or words. */
export type AnswerChange = { number: number; choice?: number; choices?: number[]; text?: string }

/**
 * Change on a receipt: the person corrects an answer they gave. The agent hears of it in its next
 * reply (`changed_answers`) and rewrites *Decided with you*. A gate's question is decided on the
 * gate, so it is not changed here. On a several-answer question `choices` is the whole set that
 * replaces the stored picks, and `text` adds one more pick in the person's own words; on a
 * one-answer question the words replace the choice.
 */
export async function changeAnswer(
  ctx: Ctx,
  task: Runtime,
  input: AnswerChange,
): Promise<Result<AnsweredQuestion>> {
  return ctx.fs.withLock(lockOf(task), async () => {
    const all = await answeredQuestions(ctx, task)
    const index = all.findLastIndex((a) => a.number === input.number)
    const entry = all[index]
    if (entry === undefined)
      return err({ code: "bad_args", message: `question ${input.number} has no answer to change` })
    if (entry.gate !== undefined)
      return err({
        code: "bad_args",
        message: "a review question is changed on its item, not here",
      })
    const labels = entry.choices ?? []
    const own = text(input.text, 2000)
    const asked = input.choices ?? (input.choice !== undefined ? [input.choice] : undefined)
    let next: Pick<AnsweredQuestion, "choice" | "words" | "picked" | "pickedLabels" | "note">
    if (entry.multi === true && (asked !== undefined || own !== undefined)) {
      const picks = [...(asked ?? [])].sort((a, b) => a - b)
      if (
        new Set(picks).size !== picks.length ||
        picks.some((i) => !Number.isInteger(i) || labels[i] === undefined) ||
        (picks.length === 0 && own === undefined)
      )
        return err({ code: "bad_args", message: "pick at least one choice, each at most once" })
      const chosen = picks.map((i) => labels[i] ?? "")
      if (picks.length > 0) {
        next = {
          choice: [...chosen, ...(own !== undefined ? [own] : [])].join(" + "),
          picked: picks,
          pickedLabels: chosen,
          ...(own !== undefined ? { note: own } : {}),
        }
      } else {
        // Words alone: the answer is the words, with the options they clearly name beside them.
        const named = matchOptions(
          own ?? "",
          labels.map((label) => ({ label })),
        )
        next = {
          choice: own ?? "",
          words: true,
          ...(named !== null
            ? { picked: named, pickedLabels: named.map((i) => labels[i] ?? "") }
            : {}),
        }
      }
    } else {
      if (input.choices !== undefined)
        return err({ code: "bad_args", message: "this question takes one choice, not several" })
      const label = input.choice !== undefined ? labels[input.choice] : own
      if (label === undefined)
        return err({ code: "bad_args", message: "expected { number, choice | choices | text }" })
      next = { choice: label, ...(labels.includes(label) ? {} : { words: true as const }) }
    }
    if (
      next.choice === entry.choice &&
      JSON.stringify(next.picked) === JSON.stringify(entry.picked) &&
      next.note === entry.note
    )
      return ok(entry)
    const {
      kind: _kind,
      words: _words,
      picked: _picked,
      pickedLabels: _pickedLabels,
      note: _note,
      ...rest
    } = entry
    const changed: AnsweredQuestion = {
      ...rest,
      ...next,
      changed: { at: ctx.clock.now(), was: entry.changed?.was ?? entry.choice, delivered: false },
    }
    // A correction made before the agent heard the answer is simply the answer.
    const final: AnsweredQuestion =
      entry.delivered === false ? (({ changed: _c, ...plain }) => plain)(changed) : changed
    await writeAnswered(
      ctx,
      task,
      all.map((a, i) => (i === index ? final : a)),
    )
    return ok(final)
  })
}

/** What the agent has not heard yet: App answers given while no `ask` waited, and corrections. */
export type Meanwhile = {
  answered_meanwhile?: AskReply[]
  changed_answers?: { id?: string; number: number; question: string; was: string; now: string }[]
}

/** Hand the agent what it has not heard yet, once. */
export async function takeMeanwhile(
  ctx: Ctx,
  task: Runtime,
  members?: ReadonlySet<string>,
): Promise<Meanwhile> {
  return ctx.fs.withLock(lockOf(task), async () => {
    const all = await answeredQuestions(ctx, task)
    const selected = (answer: AnsweredQuestion) =>
      members === undefined || (answer.id !== undefined && members.has(answer.id))
    const fresh = all.filter((a) => selected(a) && a.delivered === false && !a.reopened)
    const changed = all.filter(
      (a) => selected(a) && a.changed !== undefined && a.changed.delivered === false,
    )
    if (fresh.length === 0 && changed.length === 0) return {}
    await writeAnswered(
      ctx,
      task,
      all.map((a) =>
        selected(a)
          ? {
              ...a,
              ...(a.delivered === false ? { delivered: true, pickedAt: ctx.clock.now() } : {}),
              ...(a.changed !== undefined ? { changed: { ...a.changed, delivered: true } } : {}),
            }
          : a,
      ),
    )
    return {
      ...(fresh.length > 0 ? { answered_meanwhile: fresh.map((a) => replyOf(a)) } : {}),
      ...(changed.length > 0
        ? {
            changed_answers: changed.map((a) => ({
              ...(a.reopened ? { id: a.id } : {}),
              number: a.number,
              question: a.question,
              was: a.changed?.was ?? "",
              now: a.choice,
            })),
          }
        : {}),
    }
  })
}

/** Reopen exactly the version the person undid; pickup turns Undo into an explicit correction. */
export async function reopenAnswer(
  ctx: Ctx,
  task: Runtime,
  id: string,
  at: number,
): Promise<Result<AnsweredQuestion>> {
  return ctx.fs.withLock(lockOf(task), async () => {
    const all = await answeredQuestions(ctx, task)
    const entry = all.findLast((a) => a.id === id)
    if (entry === undefined || entry.at !== at || entry.reopened)
      return err({ code: "bad_args", message: "that answer has changed since you saw it" })
    const reopened: AnsweredQuestion = {
      ...entry,
      reopened: true,
      ...(entry.delivered === true
        ? {
            changed: { at: ctx.clock.now(), was: entry.choice, delivered: false },
            choice: "(answer withdrawn; question reopened)",
          }
        : {}),
    }
    await writeAnswered(
      ctx,
      task,
      all.map((a) => (a === entry ? reopened : a)),
    )
    return ok(reopened)
  })
}
