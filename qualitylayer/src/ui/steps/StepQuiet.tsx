// The quiet state of a step with no document to read: icon, heading, one line and a way back. It is
// drawn for a step the task has not reached and for a step the agent is writing (the first draft
// opens here), so the page never shows one bare line. Props in, rendering out.

import { ArrowLeftIcon, LayersIcon, PenLineIcon } from "lucide-react"
import { FLOW_STEPS, type FlowStepId } from "../../core/flow.ts"
import "./steps.css"

export type QuietKind = "future" | "writing" | "draft"

const FUTURE_HEADING: Record<FlowStepId, string> = {
  plan: "The Plan comes first",
  implement: "Implementation hasn’t started",
  verify: "Verification hasn’t started",
}

/**
 * What happens at a step not reached yet, and who does it, in the App Model's words
 * (`StepEmpty` in artifacts/app/app-model/task.jsx): the line under the heading.
 */
export const FUTURE_LINE: Record<FlowStepId, string> = {
  plan: "The agent reads the code, asks what it cannot settle and writes the Plan here for your approval.",
  implement: "Build work appears here once you approve the Plan and start the build.",
  verify:
    "The built change will be checked here after implementation; then you review it and ship.",
}

const WRITING_HEADING: Record<FlowStepId, string> = {
  plan: "Writing the Plan",
  implement: "Generating slices and tasks",
  verify: "Preparing verification",
}

export const WRITING_LINE: Record<FlowStepId, string> = {
  plan: "The Plan opens here when it is ready.",
  implement: "The build board opens here when it is ready.",
  verify: "The checks appear here when they are ready.",
}

/** The step before `step` in the flow, or null for the first. */
export function stepBefore(step: FlowStepId): { id: FlowStepId; label: string } | null {
  const at = FLOW_STEPS.findIndex((row) => row.id === step)
  const before = at > 0 ? FLOW_STEPS[at - 1] : undefined
  return before === undefined ? null : { id: before.id, label: before.label }
}

type Props = {
  step: FlowStepId
  kind: QuietKind
  /** The heading, where the step's own words say more than "comes next". */
  heading?: string
  /** The line under the heading; the step's own (what happens there, who does it) when absent. */
  line?: string
  /** The link back: its label names the step, `open` takes the person there. */
  back: { label: string; open: () => void } | null
  testId?: string
}

export function StepQuiet({ step, kind, heading, line, back, testId = "step-quiet" }: Props) {
  const pending = kind !== "future"
  return (
    <section className="ir-future-step sq" data-testid={testId} data-kind={kind}>
      <div className="ir-future-icon sq-icon">
        {pending ? <PenLineIcon aria-hidden="true" /> : <LayersIcon aria-hidden="true" />}
      </div>
      <h1>
        {heading ??
          (kind === "writing" ? WRITING_HEADING[step] : pending ? "Draft" : FUTURE_HEADING[step])}
      </h1>
      <p>{line ?? (pending ? WRITING_LINE[step] : FUTURE_LINE[step])}</p>
      {back !== null ? (
        <button type="button" className="q-btn quiet" onClick={back.open}>
          <ArrowLeftIcon aria-hidden="true" /> Back to {back.label}
        </button>
      ) : null}
    </section>
  )
}
