// The things that need a person, as one shape for every surface. The server computes
// `TaskDetail.items[]` from the documents and state; the App draws them and never parses
// Markdown for them. The words an item and its answers wear live in this file alone, so the
// step page, the sidebar, Home and the Comments panel all say the same thing.
//
// Free of imports apart from the five steps and the document names, so the browser bundles read it
// as it is.

import { folderDoc } from "./docs/names.ts"
import type { FlowStepId } from "./flow.ts"
import type { RuntimeAttachment } from "./records/contract.ts"

/** What a person does with an item; each family has its own two answers. */
export type ItemFamily = "decide" | "look" | "confirm" | "fix" | "answer"

export type ItemKind =
  /** The agent's question, answered in Claude Code or Codex. */
  | "question"
  /** Only you can confirm: something no agent may do. */
  | "confirm"
  /** An engineering decision, with its diagram or diff. */
  | "decision"
  /** Decided by the agent, in the Plan. */
  | "decided"
  | "scope"
  | "extra-review"
  /** Done means: the points the finished change must pass. */
  | "done"
  /** Is this what you asked for. */
  | "asked"
  | "mockup"
  /** Look at the result: a screen or a picture. */
  | "result"
  | "diagram"
  /** Found while checking. */
  | "found"
  /** Decided by the agent while building. */
  | "deviation"
  /** A teammate's question or comment. */
  | "teammate"
  /** Another agent's review finding. */
  | "finding"
  /** Your own note or comment, returned with the agent's answer. */
  | "note"
  /** A change too small for a plan, handed back to the plain agent with a ready prompt. */
  | "handback"

/**
 * Every answer a person can give an item. The one list: the type, the server's check of an
 * incoming draft (`answerKind`) and the buttons' words (`ANSWER_LABEL`) all read it, so an answer
 * the page can offer is one the server keeps.
 */
export const ANSWER_KINDS = [
  "agree",
  "change",
  "confirm",
  "record",
  "accept",
  "fix",
  "fine",
  "ask-why",
  "add",
  "skip",
  "reply",
  "keep",
  /** Resolve a teammate's comment. */
  "resolve",
  /** Reopen something that was settled. */
  "revisit",
  /** Add a security or second-opinion review to the checks. */
  "add-review",
] as const

export type AnswerKind = (typeof ANSWER_KINDS)[number]

/** open: waits for you. chosen: you picked an answer, not sent yet. sent: with the agent. settled: done. */
export type ItemState = "open" | "chosen" | "sent" | "settled"

/** The thing itself, for the step pages to draw under the item. */
export type ItemMedia =
  | { kind: "wireframe"; name: string; source: string }
  | { kind: "panel"; name: string; source: string }
  | { kind: "artifact"; name: string; title?: string }
  | {
      kind: "mermaid"
      source: string
      title?: string
      diagram?: "architecture" | "sequence" | "flow"
    }
  | { kind: "diff"; title: string; where?: string; lines: string }
  | {
      kind: "screenshot"
      name: string
      caption?: string
      /** The points of Done this picture proves, from the checks that cite it. */
      proves?: { n: number; point: string }[]
      /** The other checks that cite it ("scenario 2"). */
      also?: string[]
    }
  | { kind: "text"; text: string }
  /** The agent's question as it asks it in its own window: the choices, the recommended one marked. */
  | {
      kind: "choices"
      choices: { label: string; detail?: string; recommended?: boolean }[]
      /** Questions answered so far on this task. */
      answered: number
      /** The agent it is asked in: "claude-code", "codex". */
      agent: string
    }
  /** What the person asked for, in their own words (more than a few lines open on click). */
  | { kind: "words"; text: string }
  /** A short table of label and value: When, Today, Expected, Must keep working. */
  | { kind: "facts"; rows: { label: string; value: string }[] }
  /** A prompt to copy, in a box of its own. */
  | { kind: "prompt"; text: string }

export type ItemAnswer = {
  recordAttachments?: RuntimeAttachment[]
  kind: AnswerKind
  /** What you wrote beside the answer. */
  note?: string
  at: number
  by?: string
  /** Given in the agent's own window, not in the App: the person said it in the chat. */
  via?: "chat"
  /** Safe display metadata; bytes are served through this task's bound comment. */
  files?: { name: string; type: string; size: number }[]
  attachmentComment?: string
}

export type ItemAnswers = {
  /** The one or two buttons, in order. */
  options: AnswerKind[]
  /** An optional link-style third ("Revisit", "Show"). */
  link?: AnswerKind
  /** Words for this item's answers where the table's do not fit ("Change the Plan", "Keep it"). */
  labels?: Partial<Record<AnswerKind, string>>
}

export type Item = {
  /** Stable across reads, so an answer finds its item again: `plan:decision:2`. */
  id: string
  step: FlowStepId
  family: ItemFamily
  kind: ItemKind
  /** The kind line: "Engineering decision · diagram". */
  kindLabel: string
  what: string
  why?: string
  answers: ItemAnswers
  /** A group of several ("Decided by the agent · 7"); the children are the members. */
  count?: number
  children?: Item[]
  media?: ItemMedia
  /** Work waits until you answer. */
  blocking: boolean
  state: ItemState
  answer?: ItemAnswer
  /** The agent's answer after the answer was sent. */
  reply?: { text: string; at: number }
  /** When a decision settled it; a record that was never open (a settled Discuss decision) has none. */
  settledAt?: number
  /** The agent changed something you had settled: the item opens again with this mark. */
  changedSinceReview?: boolean
  /** The words of a Done means point before the person agreed, shown when it changes. */
  changedFrom?: string
  /** The agent changed the item while you read it; your unsent answer stays. */
  updated?: boolean
  /**
   * A Your call: a decision of the Plan only the person can settle, with its two options and the one
   * the agent recommends. Approve waits until it is answered: A agrees, B asks for the change.
   */
  call?: { options: [string, string]; recommended: 0 | 1; artifact?: string }
  /** The part of the build an item is about: an addition to the Plan waits on this slice, with these tasks. */
  about?: { slice: number; tasks: string[] }
  /**
   * Open for a question, but waiting for no one: it adds to no count and to no "Needs you" (the
   * choices the build made on its own, which it goes on with while you read them).
   */
  uncounted?: true
  /** A short mark beside the headline: "changed in slice 40 · not re-checked", "follow-up". */
  tag?: string
  /** The full words behind the headline (a judge's finding), shown folded under Details. */
  details?: string
  /** A `confirm` item: what the person is asked to confirm ("the live call"); "" when unsaid. */
  ask?: string
  /**
   * A fingerprint of what the item says. The page sends it back with an answer (`seen`), so a
   * later change to the item shows as "updated" beside that answer.
   */
  digest?: string
}

/**
 * Where an answer is stored: the document the step's decision covers, as a comment with the item's
 * id as its anchor. The Plan's answers ride with the Plan approval, the Review's with the final.
 */
export function answerDoc(step: FlowStepId): string {
  return targetOf(step)
}

/** The gate was decided in the agent's window while answers were still unsent here (rule 3). */
export type DecidedElsewhere = {
  /** What was decided there: the Plan approved, or changes sent. */
  decision: "approved" | "changes"
  /** Who decided: "chat" (typed in the agent's window), or "policy" (approved automatically). */
  by: string
  /** The agent it was decided in: "Claude Code", "Codex". */
  where: string
  at: number
  /** How many unsent answers stay as comments. */
  drafts: number
}

const KIND_META: Record<ItemKind, [string, ItemFamily]> = {
  question: ["Question for you", "answer"],
  confirm: ["Only you can confirm", "confirm"],
  decision: ["Engineering decision", "decide"],
  decided: ["Decided by the agent", "decide"],
  scope: ["Out of scope", "decide"],
  "extra-review": ["Extra review", "decide"],
  done: ["Done means", "decide"],
  asked: ["Is this what you asked for?", "decide"],
  mockup: ["Mockup", "look"],
  result: ["Look at the result", "look"],
  diagram: ["Diagram", "look"],
  found: ["Found while checking", "fix"],
  deviation: ["Decided by the agent during the build", "fix"],
  teammate: ["Question from a teammate", "answer"],
  finding: ["Found by a second agent", "decide"],
  note: ["Your note", "decide"],
  handback: ["Handed back", "answer"],
}

/** The words of every kind, as the kind line starts. */
export const KIND_LABEL = Object.fromEntries(
  Object.entries(KIND_META).map(([kind, [label]]) => [kind, label]),
) as Record<ItemKind, string>

/** The family a kind belongs to when the server does not say otherwise. */
export const FAMILY_OF = Object.fromEntries(
  Object.entries(KIND_META).map(([kind, [, family]]) => [kind, family]),
) as Record<ItemKind, ItemFamily>

/** Every answer's button, in the words of the Decide family. */
export const ANSWER_LABEL: Record<AnswerKind, string> = {
  agree: "Agree",
  change: "Change",
  confirm: "I confirm",
  record: "Answer in words",
  accept: "Accept",
  fix: "Fix it",
  fine: "Fine",
  "ask-why": "Ask why",
  add: "Add",
  skip: "Skip it",
  reply: "Reply",
  keep: "Keep all",
  resolve: "Resolve",
  revisit: "Revisit",
  "add-review": "Add a review",
}

/** Where a family says an answer in its own words. */
const FAMILY_LABEL: Partial<Record<ItemFamily, Partial<Record<AnswerKind, string>>>> = {
  look: { agree: "Looks right" },
  answer: { agree: "Looks right", change: "Suggest a change" },
}

/** The button's words: the item's own when it names them, else the family's, else the table's. */
export function answerLabel(
  kind: AnswerKind,
  family: ItemFamily,
  own?: Partial<Record<AnswerKind, string>>,
): string {
  return own?.[kind] ?? FAMILY_LABEL[family]?.[kind] ?? ANSWER_LABEL[kind]
}

/** What each kind of item asks, in the plan's table: the two buttons, the link, and the kind's own words. */
export const KIND_ANSWERS: Record<ItemKind, ItemAnswers> = {
  // Answered in the agent's own window; the App shows it and offers no button.
  question: { options: [] },
  confirm: { options: ["confirm", "record"] },
  decision: { options: ["agree", "change"] },
  decided: { options: ["keep"], link: "change", labels: { change: "Change one" } },
  scope: { options: ["agree", "change"] },
  "extra-review": { options: ["agree", "add-review"] },
  done: { options: ["agree", "change"] },
  asked: { options: ["agree", "change"] },
  mockup: { options: ["agree", "change"] },
  result: { options: ["agree", "change"] },
  diagram: { options: ["agree", "change"] },
  found: { options: ["accept", "fix"] },
  deviation: { options: ["fine", "ask-why"] },
  teammate: { options: ["reply", "resolve"] },
  finding: {
    options: ["change", "keep"],
    labels: { change: "Change the Plan", keep: "Keep it" },
  },
  note: { options: ["agree", "change"] },
  // The prompt is copied, or the task is started anyway: both are the page's own buttons.
  handback: { options: [] },
}

/** The answers an item of this kind carries unless its source says otherwise: a copy. */
export function defaultAnswers(kind: ItemKind): ItemAnswers {
  const own = KIND_ANSWERS[kind]
  return {
    options: [...own.options],
    ...(own.link !== undefined ? { link: own.link } : {}),
    ...(own.labels !== undefined ? { labels: { ...own.labels } } : {}),
  }
}

/** The answers that ask the agent to change something: "Send N changes" counts them. */
const ASKS_FOR_CHANGE: ReadonlySet<AnswerKind> = new Set([
  "change",
  "fix",
  "ask-why",
  "record",
  "skip",
  // Reopening something settled goes to the agent with the decision. Adding a review does not: the
  // recording of the decision switches it on itself (record() in gate.ts), so Approve stays Approve.
  "revisit",
])

export const asksForChange = (kind: AnswerKind): boolean => ASKS_FOR_CHANGE.has(kind)

/**
 * The plan's order rule, as ranks: what blocks work first (a question, a stop, Only you can
 * confirm), then what a review waits on (another agent's findings, a teammate's comment), then
 * decisions and the pictures they rest on, then things to look at (a result, what
 * the checks found), then the choices the agent made that you may question. Within a rank the
 * order the server gave holds, so the Plan keeps its own sequence (mockup, decision, Done means,
 * the agent's decisions, Extra review).
 */
const RANK: Record<ItemKind, number> = {
  question: 0,
  confirm: 0,
  handback: 0,
  decision: 1,
  done: 1,
  asked: 1,
  scope: 1,
  // What a review waits on: another agent's findings and a teammate's comment come right after
  // what blocks the work, before the pictures and decisions they are about (Plan 1c).
  finding: 0.5,
  teammate: 0.5,
  note: 1,
  mockup: 1,
  diagram: 1,
  result: 2,
  found: 2,
  decided: 3,
  "extra-review": 3,
  deviation: 3,
}

/** Items as a person reads them: blocking ones first, settled ones last (by the same rule). A new array. */
export function orderItems(items: readonly Item[]): Item[] {
  const rank = (item: Item) => RANK[item.kind] + (item.state === "settled" ? 4 : 0)
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item)
}

/** Items waiting for you: open, or answered here and not sent yet. A group counts once. */
export function openCount(items: readonly Item[], step?: FlowStepId): number {
  return items.filter((item) => (step === undefined || item.step === step) && waits(item)).length
}

/** The answers that need nothing from the agent: given the moment they are clicked. */
export const GIVEN_AT_ONCE: ReadonlySet<AnswerKind> = new Set(["agree", "accept", "fine", "keep"])

function chosenWaits(item: Item): boolean {
  if (item.state !== "chosen") return false
  return item.answer === undefined || !GIVEN_AT_ONCE.has(item.answer.kind) || item.updated === true
}

/**
 * An item waits while it is open, or answered here with an answer the agent must act on (a change,
 * a fix, a question). A draft agree, accept, fine or keep is given already, unless the item changed
 * after it: then it waits again until what it says now is answered.
 */
const waits = (item: Item): boolean =>
  item.uncounted !== true && (item.state === "open" || chosenWaits(item))

/** Where an answer was given, as a row says it: "Answered in the chat" or "Answered in the App". */
export const answeredWhere = (answer: ItemAnswer): string =>
  `Answered in the ${answer.via === "chat" ? "chat" : "App"}`

/** Items answered in the chat that no longer wait for you, newest answer first. A new array. */
export function answeredInChat(items: readonly Item[]): Item[] {
  return items
    .filter((item) => item.answer?.via === "chat" && openCount([item]) === 0)
    .sort((a, b) => (b.answer?.at ?? 0) - (a.answer?.at ?? 0))
}

/** How many of these answers ask for a change. */
export function changeCount(answers: readonly Pick<ItemAnswer, "kind">[]): number {
  return answers.filter((answer) => asksForChange(answer.kind)).length
}

/** Every item and every member of a group, in order. */
export function flattenItems(items: readonly Item[]): Item[] {
  return items.flatMap((item) => [item, ...flattenItems(item.children ?? [])])
}

export type MainAction = {
  kind: "approve" | "changes"
  /** "Approve", "Send 1 change" or "Send 2 changes". */
  label: string
  changes: number
  /** Items that still wait for you. */
  open: number
}

/**
 * The step line's one main button: Approve while no answer asks for a change, else Send N
 * changes. `answers` are the ones picked here and not sent, by item id; one for an item that is
 * gone does not count.
 */
export function mainAction(
  items: readonly Item[],
  answers: Readonly<Record<string, ItemAnswer>>,
): MainAction {
  const ids = new Set(flattenItems(items).map((item) => item.id))
  const changes = changeCount(
    Object.entries(answers)
      .filter(([id]) => ids.has(id))
      .map(([, answer]) => answer),
  )
  return {
    kind: changes > 0 ? "changes" : "approve",
    label: changes === 0 ? "Approve" : `Send ${changes} ${changes === 1 ? "change" : "changes"}`,
    changes,
    open: openCount(items),
  }
}

// ---------------------------------------------------------------- what a decision covered

/** What a decision recorded for one item: the answer it gave (null: approved with the rest) and what the item said. */
export type DecidedItem = {
  answer: AnswerKind | null
  digest: string
}

/** One decision at a gate, with every item it covered (decided.json holds a list of them). */
export type FormalRequestChanges = {
  text: string
  at: number
  by: string
  gate?: string
  revision?: string
  origin?: { kind: "question"; id: string; number: number; receipt: string; action: string }
}

export type DecidedGate = {
  /** The gate's id and the revision it was open on. */
  gate?: string
  revision?: string
  target: string
  at: number
  by: string
  decision: "approved" | "changes"
  items: Record<string, DecidedItem>
  requestChanges?: FormalRequestChanges
}

/** The latest decision on a target that covered this item, or undefined. */
export function lastDecision(
  decided: readonly DecidedGate[],
  target: string,
  item: string,
): { gate: DecidedGate; item: DecidedItem } | undefined {
  for (let index = decided.length - 1; index >= 0; index--) {
    const gate = decided[index]
    const found = gate?.target === target ? gate.items[item] : undefined
    if (gate !== undefined && found !== undefined) return { gate, item: found }
  }
  return undefined
}

/** The gate target whose decision covers the items of a step. */
export const targetOf = (step: FlowStepId): string =>
  step === "verify" ? "final" : folderDoc("plan")

/** What an item's state is read from: the answers stored as comments and the decisions so far. */
export type ItemEnv = {
  comments: readonly {
    authorityDigest?: string
    recordAttachments?: RuntimeAttachment[]
    id?: string
    item?: string
    kind?: AnswerKind
    seen?: string
    via?: "chat"
    remark: string
    created: number
    delivered?: boolean
    answer?: string
    answered?: number
    files?: { name: string; type: string; size: number }[]
  }[]
  decided: readonly DecidedGate[]
  /** The revision the gate is open on, when there is a gate. */
  revision?: string
}

/**
 * One item's state, from the answers stored for it and the decisions that covered it:
 * chosen (a draft answer, kept even when the item changed under it: then it is `updated`), sent
 * (delivered; its reply shows), settled (a decision covered it and it has not changed), or open
 * again with `changedSinceReview` (it changed since a decision covered it).
 */
export const pointText = (item: Pick<Item, "what" | "why">): string =>
  item.why !== undefined ? `${item.what}\n${item.why}` : item.what

export { resolveItem } from "./items-resolve.ts"

// ---------------------------------------------------------------- what a step page shows besides items

/** The lists and records a step page draws around its items; computed from the documents by the server. */
export type StepParts = {
  plan?: {
    /** The Plan's Scope: in scope and out of scope, a few words each. */
    inScope: string[]
    outOfScope: string[]
    /** What was decided with the person: each question, with their answer. */
    decided: { what: string; answer: string }[]
    /** What the Plan rests on, with the task that rests on it. */
    assumptions: {
      text: string
      task: string | null
      /** The person did not know the answer: the agent assumed its recommendation, and says so. */
      unconfirmed?: boolean
    }[]
  }
}

/** The facts the agents proved, for the Plan's violet line; never more than five. */
export type StepChecks = { plan: string[] }
