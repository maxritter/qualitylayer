// A task's extra planners (Max, 11 November 2026): a feature task may carry up to two besides its
// own planner, each an installed agent on a model and effort the person chose (`task start --planners
// codex:gpt-6.1-sol:medium,claude-code:sonnet`, or the App's New task card). They read the Plan as
// its reviewers in place of its second opinion; with two they answer each other once (panel.ts), and
// the planner works their findings in. Kept in the task's runtime folder, so the choice is the task's
// own and no Setting changes.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import {
  AGENT_NAMES,
  isNativeAgent,
  NATIVE_AGENTS,
  type NativeAgent,
  validModelId,
} from "../agents/ids.ts"
import { DEFAULTS_EFFORTS, type DefaultsEffort } from "../config-values.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"
import type { Task } from "../task/store.ts"

/**
 * One extra planner: the agent that runs it, the model it reads the Plan on, and its effort (one of
 * the agent's `efforts` in agents.json; `validatePlanners` holds it to them). No effort means the
 * review's own (an agent that sets its effort in the model never has one).
 */
export type ExtraPlanner = { agent: NativeAgent; model: string; effort?: string }

/** The most extra planners a task carries. */
export const EXTRA_PLANNERS = 2

const FILE = "extra-planners.json"

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
    const p = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>
    const keys = Object.keys(p)
    if (keys.some((key) => !["agent", "model", "effort"].includes(key)))
      return "An extra planner names only its agent, model and effort"
    const { agent, model, effort } = p
    if (!isNativeAgent(agent)) return `An extra planner runs on one of ${either(NATIVE_AGENTS)}`
    const name = AGENT_NAMES[agent]
    if (!validModelId(agent, model)) return `${name}'s extra planner needs a model, as one word`
    if (agent === own) return `${name} is this task's own planner: choose another agent`
    if (planners.some((q) => q.agent === agent))
      return `${name} is named twice: each agent plans once`
    if (effort !== undefined) {
      const levels = plannerEfforts(agent)
      if (levels.length === 0) return `${name} sets its effort in the model: name no effort for it`
      if (!isEffort(effort) || !levels.includes(effort))
        return `${name} plans at ${either(levels)} effort, not ${String(effort)}`
    }
    planners.push({
      agent,
      model,
      ...(isEffort(effort) ? { effort } : {}),
    })
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

/** The extra planners a task carries; none when it was started without them. */
export async function readPlanners(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<ExtraPlanner[]> {
  const path = join(task.runtimeDir, FILE)
  if (!(await ctx.fs.exists(path))) return []
  try {
    const held: unknown = JSON.parse(await ctx.fs.readFile(path))
    if (!Array.isArray(held)) return []
    const planners: ExtraPlanner[] = []
    for (const entry of held) {
      const p = (typeof entry === "object" && entry !== null ? entry : {}) as Partial<ExtraPlanner>
      if (!isNativeAgent(p.agent) || typeof p.model !== "string" || p.model === "") continue
      // An effort the agent does not take is dropped: the planner reads at the review's own.
      const effort =
        isEffort(p.effort) && plannerEfforts(p.agent).includes(p.effort) ? p.effort : undefined
      planners.push({ agent: p.agent, model: p.model, ...(effort !== undefined ? { effort } : {}) })
    }
    return planners.slice(0, EXTRA_PLANNERS)
  } catch {
    return []
  }
}

/** Keep a task's extra planners. */
export async function writePlanners(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  planners: readonly ExtraPlanner[],
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.writeFile(join(task.runtimeDir, FILE), `${JSON.stringify(planners, null, 2)}\n`)
}
