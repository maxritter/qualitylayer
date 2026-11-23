// Effort levels and the models a helper, a review, a planning session or a build may run on, as
// plain values apart from any file access, so the Cockpit page can import them without pulling in
// server modules. subagent-model.ts re-exports them.

import {
  AGENT_OWN,
  AGENT_OWN_NAME,
  addedModels,
  addModel,
  addModelField,
  addModelRule,
  agentCapabilities,
  agentCatalogTable,
  canSetBuildWorkers,
  catalogIds,
  customModelProblem,
  hasCustomModel,
  type KnownModels,
  knownModels,
  knownModelsVersion,
  listsModels,
  type Model,
  modelKind,
  nativeModelIds,
  PI_ASTRA_MODEL,
  PI_SOL_MODEL,
  persistAddedModels,
  removeAddedModel,
  type StepAgent,
  setAddedModels,
  setKnownModels,
  setStartModel,
  startModel,
  startsOnOwnModel,
  takesAddedModels,
  watchKnownModels,
} from "./model-values-state.ts"

export {
  AGENT_OWN,
  AGENT_OWN_NAME,
  addedModels,
  addModel,
  addModelField,
  addModelRule,
  canSetBuildWorkers,
  customModelProblem,
  hasCustomModel,
  type KnownModels,
  knownModels,
  knownModelsVersion,
  listsModels,
  modelKind,
  nativeModelIds,
  PI_ASTRA_MODEL,
  PI_SOL_MODEL,
  persistAddedModels,
  removeAddedModel,
  type StepAgent,
  setAddedModels,
  setKnownModels,
  setStartModel,
  startModel,
  startsOnOwnModel,
  takesAddedModels,
  watchKnownModels,
}

/**
 * The catalog's models, then the agent's own that the catalog does not name (unless its list only says
 * which catalog models the account has, `adds: false`: Cursor's hundreds), then those the person added.
 */
function withListed(agent: StepAgent, catalog: Model[]): Model[] {
  const named = new Set(catalog.map((model) => model.id))
  const from = knownModels(agent)
  const listed = agentCapabilities(agent)?.modelList?.adds === false ? [] : from?.listed
  const extra = [...(listed ?? []), ...addedModels(agent)]
  const labels = from?.labels
  const label = (id: string, fallback: string) =>
    labels && Object.hasOwn(labels, id) ? (labels[id] ?? fallback) : fallback
  return [
    ...(labels
      ? catalog.map((model) => ({ ...model, name: label(model.id, model.name) }))
      : catalog),
    ...extra
      .filter((id) => !named.has(id) && named.add(id))
      .map((id) => ({ id, name: label(id, id) })),
  ]
}

/**
 * Whether the person's plan does not offer this catalog model: the agent's own list holds every model
 * the account can run (`complete`), is known, and lacks it. Without such a list every model is offered.
 */
export function notOffered(agent: StepAgent, id: string): boolean {
  const from = knownModels(agent)
  if (from === null || from.listed.length === 0) return false
  const requiresListing = agent === "pi" && /^openai\/gpt-6\.2-(sol|astra)$/.test(id)
  if (!requiresListing && agentCapabilities(agent)?.modelList?.complete !== true) return false
  return catalogIds(agent).includes(id) && !from.listed.includes(id)
}

/** The words a model the plan does not offer carries in a picker. */
export const NOT_OFFERED = "not offered"

/**
 * A picker's models as the agent's own picker shows them for the person's plan: the catalog models
 * the plan does not offer leave. One already chosen (`kept`: a task's or a setting's) stays
 * selectable, its name marked, so nothing is replaced without the person seeing it.
 */
export function offeredModels<T extends Model>(
  agent: StepAgent,
  models: readonly T[],
  kept: readonly (string | undefined)[] = [],
): T[] {
  return models.flatMap((model) => {
    if (!notOffered(agent, model.id)) return [model]
    return kept.includes(model.id) ? [{ ...model, name: `${model.name} · ${NOT_OFFERED}` }] : []
  })
}

function renamedPiProvider(value: string, slash: number, listed: readonly string[]): string | null {
  const provider = value.slice(0, slash)
  if (provider !== "openai" && provider !== "openai-codex") return null
  const other = provider === "openai" ? "openai-codex" : "openai"
  const renamed = other + value.slice(slash)
  return listed.includes(renamed) ? renamed : null
}

/**
 * A catalog `provider/model` the agent's own, partial list does not hold, while the list holds that
 * model once under another provider: the agent renamed the provider (Pi 1.3 moved `openai-codex/…`
 * to `openai/…`). The listed id takes its place, so the default runs instead of failing for a login
 * it no longer has. Null when nothing applies.
 */
export function renamedProvider(
  agent: StepAgent,
  value: string,
  from: KnownModels | null,
): string | null {
  const slash = value.indexOf("/")
  if (from === null || slash < 0 || agentCapabilities(agent)?.modelList?.complete === true)
    return null
  if (from.listed.includes(value)) return null
  if (agent === "pi") return renamedPiProvider(value, slash, from.listed)
  if (!catalogIds(agent).includes(value)) return null
  const same = from.listed.filter((id) => id.slice(id.indexOf("/") + 1) === value.slice(slash + 1))
  return same.length === 1 ? (same[0] as string) : null
}

/**
 * The model a default stands for. A catalog model the agent's own list is known not to hold (an
 * OpenAI model without an OpenAI login) cannot run, so the agent's own model takes its place; any
 * other value, a custom id included, is the person's and stays. Only a list that holds every model
 * the agent can run says so (`complete`).
 */
export function usableDefault(
  agent: StepAgent,
  value: string,
  from: KnownModels | null,
  piFallback = from?.own ?? value,
): string {
  const moved = renamedProvider(agent, value, from)
  if (moved !== null) return moved
  if (
    agent === "pi" &&
    (value === PI_ASTRA_MODEL || value === PI_SOL_MODEL) &&
    !from?.listed.includes(value)
  )
    return piFallback
  if (agentCapabilities(agent)?.modelList?.complete !== true || from === null || from.own === null)
    return value
  if (from.listed.includes(value)) return value
  return catalogIds(agent).includes(value) ? from.own : value
}

/** Pi launches inherit its native model where the new recommendation is unavailable. */
export const usableLaunchModel = (
  agent: StepAgent,
  value: string,
  from: KnownModels | null,
): string => usableDefault(agent, value, from, AGENT_OWN)

/** The models a helper or a review may run on for one agent, the first the default. */
export function stepModels(agent: StepAgent): Model[] {
  return withListed(
    agent,
    Object.entries(agentCatalogTable[agent]?.helperModels ?? {}).map(([id, name]) => ({
      id,
      name,
    })),
  )
}

/** The models Discuss and Plan may run on, the recommended one first. */
export function planModels(agent: StepAgent): Model[] {
  return withListed(agent, agentCatalogTable[agent]?.plan?.models ?? [])
}

/**
 * The model a build session is taken to run, for judging who built the change: the one named, and for
 * Agent’s settings ("") the one QualityLayer recommends, since what the agent has set is not read there.
 */
export const buildingOn = (agent: StepAgent, orchestrator: string): string =>
  orchestrator === AGENT_OWN ? orchestratorModel(agent) : orchestrator

/** The model QualityLayer recommends for Discuss and Plan. */
export function planModel(agent: StepAgent): string {
  return agentCatalogTable[agent]?.plan?.model ?? planModels(agent)[0]?.id ?? ""
}

/** The models a build session may run on, the most capable first. */
export function orchestratorModels(agent: StepAgent): Model[] {
  return withListed(agent, agentCatalogTable[agent]?.build?.orchestrators ?? [])
}

/** The build session's model QualityLayer recommends for a full task. */
export function orchestratorModel(agent: StepAgent): string {
  return agentCatalogTable[agent]?.build?.orchestrator.id ?? orchestratorModels(agent)[0]?.id ?? ""
}

/** The models a build session or its subagents may run on, the recommended one for a full task first. */
export function builderModels(agent: StepAgent): Model[] {
  return withListed(agent, agentCatalogTable[agent]?.build?.models ?? [])
}

/** The build session's model QualityLayer recommends for a small change: Sonnet on Claude Code, else the full-task one. */
export function smallChangeModel(agent: StepAgent): string {
  return agentCatalogTable[agent]?.build?.small ?? orchestratorModel(agent)
}

/**
 * The catalog's name for a model id (`opus` for `claude-opus-5-5`, `gpt-6-astra` for
 * `openai/gpt-6-astra`): the first of the agent's `modelOrder` the id holds, ignoring a provider prefix.
 */
function modelToken(agent: StepAgent, id: string): string | undefined {
  const bare = (id.split("/").at(-1) ?? id).toLowerCase()
  return agentCatalogTable[agent]?.modelOrder?.find(
    (name) => bare === name || bare.includes(`-${name}-`),
  )
}

/**
 * The note a menu shows beside a model: "Default" for the one the App starts with, else how its price
 * compares with that Default's (`costs more`, `costs less`), so every list of one agent reads true
 * whichever model its Default is. A better note the catalog words for the model replaces "costs more".
 */
export function modelNote(agent: StepAgent, id: string, recommended: string): string | undefined {
  if (id === recommended) return "Default"
  const entry = agentCatalogTable[agent]
  const token = modelToken(agent, id)
  const own = token === undefined ? undefined : entry?.modelCost?.[token]
  const base = entry?.modelCost?.[modelToken(agent, recommended) ?? ""]
  if (own === undefined || base === undefined || own === base) return undefined
  if (own < base) return "costs less"
  return (token === undefined ? undefined : entry?.modelNotes?.[token]) ?? "costs more"
}

/**
 * Models in the order every picker lists them: the agent's `modelOrder` (Claude Code: Opus, Sonnet,
 * Fable, Haiku), matched as `modelNote` does. A model the order does not name keeps its place after
 * those it does; an agent without an order is unchanged. Only pickers use this: the catalog's own
 * lists keep their order, where the first is a default.
 */
export function orderedModels<T extends { id: string }>(agent: StepAgent, models: T[]): T[] {
  const order = agentCatalogTable[agent]?.modelOrder
  if (order === undefined) return models
  const rank = (id: string) => {
    const token = modelToken(agent, id)
    return token === undefined ? order.length : order.indexOf(token)
  }
  return [...models].sort((a, b) => rank(a.id) - rank(b.id))
}

/** Copilot's automatic selection, which routes each call to a model of its own choosing. */
export const automaticModel = (agent: StepAgent, id: string | undefined): boolean =>
  agent === "copilot" && ["auto", "fusion", "copilot-fusion"].includes((id ?? "").toLowerCase())

/** A model's name for one agent, from any of its lists; the id when no list has it. */
export function modelName(agent: StepAgent, id: string): string {
  if (id === AGENT_OWN) return AGENT_OWN_NAME
  // Copilot's own menu calls its automatic choice Fusion; the id stays what Copilot records.
  if (automaticModel(agent, id)) return "Copilot Fusion"
  for (const list of [
    stepModels(agent),
    planModels(agent),
    orchestratorModels(agent),
    builderModels(agent),
  ]) {
    const found = list.find((m) => m.id === id)
    if (found !== undefined) return found.name
  }
  return id
}
