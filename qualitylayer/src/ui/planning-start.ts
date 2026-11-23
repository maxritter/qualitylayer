import { type PlanningLaunch, planningLaunchOf } from "../core/config-values.ts"
import type { RunWindow } from "./run-context.tsx"

function isPlanningPurpose(purpose: RunWindow["purpose"]): boolean {
  if (purpose.kind === "new-task") return true
  return purpose.kind === "task" && purpose.phase === "planning"
}

function isRetainedPlanningRun(candidate: RunWindow, task: string | undefined): boolean {
  if (task !== undefined && candidate.task !== task) return false
  if (candidate.startPhase !== "ready" || candidate.status === "failed") return false
  return isPlanningPurpose(candidate.purpose)
}

/** Older tasks can retain their successful planning setup in a native run. */
export function retainedPlanningStart(
  task: string | undefined,
  runs: readonly RunWindow[],
): PlanningLaunch | null {
  const run = runs
    .filter((candidate) => isRetainedPlanningRun(candidate, task))
    .sort((a, b) =>
      task ? b.updatedAt.localeCompare(a.updatedAt) : b.startedAt.localeCompare(a.startedAt),
    )[0]
  if (!run?.settings) return null
  return planningLaunchOf({
    ...(Number.isFinite(Date.parse(run.startedAt)) ? { at: Date.parse(run.startedAt) } : {}),
    agent: run.agent,
    model: run.settings.model ?? "",
    effort: run.settings.effort ?? "",
    perm: run.settings.perm,
    permMode: run.settings.permMode ?? "",
    runWhere: "app",
    works: run.worktreePath ? "worktree" : run.branch ? "branch" : "checkout",
  })
}
