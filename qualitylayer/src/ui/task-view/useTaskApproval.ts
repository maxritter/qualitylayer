import { type RefObject, useRef, useState } from "react"
import type { ItemAnswer } from "../../core/items.ts"
import type { Api, TaskDetail } from "../api.ts"
import { clearIntent } from "../build-here-intent.ts"
import type { BuildLaunchSelection } from "../ImplementStart.tsx"
import {
  type BuildApprovalRecord,
  gateKeyOf,
  isPlanAlreadyApproved,
  resolveBuildApproval,
} from "./task-approval-helpers.ts"
import { useGateDecision } from "./useGateDecision.ts"

export type Foreground = { task: string; view: string; reader: boolean }

type ApprovalContext = {
  api: Pick<Api, "gate" | "review">
  task: TaskDetail
  view: string
  answers: Record<string, ItemAnswer>
  flush: () => Promise<void>
  clear: () => void
  reload: () => void
  foreground: RefObject<Foreground>
  mounted: RefObject<boolean>
  /** Takes the person to the page that starts the build once the Plan is approved. */
  openStart: () => void
  onBuildLaunch?: (selection: BuildLaunchSelection) => void
  showBuild: () => void
}

async function runBuildConfirmation({
  context,
  gate,
  approval,
  launch,
  selection,
  origin,
  onClearChoice,
  onFailed,
}: {
  context: ApprovalContext
  gate: ReturnType<typeof useGateDecision>
  approval: BuildApprovalRecord
  launch: () => Promise<void>
  selection: BuildLaunchSelection | null
  origin: Foreground
  onClearChoice: () => void
  onFailed: () => void
}) {
  try {
    if (!approval.approved) {
      const approved = await gate.decide("approved", approval.remark, undefined, true)
      if (approved !== true || !approval.approved) {
        throw new Error(
          gate.decisionFailure.current ??
            "The Plan was not approved. Review its pending choices before starting.",
        )
      }
    }
    await launch()
    const canFinishUi =
      selection !== null &&
      context.mounted.current &&
      context.foreground.current.task === context.task.id
    if (!canFinishUi) return
    context.onBuildLaunch?.(selection)
    onClearChoice()
    if (context.foreground.current === origin || context.foreground.current.view === "implement") {
      context.showBuild()
    }
  } catch (cause) {
    if (approval.approved && selection !== null) onFailed()
    throw cause
  }
}

function captureActiveElement() {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

/** Owns the decision transaction and the approval kept while choosing where to build. */
export function useTaskApproval(context: ApprovalContext) {
  const { task, foreground } = context
  const [implementationChoice, setImplementationChoice] = useState<string | null>(null)
  const [buildScheduleDefault, setBuildScheduleDefault] = useState(false)
  const buildOpener = useRef<{ task: string; element: HTMLElement | null } | null>(null)
  const buildApproval = useRef<BuildApprovalRecord | null>(null)
  const buildConfirming = useRef(false)
  const [buildBusy, setBuildBusy] = useState(false)
  const [buildLaunchFailed, setBuildLaunchFailed] = useState(false)

  const prepareBuild = (remark?: string) => {
    buildApproval.current = {
      task: task.id,
      gate: gateKeyOf(task),
      approved: isPlanAlreadyApproved(task),
      ...(remark !== undefined ? { remark } : {}),
    }
  }
  const openBuildChoice = (remark?: string, options?: { schedule?: boolean }) => {
    if (buildConfirming.current) return
    if (implementationChoice !== task.id) {
      buildOpener.current = { task: task.id, element: captureActiveElement() }
    }
    clearIntent(task.id)
    prepareBuild(remark)
    setBuildLaunchFailed(false)
    setBuildScheduleDefault(options?.schedule === true)
    setImplementationChoice(task.id)
  }
  const dismissImplementationChoice = () => {
    if (buildConfirming.current) return
    setImplementationChoice((current) => (current === task.id ? null : current))
  }
  const gate = useGateDecision({ ...context, openBuildChoice, buildApproval })

  const confirmBuildStart = async (
    launch: () => Promise<void>,
    selection: BuildLaunchSelection | null,
  ) => {
    if (buildConfirming.current) throw new Error("This build confirmation is already running.")
    const origin = foreground.current
    const approval = resolveBuildApproval(buildApproval.current, task)
    buildApproval.current = approval
    buildConfirming.current = true
    setBuildBusy(true)
    try {
      await runBuildConfirmation({
        context,
        gate,
        approval,
        launch,
        selection,
        origin,
        onClearChoice: () => setImplementationChoice(null),
        onFailed: () => setBuildLaunchFailed(true),
      })
    } finally {
      buildConfirming.current = false
      setBuildBusy(false)
    }
  }
  const buildApproved = () => buildApproval.current?.approved === true
  const currentBuildApproved = () =>
    buildApproved() && buildApproval.current?.gate === gateKeyOf(task)
  return {
    busy: gate.busy,
    decisionError: gate.decisionError,
    decide: gate.decide,
    implementationChoice,
    buildScheduleDefault,
    buildOpener,
    buildBusy,
    buildLaunchFailed,
    openBuildChoice,
    dismissImplementationChoice,
    confirmBuildStart,
    prepareBuild,
    buildApproved,
    currentBuildApproved,
    takeDecisionFailure: gate.takeDecisionFailure,
    resetBuildFailure: () => setBuildLaunchFailed(false),
  }
}
