import { isValidElement, type ReactNode, useLayoutEffect, useRef } from "react"
import { api as liveApi } from "../api.ts"
import {
  setDocumentFullSize,
  setDocumentRecord,
  setDocumentReturn,
  useDocumentFullSize,
  useDocumentRecord,
  useDocumentReturn,
} from "../docs/mode.ts"
import { agentInfo, autonomous as agentsWork, inReview, stepPhase, viewedStep } from "../model.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { runTaskId } from "../runs-api.ts"
import { AgentTurn } from "../shell/AgentTurn.tsx"
import { DeferredNeeds } from "../status/DeferredNeeds.tsx"
import { OwnerRequests } from "../status/OwnerRequests.tsx"
import { NeedsAboveContext, StepSupportingContext } from "../steps/context.ts"
import { humanQuestions, isFinalApprovalQuestion } from "../turn/ApproveCard.tsx"
import { useTurnSnapshot } from "../turn/projection.ts"
import type { TaskSurfaceProps } from "./props.ts"
import {
  hasOpenBlockingItem,
  stageTurnState,
  useTurnFocusEffect,
  type ViewedStep,
} from "./workspace-state.ts"

function supportingOf(
  surface: TaskSurfaceProps | null,
  step: ViewedStep,
  autonomous: boolean,
): ReactNode {
  if (!autonomous || !surface) return null
  if (step === "verify" && surface.task.stage === "verify") {
    return (
      <OwnerRequests
        needs={surface.task.live?.needs ?? []}
        question={surface.task.question ?? null}
        answered={surface.task.answeredQuestions ?? []}
        agent={agentInfo(surface.task.session?.agent).name}
        onSet={surface.live.setNeed}
      />
    )
  }
  if (step === "implement" && surface.task.stage === "implement") return null
  return <DeferredNeeds needs={surface.task.live?.needs ?? []} />
}

function focusYourTurn() {
  setDocumentFullSize(false)
  setDocumentRecord(null)
  const card = document.querySelector<HTMLElement>(
    '[data-testid="interaction-now"] [aria-label="Your turn"], [data-testid="interaction-now"]',
  )
  card?.scrollIntoView({ block: "start", behavior: "smooth" })
  card?.focus({ preventScroll: true })
}

function StageTools({
  surface,
  step,
  waiting,
  returnTo,
}: {
  surface: TaskSurfaceProps
  step: ViewedStep
  waiting: boolean
  returnTo: ReturnType<typeof useDocumentReturn>
}) {
  return (
    <nav className="ir-stage-tools" aria-label="Task files and comments">
      {waiting ? (
        <button type="button" onClick={focusYourTurn}>
          Your turn
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (returnTo?.taskId !== surface.task.id)
            setDocumentReturn({ taskId: surface.task.id, view: surface.view })
          setDocumentFullSize(true)
        }}
      >
        {step ? step[0]?.toUpperCase() + step.slice(1) : "Step"}
      </button>
      <button type="button" onClick={() => surface.onSidebar("comments")}>
        Conversation
      </button>
      <button type="button" onClick={() => surface.onSidebar("files")}>
        Files
      </button>
    </nav>
  )
}

function useResetDocumentOnTaskChange(taskId: string | undefined) {
  const previousTask = useRef(taskId)
  useLayoutEffect(() => {
    if (previousTask.current !== taskId) {
      setDocumentFullSize(false)
      setDocumentRecord(null)
      setDocumentReturn(null)
    }
    previousTask.current = taskId
  }, [taskId])
}

function NativeStage({
  surface,
  step,
  now,
  children,
  reviewing,
  autonomous,
  open,
  questionsCount,
  reading,
  readingRecord,
  managedRun,
  returnTo,
  setDecision,
}: {
  surface: TaskSurfaceProps
  step: ViewedStep
  now: ReactNode
  children: ReactNode
  reviewing: boolean
  autonomous: boolean
  open: boolean
  questionsCount: number
  reading: boolean
  readingRecord: boolean
  managedRun: boolean
  returnTo: ReturnType<typeof useDocumentReturn>
  setDecision: (element: HTMLElement | null) => void
}) {
  const { asking, recentReceipt, waiting } = stageTurnState({
    task: surface.task,
    step,
    reviewing,
    autonomous,
    open,
    questionsCount,
  })
  const verifyQuestion = step === "verify" && !reviewing && (asking || recentReceipt)
  return (
    <div className="ir-stage" data-step={step} data-testid="interaction-workspace">
      <div
        ref={setDecision}
        hidden={reading || readingRecord || !waiting}
        className="ir-stage-decision"
        data-verify-question={verifyQuestion ? true : undefined}
        data-testid="interaction-now"
      >
        {waiting ? now : null}
      </div>
      {!waiting && !managedRun && !reviewing ? (
        <div className="ir-stage-progress">
          <AgentTurn {...surface} />
        </div>
      ) : null}
      <div className="ir-stage-reader">{children}</div>
      <StageTools surface={surface} step={step} waiting={waiting} returnTo={returnTo} />
    </div>
  )
}

function isManagedRunActive(
  windows: ReturnType<typeof useOptionalRuns>,
  taskId: string | undefined,
): boolean {
  return (
    windows?.runs.some(
      (run) => runTaskId(run) === taskId && run.status !== "failed" && run.status !== "stopped",
    ) ?? false
  )
}

export function TaskWorkspace({ now, children }: { now: ReactNode; children: ReactNode }) {
  const surface = isValidElement<TaskSurfaceProps>(now) ? now.props : null
  const decision = useRef<HTMLElement | null>(null)
  const handledFocus = useRef<number | null>(null)
  const managedRun = isManagedRunActive(useOptionalRuns(), surface?.task.id)
  useResetDocumentOnTaskChange(surface?.task.id)
  const turn = useTurnSnapshot(surface?.task.id ?? "")
  const reading = useDocumentFullSize()
  const record = useDocumentRecord()
  const readingRecord = record?.taskId === surface?.task.id
  const returnTo = useDocumentReturn()
  const step = surface ? viewedStep(surface.view) : null
  const native =
    (surface?.api === liveApi || surface?.api.currentTurnLayout === true) && step !== null
  const phase = surface ? stepPhase(surface.task, surface.view) : "now"
  // The person's own review is not the agents': Verify turned to them, or the task shipped.
  const reviewing = surface !== null && step === "verify" && inReview(surface.task)
  const autonomous =
    surface !== null &&
    (agentsWork(surface.task) || step === "implement" || (step === "verify" && !reviewing))
  // Implement's queued needs stand on the slice that owns them; the disclosure stays where the page
  // does not draw them.
  const supporting = supportingOf(surface, step, autonomous)
  const open = hasOpenBlockingItem(turn?.items ?? surface?.task.items ?? [], step)
  const questions = surface
    ? humanQuestions(surface.task, turn?.questions).filter(
        (question) => step !== "verify" || !isFinalApprovalQuestion(surface.task, question),
      )
    : []
  useTurnFocusEffect({
    surface,
    questions,
    step,
    reading,
    readingRecord,
    decision,
    handledFocus,
  })
  const setDecision = (element: HTMLElement | null) => {
    decision.current = element
  }
  const body =
    surface && native && phase === "future" ? (
      <div className="ir-stage" data-step={step} data-testid="interaction-workspace">
        {now}
      </div>
    ) : surface && native ? (
      <NativeStage
        surface={surface}
        step={step}
        now={now}
        reviewing={reviewing}
        autonomous={autonomous}
        open={open}
        questionsCount={questions.length}
        reading={reading}
        readingRecord={readingRecord}
        managedRun={managedRun}
        returnTo={returnTo}
        setDecision={setDecision}
      >
        {children}
      </NativeStage>
    ) : (
      <div className="ir-workspace" data-testid="interaction-workspace">
        <aside ref={setDecision} className="ir-now" aria-label="Now" data-testid="interaction-now">
          {now}
        </aside>
        <div className="ir-work" data-testid="interaction-work">
          {children}
        </div>
      </div>
    )
  return (
    <NeedsAboveContext value={autonomous}>
      <StepSupportingContext value={supporting}>{body}</StepSupportingContext>
    </NeedsAboveContext>
  )
}
