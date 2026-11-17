import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type { Config } from "../core/config-values.ts"
import { folderDoc } from "../core/docs/names.ts"
import { readGate } from "../core/gate/gate.ts"
import { userHome } from "../core/install/manifest.ts"
import { canonicalPath } from "../core/platform.ts"
import type { RunPurpose, RunRecord, StartRequest } from "../core/run/contracts.ts"
import { isArchived } from "../core/task/archive.ts"
import { readSession, type Task } from "../core/task/store.ts"
import type { Ctx } from "../ctx.ts"
import { listProjects, locate } from "./api.ts"
import { resolveArtifactAgentContext } from "./artifact-agent.ts"

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
type ArtifactStart = StartRequest & { purpose: Extract<RunPurpose, { kind: "artifact" }> }
type TerminalStart = StartRequest & { purpose: Extract<RunPurpose, { kind: "terminal" }> }
type NewTaskStart = StartRequest & { purpose: Extract<RunPurpose, { kind: "new-task" }> }

async function knownCheckout(ctx: Ctx, cwd: string): Promise<string> {
  const canonical = canonicalPath(realpathSync(resolve(cwd)))
  for (const project of await listProjects(ctx))
    for (const path of project.paths) {
      try {
        if (canonicalPath(realpathSync(path)) === canonical) return canonical
      } catch {
        /* missing registered checkout */
      }
    }
  throw new Error("Choose a project folder QualityLayer knows on this computer")
}
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

async function artifactContext(ctx: Ctx, request: ArtifactStart): Promise<LaunchContext> {
  if (request.works && request.works !== "checkout")
    throw new Error("Artifact iteration stays in its registered source checkout")
  const { kind: _kind, ...address } = request.purpose
  if (!/^[a-f0-9]{64}$/.test(address.revision))
    throw new Error("Refresh the artifact source before starting")
  const resolved = await resolveArtifactAgentContext(ctx, address)
  if (!resolved.ok) throw new Error(resolved.error.message)
  const cwd = realpathSync(resolved.data.binding.folder)
  if (request.cwd && realpathSync(resolve(request.cwd)) !== cwd)
    throw new Error("This artifact opens in its registered source folder")
  return { cwd, works: "checkout" as const, artifact: resolved.data }
}

async function terminalContext(ctx: Ctx, request: TerminalStart): Promise<LaunchContext> {
  if (request.works && request.works !== "checkout")
    throw new Error("A terminal opens in the project's checkout")
  const scope = request.purpose.context
  if (scope?.kind === "agent-setup") {
    if (request.agent !== "other" || request.purpose.shell !== true)
      throw new Error("Agent setup uses its own native terminal operation")
    const home = userHome(ctx)
    if (!home.ok) throw new Error(home.reason)
    if (request.cwd && resolve(request.cwd) !== home.home)
      throw new Error("Agent setup runs in this machine's native home")
    return { cwd: home.home, works: "checkout" as const }
  }
  if (scope) {
    let cwd: string
    if (scope.kind === "task") {
      const found = await locate(ctx, scope.task)
      if (!found.ok) throw new Error(found.error.message)
      if (await isArchived(ctx, found.data.task))
        throw new Error("Restore this task before opening its terminal")
      cwd = realpathSync(found.data.task.repoRoot)
    } else {
      const { kind: _kind, ...address } = scope
      const resolved = await resolveArtifactAgentContext(ctx, {
        ...address,
        request: "Open the project shell.",
      })
      if (!resolved.ok) throw new Error(resolved.error.message)
      cwd = realpathSync(resolved.data.binding.folder)
      if (request.cwd && realpathSync(resolve(request.cwd)) !== cwd)
        throw new Error("This artifact terminal opens in its registered source folder")
      return { cwd, works: "checkout" as const, terminalArtifactBinding: resolved.data.binding }
    }
    if (request.cwd && realpathSync(resolve(request.cwd)) !== cwd)
      throw new Error("This terminal belongs to another checkout")
    return { cwd, works: "checkout" as const }
  }
  if (!request.cwd) throw new Error("A terminal needs a registered project folder")
  return { cwd: await knownCheckout(ctx, request.cwd), works: "checkout" as const }
}

async function newTaskContext(
  ctx: Ctx,
  request: NewTaskStart,
  config: Config,
): Promise<LaunchContext> {
  const requestText = request.purpose.request.trim()
  if (!requestText || requestText.length > 16_384 || requestText.includes("\0"))
    throw new Error("New task needs a bounded request")
  if (!request.cwd) throw new Error("New task needs a registered project folder")
  const works =
    request.works ??
    (request.agent === "other" ? "checkout" : config.planning.defaults[request.agent].planningWorks)
  if (!["checkout", "branch", "worktree"].includes(works))
    throw new Error("Choose this checkout, a new branch or a new worktree")
  return {
    cwd: await knownCheckout(ctx, request.cwd),
    works: works as "checkout" | "branch" | "worktree",
  }
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
