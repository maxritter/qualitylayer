import type { TaskSurfaceProps } from "../interaction/props.ts"
import { autonomous, viewedStep } from "../model.ts"
import { AgentTurn } from "../shell/AgentTurn.tsx"
import { DeferredNeeds } from "../status/DeferredNeeds.tsx"
import { useNeedsAbove } from "./context.ts"
import { StepReceipts } from "./StepReceipts.tsx"
import {
  ChecklistNowRows,
  RequestedNotesRows,
  SetNeedsRows,
  SliceProgressRows,
} from "./StepsAgentRows.tsx"

function progressTitle(shipped: boolean, notesCount: number, doneCount: number, total: number) {
  if (shipped) return "Shipped"
  if (notesCount > 0) return "Your requested changes"
  return `Build progress · ${doneCount} of ${total} slices done`
}

function progressSummary(shipped: boolean, step: string | null) {
  if (shipped) return "Your decisions and the evidence are kept with this task."
  if (step === "implement") return "Each task is written test first and every check is recorded."
  return "The checks and fixes update as they are recorded. Your confirmations are kept."
}

export function StepsAgentTurn(props: TaskSurfaceProps) {
  const needsAbove = useNeedsAbove()
  const { task, view } = props
  const step = viewedStep(view)
  const slices = task.timeline?.slices ?? []
  const finished = slices.filter(
    (slice) => slice.tasks.length > 0 && slice.tasks.every((entry) => entry.checked),
  )
  const notes = task.changesRequested?.notes ?? []
  const shipped = task.stage === "shipped"
  const showDeferred =
    autonomous(task) && !(step === "implement" && task.stage === "implement") && !needsAbove
  const deferred = showDeferred ? <DeferredNeeds needs={task.live?.needs ?? []} /> : null
  const hideProgress =
    task.action === "implement" ||
    ((step !== "implement" || slices.length === 0) && notes.length === 0)
  if (hideProgress) {
    return (
      <>
        <AgentTurn {...props} />
        {deferred}
        <StepReceipts task={task} />
      </>
    )
  }
  const title = progressTitle(shipped, notes.length, finished.length, slices.length)
  const prUrl = shipped ? task.shipped?.pr?.url : undefined
  return (
    <>
      <AgentTurn {...props} />
      {deferred}
      <section
        className="ir-steps-agent"
        aria-label={notes.length ? "Requested changes" : "Build progress"}
        data-testid="steps-agent-turn"
      >
        <header>
          <div className="ir-step-agent-label">
            {shipped ? "The change is shipped" : "Recorded work"}
          </div>
          <h2>{title}</h2>
          <p>{progressSummary(shipped, step)}</p>
        </header>
        <ol>
          <SetNeedsRows needs={task.live?.needs ?? []} />
          {notes.length > 0 ? (
            <RequestedNotesRows notes={notes} />
          ) : step === "implement" ? (
            <SliceProgressRows
              slices={slices}
              finished={finished}
              builder={task.timeline?.builder}
            />
          ) : (
            <ChecklistNowRows now={task.checklist?.now ?? []} />
          )}
        </ol>
        {prUrl !== undefined ? (
          <a className="q-link" href={prUrl} target="_blank" rel="noreferrer">
            Open the pull request
          </a>
        ) : null}
        {!shipped ? (
          <footer>
            <span>Next for you</span>
            {step === "verify"
              ? "Approve, after your changes are checked."
              : "Review the change, after checking."}
          </footer>
        ) : null}
        <StepReceipts task={task} />
      </section>
    </>
  )
}
