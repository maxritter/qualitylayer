// The state a step page draws its live parts from, as plain data: what each marked section shows,
// what needs the person and where it sits, worked out from the task the server sends. The App builds
// it live; the share link builds the same from its copy of the task, in snapshot mode, which leaves
// out everything the agent keeps for itself (task cards, records) and every artifact but its picture.
// Pure: no DOM, no fetch.

import { marked } from "marked"
import { referenceName } from "../../core/artifact/reference.ts"
import { type Decision, decisionsOf } from "../../core/docs/build-decisions.ts"
import { withoutMarkerText } from "../../core/docs/markers.ts"
import { agentFileOf } from "../../core/docs/names.ts"
import type { FlowStepId } from "../../core/flow.ts"
import { shellStatus } from "../../core/interaction-shell/status.ts"
import { pointProof } from "../../core/interaction-steps/proof.ts"
import {
  type AnswerKind,
  answerLabel,
  flattenItems,
  type Item,
  type ItemAnswer,
  type ItemKind,
  mainAction,
} from "../../core/items.ts"
import type { Need } from "../../core/need/need.ts"
import type { AnsweredQuestion } from "../../core/task/question.ts"
import type { TimelineSlice } from "../../core/timeline.ts"
import type { PointProof } from "../../interaction/contracts.ts"
import planSchema from "../../workflow/schemas/plan.json" with { type: "json" }
import type { TaskDetail } from "../api.ts"
import { type RowState, rowState } from "../kit/ItemRow.tsx"
import { shortNeed } from "../live-status.ts"
import { agentInfo, inReview, pendingGate, reviewGate } from "../model.ts"
import { stepIsWorking } from "../steps/readiness.ts"
import {
  artifactFile,
  artifactItem,
  checkItems,
  decisionItem,
  donePointItems,
  madeForYouItems,
  type StepDocument,
} from "./document.ts"
import { quotedRequest } from "./request-text.ts"

export type Mode = "live" | "snapshot" | "plain"

export type Choice = { kind: AnswerKind; label: string }

/** One thing a person answers, drawn where the document states it. */
export type ItemCard = {
  id: string
  kind: ItemKind
  kindLabel: string
  /** A proposal read with its document, rather than a separately required human choice. */
  documentary?: true
  /** A Your call: two options, the recommended one, and the artifact it is about. */
  call?: NonNullable<Item["call"]>
  what: string
  changedFrom?: string
  why?: string
  state: RowState
  /** The answer picked here, or given: what the row says it was. */
  answer?: Choice & Pick<ItemAnswer, "note">
  /** The buttons while it is open. */
  options: Choice[]
  /** A quiet link beside them (Ask why, Change). */
  link?: Choice
  /** Comments open on it. */
  pins: number
  /** A picture that shows it: the file under evidence/. */
  picture?: { name: string; caption: string }
  /** What the agent wrote back once it was sent. */
  reply?: string
  /** The DOM id the Needs-you index jumps to. */
  target: string
}

/** One entry of the Needs-you index at the top of the step. */
export type NeedEntry = { label: string; side?: string; target: string }

export type NeedsIndex = {
  entries: NeedEntry[]
  /** What follows the entries: "then Approve", or "2 settled". */
  end?: { lead?: string; label: string; target?: string }
}

export type DecidedRow = {
  number?: number
  question: string
  answer: string
  /** The question is asked now: its answer is still to come. */
  waiting?: true
  /** The answered question, so Change can offer its choices again. */
  answered?: AnsweredQuestion
}

/** What was decided with the agent: the Done means points, the questions asked and your answers. */
export type DecidedView = {
  points: (ItemCard & { n: number })[]
  decided: DecidedRow[]
  /** How many questions were answered so far. */
  answered: number
}

export type ArtifactView = {
  name: string
  title: string
  /** The file the App loads today. Absent in snapshot mode: the share link shows a picture only. */
  file?: string
  /** "Is this what you expect?": the look the Plan asks for. */
  look?: ItemCard
}

export type ApproveRow = {
  id: string
  label: string
  answer?: string
  open: boolean
  target: string
}

export type ApproveView = {
  /** open: the gate waits for you. writing: the agent has not opened it. decided: it is behind you. */
  phase: "open" | "writing" | "decided"
  rows: ApproveRow[]
  answered: number
  main: { kind: "approve" | "changes"; label: string; changes: number }
  /** Why Approve is locked now; null when it is not. */
  locked: string | null
  /** Approve waits while the planner folds a late answer in: when the person sent it. */
  folding?: number
  decided?: { decision: string; at?: number }
  /** What the agent changed in the Plan after the approval, one line per `plan amend`, oldest first. */
  amends: PlanAmend[]
}

export type PlanAmend = { at: number; note: string }

/**
 * The agent's amendments that changed the Plan (from the task's events), for "what changed after
 * your approval". An amendment of the build alone, or one the person agreed to themselves, is not
 * a change they did not see.
 */
export function planAmendsOf(events: readonly Record<string, unknown>[] | undefined): PlanAmend[] {
  const out: PlanAmend[] = []
  for (const e of events ?? []) {
    if (e.event !== "plan_amended" || e.by !== "agent") continue
    const changed = Array.isArray(e.changed) ? e.changed : []
    if (!changed.some((name) => typeof name === "string" && name.endsWith("plan.md"))) continue
    if (typeof e.note !== "string" || e.note.trim() === "" || typeof e.ts !== "number") continue
    out.push({ at: e.ts, note: e.note.trim() })
  }
  return out.toSorted((a, b) => a.at - b.at)
}

export type PlanView = {
  artifacts: Record<string, ArtifactView>
  decisions: Record<string, ItemCard & { n: number }>
  /** The decisions that ask something of the person: the Your calls. */
  asking: Record<string, ItemCard & { n: number }>
  decisionCount: number
  madeForYou: ItemCard[]
  slices: { n: number; title: string; tasks: number }[]
  tasks: number
  /** Each slice's task cards, by slice: in the App only, never on the share link. */
  cards?: Record<number, TaskCard[]>
  /** Where each slice's cards are: in the App only. */
  cardsAt?: Record<number, CardsPlace>
  approve: ApproveView
}

/** Where a slice's task cards are in the agent's records: the file, and the place in it in words. */
export type CardsPlace = { path: string; place: string }

export type TaskCard = {
  id: string
  title: string
  state: "done" | "building" | "stopped" | "next"
  /** A bug's card role from the agents' file: `reproduce` or `fix`. */
  role?: string
  /** The agents' card: its objective, whose first sentence is the task's detail. */
  objective?: string
  files: string[]
  testFirst?: string
  /** The Done when lines, the verify command last. */
  dod: string[]
  /** What the builder reports on the task now, while it is built. */
  line?: string
}

/** A slice of the build as the Implement page draws it. */
export type BoardSlice = {
  n: number
  title: string
  summary: string
  status: "done" | "run" | "progress" | "wait"
  /** One segment per task: done, in work, or waiting. */
  segs: ("d" | "r" | "")[]
  tasks: number
  /** The agent's task cards for this slice: in the App only, never on the share link. */
  cards?: TaskCard[]
}

/** Where a slice's task cards are: the Implement agents' file, by slice. */
function cardsPlace(slice: number): CardsPlace {
  const path = agentFileOf("implement")
  return { path, place: `${path} › Slice ${slice}` }
}

export type NeedView = {
  slice: number
  /** What only the person can provide (`qualitylayer need`), drawn by the need card. */
  need?: Need
  /** The task that waits for it, by its title in the Plan. */
  taskTitle: string | null
  /** Everything else is built: the next step after this one is Verify. */
  last: boolean
  /** In a few words, for the index: "Stripe test key". */
  short: string
  target: string
}

/** A raw record, shown read-only in a drawer from the spot it explains. */
export type RecordView = {
  title: string
  /** Where it is, in words: the file, and the section in it (`agents/02-implement.md › Slice 3`). */
  place: string
  /** The file in the task folder, for Copy path and Open in editor. */
  path: string
  /** The text file under evidence/ to read and show; absent when the state holds it all. */
  evidence?: string
  facts?: { label: string; value: string }[]
  lines?: string[]
}

export type DecisionLine = { where: string; text: string; sub?: string; id: string }

/** A task whose check fails while the agent fixes it. */
export type FailingTask = { id: string; command: string }

export type ImplementView = {
  slices: BoardSlice[]
  /** The task the build session reports on now. */
  now?: { id: string; title: string }
  /** The checks that fail now, one chip. */
  failing: FailingTask[]
  /** The build's amendments, each stated once, the ones it replaced under it. */
  decisions: Decision[]
}

export type ProofRow = {
  n: number
  text: string
  state: "passed" | "failed" | "running" | "waiting" | "user"
  sentence?: string
  picture?: { name: string; caption: string }
  record?: RecordView
}

export type VerifyView = {
  /** A need raised while checking, or the stop after two rounds: first among the open items. */
  needs: NeedView[]
  openItems: ItemCard[]
  proof: { passed: number; total: number; round: number; who?: string; rows: ProofRow[] }
  checked: string[]
}

export type ShipView = {
  phase: "open" | "writing" | "decided" | "shipped"
}

/** The person's review of the change: Verify turned to them, or the task shipped. */
export type ReviewView = {
  needs?: NeedView[]
  open?: ItemCard[]
  madeForYou: DecisionLine[]
  settled: ItemCard[]
  checked: string[]
  rounds: number
  ship: ShipView
}

export type StepState = {
  working?: boolean
  /** Only the recorded request and empty scaffold exist; no process activity is implied. */
  preparing?: { request: string }
  pointProof?: PointProof[]
  step: FlowStepId
  mode: Mode
  /** The task's title: a document's first heading that repeats it is the page's header already. */
  title: string
  agent: string
  /** The moment the state was taken: the share link says "As of" it. */
  at: number
  needs: NeedsIndex
  /** Counts and context beside the document's own headings. */
  headings: Record<string, { count?: string; side?: string; target?: string }>
  closed: boolean
  /** The task's agent runs in the terminal: it asks and decides there, so the page only reads. */
  outside?: true
  decided?: DecidedView
  plan?: PlanView
  implement?: ImplementView
  verify?: VerifyView
  review?: ReviewView
}

/** The DOM id a jump lands on for an item or a part. */
export const jumpId = (id: string): string => `sp-${id.replace(/[^a-z0-9]+/gi, "-")}`

const say = (kind: AnswerKind, item: Item): Choice => ({
  kind,
  label: answerLabel(kind, item.family, item.answers.labels),
})

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const clip = (text: string, at: number) =>
  text.length > at ? `${text.slice(0, at - 1).trimEnd()}…` : text

/** One item as its card draws it: its state with the answer picked here laid over the server's. */
export function cardOf(
  item: Item,
  answers: Readonly<Record<string, ItemAnswer>>,
  comments: TaskDetail["comments"],
  override: { options?: AnswerKind[]; link?: AnswerKind | null } = {},
): ItemCard {
  const picked = answers[item.id] ?? (item.state === "chosen" ? item.answer : undefined)
  const state = rowState(item, picked)
  const given = picked ?? (state === "sent" || state === "settled" ? item.answer : undefined)
  const options = (override.options ?? item.answers.options).slice(0, 2)
  const link = override.link === null ? undefined : (override.link ?? item.answers.link)
  const media = item.media
  return {
    id: item.id,
    kind: item.kind,
    kindLabel: item.kindLabel,
    ...(item.uncounted ? { documentary: true as const } : {}),
    ...(item.call !== undefined ? { call: item.call } : {}),
    what: item.what,
    ...(item.changedFrom !== undefined ? { changedFrom: item.changedFrom } : {}),
    ...(item.why !== undefined ? { why: item.why } : {}),
    state,
    ...(given !== undefined
      ? {
          answer: {
            ...say(given.kind, item),
            ...(given.note !== undefined ? { note: given.note } : {}),
          },
        }
      : {}),
    options: options.map((kind) => say(kind, item)),
    ...(link !== undefined ? { link: say(link, item) } : {}),
    pins: comments.filter((c) => c.item === item.id && c.kind === undefined && c.delivered !== true)
      .length,
    ...(media?.kind === "screenshot"
      ? { picture: { name: media.name, caption: media.caption ?? "" } }
      : {}),
    ...(item.reply !== undefined ? { reply: item.reply.text } : {}),
    target: jumpId(item.id),
  }
}

const waiting = (card: Pick<ItemCard, "state">) => card.state === "open"

// ---------------------------------------------------------------- What was decided

function decidedView(task: TaskDetail, answers: Readonly<Record<string, ItemAnswer>>): DecidedView {
  const points = donePointItems(task.items ?? []).map((item, index) => ({
    ...cardOf(item, answers, task.comments, {
      options: [],
      link: null,
    }),
    documentary: true as const,
    n: index + 1,
  }))
  const answered = task.answeredQuestions ?? []
  const asked = task.question
  const rows: DecidedRow[] = [
    ...(asked != null
      ? [{ number: asked.number, question: asked.question, answer: "", waiting: true as const }]
      : []),
    ...[...answered]
      .sort((a, b) => b.number - a.number)
      .map((a) => ({ number: a.number, question: a.question, answer: a.choice, answered: a })),
  ]
  // A task whose questions were answered before the App kept them: the document's own rows.
  const fromDoc = (task.parts?.plan?.decided ?? []).filter(
    (row) => !rows.some((r) => r.question === row.what),
  )
  return {
    points,
    decided: [...rows, ...fromDoc.map((row) => ({ question: row.what, answer: row.answer }))],
    answered: answered.length,
  }
}

// ---------------------------------------------------------------- Plan

function planView(
  task: TaskDetail,
  doc: StepDocument | null,
  answers: Readonly<Record<string, ItemAnswer>>,
  mode: Mode,
): PlanView {
  const items = task.items ?? []
  const markers = doc?.markers ?? []
  const artifacts: Record<string, ArtifactView> = {}
  for (const m of markers.filter((m) => m.name === "artifact")) {
    const name = m.args[0] ?? ""
    const item = artifactItem(items, name)
    const title =
      (item?.media?.kind === "artifact" ? item.media.title : undefined) ?? referenceName(name)
    artifacts[name] = {
      name,
      title,
      ...(mode === "live" ? { file: artifactFile(name, item) } : {}),
      ...(item !== undefined ? { look: cardOf(item, answers, task.comments, { link: null }) } : {}),
    }
  }
  const decisions: PlanView["decisions"] = {}
  let n = 0
  for (const m of markers.filter((m) => m.name === "decide")) {
    const id = m.args[0] ?? ""
    const item = decisionItem(items, id)
    n++
    if (item === undefined) continue
    decisions[id] = {
      ...cardOf(item, answers, task.comments, { options: ["agree", "change"], link: "ask-why" }),
      n,
    }
  }
  // A decision is documented; only a Your call asks the person for an answer.
  const asking = Object.fromEntries(
    Object.entries(decisions).filter(([, d]) => d.call !== undefined),
  )
  const madeForYou = madeForYouItems(items).map((item) =>
    cardOf(item, answers, task.comments, { options: [], link: "ask-why" }),
  )
  const slices = task.slices.map((s) => ({ n: s.n, title: s.title, tasks: s.tasks.length }))
  return {
    artifacts,
    decisions,
    asking,
    decisionCount: n,
    madeForYou,
    slices,
    tasks: slices.reduce((sum, s) => sum + s.tasks, 0),
    ...(mode === "live" && task.timeline !== null
      ? {
          cards: Object.fromEntries(
            task.timeline.slices.map((s) => [
              s.n,
              cardsOf(s, task.timeline?.builder?.task ?? null, false),
            ]),
          ),
          cardsAt: Object.fromEntries(slices.map((s) => [s.n, cardsPlace(s.n)])),
        }
      : {}),
    approve: approveView(task, artifacts, asking, answers),
  }
}

/** A decision's title in a few words, for the approval's summary row. */
const shortTitle = (what: string) => clip(what.replace(/[.?]$/, ""), 44)

function approveView(
  task: TaskDetail,
  artifacts: Record<string, ArtifactView>,
  decisions: PlanView["decisions"],
  answers: Readonly<Record<string, ItemAnswer>>,
): ApproveView {
  const rows: ApproveRow[] = [
    ...Object.values(decisions).map((d) => ({
      id: d.id,
      label:
        d.call !== undefined
          ? `Your call · ${shortTitle(d.what)}`
          : `Decision ${d.n} · ${shortTitle(d.what)}`,
      ...(d.answer !== undefined ? { answer: d.answer.label } : {}),
      open: waiting(d),
      target: d.target,
    })),
    ...Object.values(artifacts).flatMap((d) =>
      d.look !== undefined
        ? [
            {
              id: d.look.id,
              label: `The artifact · ${d.title}`,
              ...(d.look.answer !== undefined ? { answer: d.look.answer.label } : {}),
              open: waiting(d.look),
              target: jumpId(`artifact-${d.name}`),
            },
          ]
        : [],
    ),
  ]
  const planItems = flattenItems(task.items ?? []).filter((i) => i.step === "plan")
  const main = mainAction(planItems, answers)
  const gate = reviewGate(task)
  const open = pendingGate(task)?.endsWith("plan.md") === true
  const decided = gate?.target.endsWith("plan.md") === true && gate.decision !== "pending"
  const approved = task.stage !== "plan"
  return {
    phase: open ? "open" : decided || approved ? "decided" : "writing",
    rows,
    answered: rows.filter((r) => !r.open).length,
    main: { kind: main.kind, label: main.label, changes: main.changes },
    locked: open ? (gate?.locked ?? null) : null,
    ...(open && gate?.locked && gate.folding !== undefined ? { folding: gate.folding } : {}),
    amends: decided || approved ? planAmendsOf(task.events) : [],
    ...(decided || approved
      ? {
          decided: {
            decision: decided ? (gate?.decision ?? "approved") : "approved",
            ...(gate?.decided !== undefined ? { at: gate.decided } : {}),
          },
        }
      : {}),
  }
}

// ---------------------------------------------------------------- Implement

/** A slice's task cards as the page draws them: the agents' card of each task, with the builder's line on the one in work. */
export function cardsOf(
  slice: TimelineSlice,
  building: string | null,
  halted: boolean,
  line?: string,
): TaskCard[] {
  return slice.tasks.map((t) => {
    const state: TaskCard["state"] = t.checked
      ? "done"
      : t.id === building
        ? halted
          ? "stopped"
          : "building"
        : "next"
    const done = [...t.dod, ...(t.proof !== null ? [`verify: \`${t.proof}\``] : [])]
    return {
      id: t.id,
      title: t.title,
      state,
      ...(t.role !== undefined ? { role: t.role } : {}),
      ...(t.objective !== "" ? { objective: t.objective } : {}),
      files: t.files.map((f) => f.path),
      ...(t.testFirst !== null ? { testFirst: t.testFirst.text } : {}),
      dod: done,
      ...(state === "building" && line !== undefined && line !== "" ? { line } : {}),
    }
  })
}

/**
 * What the build waits on the person for, each under the slice it blocks: the needs the agent
 * raised (what only the person can provide).
 */
export function buildNeeds(task: TaskDetail): NeedView[] {
  const slices = task.timeline?.slices ?? []
  const sliceOf = (id: string) =>
    slices.find((s) => s.tasks.some((t) => t.id.toUpperCase() === id.toUpperCase()))
  const out: NeedView[] = []
  for (const need of (task.live?.needs ?? []).filter((n) => n.state !== "resolved")) {
    const slice = sliceOf(need.for)
    out.push({
      slice: slice?.n ?? 0,
      need,
      taskTitle:
        slice?.tasks.find((t) => t.id.toUpperCase() === need.for.toUpperCase())?.title ?? null,
      last: slices.every((s) =>
        s.tasks.every((t) => t.checked || t.id.toUpperCase() === need.for.toUpperCase()),
      ),
      short: shortNeed(need.what),
      // The need card's own id: the header's pill jumps there too.
      target: `need-${need.for}`,
    })
  }
  return out
}

function implementView(task: TaskDetail, mode: Mode, now: number): ImplementView | undefined {
  const timeline = task.timeline
  if (timeline === null) return undefined
  const live = mode === "live"
  const reported = timeline.builder?.task ?? null
  const done = (s: TimelineSlice) => s.tasks.length > 0 && s.tasks.every((t) => t.checked)
  // The working ring means the agent works: a stopped or waiting session, or a build not yet started,
  // is not running however the stage reads.
  const session = shellStatus(task, now).state
  const idle = session === "stopped" || session === "waits-for-you" || session === "step-done"

  const slices: BoardSlice[] = timeline.slices.map((s) => {
    const runningTask =
      reported !== null && s.tasks.some((t) => t.id === reported && !t.checked) ? reported : null
    const status: BoardSlice["status"] = done(s)
      ? "done"
      : runningTask !== null
        ? "run"
        : s.tasks.some((t) => t.checked)
          ? "progress"
          : "wait"
    const halted = status === "run" && idle
    return {
      n: s.n,
      title: s.title,
      summary: s.summary,
      status,
      segs: s.tasks.map((t) => (t.checked ? "d" : t.id === runningTask && !halted ? "r" : "")),
      tasks: s.tasks.length,
      ...(live ? { cards: cardsOf(s, runningTask, halted, timeline.builder?.line) } : {}),
    }
  })

  const working = idle ? null : reported
  const card = timeline.slices.flatMap((s) => s.tasks).find((t) => t.id === working && !t.checked)
  // A check of a task that failed and has not run green since: the agent fixes it.
  // Only each scope's latest run counts: a later run replaces the earlier one whole.
  const progress = task.checkProgress ?? []
  const lastRun = new Map<string, string>()
  for (const p of [...progress].sort((a, b) => a.started - b.started)) lastRun.set(p.scope, p.check)
  const failing: FailingTask[] = progress
    .filter((p) => lastRun.get(p.scope) === p.check)
    .filter((p) => !p.running && p.queued !== true && p.exit != null && p.exit !== 0)
    .map((p) => ({ id: p.scope, command: p.command }))

  return {
    slices,
    ...(card !== undefined ? { now: { id: card.id, title: card.title } } : {}),
    failing,
    // The amendments, each once, and the ones the person agreed to, in the order they were made.
    decisions: [
      ...decisionsOf(timeline.notes),
      ...timeline.notes.filter((n) => n.kind === "agreed").map((note) => ({ note, replaced: [] })),
    ].sort((a, b) => a.note.line - b.note.line),
  }
}

// ---------------------------------------------------------------- Verify

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

function verifyView(
  task: TaskDetail,
  answers: Readonly<Record<string, ItemAnswer>>,
  mode: Mode,
): VerifyView {
  const items = checkItems(task.items ?? [])
  const openItems = items
    .filter((i) => i.state !== "settled")
    .map((item) => cardOf(item, answers, task.comments))
  const list = task.checklist
  const rows: ProofRow[] = (list?.groups.find((g) => g.id === "done")?.rows ?? []).map(
    (row, index) => {
      const n = Number(/:(\d+)$/.exec(row.id)?.[1] ?? index + 1)
      const evidence = row.evidence
      const picture = evidence !== undefined && IMAGE.test(evidence)
      const title = `The record · Done means ${n}`
      // A point proved by a text file opens it in the drawer; a picture shows in the row.
      const record: RecordView | undefined =
        !picture && evidence !== undefined
          ? { title, place: `evidence/${evidence}`, path: `evidence/${evidence}`, evidence }
          : undefined
      return {
        n,
        text: row.label,
        state: row.state,
        ...(row.text !== undefined ? { sentence: row.text } : {}),
        ...(picture && evidence !== undefined
          ? { picture: { name: evidence, caption: row.label } }
          : {}),
        ...(record !== undefined && mode === "live"
          ? {
              record: {
                ...record,
                facts: [
                  { label: "Result", value: row.state },
                  ...(row.who !== undefined ? [{ label: "Checked by", value: row.who }] : []),
                ],
              },
            }
          : {}),
      }
    },
  )
  return {
    needs: buildNeeds(task),
    openItems,
    proof: {
      passed: rows.filter((r) => r.state === "passed").length,
      total: rows.length,
      round: list?.rounds ?? 0,
      ...(list?.now[0] !== undefined ? { who: list.now[0].who } : {}),
      rows,
    },
    checked: checkedFacts(task),
  }
}

/** The quality pass and the reviews in one line each: "security review: nothing severe". */
function checkedFacts(task: TaskDetail): string[] {
  const facts: string[] = []
  for (const row of task.quality) {
    if (row.state === "off" || row.result === undefined) continue
    const result = row.result.replace(/\.$/, "")
    const lower = result.charAt(0).toLowerCase() + result.slice(1)
    facts.push(row.step === "security" ? `security review: ${lower}` : `${row.step}: ${lower}`)
  }
  return facts
}

// ---------------------------------------------------------------- Review

function reviewView(task: TaskDetail, answers: Readonly<Record<string, ItemAnswer>>): ReviewView {
  const left = (task.answeredQuestions ?? []).filter((a) => a.kind === "unsure")
  const timeline = task.timeline
  const sliceOfTask = (id: string | null) =>
    id === null ? null : (timeline?.slices.find((s) => s.tasks.some((t) => t.id === id))?.n ?? null)
  const madeForYou: DecisionLine[] = [
    ...left.map((a) => ({
      where: "Plan",
      text: `${a.question.replace(/\?$/, "")}: ${a.choice}`,
      id: `q${a.number}`,
    })),
    ...madeForYouItems(task.items ?? []).map((item) => ({
      where: "Plan",
      text: item.what,
      id: item.id,
    })),
    ...(timeline?.notes ?? [])
      .filter((n) => n.kind === "tactical")
      .map((note, index) => {
        const slice = sliceOfTask(note.task)
        return {
          where: slice !== null ? `slice ${slice}` : "the Plan",
          text: note.text,
          id: `${note.task ?? "Plan"}-${index}`,
        }
      }),
  ]
  const settled = checkItems(task.items ?? [])
    .filter((i) => i.state === "settled" || answers[i.id] !== undefined)
    .map((item) => cardOf(item, answers, task.comments, { link: "revisit" }))
  const list = task.checklist
  const done = list?.groups.find((g) => g.id === "done")?.rows ?? []
  const passed = done.filter((r) => r.state === "passed").length
  const checked = [
    ...(done.length > 0 ? [`${passed} of ${done.length} points of Done means passed`] : []),
    ...checkedFacts(task).filter((f) => f.startsWith("security")),
    ...(list !== undefined && list !== null && list.rounds > 0
      ? [plural(list.rounds, "round")]
      : []),
  ]
  const gate = reviewGate(task)
  const open = pendingGate(task) === "final"
  const shipped = task.stage === "shipped"
  const reviewItems = flattenItems(task.items ?? []).filter((i) => i.step === "verify")
  return {
    madeForYou,
    needs: buildNeeds(task),
    open: reviewItems
      .filter((item) => item.state !== "settled" && answers[item.id] === undefined)
      .map((item) => cardOf(item, answers, task.comments)),
    settled,
    checked,
    rounds: list?.rounds ?? 0,
    ship: {
      phase: shipped ? "shipped" : open ? "open" : gate?.target === "final" ? "decided" : "writing",
    },
  }
}

// ---------------------------------------------------------------- the index and the headings

function needsOf(state: Omit<StepState, "needs" | "headings">): NeedsIndex {
  if (state.mode === "plain" || state.closed) return { entries: [] }
  const entries: NeedEntry[] = []
  // The questions belong to Your turn. Their history has no question target to jump to.
  if (state.plan !== undefined) {
    const approving = state.plan.approve.phase === "open"
    for (const artifact of Object.values(state.plan.artifacts))
      if (artifact.look !== undefined && waiting(artifact.look) && approving)
        entries.push({ label: "The artifact", target: jumpId(`artifact-${artifact.name}`) })
    for (const decision of Object.values(state.plan.asking ?? state.plan.decisions))
      if (waiting(decision) && approving)
        entries.push({
          label: decision.call !== undefined ? "Your call" : `Decision ${decision.n}`,
          target: decision.target,
        })
    if (approving)
      return {
        entries,
        end:
          entries.length > 0
            ? { lead: "then", label: "Approve", target: jumpId("approve") }
            : { label: "Approve the Plan", target: jumpId("approve") },
      }
  }
  for (const need of state.verify?.needs ?? [])
    entries.push({
      label: need.short,
      ...(need.slice > 0 ? { side: `slice ${need.slice}` } : {}),
      target: need.target,
    })
  if (state.verify !== undefined)
    for (const card of state.verify.openItems.filter(waiting))
      entries.push({ label: card.kindLabel, target: card.target })
  return { entries }
}

/**
 * The words the parts add to the document's own headings. Keyed by the heading's text as the
 * document writes it; a heading the part names itself ("Checked by agents") is left out.
 */
function headingsOf(state: Omit<StepState, "needs" | "headings">): StepState["headings"] {
  const h: StepState["headings"] = {}
  if (state.decided !== undefined) {
    h["Done means"] = {
      target: jumpId("done-means"),
    }
    if (state.decided.answered > 0)
      h["Decided with you"] = { count: String(state.decided.answered) }
  }
  if (state.plan !== undefined) {
    if (state.plan.decisionCount > 0)
      h["Engineering decisions"] = { count: String(state.plan.decisionCount) }
    if (state.plan.madeForYou.length > 0)
      h["Decisions made for you"] = { count: String(state.plan.madeForYou.length) }
    if (state.plan.slices.length > 0)
      h["The build"] = {
        count: `${plural(state.plan.slices.length, "slice")} · ${plural(state.plan.tasks, "task")}`,
      }
  }
  if (state.verify !== undefined) {
    if (state.verify.openItems.length > 0)
      h["Open items"] = { count: String(state.verify.openItems.length) }
    h["Checked by agents"] = { side: "" }
  }
  if (state.review !== undefined) {
    if (state.review.madeForYou.length > 0)
      h["Decisions made for you"] = { count: String(state.review.madeForYou.length) }
    if (state.review.settled.length > 0)
      h["Settled with you"] = { count: String(state.review.settled.length) }
  }
  return h
}

/** Headings a part draws with its own title: the page leaves the document's out. */
export const OWN_TITLE = new Set(["Checked by agents"])

// ---------------------------------------------------------------- the whole

const PLAN_LEAD = new Set(
  planSchema.sections
    .filter((section) => section.show === "lead")
    .map((section) => section.heading),
)

/** The initial Plan has no authored lead content; managed fallbacks and decisions are not its draft. */
export function planPreparation(
  task: TaskDetail,
  doc: StepDocument | null,
): StepState["preparing"] {
  if (
    task.stage !== "plan" ||
    task.archived ||
    doc?.step !== "plan" ||
    donePointItems(task.items ?? []).length > 0 ||
    doc.markers.some((marker) => marker.name === "artifact")
  )
    return undefined
  let section = ""
  let request = ""
  for (const token of marked.lexer(withoutMarkerText(doc.markdown))) {
    if (token.type === "space") continue
    if (token.type === "heading") {
      if (token.depth === 2) section = token.text
      continue
    }
    if (token.type === "html" && /^<!--[\s\S]*-->$/.test(token.raw.trim())) continue
    if (
      token.type === "blockquote" &&
      (section === "Problem" || section === "Your request") &&
      request === ""
    ) {
      request = task.request ?? quotedRequest(token.raw)
      continue
    }
    if (!PLAN_LEAD.has(section)) continue
    if (token.type === "paragraph" && /^Not written yet\.?$/i.test(token.text.trim())) continue
    if (token.type === "table" && token.rows.length === 0) continue
    return undefined
  }
  return { request: task.request ?? request }
}

export function stepState(
  task: TaskDetail,
  doc: StepDocument | null,
  options: {
    answers?: Readonly<Record<string, ItemAnswer>>
    mode?: Mode
    now?: number
  } = {},
): StepState {
  const step = doc?.step ?? "plan"
  const answers = options.answers ?? {}
  const mode = options.mode ?? "live"
  const now = options.now ?? Date.now()
  const base = {
    working: stepIsWorking(task, now),
    step,
    mode,
    title: task.title,
    agent: agentInfo(task.session?.agent).name,
    at: now,
    closed: task.archived || task.stage === "shipped" || task.stage === "abandoned",
    ...(mode === "live" && task.answers === "terminal" ? { outside: true as const } : {}),
    ...(mode === "live" ? { preparing: planPreparation(task, doc) } : {}),
  }
  const implement = step === "implement" ? implementView(task, mode, now) : undefined
  const parts = {
    ...base,
    ...(mode === "live" && step === "verify" ? { pointProof: pointProof(task) } : {}),
    ...(step === "plan"
      ? { decided: decidedView(task, answers), plan: planView(task, doc, answers, mode) }
      : {}),
    ...(implement !== undefined ? { implement } : {}),
    ...(step === "verify" ? { verify: verifyView(task, answers, mode) } : {}),
    ...(step === "verify" && inReview(task) ? { review: reviewView(task, answers) } : {}),
  }
  return { ...parts, needs: needsOf(parts), headings: headingsOf(parts) }
}
