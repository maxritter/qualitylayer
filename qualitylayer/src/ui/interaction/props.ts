// Frozen lane seam. Implementations can read live task data and use existing guarded actions.
import type { ReactNode } from "react"
import type { FlowStepId } from "../../core/flow.ts"
import type { Item } from "../../core/items.ts"
import type { Api, TaskDetail } from "../api.ts"
import type { NextStep, StageTab } from "../model.ts"
import type { StepLive } from "../step-page/live.ts"
export type TurnFocusRequest = {
  task: string
  view: string
  fromView: string
  navigation: string
  step: FlowStepId
  questions: readonly { id: string; asked: number }[]
  sequence: number
  origin?: HTMLElement
  focusAtRequest: Element | null
}
export type TaskSurfaceProps = {
  task: TaskDetail
  api: Api
  view: string
  version: number
  /** The calm pace of files and signs of life together; absent without events. */
  activity?: number
  theme: string
  live: StepLive
  step: NextStep
  tabs: StageTab[]
  onOpen: (view: string) => void
  onRevealTurn?: (origin: HTMLElement) => void
  turnFocus?: TurnFocusRequest
  onTurnFocusHandled?: (sequence: number) => void
  onOpenDoc: (view: string, heading?: string) => void
  onCopy: (text: string, note: string) => void
  reload: () => void
  onDeleted?: () => void
  onPlanDiff?: () => void
  /** TaskView's guarded Plan decision, including feedback and the retryable result. */
  onPlanDecision?: (
    decision: "approved" | "changes",
    remark?: string,
  ) => Promise<boolean | undefined>
  /**
   * Approve and build here (12.9): whether the live App planner can continue as the build, why not,
   * who it is, and the guarded approve-and-continue transaction.
   */
  buildHere?: {
    available: boolean
    reason?: string
    lead?: string
    /** The approval is kept and the planning session builds when its turn ends: what to show. */
    waiting?: string
    /** The planner waits in the person's terminal: the menu offers its session: the clean start (compact first) leads, keeping the conversation follows. */
    route?: "terminal"
    start: (remark?: string, options?: { compact?: boolean }) => Promise<boolean | undefined>
  }
  /** Request changes through TaskView's existing flush/current-gate/error boundary. */
  onReviewDecision?: (
    decision: "approved" | "changes",
    remark?: string,
    ship?: "pull-request" | "only" | "commands",
  ) => Promise<boolean | undefined>
  /** Opens the right sidebar: "comments" is the task's session (Conversation or Terminal) now. */
  onSidebar: (tab: "comments" | "files" | "artifacts") => void
  /** Opens the Agent sidebar, which owns Continue; given only while that sidebar is closed. */
  onOpenAgent?: () => void
  onFullScreen: (full: boolean) => void
  planning?: { renderMedia: (item: Item) => ReactNode }
  children?: ReactNode
  /** TaskView's loaded reader, with its comments, ask, thread and jump context. */
  documentReader?: ReactNode
}
