import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type { Config } from "../core/config-values.ts"
import { folderDoc } from "../core/docs/names.ts"
import { readGate } from "../core/gate/gate.ts"
import type { RunPurpose, RunRecord, StartRequest } from "../core/run/contracts.ts"
import { isArchived } from "../core/task/archive.ts"
import { readSession, type Task } from "../core/task/store.ts"
import type { Ctx } from "../ctx.ts"
import { locate } from "./api.ts"
import type { resolveArtifactAgentContext } from "./artifact-agent.ts"
import {
  type ArtifactStart,
  artifactContext,
  type NewTaskStart,
  newTaskContext,
  type TerminalStart,
  terminalContext,
} from "./run-purpose-context-terminal.ts"

type ResolvedArtifact = Extract<
  Awaited<ReturnType<typeof resolveArtifactAgentContext>>,
  { ok: true }
>["data"]
export type LaunchContext = {
  cwd: string
  works: "checkout" | "branch" | "worktree"
  task?: Task
  planGate?: NonNullable<Awaited<ReturnType<typeof readGate>>>
  artifact?: ResolvedArtifact
  terminalArtifactBinding?: RunRecord["artifactBinding"]
}
type TaskStart = StartRequest & { purpose: Extract<RunPurpose, { kind: "task" }> }

async function planningTaskContext(
  ctx: Ctx,
  request: TaskStart,
  task: Task,
): Promise<LaunchContext> {
  if (!["chat", "plan"].includes(task.stage))
    throw new Error("Planning is finished; start the approved build instead")
  const cwd = realpathSync(
    task.stage === "chat"
      ? ((await readSession(ctx, task))?.checkout ?? task.repoRoot)
      : task.repoRoot,
  )
  if (request.cwd && realpathSync(resolve(request.cwd)) !== cwd)
    throw new Error("Planning continues in this task's recorded checkout")
  if (request.works && request.works !== "checkout")
    throw new Error("An existing plan continues in its recorded checkout")
  return { cwd, task, works: "checkout" as const }
}

async function buildTaskContext(
  ctx: Ctx,
  request: TaskStart,
  config: Config,
  task: Task,
  retry?: RunRecord,
): Promise<LaunchContext> {
  if (!["implement", "plan", "verify", "shipped"].includes(task.stage))
    throw new Error("The task must have an approved build to continue")
  const planGate = await buildPlanGate(ctx, task)
  const cwd = realpathSync(task.repoRoot)
  if (
    request.cwd &&
    realpathSync(resolve(request.cwd)) !== cwd &&
    !keptTaskWorktree(retry, request.cwd, cwd)
  )
    throw new Error("This task's build stays in its recorded checkout")
  const works =
    request.works ??
    (request.agent === "other"
      ? "checkout"
      : config.implement.defaults[request.agent].buildingWorks)
  if (!["checkout", "branch", "worktree"].includes(works))
    throw new Error("Choose this checkout, a new branch or a new worktree")
  return { cwd, task, planGate, works: works as "checkout" | "branch" | "worktree" }
}

async function buildPlanGate(ctx: Ctx, task: Task) {
  if (task.stage !== "plan") return undefined
  const gate = await readGate(ctx, task)
  if (
    !gate ||
    gate.target !== folderDoc("plan") ||
    gate.decision !== "approved" ||
    gate.settled === true
  )
    throw new Error("The Plan must be approved before starting its build")
  return gate
}

function keptTaskWorktree(retry: RunRecord | undefined, source: string, cwd: string): boolean {
  return retry?.sourceCheckout === source && retry.worktreePath === cwd && retry.cwd === cwd
}

async function taskContext(
  ctx: Ctx,
  request: TaskStart,
  config: Config,
  retry?: RunRecord,
): Promise<LaunchContext> {
  const found = await locate(ctx, request.purpose.task)
  if (!found.ok) throw new Error(found.error.message)
  const task = found.data.task
  if (await isArchived(ctx, task))
    throw new Error("Restore this archived task before starting its agent")
  return task.stage === "chat" || request.purpose.phase === "planning"
    ? planningTaskContext(ctx, request, task)
    : buildTaskContext(ctx, request, config, task, retry)
}

export function purposeContext(
  ctx: Ctx,
  request: StartRequest,
  config: Config,
  retry?: RunRecord,
): Promise<LaunchContext> {
  switch (request.purpose.kind) {
    case "task":
      return taskContext(ctx, request as TaskStart, config, retry)
    case "artifact":
      return artifactContext(ctx, request as ArtifactStart)
    case "terminal":
      return terminalContext(ctx, request as TerminalStart)
    case "new-task":
      return newTaskContext(ctx, request as NewTaskStart, config)
  }
}
