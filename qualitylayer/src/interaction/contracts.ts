// Shared v1 wire contract for the Interaction Rethink build. Frozen after the skeleton commit.
// Runtime implementations belong to one lane each; absent facts stay null, never invented.
import type { Artifact } from "../core/artifact/format.ts"
import type { FlowStepId } from "../core/flow.ts"
import type { Comment } from "../core/gate/comments.ts"
import type { Item } from "../core/items.ts"
import type { LiveSignals } from "../core/live/liveness.ts"
import type { AnsweredQuestion, Question } from "../core/task/question.ts"
import type { Person } from "../core/team/people.ts"
import type { ThreadReply } from "../core/team/thread-publication.ts"
import type { DocEntry } from "../server/api.ts"

export type AgentState = "working" | "waits-for-you" | "quiet" | "stopped" | "step-done"
export type ItemTarget = {
  taskId: string
  step: FlowStepId
  itemId: string
  view: string
  threadId?: string
}
export type QuestionPointLink = { questionId: string; points: number[] }
export type QuestionBatch = {
  id: string
  asked: number
  agent: string | null
  session: string | null
  questions: Question[]
  links: QuestionPointLink[]
  /** The step that asked it (`discuss`, `research`, `plan`, `review`); a task counts batches per step. */
  step?: string
  /** The topic ("Scope and what done means"), shown on the batch strip. */
  title?: string
  /** One line about the batches still to come ("Probably the only Discuss batch"). */
  ahead?: string
  /** Why this batch has fewer than three members. */
  small?: string
  /** Why this is a third batch in its step. */
  whyAnother?: string
}
/** One member of a batch as the strip shows it: open, or answered and changeable. */
export type BatchMember = {
  id: string
  /** The member's place in the batch, from 1. */
  number: number
  text: string
  recommended: number
  recommendedChoices?: number[]
  multi?: true
  /** The label the person picked; absent while the question is open. */
  answer?: string
}
/** The whole batch in one line for the card's strip: every member, in order, answered ones included. */
export type BatchStrip = {
  id: string
  step?: string
  title?: string
  ahead?: string
  members: BatchMember[]
}
/** What `question ask --batch` answers with: the batch, and what the rules advise about it. */
export type AskedBatch = QuestionBatch & {
  /** Which batch of its step this is: "batch 2 of this step (Research)". Batches count per step. */
  count?: string
  warnings?: string[]
  /** A republish of answered members: their answers are kept as they were. */
  kept?: { id: string; answer: string }[]
}
export type BatchAnswer = { id: string; batch: string } & (
  | { choice: number }
  /** A `multi` question: indices of the choices picked (at least one, each once). */
  | { choices: number[] }
  | { text: string }
  | { unsure: true }
  | { more: { request: string } }
)
export type DeliveryReceipt = {
  id: string
  kind: "question" | "agreement" | "comment" | "approval"
  state: "saved" | "picked-up" | "acted"
  saved: number
  pickedUp: number | null
  acted: number | null
  reply: string | null
  /**
   * A question's answer once the agent was handed it, so it can be read again later: the label
   * picked or the person's own words, the words written beside it, and a multi answer's labels.
   * Absent on a saved receipt and on receipts recorded before these fields existed.
   */
  choice?: string
  note?: string
  labels?: string[]
}
// The storage authority remains task/point-confirmations.ts and Item.changedFrom/digest.
export type PointAgreement = {
  item: string
  point: number
  text: string
  hash: string
  agreedText: string | null
  agreedHash: string | null
  at: number | null
  state: "open" | "agreed" | "changed"
}
export type AgentStatus = {
  state: AgentState
  agent: string | null
  doing: string
  since: number | null
  lastActivity: number | null
  openItems: number
  blocked: boolean
  signals: LiveSignals | null
  resume: string | null
}
export type BackgroundAgent = {
  id: string
  parent: string | null
  role: "research" | "artifact" | "building" | "checking" | "review" | "plan-review" | "other"
  subject: string
  state: "queued" | "running" | "quiet" | "done" | "failed" | "stopped"
  started: number | null
  ended: number | null
  doing: string | null
}
export type AgentTurnStep = {
  id: string
  text: string
  state: "done" | "now" | "next"
  at: number | null
}
export type TurnSnapshot = {
  batch: QuestionBatch | null
  questions: Question[]
  answered: AnsweredQuestion[]
  links: QuestionPointLink[]
  items: Item[]
  agreements: PointAgreement[]
  receipts: DeliveryReceipt[]
}
export type ShellSnapshot = {
  status: AgentStatus | null
  signals: LiveSignals | null
  agents: BackgroundAgent[]
  steps: AgentTurnStep[]
  nextForYou: string | null
}
export type Notification = {
  id: string
  project: string
  text: string
  at: number
  target: ItemTarget
  state: "open" | "settled"
  settledAt: number | null
  batch: string | null
}
export type HomePeriod = "today" | "week" | "month"
export type HomeFacts = {
  timezone: string
  periods: Record<
    HomePeriod,
    {
      from: number
      to: number
      shipped: { taskId: string; at: number; costUsd: number | null; durationMs: number | null }[]
      shippedCostUsd: number | null
      spentUsd: number | null
      spending?: {
        usd: number
        unpriced: { model: string; tokens: number }[]
        tasks: { id: string; title: string; usd: number; unpricedTokens?: number }[]
      }
      typicalDurationMs: number | null
      fastestDurationMs: number | null
    }
  >
  steps: Record<FlowStepId, string[]>
}
export type TeamReply = ThreadReply
export type CommentThread = {
  id: string
  doc: string
  item: string | null
  quote: string
  state: "open" | "resolved"
  comments: Comment[]
  replies: TeamReply[]
  delivery: "with-approval" | "immediate" | "saved"
  /** Where the person's newest comment stands (sent, queued, helper answering, answered…); planning documents. */
  handling?: import("../core/comment-handling.ts").CommentHandling
  tally: { agree: number; change: number; waiting: Person[] } | null
}
export type DocsSnapshot = {
  documents: DocEntry[]
  threads: CommentThread[]
  artifacts: Artifact[]
}
export type PointProof = {
  point: number
  text: string
  state: "waiting" | "checking" | "fixing" | "passed" | "failed" | "accepted"
  expected: string | null
  happened: string | null
  tried: string[]
  evidence: string[]
  files: string[]
  slices: number[]
  /** Task-wide fallback when the records cannot link changed files to this point. */
  filesScope?: "point" | "task"
  filesUnavailable?: boolean
  confirmation?: { at: number; by: string; text: string }
}
export type StepsSnapshot = { proof: PointProof[] }
export type InteractionCapabilities = {
  batches: boolean
  status: boolean
  homeFacts: boolean
  threads: boolean
  pointProof: boolean
}
export type InteractionSnapshot = {
  version: 1
  taskId: string
  capabilities: InteractionCapabilities
  turn: TurnSnapshot
  shell: ShellSnapshot
  docs: DocsSnapshot
  steps: StepsSnapshot
}
