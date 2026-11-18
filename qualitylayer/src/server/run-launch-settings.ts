import { readFileSync } from "node:fs"
import { runnableFile } from "../core/agents/binary.ts"
import { AGENT_NAMES } from "../core/agents/ids.ts"
import { knownFrom, storedModelLists } from "../core/agents/model-list-store.ts"
import { AGENT_OWN, renamedProvider } from "../core/agents/model-values.ts"
import {
  type Config,
  defaultAgentView,
  type PlanningLaunch,
  SESSION_MODEL,
} from "../core/config-values.ts"
import type { RunRecord, RunSettings, StartRequest } from "../core/run/contracts.ts"
import { acceptedFreshPermission } from "../core/run/fresh.ts"
import {
  chosenNativeSession,
  defaultPermissionChoice,
  ownPermissionOnly,
  permissionChoice,
  permissionFor,
} from "../core/run/launch-spec.ts"
import type { Task } from "../core/task/store.ts"
import type { Ctx } from "../ctx.ts"

/** A new run's native session id when the agent takes one QualityLayer chooses; none for an agent that picks or creates its own. */
export function chosenSession(agent: RunRecord["agent"]): { nativeSession?: string } {
  const nativeSession = chosenNativeSession(agent)
  return nativeSession === undefined ? {} : { nativeSession }
}

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
): RunSettings {
  const building = request.purpose.kind === "task" && request.purpose.phase !== "planning"
  // New terminal opens the agent as the person would in their own terminal: its own settings.
  const plain = request.purpose.kind === "terminal"
  const models = configuredModels(config, request, building, plain)
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
): Partial<RunSettings> {
  const agent = request.agent === "other" ? "codex" : request.agent
  const defaults = building ? config.implement.defaults[agent] : config.planning.defaults[agent]
  const model = building
    ? config.implement.defaults[agent].orchestrator
    : config.planning.defaults[agent].model
  const subagentModel = request.workers ?? config.implement.defaults[agent].subagents
  return {
    ...(request.agent === "other" || plain ? {} : { model, effort: defaults.effort }),
    ...(building && request.agent === "claude-code"
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
/** An agent turned off in Settings is never started. */
export function assertEnabled(agent: RunRecord["agent"], config: Config): void {
  if (agent !== "other" && !config.agents[agent].enabled)
    throw new Error(`${AGENT_NAMES[agent]} is turned off in Settings`)
}
/** The extra arguments Settings › Agents adds to every start of a native agent. */
export function agentArgs(agent: RunRecord["agent"], config: Config): string[] | undefined {
  return agent === "other" ? undefined : config.agents[agent].args
}
/** The shells this computer lists, for New terminal's choice; at most 32. */
export function availableShells(): string[] {
  if (process.platform === "win32") return []
  try {
    return readFileSync("/etc/shells", "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("/") && runnableFile(line))
      .slice(0, 32)
  } catch {
    return []
  }
}
export function loginShell(ctx: Ctx): string {
  return (
    ctx.env.get("SHELL") ||
    (process.platform === "win32" ? ctx.env.get("COMSPEC") || "cmd.exe" : "/bin/sh")
  )
}
const LOGIN_ARGS = process.platform === "win32" ? [] : ["-l"]
/** A shell tab's program: the chosen shell or the login shell, with its arguments or `-l`. */
export function terminalShell(ctx: Ctx, config: Config): { program: string; args: string[] } {
  const { program, args } = config.terminal.shell
  return { program: program || loginShell(ctx), args: args.length > 0 ? args : [...LOGIN_ARGS] }
}

export async function prepareStartSettings(
  ctx: Ctx,
  config: Config,
  input: StartRequest,
  source: { planned: PlanningLaunch | null; task?: Pick<Task, "answers">; existing?: RunRecord },
): Promise<RunSettings> {
  const { planned, task, existing } = source
  const settings = settingsOf(config, input, planned)
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
