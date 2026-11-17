import type { StartRequest } from "../../core/run/contracts.ts"
import { requireStopped } from "../agent-window/task-controls.ts"
import type { TaskDetail } from "../api.ts"
import type { RunAdapter, RunWindow } from "../run-context.tsx"
import { runTaskId } from "../runs-api.ts"
import { taskPlanningLaunch } from "./task-launch.ts"

export function canSwitchTaskAgent(task: TaskDetail, run: RunWindow): boolean {
  const planning =
    run.purpose.kind === "new-task" ||
    (run.purpose.kind === "task" && run.purpose.phase === "planning")
  return (
    !task.archived &&
    !task.earlier &&
    task.stage !== "abandoned" &&
    task.type !== "chat" &&
    task.outside === undefined &&
    run.agent !== "other" &&
    run.cwd.length > 0 &&
    runTaskId(run) === task.id &&
    (run.purpose.kind === "task" || run.purpose.kind === "new-task") &&
    (!planning || taskPlanningLaunch(task))
  )
}

export async function continueInAnotherAgent({
  previous,
  request,
  control,
  start,
  cancelled,
  onStarting,
}: {
  previous: RunWindow
  request: StartRequest
  control: RunAdapter["control"]
  start: RunAdapter["start"]
  cancelled(): boolean
  onStarting(): void
}): Promise<RunWindow | undefined> {
  if (request.agent === previous.agent || request.agent === "other")
    throw new Error("Choose a different installed agent.")
  if (previous.purpose.kind !== "task" && previous.purpose.kind !== "new-task")
    throw new Error("Choose this task's agent session.")
  if (
    request.purpose.kind !== "task" ||
    request.purpose.task !== runTaskId(previous) ||
    request.cwd !== previous.cwd ||
    request.works !== "checkout"
  )
    throw new Error("Continue from this task's current checkout.")
  if (cancelled()) return undefined
  // Stop's existing owner waits for native cleanup and process exit, including failed hosts.
  const stopped = await control(previous.id, { action: "stop", generation: previous.generation })
  requireStopped("stop", true, stopped)
  if (
    !stopped ||
    stopped.id !== previous.id ||
    stopped.generation !== previous.generation ||
    stopped.nativeSession !== previous.nativeSession
  )
    throw new Error("The previous session changed. Reopen Continue in another agent.")
  if (cancelled()) return undefined
  onStarting()
  return start(request)
}
