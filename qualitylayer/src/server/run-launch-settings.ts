import { knownFrom, storedModelLists } from "../core/agents/model-list-store.ts"
import { AGENT_OWN, canSetBuildWorkers, renamedProvider } from "../core/agents/model-values.ts"
import {
  type Config,
  defaultAgentView,
  type PlanningLaunch,
  SESSION_MODEL,
} from "../core/config-values.ts"
import type { RunRecord, RunSettings, StartRequest } from "../core/run/contracts.ts"
import { acceptedFreshPermission } from "../core/run/fresh.ts"
import {
  defaultPermissionChoice,
  ownPermissionOnly,
  permissionChoice,
  permissionFor,
} from "../core/run/launch-spec.ts"
import { resumedPlanningModels } from "../core/run/planning-start.ts"
import type { Task } from "../core/task/store.ts"
import { taskFlow } from "../core/task-flow.ts"
import type { Ctx } from "../ctx.ts"

export {
  agentArgs,
  assertEnabled,
  availableShells,
  chosenSession,
  loginShell,
  terminalShell,
} from "./run-launch-settings-shell.ts"

function rememberedLaunch(
  config: Config,
  request: StartRequest,
  planned: PlanningLaunch | null | undefined,
  building: boolean,
) {
  if (building) return planned?.agent === request.agent ? planned : undefined
  if (request.purpose.kind !== "new-task") return undefined
  const last = config.planning.lastStart
  return last?.agent === request.agent ? last : undefined
}

/**
 * The person's persisted default, or the first-use default, when the agent supports it.
 */
function defaultPermission(
  agent: Exclude<RunRecord["agent"], "other">,
  config: Config,
): RunSettings["perm"] {
  return permissionFor(agent, config.perm)
}
export function settingsOf(
  config: Config,
  request: StartRequest,
  planned?: PlanningLaunch | null,
  small = false,
  native?: Pick<RunSettings, "model" | "effort">,
): RunSettings {
  const building = request.purpose.kind === "task" && request.purpose.phase !== "planning"
  // New terminal opens the agent as the person would in their own terminal: its own settings.
  const plain = request.purpose.kind === "terminal"
  const models = configuredModels(config, request, building, plain, small)
  const inherited = rememberedLaunch(config, request, planned, building)
  return {
    perm: plain || request.agent === "other" ? "own" : defaultPermission(request.agent, config),
    typeFrom: config.typeFrom,
    onQuit: config.onQuit,
    windowMode: plain ? "open" : config.windowMode,
    agentView: plain ? "terminal" : defaultAgentView(config),
    ...(["new-task", "task"].includes(request.purpose.kind) ? { answers: "app" as const } : {}),
    ...models,
    ...inheritedSettings(request.agent, inherited),
    ...(building && !request.resumeNative && canSetBuildWorkers(request.agent)
      ? { model: models.model }
      : {}),
    ...native,
    ...request.settings,
    ...permissionChoice(request.agent, request.settings ?? {}),
    ...(inherited ? {} : agentPermission(request, config)),
    fastMode: undefined,
  }
}

function configuredModels(
  config: Config,
  request: StartRequest,
  building: boolean,
  plain: boolean,
  small: boolean,
): Partial<RunSettings> {
  const agent = request.agent === "other" ? "codex" : request.agent
  const defaults = building ? config.implement.defaults[agent] : config.planning.defaults[agent]
  const model = building
    ? config.implement.defaults[agent][small ? "builder" : "orchestrator"]
    : config.planning.defaults[agent].model
  const subagentModel = request.workers ?? config.implement.defaults[agent].subagents
  return {
    ...(request.agent === "other" || plain ? {} : { model, effort: defaults.effort }),
    ...(building && canSetBuildWorkers(request.agent)
      ? { subagentModel: subagentModel === SESSION_MODEL ? AGENT_OWN : subagentModel }
      : {}),
  }
}

function inheritedSettings(
  agent: RunRecord["agent"],
  inherited: PlanningLaunch | undefined,
): Partial<RunSettings> {
  if (!inherited) return {}
  return {
    model: inherited.model,
    ...permissionChoice(agent, {
      perm: inherited.perm,
      ...(inherited.permMode ? { permMode: inherited.permMode } : {}),
    }),
  }
}
/**
 * The permission mode an agent's session starts in when the launch names none: the mode set in
 * Settings › Agents for that agent. A launch names one with a `permMode` or any explicit level,
 * including `own`. A plain terminal, an ask and another agent
 * always use the agent's own settings. The global `perm` level stays the default for the rest.
 */
function agentPermission(
  request: StartRequest,
  config: Config,
): ReturnType<typeof permissionChoice> {
  const { agent, settings, purpose } = request
  if (agent === "other" || purpose.kind === "terminal") return {}
  const mode = config.agents[agent].permMode
  const named = settings?.permMode !== undefined || settings?.perm !== undefined
  return mode === "" || named
    ? {}
    : permissionChoice(agent, mode === "own" ? { perm: "own" } : { permMode: mode })
}

async function smallBuild(ctx: Ctx, task: Task | undefined, input: StartRequest): Promise<boolean> {
  if (!task || input.resumeNative || input.settings?.model !== undefined) return false
  if (!canSetBuildWorkers(input.agent) || input.purpose.kind !== "task") return false
  if (input.purpose.phase === "planning") return false
  return (await taskFlow(ctx, task)).flow.light === true
}

export async function prepareStartSettings(
  ctx: Ctx,
  config: Config,
  input: StartRequest,
  source: { planned: PlanningLaunch | null; task?: Task; existing?: RunRecord },
): Promise<RunSettings> {
  const { planned, task, existing } = source
  const small = existing ? false : await smallBuild(ctx, task, input)
  const native = !existing && task ? resumedPlanningModels(ctx, task, input) : undefined
  const settings = settingsOf(config, input, planned, small, native)
  if (!existing && input.agent === "pi" && settings.model) {
    const lists = await storedModelLists(ctx)
    settings.model = renamedProvider("pi", settings.model, knownFrom(lists.pi)) ?? settings.model
  }
  if (task && input.settings?.answers === undefined) settings.answers = task.answers
  if (input.agent === "other" && !ownPermissionOnly(settings))
    throw new Error("This run uses the agent's own settings")
  if (settings.perm !== "bypass" || input.confirmBypass === true) return settings
  const defaultChoice = defaultPermissionChoice(
    config,
    input.agent,
    input.purpose.kind === "new-task" ? config.planning.lastStart : planned,
  )
  if (defaultChoice.perm === "bypass") return settings
  if (existing && (await acceptedFreshPermission(ctx, existing, settings))) return settings
  throw new Error("Confirm this agent's Bypass permission mode for this run")
}
