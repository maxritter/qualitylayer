// A task's extra planners (Max, 11 November 2026): a feature task may carry up to two besides its
// own planner, each an installed agent on a model and effort the person chose (`task start --planners
// codex:gpt-6.1-sol:medium,claude-code:sonnet`, or the App's New task card). They read the Plan as
// its reviewers in place of its second opinion; with two they answer each other once (panel.ts), and
// the planner works their findings in. Kept in the task's runtime folder, so the choice is the task's
// own and no Setting changes.

import {
  AGENT_NAMES,
  isNativeAgent,
  NATIVE_AGENTS,
  type NativeAgent,
  validModelId,
} from "../agents/ids.ts"
import { DEFAULTS_EFFORTS, type DefaultsEffort } from "../config-values.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"

/**
 * One extra planner: the agent that runs it, the model it reads the Plan on, and its effort (one of
 * the agent's `efforts` in agents.json; `validatePlanners` holds it to them). No effort means the
 * review's own (an agent that sets its effort in the model never has one).
 */
export type ExtraPlanner = { agent: NativeAgent; model: string; effort?: string }

/** The most extra planners a task carries. */
export const EXTRA_PLANNERS = 2

export const PLANNERS_USAGE = `--planners takes up to ${EXTRA_PLANNERS} agent:model[:effort] entries separated by commas, each agent once (agents: ${NATIVE_AGENTS.join(", ")}; efforts: ${DEFAULTS_EFFORTS.join(", ")}), e.g. --planners codex:gpt-6.2-astra:high,claude-code:opus:high`

/** The efforts an extra planner on this agent may name; none when it sets its effort in the model. */
export const plannerEfforts = (agent: NativeAgent): readonly string[] =>
  AGENT_CAPABILITIES[agent].effort === "separate" ? AGENT_CAPABILITIES[agent].efforts : []

/** `codex:gpt-6.1-sol:medium`, or `cursor:auto` for one with no effort of its own. */
export const plannerSpec = (planner: ExtraPlanner): string =>
  `${planner.agent}:${planner.model}${planner.effort !== undefined ? `:${planner.effort}` : ""}`

const isEffort = (value: unknown): value is DefaultsEffort =>
  typeof value === "string" && (DEFAULTS_EFFORTS as readonly string[]).includes(value)

/** "low, medium or high". */
const either = (words: readonly string[]): string =>
  words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`

const PLANNER_KEYS = new Set(["agent", "model", "effort"])

function validatePlannerEffort(agent: NativeAgent, name: string, effort: unknown): string | null {
  if (effort === undefined) return null
  const levels = plannerEfforts(agent)
  if (levels.length === 0) return `${name} sets its effort in the model: name no effort for it`
  if (!isEffort(effort) || !levels.includes(effort))
    return `${name} plans at ${either(levels)} effort, not ${String(effort)}`
  return null
}

function validateOnePlanner(
  entry: unknown,
  own: string | undefined,
  planners: readonly ExtraPlanner[],
): ExtraPlanner | string {
  const p = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>
  if (Object.keys(p).some((key) => !PLANNER_KEYS.has(key)))
    return "An extra planner names only its agent, model and effort"
  const { agent, model, effort } = p
  if (!isNativeAgent(agent)) return `An extra planner runs on one of ${either(NATIVE_AGENTS)}`
  const name = AGENT_NAMES[agent]
  const problem = !validModelId(agent, model)
    ? `${name}'s extra planner needs a model, as one word`
    : agent === own
      ? `${name} is this task's own planner: choose another agent`
      : planners.some((q) => q.agent === agent)
        ? `${name} is named twice: each agent plans once`
        : validatePlannerEffort(agent, name, effort)
  if (problem !== null) return problem
  return { agent, model: model as string, ...(isEffort(effort) ? { effort } : {}) }
}

/**
 * The extra planners a list names, or the sentence that says what is wrong with it: at most two,
 * each a native agent once (not `own`, the task's planner), on a model of its own, at an effort it
 * accepts. The CLI's `--planners` and the server's run start both check through this.
 */
export function validatePlanners(list: unknown, own?: string): ExtraPlanner[] | string {
  if (!Array.isArray(list)) return "Extra planners are a list of agent, model and effort"
  if (list.length > EXTRA_PLANNERS)
    return `A task takes at most ${EXTRA_PLANNERS} extra planners, not ${list.length}`
  const planners: ExtraPlanner[] = []
  for (const entry of list) {
    const validated = validateOnePlanner(entry, own, planners)
    if (typeof validated === "string") return validated
    planners.push(validated)
  }
  return planners
}

/** The planners `--planners` names, or the sentence that says what is wrong with it. */
export function parsePlanners(text: string): ExtraPlanner[] | string {
  const entries = text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
  if (entries.length === 0 || entries.length > EXTRA_PLANNERS) return PLANNERS_USAGE
  const named: Record<string, string>[] = []
  for (const entry of entries) {
    const at = entry.search(/[:=]/)
    const agent = at === -1 ? entry : entry.slice(0, at)
    let model = at === -1 ? "" : entry.slice(at + 1).trim()
    // A model id may hold ":" itself (`local-ollama/llama-4:70b`): only an effort's name ends it.
    const last = model.lastIndexOf(":")
    const effort = last === -1 ? undefined : model.slice(last + 1)
    if (isEffort(effort)) model = model.slice(0, last)
    if (!isNativeAgent(agent) || !validModelId(agent, model)) return PLANNERS_USAGE
    named.push({ agent, model, ...(isEffort(effort) ? { effort } : {}) })
  }
  return validatePlanners(named)
}

export { readPlanners, writePlanners } from "./planners-store.ts"
