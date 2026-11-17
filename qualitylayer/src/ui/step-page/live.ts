// What a step page can do in the App, as the task's page hands it over. In snapshot and plain mode
// there is none: the page draws the same parts without a control that acts.

import type { ItemAnswer } from "../../core/items.ts"
import type { Evidence } from "../api.ts"
import type { ClipboardCopy } from "../clipboard.ts"
import type { ExportWriter } from "../export/ExportCard.tsx"
import type { QuestionActions } from "../FocusQuestion.tsx"
import type { BuildArtifacts } from "../ImplementStart.tsx"
import type { ReaderMark } from "../reader/DocReader.tsx"

export type ShipChoice = "pull-request" | "only" | "commands"

export type StepLive = {
  exportFile?: ExportWriter
  exportContext?: { title: string; recordedDecision: string }
  /** Words selected on the page: the quick field opens there and sends to the task's session. */
  mark?: (mark: ReaderMark) => void
  /** The Markdown the page draws, whose hash names the revision a mark was made on. */
  markSource?: string
  /** "Ask why" on a row: the quick field opens under `anchor` with these words quoted. */
  askAbout?: (quote: string, anchor: Element) => void
  /** The current task's existing file query, shared with its standalone build entry. */
  buildArtifacts?: BuildArtifacts
  /**
   * The approved Plan's planning session can still take the build (12.9): the waiting line
   * while it finishes its turn, or the action that continues it (also after a reload).
   */
  buildHere?: { waiting?: string; offer?: { lead: string; start: () => Promise<unknown> } }
  /** Pick an answer for an item (or Undo with null): saved as a draft, sent with the step's decision. */
  answer: (id: string, answer: ItemAnswer | null) => void
  /** The Plan's approval: Approve, or Send N changes. */
  decide: (decision: "approved" | "changes") => void
  /** The final approval, the way the person picked. QualityLayer never merges. */
  ship: (choice: ShipChoice) => void
  /** Answer the build's question (a need), change an earlier answer: the question card's own actions. */
  question: QuestionActions
  /** "Done, it's set" for a need of the build, with the person's note; false when it did not go. */
  setNeed: (forTask: string, note: string) => Promise<boolean>
  copy: ClipboardCopy
  /** Open a file of the task folder in the editor (Open in editor). */
  open: (path: string) => void
  /** The task folder on disk, for Copy path. */
  dir: string
  /** What the step title's Copy menu adds to the document's own copies. */
  copyDoc?: {
    /** The task's branch, for Copy branch name; null when it has none. */
    branch: string | null
    /** The prompt that starts the build in any agent, once the Plan is approved. */
    forAgent?: string
    /** A feature or bug-fix task's Plan: its Markdown copy says what the Plan export writes. */
    planExport: boolean
  }
  loadArtifact: (name: string) => Promise<string>
  /** A document of the task folder as Markdown: the agents' file, which Copy for an agent adds. */
  loadDoc?: (name: string) => Promise<string>
  loadEvidence: (name: string) => Promise<Evidence>
  /** A record's text, read-only: a text file under evidence/. */
  loadRecord: (evidence: string) => Promise<string>
  /** Open an artifact full size; the artifact page takes it once it lands. */
  openArtifact?: (name: string) => void
  theme: string
  /** A decision is on its way: the main buttons wait. */
  busy: boolean
}

/** The answer a click gives, now. */
export const given = (kind: ItemAnswer["kind"]): ItemAnswer => ({ kind, at: Date.now() })
