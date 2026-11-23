import { useEffect, useRef, useSyncExternalStore } from "react"
import type { ItemAnswer } from "../../core/items.ts"
import { agentName } from "../../core/live/liveness.ts"
import type { TaskAgentControls } from "../agent-window/task-controls.ts"
import type { Api, TaskDetail } from "../api.ts"
import {
  clearIntent,
  continuation,
  intentPlanner,
  readIntent,
  subscribeIntents,
} from "../build-here-intent.ts"
import type { RunWindow, useOptionalRuns } from "../run-context.tsx"
import { buildRunForTask } from "../runs-api.ts"
import {
  findTaskPlanner,
  isOutlineHereReady,
  resolveBuildHereReason,
  resolvePlannerReason,
  runBuildInTerminal,
  runStartHere,
} from "./build-handoff-helpers.ts"
import type { useTaskApproval } from "./useTaskApproval.ts"

type BuildHandoff = {
  api: Pick<Api, "config" | "buildHere">
  task: TaskDetail
  view: string
  windows: ReturnType<typeof useOptionalRuns>
  planControls?: TaskAgentControls
  answers: Record<string, ItemAnswer>
  flush: () => Promise<void>
  reload: () => void
  approval: Pick<
    ReturnType<typeof useTaskApproval>,
    "prepareBuild" | "confirmBuildStart" | "buildApproved" | "openBuildChoice" | "resetBuildFailure"
  >
}

/** Continues the approved Plan in its existing native session or waiting terminal. */
export function useBuildHandoff({
  api,
  task,
  view,
  windows,
  planControls,
  answers,
  flush,
  reload,
  approval,
}: BuildHandoff) {
  const planner = findTaskPlanner(windows?.runs, task.id, planControls)
  const plannerReason = resolvePlannerReason(planner, windows?.adapter.conversation !== undefined)
  const buildHereReason = resolveBuildHereReason(task, plannerReason)
  // The person's one click, kept while the planner finishes its turn (in this App's memory only);
  // the App-wide BuildHereContinuation continues it at the planner's next turn end on any page.
  const intent = useSyncExternalStore(subscribeIntents, () => readIntent(task.id))
  const buildRunning = windows?.runs.some((run) => buildRunForTask(run, task.id)) ?? false
  const liveRuns = useRef<readonly RunWindow[]>([])
  liveRuns.current = windows?.runs ?? []

  const startHere = (run: RunWindow, remark?: string) =>
    runStartHere({ api, task, run, remark, windows, liveRuns, reload, approval })

  const buildHere = async (remark?: string) => {
    if (buildHereReason !== null || planner === null)
      throw new Error(buildHereReason ?? "No planning session of this task in the App")
    return startHere(planner, remark)
  }

  // A planner in the person's terminal that waits on this approval: the App records the route
  // (its session, this gate) before the approval, and that session builds it next.
  const terminalPlanner =
    task.stage === "plan" && task.outside?.phase === "planning" ? task.outside : null
  const buildInTerminal = (remark?: string, options?: { compact?: boolean }) =>
    runBuildInTerminal({
      api,
      task,
      view,
      answers,
      flush,
      reload,
      agent: terminalPlanner?.agent ?? null,
      remark,
      options,
    })

  const next = continuation(intent, {
    task: task.id,
    stage: task.stage,
    decision: task.gate?.decision,
    buildRunning,
    runsLoaded: windows !== null,
    planner: intent === null || windows === null ? null : intentPlanner(intent, windows.runs),
  })
  useEffect(() => {
    if (intent !== null && next === "disarm" && windows !== null) clearIntent(task.id)
  }, [intent, next, windows, task.id])
  const waitingHere =
    intent !== null && next !== "disarm" && next !== "stopped"
      ? `Approved · ${agentName(intent.agent)} builds here when its turn ends`
      : null
  /** Approved and not started: the planning session can still take the build (also after a reload). */
  const approvedUnstarted =
    (task.action === "implement" ||
      (task.stage === "plan" && task.gate?.decision === "approved")) &&
    !buildRunning
  const outlineHere = isOutlineHereReady(task, approvedUnstarted, planner, plannerReason)
  return {
    planner,
    buildHereReason,
    waitingHere,
    approvedUnstarted,
    outlineHere,
    startHere,
    buildHere,
    terminalPlanner,
    buildInTerminal,
  }
}
