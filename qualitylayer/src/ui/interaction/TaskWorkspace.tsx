import { isValidElement, type ReactNode, useLayoutEffect, useRef } from "react"
import { flowStepOf } from "../../core/flow.ts"
import { flattenItems } from "../../core/items.ts"
import { api as liveApi } from "../api.ts"
import {
  setDocumentFullSize,
  setDocumentRecord,
  setDocumentReturn,
  useDocumentFullSize,
  useDocumentRecord,
  useDocumentReturn,
} from "../docs/mode.ts"
import { autonomous as agentsWork, inReview, pendingGate, stepPhase, viewedStep } from "../model.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { runTaskId } from "../runs-api.ts"
import { AgentTurn } from "../shell/AgentTurn.tsx"
import { DeferredNeeds } from "../status/DeferredNeeds.tsx"
import { NeedsAboveContext, StepSupportingContext } from "../steps/context.ts"
import { humanQuestions, isFinalApprovalQuestion } from "../turn/ApproveCard.tsx"
import { useTurnSnapshot } from "../turn/projection.ts"
import type { TaskSurfaceProps } from "./props.ts"
export function TaskWorkspace({ now, children }: { now: ReactNode; children: ReactNode }) {
  const surface = isValidElement<TaskSurfaceProps>(now) ? now.props : null
  const decision = useRef<HTMLElement | null>(null)
  const handledFocus = useRef<number | null>(null)
  const windows = useOptionalRuns()
  const managedRun =
    windows?.runs.some(
      (run) =>
        runTaskId(run) === surface?.task.id && run.status !== "failed" && run.status !== "stopped",
    ) ?? false
  const previousTask = useRef(surface?.task.id)
  useLayoutEffect(() => {
    if (previousTask.current !== surface?.task.id) {
      setDocumentFullSize(false)
      setDocumentRecord(null)
      setDocumentReturn(null)
    }
    previousTask.current = surface?.task.id
  }, [surface?.task.id])
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
  const supporting =
    autonomous && surface && !(step === "implement" && surface.task.stage === "implement") ? (
      <DeferredNeeds needs={surface.task.live?.needs ?? []} />
    ) : null
  const items = flattenItems(turn?.items ?? surface?.task.items ?? []).filter(
    (item) =>
      !item.children &&
      !item.uncounted &&
      (item.step === step || (step === "verify" && item.step === "implement")) &&
      item.kind !== "question" &&
      item.kind !== "done" &&
      item.kind !== "asked",
  )
  const open = items.some(
    (item) =>
      item.state === "open" &&
      (item.blocking || item.kind === "decision" || item.kind === "mockup"),
  )
  const questions = surface
    ? humanQuestions(surface.task, turn?.questions).filter(
        (question) => step !== "verify" || !isFinalApprovalQuestion(surface.task, question),
      )
    : []
  useLayoutEffect(() => {
    if (!surface) return
    const request = surface.turnFocus
    if (!request || handledFocus.current === request.sequence) return
    const complete = () => {
      handledFocus.current = request.sequence
      surface.onTurnFocusHandled?.(request.sequence)
    }
    const pending = questions.filter((question) =>
      request.questions.some(
        (target) => target.id === question.id && target.asked === question.asked,
      ),
    )
    if (
      request.task !== surface.task.id ||
      request.view !== surface.view ||
      request.navigation !== window.location.hash ||
      request.step !== step ||
      request.step !== flowStepOf(surface.task.stage) ||
      surface.task.archived ||
      surface.task.stage === "shipped" ||
      surface.task.stage === "abandoned" ||
      reading ||
      readingRecord ||
      pending.length === 0
    ) {
      complete()
      return
    }
    const region = decision.current
    const card = Array.from(
      region?.querySelectorAll<HTMLElement>(
        '[data-testid="focus-card"], [data-testid="question-batch"]',
      ) ?? [],
    ).find((element) =>
      pending.some(
        (question) =>
          element.dataset.itemId === `question:${question.id}` ||
          element.getAttribute("aria-label") ===
            `Question ${question.number}: ${question.question}`,
      ),
    )
    const active = document.activeElement
    const fromTurn = active === request.origin || active === request.focusAtRequest
    if (active && active !== document.body && !fromTurn) {
      complete()
      return
    }
    if (!card) return
    complete()
    card.scrollIntoView?.({ block: "start" })
    card.focus({ preventScroll: true })
  }, [surface, questions, step, reading, readingRecord])
  if (surface && native && phase === "future")
    return (
      <NeedsAboveContext value={autonomous}>
        <StepSupportingContext value={supporting}>
          <div className="ir-stage" data-step={step} data-testid="interaction-workspace">
            {now}
          </div>
        </StepSupportingContext>
      </NeedsAboveContext>
    )
  if (surface && native) {
    const current = step === flowStepOf(surface.task.stage)
    const closed =
      surface.task.archived ||
      surface.task.stage === "shipped" ||
      surface.task.stage === "abandoned"
    const asking = current && !closed && questions.length > 0
    const waiting =
      asking ||
      (!reviewing &&
        !autonomous &&
        ((step === "plan" && surface.task.handedBack !== undefined) ||
          (!closed &&
            (open ||
              questions.length > 0 ||
              (current && step !== "plan" && pendingGate(surface.task) !== null) ||
              (current && surface.task.live?.needs.some((need) => need.state === "open"))))))
    return (
      <NeedsAboveContext value={autonomous}>
        <StepSupportingContext value={supporting}>
          <div className="ir-stage" data-step={step} data-testid="interaction-workspace">
            <div
              ref={(element) => {
                decision.current = element
              }}
              hidden={reading || readingRecord || !waiting}
              className="ir-stage-decision"
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
            <nav className="ir-stage-tools" aria-label="Task files and comments">
              {waiting ? (
                <button
                  type="button"
                  onClick={() => {
                    setDocumentFullSize(false)
                    setDocumentRecord(null)
                    const card = document.querySelector<HTMLElement>(
                      '[data-testid="interaction-now"] [aria-label="Your turn"], [data-testid="interaction-now"]',
                    )
                    card?.scrollIntoView({ block: "start", behavior: "smooth" })
                    card?.focus({ preventScroll: true })
                  }}
                >
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
          </div>
        </StepSupportingContext>
      </NeedsAboveContext>
    )
  }
  return (
    <NeedsAboveContext value={autonomous}>
      <StepSupportingContext value={supporting}>
        <div className="ir-workspace" data-testid="interaction-workspace">
          <aside
            ref={(element) => {
              decision.current = element
            }}
            className="ir-now"
            aria-label="Now"
            data-testid="interaction-now"
          >
            {now}
          </aside>
          <div className="ir-work" data-testid="interaction-work">
            {children}
          </div>
        </div>
      </StepSupportingContext>
    </NeedsAboveContext>
  )
}
