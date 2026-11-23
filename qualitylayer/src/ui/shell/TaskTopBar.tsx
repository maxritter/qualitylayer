import { type ReactNode, useRef } from "react"
import { createPortal } from "react-dom"
import type { TaskCost } from "../../core/cost/labels.ts"
import { type FlowStepId, flowStepOf } from "../../core/flow.ts"
import { setDocumentFullSize, setDocumentRecord } from "../docs/mode.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { type StageTab, stepView } from "../model.ts"
import { ProjectOrigin, useProjectFacts } from "../sidebar/look-context.tsx"
import { LandingActions, landingActionsShow } from "../steps/verify/LandingActions.tsx"
import { ReviewApproval } from "../steps/verify/ReviewApproval.tsx"
import { ApproveCard } from "../turn/ApproveCard.tsx"
import { useTurnSnapshot } from "../turn/projection.ts"
import { ShellApiContext } from "./context.ts"
import { StepTrack } from "./StepTrack.tsx"
import { TaskActions } from "./TaskActions.tsx"
import { attentionCount, computeTopBarGateState, useTopBarHosts } from "./top-bar-helpers.ts"

export { attentionCount, TaskActions }

type OwnerBarProps = TaskSurfaceProps & {
  cost?: TaskCost | null
  actions?: boolean
  /** False while a task's artifact is open: the artifact's own bar stands under the header, with no step track. */
  track?: boolean
  mode?: "owner"
}

/** A teammate's task in the same header: the title, the owner's chip and tools, the three steps. */
type TeammateBarProps = {
  mode: "teammate"
  title: string
  /** The steps with the owner's progress; the gate row and the task menu stay out. */
  tabs: StageTab[]
  /** The step in view. */
  step: FlowStepId | null
  onOpen: (key: string) => void
  /** Whether the person approves at Plan and Verify on this task's layout (a task). */
  approves: boolean
  /** The owner chip, the follow switch and the verdict buttons. */
  children: ReactNode
}

function TeammateTopBar({ title, tabs, step, onOpen, approves, children }: TeammateBarProps) {
  return (
    <div
      className="ir-topbar"
      data-testid="teammate-topbar"
      data-unified="true"
      data-gate-row="false"
      data-mode="teammate"
    >
      <div className="q-head" data-testid="task-head">
        <div className="min-w-0">
          <h1 className="q-title" title={title}>
            <span className="truncate">{title}</span>
          </h1>
        </div>
        <div className="q-tools">{children}</div>
      </div>
      <div className="ir-workflow-row">
        <StepTrack tabs={tabs} step={step} onOpen={onOpen} approves={approves} progress />
      </div>
    </div>
  )
}

export function TaskTopBar(props: OwnerBarProps | TeammateBarProps) {
  return props.mode === "teammate" ? <TeammateTopBar {...props} /> : <OwnTaskTopBar {...props} />
}

function TopBarGateRow({
  props,
  openCount,
  planApproval,
  reviewApproval,
  showTurnPill,
  turnItems,
}: {
  props: OwnerBarProps
  openCount: number
  planApproval: boolean
  reviewApproval: boolean
  showTurnPill: boolean
  turnItems: NonNullable<TaskSurfaceProps["task"]["items"]>
}) {
  return (
    <div
      className="ir-task-gate-row"
      id={`task-gate-track-${props.task.id}`}
      data-testid="task-gate-row"
    >
      {showTurnPill ? (
        <button
          type="button"
          className="ir-turn-pill"
          disabled={openCount === 0}
          onClick={(event) => {
            if (props.onRevealTurn) {
              props.onRevealTurn(event.currentTarget)
              return
            }
            setDocumentFullSize(false)
            setDocumentRecord(null)
            const current = flowStepOf(props.task.stage)
            if (current !== null) props.onOpen(stepView(props.task, current))
          }}
        >
          {openCount ? `Your turn · ${openCount}` : "Nothing needs you"}
        </button>
      ) : null}
      {planApproval ? (
        <ApproveCard items={turnItems} busy={props.live.busy} surface={props} />
      ) : null}
      {reviewApproval ? <ReviewApproval key={props.task.gate?.id} surface={props} /> : null}
    </div>
  )
}

function OwnTaskTopBar(props: OwnerBarProps) {
  const root = useRef<HTMLDivElement | null>(null)
  const { header, decisionHost, originHost, stepsHost } = useTopBarHosts(root, props.track)
  const project = useProjectFacts(props.task)
  const turn = useTurnSnapshot(props.task.id)
  const { step, openCount, planApproval, reviewApproval, showGateRow, showTurnPill } =
    computeTopBarGateState(props.task, props.view, turn)
  const placeDecision = (element: ReactNode) =>
    decisionHost ? createPortal(element, decisionHost) : element
  const trackNode =
    props.track === false ? null : stepsHost !== null ? (
      createPortal(
        <StepTrack
          tabs={props.tabs}
          step={step}
          onOpen={props.onOpen}
          approves
          starting={props.task.action === "implement"}
          look="header"
        />,
        stepsHost,
      )
    ) : (
      <StepTrack
        tabs={props.tabs}
        step={step}
        onOpen={props.onOpen}
        approves
        starting={props.task.action === "implement"}
      />
    )
  return (
    <ShellApiContext.Provider value={props.api}>
      <div
        ref={root}
        className="ir-topbar"
        data-testid="interaction-topbar"
        data-unified="true"
        data-gate-row={showGateRow}
      >
        {props.children}
        <div className="ir-workflow-row">
          {trackNode}
          {showGateRow
            ? placeDecision(
                <TopBarGateRow
                  props={props}
                  openCount={openCount}
                  planApproval={planApproval}
                  reviewApproval={reviewApproval}
                  showTurnPill={showTurnPill}
                  turnItems={turn?.items ?? props.task.items ?? []}
                />,
              )
            : null}
        </div>
        {landingActionsShow(props.task) ? placeDecision(<LandingActions surface={props} />) : null}
        {originHost !== null ? createPortal(<ProjectOrigin project={project} />, originHost) : null}
        {props.actions === false ? null : <TaskActions {...props} host={header} />}
      </div>
    </ShellApiContext.Provider>
  )
}
