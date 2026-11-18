import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { canSetBuildWorkers } from "../agents/model-values.ts"
import { readConfig, writeConfig } from "../config.ts"
import { type PlanningLaunch, planningLaunchOf } from "../config-values.ts"
import type { Task } from "../task/store.ts"
import type { RunRecord, StartRequest } from "./contracts.ts"
import { observedNativeSettings } from "./effective-native-settings.ts"
import { listRuns } from "./registry.ts"

function isPlanningRun(run: RunRecord): boolean {
  if (run.purpose.kind === "new-task") return true
  return run.purpose.kind === "task" && run.purpose.phase === "planning"
}

function readyPlanner(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  native?: { agent: RunRecord["agent"]; session: string },
): RunRecord | undefined {
  return listRuns(ctx.home)
    .filter((run) => run.taskRuntimeDir === task.runtimeDir && run.startPhase === "ready")
    .filter(isPlanningRun)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .find((run) =>
      native
        ? run.agent === native.agent && run.nativeSession === native.session
        : run.status !== "failed",
    )
}

/** The person's pending model and effort choice takes effect when this planner continues. */
function selectedPlanningSettings(ctx: Ctx, run: RunRecord) {
  const observed = observedNativeSettings(ctx, run)
  const pending = run.pendingSettings
  if (!pending || pending.error) return observed
  if (pending.generation !== run.generation || pending.nativeSession !== run.nativeSession)
    return observed
  return {
    ...observed,
    model: pending.settings.model ?? observed.model,
    effort: pending.settings.effort ?? observed.effort,
  }
}

/** Build Here takes model and effort from the exact native planning session it will resume. */
export function resumedPlanningModels(ctx: Ctx, task: Task, request: StartRequest) {
  if (!request.resumeNative || !canSetBuildWorkers(request.agent)) return undefined
  if (request.purpose.kind !== "task" || request.purpose.phase === "planning") return undefined
  const planner = readyPlanner(ctx, task, { agent: request.agent, session: request.resumeNative })
  if (!planner) return undefined
  const { model, effort } = selectedPlanningSettings(ctx, planner)
  return { model, effort }
}

/** A completed planning setup belongs to its task after another task changes global defaults. */
export async function readPlanningStart(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<PlanningLaunch | null> {
  const latest = readyPlanner(ctx, task)
  if (latest?.settings) {
    const { model: _model, effort: _effort, ...stable } = latest.settings
    const choice = planningStartOf(
      {
        ...latest,
        status: "running",
        settings: { ...stable, ...selectedPlanningSettings(ctx, latest) },
      },
      {},
    )
    if (choice) return choice
  }
  try {
    const path = join(task.runtimeDir, "planning-start.json")
    const text = ctx.fs.readRange
      ? await ctx.fs.readRange(path, 0, 16_385)
      : await ctx.fs.readFile(path)
    return text.length <= 16_384 ? planningLaunchOf(JSON.parse(text)) : null
  } catch {
    return null
  }
}

export function planningStartOf(
  run: RunRecord,
  request: Pick<StartRequest, "works">,
): PlanningLaunch | null {
  if (!isPlanningRun(run) || run.status !== "running" || run.startPhase !== "ready") return null
  return planningLaunchOf({
    ...(Number.isFinite(Date.parse(run.startedAt)) ? { at: Date.parse(run.startedAt) } : {}),
    agent: run.agent,
    model: run.settings?.model ?? "",
    effort: run.settings?.effort ?? "",
    perm: run.settings?.perm ?? "own",
    permMode: run.settings?.permMode ?? "",
    runWhere: "app",
    works: request.works ?? (run.worktreePath ? "worktree" : run.branch ? "branch" : "checkout"),
  })
}

export async function writePlanningStart(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  choice: PlanningLaunch,
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    join(task.runtimeDir, "planning-start.json"),
    `${JSON.stringify(choice)}\n`,
  )
}

export async function rememberPlanningStart(ctx: Ctx, choice: PlanningLaunch): Promise<void> {
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.withLock(join(ctx.home, "planning-start.lock"), async () => {
    const previous = (await readConfig(ctx)).planning.lastStart
    if ((previous?.at ?? 0) <= (choice.at ?? 0))
      await writeConfig(ctx, { planning: { lastStart: choice } })
  })
}
