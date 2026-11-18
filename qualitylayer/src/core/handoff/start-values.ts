// How a build starts, as plain values: the setup the Implement start opens with (your Build
// defaults) and the one QualityLayer recommends, the lines it shows, and the model and effort the
// build's subagents run at once the person copied a start. No file access, so the App page imports
// it; start.ts records the choice on the task.

import type { NativeAgent } from "../agents/ids.ts"
import {
  AGENT_OWN,
  canSetBuildWorkers,
  customModelProblem,
  hasCustomModel,
  orchestratorModels,
} from "../agents/model-values.ts"
import {
  type Config,
  DEFAULT_CONFIG,
  DEFAULTS_EFFORTS,
  type DefaultsEffort,
  type DefaultsWhere,
  type EffortChoice,
  SESSION_MODEL,
} from "../config-values.ts"
import { AGENT_CAPABILITIES, launchSpec, startBranchLine } from "../run/launch-spec.ts"
import type { HelperRole } from "../scaling.ts"

export type StartAgent = NativeAgent | "other"
export type StartEffort = EffortChoice
export type StartWhere = "here" | "new" | "worktree"

export const START_EFFORTS: DefaultsEffort[] = DEFAULTS_EFFORTS
export const START_WHERE: StartWhere[] = ["here", "new"]

/** Settings says `this` for the session that is open; the start's own id is `here`. The one place they meet. */
export const startWhereOf = (where: DefaultsWhere): StartWhere =>
  where === "this" ? "here" : "new"

/** What the person chose: where the build runs and how. */
export type StartChoice = {
  answers?: "app" | "terminal"
  agent: StartAgent
  /** The build session's model. */
  model: string
  /** Native subagent default for this build; "" keeps the agent's setting. */
  workers: string
  /** One effort for the session and its subagents; independent review keeps its own. */
  effort: StartEffort
  fastMode?: boolean
  /** The agent's own keep-going mode (`/goal`), or one plain prompt. */
  goal: boolean
  where: StartWhere
}

/** The start the person copied, as recorded on the task. */
export type StartRecord = {
  answers?: "app" | "terminal"
  agent: StartAgent
  /** The session's model; null for another agent, which picks its own. */
  orchestrator: string | null
  /** Native subagent default for this build; "" keeps the agent's setting. */
  workers: string | null
  /** Null for another agent: its helpers keep the defaults. */
  effort: StartEffort | null
  goal: boolean
  where: StartWhere
  /** The planner session the person chose in the App (`keyOf`), for a build here; with `gate`. */
  session?: string
  /** The Plan gate this choice belongs to: a route from an earlier gate starts nothing. */
  gate?: string
  /** The person chose Compact first: the planner ends its turn with the compact advice. */
  compact?: boolean
  at: number
}

/** Claude's /goal wrapper cannot invoke its user-only workflow skill. */
export const supportsStartGoal = (agent: StartAgent): boolean => AGENT_CAPABILITIES[agent].goal

/** The models offered for the build session, the most capable first. */
export function sessionModels(agent: StartAgent): { id: string; name: string }[] {
  return agent === "other" ? [] : orchestratorModels(agent)
}

/**
 * Whether the session may run on `model`: one of the models offered, or, for an agent that takes
 * ids of its own, one the person typed in an Add a model field.
 */
export function acceptsModel(agent: StartAgent, offered: { id: string }[], model: string): boolean {
  if (agent !== "other" && model === AGENT_OWN) return true
  if (offered.some((m) => m.id === model)) return true
  return agent !== "other" && hasCustomModel(agent) && customModelProblem(agent, model) === null
}

/**
 * The start a config's Build defaults make for one agent and Plan: the build session's model (the
 * small-change one for a small change); the native subagent default from Build defaults unless
 * `workers` names another. This session is the one that planned the task: for any other agent a new
 * session stands in for it.
 */
export function startDefaults(
  config: Pick<Config, "implement" | "models">,
  agent: StartAgent,
  small: boolean,
  planned: string,
  workers?: string,
): StartChoice {
  if (agent === "other")
    return { agent, model: "", workers: "", effort: "high", goal: false, where: "new" }
  const defaults = config.implement.defaults[agent]
  const picked = workers ?? defaults.subagents
  const crew = canSetBuildWorkers(agent) && picked !== SESSION_MODEL ? picked : AGENT_OWN
  const where = startWhereOf(defaults.terminalSession)
  return {
    agent,
    model: small ? defaults.builder : defaults.orchestrator,
    workers: crew,
    effort: defaults.effort,
    goal: defaults.goal && supportsStartGoal(agent),
    where: where === "here" && agent !== planned ? "new" : where,
  }
}

/** The start QualityLayer recommends: the Build defaults of a config nobody changed. */
export const recommendedStart = (agent: StartAgent, small: boolean, planned: string) =>
  startDefaults(DEFAULT_CONFIG, agent, small, planned)

/** The prompt the session starts with: the skill command, inside the agent's goal mode when chosen. */
export function startPrompt(
  choice: Pick<StartChoice, "agent" | "goal" | "answers">,
  task: string,
): string {
  return launchSpec({
    agent: choice.agent,
    answers: choice.answers,
    purpose: { kind: "task", task },
    mode: choice.goal ? "goal" : "plain",
  }).prompt
}

/**
 * What the person types: one command, or in this session the lines to type first and then the
 * prompt. Claude Code takes the model and the effort as commands; Codex's /model opens its menu,
 * where the person picks both. The prompt is always the last line. Every line is for the agent: a
 * git command that runs in a terminal is `startTerminalLine`, never one of these.
 */
export function startLines(choice: StartChoice, task: string): string[] {
  const spec = launchSpec({
    agent: choice.agent,
    answers: choice.answers,
    purpose: { kind: "task", task },
    model: choice.model,
    effort: choice.effort,
    fastMode: choice.fastMode,
    mode: choice.goal ? "goal" : "plain",
    works: choice.where === "worktree" ? "worktree" : "checkout",
  })
  return [spec.prompt]
}

/**
 * The one command that runs in a terminal before the agent starts: `git switch -c` for a branch the
 * person chose but the App could not create. A new worktree makes its own branch, so it has none.
 * Null when there is nothing to run by hand.
 */
export function startTerminalLine(_choice: Pick<StartChoice, "where">, newBranch?: string) {
  return startBranchLine("checkout", newBranch)
}

/** High for a review, Medium for bounded work including acceptance shares. */
export function helperEffort(role: HelperRole, acceptanceShare = false): "high" | "medium" {
  if (acceptanceShare) return "medium"
  return role === "judge" ||
    role === "plan-review" ||
    role === "security" ||
    role === "artifact-check"
    ? "high"
    : "medium"
}
