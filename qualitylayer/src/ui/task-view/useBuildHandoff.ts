import { useEffect, useRef, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { AGENT_OWN, canSetBuildWorkers } from "../../core/agents/model-values.ts"
import { START_EFFORTS } from "../../core/handoff/start-values.ts"
import { type ItemAnswer, mainAction } from "../../core/items.ts"
import { agentName } from "../../core/live/liveness.ts"
import { retainedDrafts } from "../agent-window/conversation/draft-handoff.ts"
import type { TaskAgentControls } from "../agent-window/task-controls.ts"
import type { Api, TaskDetail } from "../api.ts"
import {
  advanceIntent,
  type BuildHereIntent,
  clearIntent,
  continuation,
  type IntentDeps,
  intentPlanner,
  readIntent,
  subscribeIntents,
  writeIntent,
} from "../build-here-intent.ts"
import type { BuildLaunchSelection, StartAgent } from "../ImplementStart.tsx"
import { viewedStep } from "../model.ts"
import { runsInApp } from "../outside.ts"
import type { RunWindow, useOptionalRuns } from "../run-context.tsx"
import { buildRunForTask, runColors } from "../runs-api.ts"
import { turnedMessage } from "./errors.ts"
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
  const { prepareBuild, confirmBuildStart, buildApproved, openBuildChoice, resetBuildFailure } =
    approval
  /**
   * Approve and build here (12.9): the live App planner's own native conversation continues as the
   * build. The approval is the existing gate decision; the start is the existing run start resuming
   * that conversation with its model, effort and permissions, under one key so a second click reuses
   * it. A planner still in its turn is left alone and the approval stays.
   */
  // This task's App planner: the controlled window's run, else its latest planning run, which a
  // stopped session still is while its native conversation can resume.
  const plannerOf = (run: RunWindow) =>
    run.agent !== "other" &&
    !!run.nativeSession &&
    ((run.purpose.kind === "task" &&
      run.purpose.phase === "planning" &&
      run.purpose.task === task.id) ||
      (run.purpose.kind === "new-task" && run.task === task.id))
  const planner =
    windows?.runs.find(
      (run) =>
        run.id === planControls?.run &&
        run.generation === planControls.generation &&
        run.nativeSession === planControls.nativeSession &&
        plannerOf(run),
    ) ??
    windows?.runs
      .filter(plannerOf)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .at(0) ??
    null
  const plannerEnded = planner?.status === "stopped" || planner?.status === "failed"
  // Whether the planning session can take the build: running (the App reads its conversation to find
  // a safe turn end), or stopped while it can resume. The stage does not decide it: an approval
  // settles into Implement.
  const plannerReason =
    planner === null
      ? "No planning session of this task in the App"
      : plannerEnded
        ? planner.canResume
          ? null
          : "The planning session cannot be resumed here"
        : windows?.adapter.conversation === undefined
          ? "This window cannot read the planning session"
          : null
  const buildHereReason =
    task.stage !== "plan" || task.archived || task.handedBack
      ? "The Plan is not waiting for approval"
      : !runsInApp(task) || task.outside
        ? "Planned in your own agent"
        : plannerReason
  // The person's one click, kept while the planner finishes its turn (in this App's memory only);
  // the App-wide BuildHereContinuation continues it at the planner's next turn end on any page.
  const intent = useSyncExternalStore(subscribeIntents, () => readIntent(task.id))
  const buildRunning = windows?.runs.some((run) => buildRunForTask(run, task.id)) ?? false
  const liveRuns = useRef<readonly RunWindow[]>([])
  liveRuns.current = windows?.runs ?? []
  const intentDeps = (): IntentDeps | null =>
    windows === null
      ? null
      : {
          runs: () => liveRuns.current,
          start: (request) => windows.start(request),
          stop: (run) => windows.control(run.id, { action: "stop", generation: run.generation }),
          conversation: windows.adapter.conversation
            ? (run) => windows.adapter.conversation?.(run) ?? Promise.resolve(undefined)
            : undefined,
          hasDraft: (run) => {
            const draft = retainedDrafts(run.id)?.current
            return !!draft && (draft.text.trim() !== "" || draft.files.length > 0)
          },
          buildRunning: (id) => liveRuns.current.some((run) => buildRunForTask(run, id)),
        }
  /**
   * Approve (when not yet) and continue `run`'s own conversation as the build: a stopped planner
   * resumes as it is; a running one ends at a verified turn boundary first. A planner still in its
   * turn keeps the intent; the approval stays and the next turn end continues it.
   */
  const startHere = async (run: RunWindow, remark?: string): Promise<boolean | undefined> => {
    const deps = intentDeps()
    if (deps === null) throw new Error("This window cannot start an agent yet.")
    const agent = run.agent as StartAgent
    const keepsNativeChoice = canSetBuildWorkers(agent)
    const effort = keepsNativeChoice
      ? (START_EFFORTS.find((level) => level === run.settings?.effort) ?? AGENT_OWN)
      : agent === "other"
        ? "high"
        : (await api.config()).implement.defaults[agent].effort
    const selection: BuildLaunchSelection = {
      answers: "app",
      agent,
      model: keepsNativeChoice
        ? (run.settings?.model ?? AGENT_OWN)
        : task.planningStart?.agent === agent
          ? task.planningStart.model
          : AGENT_OWN,
      effort,
      runWhere: "app",
      works: "checkout",
      continuation: "same",
    }
    // Kept only once the approval is recorded: confirmBuildStart runs the launch after it.
    const kept: BuildHereIntent = {
      task: task.id,
      nativeSession: run.nativeSession as string,
      agent: run.agent,
      // The person's click on a stopped, resumable session is the authority to resume it; a running
      // planner is released only by the App at a verified turn end.
      ...(run.status === "stopped" || run.status === "failed" ? { releasing: true as const } : {}),
      request: {
        agent,
        purpose: { kind: "task", task: task.id },
        cwd: run.cwd,
        works: "checkout",
        mode: "plain",
        settings: {
          answers: "app",
          ...(!keepsNativeChoice ? { effort } : {}),
          ...(run.settings?.perm ? { perm: run.settings.perm } : {}),
          ...(run.settings?.permMode ? { permMode: run.settings.permMode } : {}),
        },
        resumeNative: run.nativeSession as string,
        idempotencyKey: `build-here:${task.id}:${run.nativeSession}`,
        colors: runColors(),
      },
    }
    const stillPlanning = new Error("The planner is finishing its turn")
    prepareBuild(remark)
    try {
      await confirmBuildStart(async () => {
        writeIntent(kept)
        const outcome = await advanceIntent(task.id, deps)
        if (outcome !== "started") throw stillPlanning
      }, selection)
    } catch (cause) {
      if (cause !== stillPlanning) {
        clearIntent(task.id)
        // The approval stays; the existing Start the build card offers the other ways to build.
        if (task.gate?.decision === "approved" || buildApproved()) openBuildChoice(remark)
        throw cause
      }
      // The approval is kept and nothing started: the intent waits for the planner's turn to end.
      resetBuildFailure()
      reload()
      return undefined
    }
    return true
  }
  const buildHere = async (remark?: string): Promise<boolean | undefined> => {
    if (buildHereReason !== null || planner === null)
      throw new Error(buildHereReason ?? "No planning session of this task in the App")
    return startHere(planner, remark)
  }
  // A planner in the person's terminal that waits on this approval: the App records the route
  // (its session, this gate) before the approval, and that session builds it next.
  const terminalPlanner =
    task.stage === "plan" && task.outside?.phase === "planning" ? task.outside : null
  const buildInTerminal = async (
    remark?: string,
    options?: { compact?: boolean },
  ): Promise<boolean | undefined> => {
    await flush()
    const sent = await api.buildHere(task.id, {
      gateId: task.gate?.id,
      agent: terminalPlanner?.agent ?? null,
      ...(options?.compact === true ? { compact: true } : {}),
      ...(remark !== undefined ? { remark } : {}),
    })
    reload()
    if (sent.decision !== "approved") {
      const asked = mainAction(
        (task.items ?? []).filter((item) => item.step === viewedStep(view)),
        answers,
      ).changes
      toast.success(
        sent.turned === true ? turnedMessage(sent.sent, asked) : "Changes sent to the agent",
      )
      return false
    }
    return true
  }
  // Where the task is open it also knows the stage and the decision: a Plan sent back for changes,
  // or a task whose build has started, ends the kept intent here. The App-wide continuation starts it.
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
  const outlineHere =
    approvedUnstarted &&
    planner !== null &&
    plannerReason === null &&
    runsInApp(task) &&
    !task.outside
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
