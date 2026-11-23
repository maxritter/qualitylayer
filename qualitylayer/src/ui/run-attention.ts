import { flowStepOf } from "../core/flow.ts"
import { agentIdOf, shellStatus } from "../core/interaction-shell/status.ts"
import { intentReasonText } from "../core/run/contracts.ts"
import type { TaskSummary } from "./api.ts"
import { askingYou, autonomous, type ForYouItem, forYouIn } from "./model.ts"
import type { RunWindow } from "./run-context.tsx"
import { preferredBuildRun, runStatusText, runTaskId } from "./runs-api.ts"
import type { ShellGroups } from "./shell/model.ts"

export type ManagedRunGroups = {
  builds: ReadonlySet<string>
  planners?: ReadonlySet<string>
  attention: ReadonlySet<string>
  blocked?: ReadonlySet<string>
}

function hasOpenTaskNeeds(task: TaskSummary): boolean {
  if (task.needs?.some((need) => need.state === "open" || need.state === "chosen")) return true
  if ((task.openItems ?? 0) > 0 || task.live?.question != null) return true
  return task.live?.needs.some((need) => need.state === "open") ?? false
}

function explicitAttention(task: TaskSummary): boolean {
  if (autonomous(task)) return false
  if (hasOpenTaskNeeds(task)) return true
  return task.gate?.decision === "pending" && !task.gate.settled
}

function isInactiveOrAttached(task: TaskSummary, now: number): boolean {
  if (task.archived || task.stage === "shipped" || task.stage === "abandoned" || task.handedBack)
    return true
  if (agentIdOf(task) !== null || task.action !== null) return true
  return (
    explicitAttention(task) || askingYou(task, now) || shellStatus(task, now).state === "stopped"
  )
}

function isActivePlanningRun(run: RunWindow, taskId: string): boolean {
  if (runTaskId(run) !== taskId || run.attention === "waiting") return false
  if (!["validated", "starting", "running"].includes(run.status)) return false
  if (run.purpose.kind === "new-task") return true
  return run.purpose.kind === "task" && run.purpose.phase === "planning"
}

/** The allocated task exists before its native planner has attached a task session. */
export function startingPlanningRun(
  runs: readonly RunWindow[],
  task: TaskSummary,
  now = Date.now(),
): RunWindow | undefined {
  if (isInactiveOrAttached(task, now)) return undefined
  return runs
    .filter((run) => isActivePlanningRun(run, task.id))
    .sort(
      (a, b) =>
        (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) ||
        b.generation - a.generation,
    )[0]
}

/** A newer task build supersedes an older blocker, including when its process has ended. */
export function blockedBuildRun(runs: readonly RunWindow[], task: string): RunWindow | undefined {
  const run = runs
    .filter(
      (run) => run.purpose.kind === "task" && run.purpose.task === task && runTaskId(run) === task,
    )
    .sort(
      (a, b) =>
        (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) ||
        b.generation - a.generation ||
        b.id.localeCompare(a.id),
    )[0]
  return run?.intent?.state === "blocked" &&
    run.intent.task === task &&
    run.nativeSession &&
    run.intent.nativeSession === run.nativeSession
    ? run
    : undefined
}

export function blockedRunReason(run: RunWindow): string {
  const reason =
    intentReasonText(run.intent) || "The agent is blocked. Open its session to inspect the blocker."
  return ["stopped", "failed", "stopping"].includes(run.status)
    ? `${runStatusText(run)} · ${reason}`
    : reason
}

/** A live builder removes only the launch prompt, never an outstanding human choice. */
export function projectBuildGroups(groups: ShellGroups, managed?: ManagedRunGroups): ShellGroups {
  if (!managed) return groups
  const builds = groups.open.filter(
    (task) => managed.builds.has(task.id) || managed.planners?.has(task.id),
  )
  const running = [
    ...new Map([...groups.running, ...builds].map((task) => [task.id, task])).values(),
  ].filter((task) => !managed.blocked?.has(task.id) && !managed.attention.has(task.id))
  return {
    ...groups,
    you: [
      ...new Map(
        [
          ...groups.you.filter(
            (task) =>
              (!managed.builds.has(task.id) && !managed.planners?.has(task.id)) ||
              managed.attention.has(task.id),
          ),
          ...builds.filter((task) => managed.attention.has(task.id)),
        ].map((task) => [task.id, task]),
      ).values(),
    ],
    running,
    progress: running,
  }
}

function isLiveTaskStage(task: TaskSummary): boolean {
  return task.stage !== "shipped" && task.stage !== "abandoned" && task.handedBack === undefined
}

function blockedRecoveryItem(task: TaskSummary, run: RunWindow): ForYouItem {
  return {
    key: `task:${task.id}`,
    kind: "task",
    task: task.id,
    title: task.title,
    step: flowStepOf(task.stage) ?? "implement",
    since: Date.parse(run.intent?.armedAt ?? "") || task.waitingSince || task.created,
    action: { label: "Open agent", route: { view: "task", id: task.id, doc: null } },
    own: { task, group: undefined },
    agentIssue: {
      run: run.id,
      generation: run.generation,
      reason: blockedRunReason(run),
    },
  }
}

function resolveAttentionItem(
  item: ForYouItem,
  blocked: Map<string, RunWindow>,
  runs: readonly RunWindow[],
  now: number | undefined,
): ForYouItem[] {
  const { task } = item.own
  if (startingPlanningRun(runs, task, now)) return []
  const issue = blocked.get(task.id)
  if (issue && !explicitAttention(task)) return [blockedRecoveryItem(task, issue)]
  if ((!preferredBuildRun(runs, task.id) && !issue) || task.action !== "implement") return [item]
  return explicitAttention(task) ? [{ ...item, action: { ...item.action, label: "Open" } }] : []
}

function collectBlockedMap(
  openTasks: readonly TaskSummary[],
  runs: readonly RunWindow[],
): Map<string, RunWindow> {
  const blocked = new Map<string, RunWindow>()
  for (const task of openTasks) {
    if (!isLiveTaskStage(task)) continue
    const run = blockedBuildRun(runs, task.id)
    if (run) blocked.set(task.id, run)
  }
  return blocked
}

export function runAttention(input: Parameters<typeof forYouIn>[0], runs: readonly RunWindow[]) {
  const base = forYouIn(input)
  const blocked = collectBlockedMap(base.shell.open, runs)
  const items = base.items.flatMap((item) => resolveAttentionItem(item, blocked, runs, input.now))
  for (const task of base.shell.open) {
    const issue = blocked.get(task.id)
    if (issue && !items.some((item) => item.own.task.id === task.id)) {
      items.push(blockedRecoveryItem(task, issue))
    }
  }
  items.sort((a, b) => a.since - b.since)
  const managed: ManagedRunGroups = {
    planners: new Set(
      base.shell.open
        .filter((task) => startingPlanningRun(runs, task, input.now))
        .map((task) => task.id),
    ),
    builds: new Set(
      base.shell.open
        .filter(
          (task) =>
            isLiveTaskStage(task) && (preferredBuildRun(runs, task.id) || blocked.has(task.id)),
        )
        .map((t) => t.id),
    ),
    attention: new Set(items.map((item) => item.own.task.id)),
    blocked: new Set(blocked.keys()),
  }
  return {
    ...base,
    items,
    shell: projectBuildGroups(base.shell, managed),
    managed,
  }
}
