// The step's actions, where its status line used to be. The status lives in one place, the pill
// in the header, so this row holds only what the person can do on the step: Approve (with the
// final review's menu of ways to ship), Request changes, the Plan's diff, taking Verify's build as
// it stands, Open Review; the one short fact beside them ("Codex read the Plan"); what teammates
// advised; and a decision made in the agent's window. A step with none of these draws nothing.

import { ArrowLeftIcon } from "lucide-react"
import type { DecidedElsewhere, Item, ItemAnswer } from "../core/items.ts"
import { useNow } from "./hooks.ts"
import { StepButtons } from "./kit/StepLine.tsx"
import { WhoMark } from "./kit/WhoMark.tsx"
import type { NextStep } from "./model.ts"
import {
  HelperRunsList,
  resolveStepButtons,
  type ShipConfig,
  StepActionNotes,
} from "./step-actions-helpers.tsx"

type Props = {
  backToPlan?: () => void
  step: NextStep
  busy: boolean
  /** What needs you in this step, and the answers picked and not sent: the main button follows them. */
  items?: readonly Item[]
  answers?: Readonly<Record<string, ItemAnswer>>
  onApprove: () => void
  /** Send the decision as changes: the answers that ask for one travel as the saved drafts. */
  onChanges: () => void
  onOpen: (view: string) => void
  /** Open the Comments panel to write a comment. */
  onComment?: () => void
  /** The gate was decided in the agent's window while answers were unsent: where, when, how many. */
  elsewhere?: DecidedElsewhere
  /** Show what the agent changed in the Plan since the last review. */
  onDiff?: () => void
  /** The final review's Approve: one button with a menu of the ways to ship. QualityLayer never merges. */
  ship?: ShipConfig
  onCopy: (text: string, note: string) => void
}

function StepLeadingLabel({
  backToPlan,
  note,
  fact,
}: {
  backToPlan?: () => void
  note: string
  fact?: string
}) {
  if (backToPlan) {
    return (
      <button
        type="button"
        className="mr-auto inline-flex items-center gap-2 rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline"
        onClick={backToPlan}
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Back to Plan
      </button>
    )
  }
  if (note !== "") {
    return (
      <span className="note" data-testid="step-note">
        {note}
      </span>
    )
  }
  if (fact !== undefined) {
    return (
      <span className="fact" data-testid="step-fact">
        <WhoMark who="check" />
        {fact}
      </span>
    )
  }
  return <span className="mr-auto" />
}

export function StepActions({
  step,
  busy,
  items,
  answers = {},
  onApprove,
  onChanges,
  onOpen,
  onComment,
  elsewhere,
  onDiff,
  ship,
  onCopy,
  backToPlan,
}: Props) {
  const { main, secondary, primary } = resolveStepButtons({
    step,
    busy,
    items,
    answers,
    ship,
    onApprove,
    onChanges,
    onOpen,
    onComment,
    onDiff,
    onCopy,
  })
  const advice = step.advice ?? []
  const runs = primary?.kind === "approve" ? (step.runs ?? []) : []
  const now = useNow(runs.length > 0)
  const hasButtons = main !== undefined || secondary !== null || backToPlan !== undefined
  const note =
    primary?.kind === "approve" &&
    step.title.startsWith("Waits for your approval") &&
    step.text !== step.fact
      ? step.text
      : ""
  if (!hasButtons && elsewhere === undefined && advice.length === 0) return null
  return (
    <div className="q-body pb-0" data-testid="step-actions">
      {hasButtons ? (
        <div className="q-acts">
          <StepLeadingLabel backToPlan={backToPlan} note={note} fact={step.fact} />
          <StepButtons main={main} secondary={secondary} />
        </div>
      ) : null}
      <HelperRunsList runs={runs} now={now} />
      <StepActionNotes elsewhere={elsewhere} advice={advice} />
    </div>
  )
}
