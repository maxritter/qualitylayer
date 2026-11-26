import { useEffect, useState } from "react"
import { agentIdOf } from "../../core/interaction-shell/status.ts"
import type { Item } from "../../core/items.ts"
import { agentName } from "../../core/live/liveness.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { jumpToItem } from "../jump.ts"
import { useMainShortcut } from "../kit/StepLine.tsx"
import { WhoMark } from "../kit/WhoMark.tsx"
import { fileOf } from "../model.ts"
import { jumpId } from "../step-page/state.ts"
import { ApprovePrimaryControl, ApproveStatusNotice } from "./ApproveCardMenus.tsx"
import {
  computeApproveCardState,
  type DecisionRoute,
  humanPlanItems,
  humanQuestions,
  isFinalApprovalQuestion,
  isPlanApprovalQuestion,
} from "./approve-card-state.ts"
import { GetApproval } from "./GetApproval.tsx"
import { OutsideBar } from "./OutsideBar.tsx"
import { useTurnSnapshot } from "./projection.ts"

export { humanPlanItems, humanQuestions, isFinalApprovalQuestion, isPlanApprovalQuestion }

/** Scroll the Your call into view and give it focus. */
function jumpToCall(id: string): void {
  const el = document.getElementById(jumpId(id))
  if (el === null) {
    jumpToItem(id)
    return
  }
  for (let parent = el?.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
  }
  el?.scrollIntoView?.({ block: "center", behavior: "smooth" })
  el?.focus?.({ preventScroll: true })
}

function outsideContextWords(surface: TaskSurfaceProps, terminal: boolean, here: boolean): string {
  if (terminal) return here ? "Waiting in your own agent" : "Stopped in your own agent"
  const name = agentName(surface.task.outside?.agent ?? agentIdOf(surface.task))
  return `${name} stays outside the App. You can approve here, or mark what should change, without moving the agent.`
}

async function submitPlanDecision(
  surface: TaskSurfaceProps,
  decision: "approved" | "changes",
  remark: string | undefined,
  route: DecisionRoute,
  here: boolean,
): Promise<string | null> {
  try {
    if (decision === "approved" && route === "schedule") {
      window.dispatchEvent(
        new CustomEvent("qualitylayer:build-schedule", { detail: surface.task.id }),
      )
      return null
    }
    let saved: boolean | undefined
    if (decision === "approved" && route !== "choose" && here && surface.buildHere) {
      saved = await surface.buildHere.start(
        remark,
        route === "compact" ? { compact: true } : undefined,
      )
    } else if (surface.onPlanDecision) {
      saved = await surface.onPlanDecision(decision, remark)
    } else if (remark === undefined) {
      await surface.live.decide(decision)
      saved = true
    } else {
      await surface.api.gate(surface.task.id, decision, remark, surface.task.gate?.id)
      surface.reload()
      saved = true
    }
    return saved === false ? "Could not send your decision. Your draft is kept; try again." : null
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Could not send your decision. Try again."
  }
}

function CallsLeftChip({
  taskId,
  calls,
  reason,
}: {
  taskId: string
  calls: Item[]
  reason: string | null
}) {
  return (
    <>
      <button
        type="button"
        className="ir-call-chip"
        data-testid="calls-left"
        title="Go to the first call"
        onClick={() => jumpToCall(calls[0]?.id ?? "")}
      >
        <WhoMark who="you" />
        {calls.length === 1 ? "1 call left" : `${calls.length} calls left`}
      </button>
      {reason ? (
        <span id={`plan-approval-reason-${taskId}`} hidden>
          {reason}
        </span>
      ) : null}
    </>
  )
}

function usePlanDecider(surface: TaskSurfaceProps, here: boolean, terminal: boolean) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: another task clears this one's error
  useEffect(() => {
    setError(null)
  }, [surface.task.id])
  const defaultRoute: DecisionRoute = here ? (terminal ? "compact" : "here") : "choose"
  const decide = async (
    decision: "approved" | "changes",
    remark?: string,
    route: DecisionRoute = defaultRoute,
  ) => {
    setSaving(true)
    setError(null)
    const err = await submitPlanDecision(surface, decision, remark, route, here)
    if (err !== null) setError(err)
    setSaving(false)
  }
  return { saving, error, decide }
}

/** The single Plan action bar. Feedback remains a draft until the guarded decision is saved. */
export function ApproveCard({
  items,
  busy,
  surface,
}: {
  items: Item[]
  busy: boolean
  surface: TaskSurfaceProps
}) {
  const turn = useTurnSnapshot(surface.task.id)
  const state = computeApproveCardState(items, turn, busy, surface)
  const { saving, error, decide } = usePlanDecider(surface, state.here, state.terminal)

  useMainShortcut({
    label: state.approveLabel,
    disabled: state.disabled || saving,
    onClick: () => void decide(state.changes ? "changes" : "approved"),
  })

  return (
    <>
      {state.outside ? (
        <OutsideBar
          testId="plan-outside-context"
          label="Agent location"
          words={outsideContextWords(surface, state.terminal, state.here)}
        />
      ) : null}
      <fieldset
        className={`ir-plan-approval${state.outside ? " ir-plan-approval-owner-outside" : ""}`}
        data-testid="plan-review-actions"
        aria-label="Plan review actions"
      >
        {error ? <span role="alert">{error}</span> : null}
        {state.callsLeft ? (
          <CallsLeftChip taskId={surface.task.id} calls={state.calls} reason={state.reason} />
        ) : null}
        <GetApproval
          key={surface.task.id}
          task={surface.task.id}
          detail={surface.task}
          readPlan={() =>
            surface.api
              .doc(surface.task.id, fileOf(surface.task, "plan"))
              .then((value) => value.markdown)
          }
          disabled={state.disabled || saving}
          onSettled={surface.reload}
        />
        <span className="ir-plan-approve-group">
          <ApproveStatusNotice
            taskId={surface.task.id}
            reviewPending={state.reviewPending}
            reviewRunning={state.review?.state === "running"}
            reviewLabel={state.reviewLabel}
            explanation={state.explanation}
            waiting={state.waiting}
            callsLeft={state.callsLeft}
            reason={state.reason}
            locked={state.locked}
          />
          {!state.reviewPending ? (
            <ApprovePrimaryControl
              taskId={surface.task.id}
              disabled={state.disabled}
              saving={saving}
              notReady={state.notReady}
              changes={state.changes}
              reason={state.reason}
              waiting={state.waiting}
              explanation={state.explanation}
              buildHere={state.buildHere}
              terminal={state.terminal}
              here={state.here}
              approveLabel={state.approveLabel}
              onDecide={(decision, route) => void decide(decision, undefined, route)}
            />
          ) : null}
        </span>
      </fieldset>
    </>
  )
}
