import { useCallback, useEffect, useRef, useState } from "react"
import type { ViewerState } from "../../core/run/protocol.ts"
import type { RunWindow } from "../run-context.tsx"
import type { PlanUpdateOutcome } from "./plan-feedback.ts"
import {
  acknowledgesInterrupt,
  boundPlanUpdate,
  buildTaskControlsPayload,
  createInterruptRequest,
  ended,
  type InterruptRequest,
  isInterruptRequestStale,
  mayStop,
  type SessionRows,
  sameScope,
  type TaskAgentControls,
  type TaskTurnEnd,
  useStableSessionRows,
} from "./task-controls-helpers.ts"

export type { SessionRows, TaskAgentControls, TaskTurnEnd }

export function requireStopped(action: string, required: boolean, result: RunWindow | undefined) {
  if (action !== "stop" || !required) return
  if (result && ended(result.status)) return
  throw new Error("The session has not confirmed it stopped. Try Stop session again.")
}

type UseTaskControlsInput = {
  run: RunWindow
  status: RunWindow["status"]
  attention: RunWindow["attention"]
  viewer: ViewerState | undefined
  readOnly: boolean
  allowReadOnlyStop: boolean
  busy: boolean
  canInterrupt: boolean
  act(action: "interrupt" | "stop"): Promise<boolean | undefined>
  onControls?(controls: TaskAgentControls | undefined): void
  updatePlan?: () => Promise<PlanUpdateOutcome>
  session?: SessionRows
}

function useRunActionCallbacks(
  run: Pick<RunWindow, "id" | "generation" | "nativeSession">,
  current: {
    current: {
      run: string
      generation: number
      nativeSession: string | undefined
      canStop: boolean
      canInterrupt: boolean
      act(action: "interrupt" | "stop"): Promise<boolean | undefined>
      updatePlan?: (() => Promise<PlanUpdateOutcome>) | undefined
      readOnly: boolean
      busy: boolean
    }
  },
) {
  const invoke = useCallback(
    async (action: "interrupt" | "stop") => {
      const now = current.current
      const allowed = action === "stop" ? now.canStop : now.canInterrupt
      const bound = sameScope(now, {
        id: run.id,
        generation: run.generation,
        nativeSession: run.nativeSession,
      })
      return bound && allowed ? (await now.act(action)) === true : false
    },
    [run.id, run.generation, run.nativeSession, current],
  )
  const interrupt = useCallback(() => invoke("interrupt"), [invoke])
  const stop = useCallback(() => invoke("stop"), [invoke])
  const update = useCallback(
    () =>
      boundPlanUpdate(current.current, {
        id: run.id,
        generation: run.generation,
        nativeSession: run.nativeSession,
      }),
    [run.id, run.generation, run.nativeSession, current],
  )
  return { interrupt, stop, update }
}

export function useTaskControls(input: UseTaskControlsInput) {
  const { run, status, attention, viewer, readOnly, allowReadOnlyStop, busy, canInterrupt } = input
  const { act, onControls, updatePlan, session } = input
  const [request, setRequest] = useState<InterruptRequest>()
  const sessionRows = useStableSessionRows(session)
  const lastEnd = useRef<TaskTurnEnd | undefined>(undefined)
  const active = !ended(status)
  const sameViewer = viewer?.generation === run.generation
  const canStop = mayStop({ active, sameViewer, viewer, readOnly, allowReadOnlyStop })
  const snapshot = {
    run: run.id,
    generation: run.generation,
    nativeSession: run.nativeSession,
    canStop,
    canInterrupt,
    act,
    updatePlan,
    readOnly,
    busy,
  }
  const current = useRef(snapshot)
  current.current = snapshot
  useEffect(() => {
    if (request && isInterruptRequestStale(request, run, active)) setRequest(undefined)
  }, [active, request, run])
  const observeTurnEnd = useCallback((end: TaskTurnEnd) => {
    const now = current.current
    if (
      !sameScope(end, { id: now.run, generation: now.generation, nativeSession: now.nativeSession })
    )
      return
    lastEnd.current = end
    setRequest((pending) => (acknowledgesInterrupt(pending, end) ? undefined : pending))
  }, [])
  const { interrupt, stop, update } = useRunActionCallbacks(run, current)
  const canExpose = sameViewer || (!active && updatePlan !== undefined && !readOnly)
  useEffect(() => {
    onControls?.(
      buildTaskControlsPayload({
        canExpose,
        runId: run.id,
        generation: run.generation,
        nativeSession: run.nativeSession,
        agent: run.agent,
        status,
        attention,
        canInterrupt,
        canStop,
        busy,
        interruptRequested: request !== undefined,
        interrupt,
        stop,
        updatePlan,
        update,
        sessionRows,
      }),
    )
    return () => onControls?.(undefined)
  }, [
    onControls,
    canExpose,
    run.id,
    run.generation,
    run.nativeSession,
    run.agent,
    status,
    attention,
    canInterrupt,
    canStop,
    busy,
    request,
    interrupt,
    stop,
    updatePlan,
    update,
    sessionRows,
  ])
  return {
    canStop,
    interruptRequested: request !== undefined,
    observeTurnEnd,
    actionStarted: (action: string) => {
      if (action === "interrupt" && onControls)
        setRequest(createInterruptRequest(run, lastEnd.current))
    },
    actionFailed: (action: string) => {
      if (action === "interrupt") setRequest(undefined)
    },
  }
}
