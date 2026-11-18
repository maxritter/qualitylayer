// Shared agent labels and model choices for launch, onboarding and review settings.

import { FileCogIcon, SatelliteDishIcon, UserRoundIcon } from "lucide-react"
import { AGENT_NAMES, NATIVE_AGENTS } from "../../core/agents/ids.ts"
import {
  AGENT_OWN,
  AGENT_OWN_NAME,
  knownModels,
  modelKind,
  modelNote,
  orderedModels,
  planModel,
  type StepAgent,
  startsOnOwnModel,
  usableDefault,
  usableLaunchModel,
} from "../../core/agents/model-values.ts"
import type { DefaultsAgent, EffortChoice } from "../../core/config-values.ts"
import { AGENT_CAPABILITIES } from "../../core/run/launch-spec.ts"
import { EffortGlyph } from "../agent-window/conversation/SessionSheet.tsx"
import type { SubagentModels } from "../api.ts"
import { DEFAULT_NOTE, type PickOption } from "../ModelPick.tsx"

/** The tabs: the agents installed on this computer, then Another agent. Both while it is not known yet. */
export function agentTabs(installed: SubagentModels[] | null | undefined): DefaultsAgent[] {
  const own: readonly StepAgent[] = NATIVE_AGENTS
  if (installed == null) return [...own, "other"]
  return [...own.filter((a) => installed.some((i) => i.agent === a)), "other"]
}

/**
 * Agent’s settings has no id a menu can hold (a menu's value is never empty), so it is this one in
 * a menu and "" everywhere else: in settings, in a start and on the command line, where it means
 * that no model and no effort is passed.
 */
export const OWN_PICK = "agent-settings"
export const toPick = (value: string): string => (value === AGENT_OWN ? OWN_PICK : value)
export const fromPick = (id: string): string => (id === OWN_PICK ? AGENT_OWN : id)

/** The model a menu marks Default when nobody chose one: the catalog's best, or the agent's own where it takes any id. */
export function recommendedModel(agent: StepAgent): string {
  if (startsOnOwnModel(agent)) return AGENT_OWN
  const model = planModel(agent)
  return agent === "pi" ? usableLaunchModel(agent, model, knownModels(agent)) : model
}

/** The mark a model carries in every menu, as in Settings › Agents › Models: what the agent reports, what you added. */
function kindMark(agent: StepAgent, id: string): Pick<PickOption, "icon" | "iconLabel"> {
  const kind = modelKind(agent, id)
  if (kind === "catalog") return {}
  const name = AGENT_NAMES[agent]
  return kind === "reported"
    ? { icon: <SatelliteDishIcon className="size-3.5" />, iconLabel: `Reported by ${name}` }
    : { icon: <UserRoundIcon className="size-3.5" />, iconLabel: "Added by you" }
}

/**
 * A list of models in the catalog's order, with their notes: "Default" beside the one the App
 * starts with, which for an agent that lists its own models is its own when the catalog's cannot
 * run. Every model picker builds its options here, so they all agree.
 */
export function modelOptions(
  agent: StepAgent,
  models: { id: string; name: string }[],
  recommended: string,
): PickOption[] {
  const starts = usableDefault(agent, recommended, knownModels(agent))
  return orderedModels(agent, models).map((m) => {
    const note = modelNote(agent, m.id, starts)
    return {
      id: m.id,
      name: m.name,
      ...kindMark(agent, m.id),
      ...(note !== undefined ? { note } : {}),
    }
  })
}

/**
 * The models a launch offers: the same list plus Agent’s settings (use the model the agent has
 * set), first and marked Default where the agent starts on its own, else last.
 */
export function launchModelOptions(
  agent: StepAgent,
  models: { id: string; name: string }[],
  recommended: string,
): PickOption[] {
  const starts = usableLaunchModel(agent, recommended, knownModels(agent))
  const list = modelOptions(agent, models, starts)
  const own: PickOption = {
    id: OWN_PICK,
    name: AGENT_OWN_NAME,
    ...(starts === AGENT_OWN ? { note: DEFAULT_NOTE } : {}),
  }
  const ownFirst = agent === "pi" ? starts === AGENT_OWN : startsOnOwnModel(agent)
  return ownFirst ? [own, ...list] : [...list, own]
}

const EFFORT_NAMES: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

/** The effort menu keeps inheritance last; Low and Max are offered only where the agent supports them. */
export function launchEfforts(agent: StepAgent | null): PickOption[] {
  const levels = [
    ...(agent !== null && AGENT_CAPABILITIES[agent].efforts.includes("low") ? ["low"] : []),
    "medium",
    "high",
    "xhigh",
  ]
  if (agent !== null && AGENT_CAPABILITIES[agent].efforts.includes("max")) levels.push("max")
  return [
    ...levels.map((id) => ({
      id,
      name: EFFORT_NAMES[id] ?? id,
      icon: <EffortGlyph effort={id} size={14} />,
    })),
    {
      id: OWN_PICK,
      name: AGENT_OWN_NAME,
      icon: <FileCogIcon className="size-3.5" />,
    },
  ]
}

/** What an effort is called on a line that sums a launch up. */
export const effortName = (effort: EffortChoice): string =>
  effort === AGENT_OWN ? AGENT_OWN_NAME : (EFFORT_NAMES[effort] ?? effort)
