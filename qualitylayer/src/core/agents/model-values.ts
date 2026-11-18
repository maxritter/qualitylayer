// Effort levels and the models a helper, a review, a planning session or a build may run on, as
// plain values apart from any file access, so the Cockpit page can import them without pulling in
// server modules. subagent-model.ts re-exports them.

import agentsJson from "./agents.json" with { type: "json" }
import { type NativeAgent, validModelId } from "./ids.ts"

export type StepAgent = NativeAgent

/**
 * The model or effort that means "use the agent's own configured one": nothing is passed to the
 * agent, so what it has set (its config file, its last choice) decides. A model menu and an effort
 * menu both offer it as Agent’s settings.
 */
export const AGENT_OWN = ""
export const AGENT_OWN_NAME = "Agent’s settings"
export const PI_SOL_MODEL = "openai/gpt-6.2-sol"
const PI_LEGACY_SOL_MODEL = "openai-codex/gpt-6.1-sol"

type Model = { id: string; name: string }
type ModelList = {
  command: string[] | null
  file?: string
  format: string
  complete: boolean
  own: string | null
  /** False when the list only says which catalog models the account has, and adds none to pickers. */
  adds?: boolean
}
type CustomModel = {
  shape: "id" | "provider/model"
  placeholder: string
  hint: string
  unlessListed: boolean
}
type Entry = {
  capabilities?: {
    modelIds?: "listed" | "native"
    modelList?: ModelList | null
    customModel?: CustomModel | null
  }
  helperModels?: Record<string, string>
  modelNotes?: Record<string, string>
  modelOrder?: string[]
  modelCost?: Record<string, number>
  plan?: { model: string; models: Model[] }
  build?: {
    models: Model[]
    orchestrator: Model
    orchestrators: Model[]
    small?: string
    subagentModel?: boolean
  }
}

const table = agentsJson as unknown as Record<string, Entry>
export const canSetBuildWorkers = (agent: string): boolean =>
  table[agent]?.build?.subagentModel === true

const capabilities = (agent: StepAgent) => table[agent]?.capabilities

/**
 * Whether any model id the agent itself accepts may be chosen, checked only for its shape, instead of
 * only the models `agents.json` lists.
 */
export function nativeModelIds(agent: StepAgent): boolean {
  return capabilities(agent)?.modelIds === "native"
}

/**
 * Whether a new task starts on the agent's own model (Agent’s settings is the Default of its menus):
 * an agent that takes any model id of its own, whose catalog is a short list beside what it holds.
 * Claude Code and Codex start on the catalog's best.
 */
export const startsOnOwnModel = (agent: StepAgent): boolean =>
  nativeModelIds(agent) && agent !== "pi"

/** Whether the agent takes model ids the catalog does not name, added by the person (`customModel`). */
export const hasCustomModel = (agent: StepAgent): boolean =>
  capabilities(agent)?.customModel != null

/** Whether the agent says which models it can use now (`modelList` in `agents.json`). */
export function listsModels(agent: StepAgent): boolean {
  return capabilities(agent)?.modelList != null
}

/** What an agent's own list says: the ids it prints, and the model it would start with itself. */
export type KnownModels = { listed: readonly string[]; own: string | null }

const known = new Map<StepAgent, KnownModels>()
const added = new Map<StepAgent, readonly string[]>()
const starts = new Map<StepAgent, string>()
const watchers = new Set<() => void>()
let version = 0
let persistAdded: ((agent: StepAgent, ids: string[]) => void) | null = null

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, at) => id === b[at])

const sameModels = (held: KnownModels | undefined, next: KnownModels): boolean =>
  held !== undefined && held.own === next.own && sameIds(held.listed, next.listed)

const changed = () => {
  version += 1
  for (const watcher of watchers) watcher()
}

/** Take the agent's own list as read by the server; every picker lists it from the next render. */
export function setKnownModels(agent: StepAgent, next: KnownModels | null): void {
  if (next !== null && sameModels(known.get(agent), next)) return
  if (next === null) known.delete(agent)
  else known.set(agent, next)
  changed()
}

export const knownModels = (agent: StepAgent): KnownModels | null => known.get(agent) ?? null

/**
 * Whether the agent's menus end in Add a model…: it takes ids of its own (`customModel`), unless its
 * own list is known and is every id it takes (Grok's `[model.<id>]` blocks).
 */
export function takesAddedModels(agent: StepAgent): boolean {
  const custom = capabilities(agent)?.customModel
  if (custom == null) return false
  return !(custom.unlessListed && (known.get(agent)?.listed.length ?? 0) > 0)
}

/** The Add a model field's placeholder and hint for one agent. */
export function addModelField(agent: StepAgent): { placeholder: string; hint: string } {
  const custom = capabilities(agent)?.customModel
  return { placeholder: custom?.placeholder ?? "", hint: custom?.hint ?? "" }
}

/** What an added model id must look like, as the field says it. */
export const addModelRule = (agent: StepAgent): string =>
  capabilities(agent)?.customModel?.shape === "provider/model"
    ? "Use provider/model, with no spaces or shell characters."
    : "Use the model id only, with no spaces or shell characters."

/**
 * Why a typed model id cannot be added, or null: the agent takes ids of its own, and the id has the
 * shape it writes (`provider/model` or a plain id) in the safe characters `validModelId` allows, so
 * it is one argument and no shell ever reads it.
 */
export function customModelProblem(agent: StepAgent, id: string): string | null {
  const shape = capabilities(agent)?.customModel?.shape
  if (shape === undefined || !validModelId(agent, id)) return addModelRule(agent)
  const slash = id.indexOf("/")
  const written = shape === "id" || (slash > 0 && slash < id.length - 1)
  return written ? null : addModelRule(agent)
}

/** The ids the person added for one agent, in the order added. */
export const addedModels = (agent: StepAgent): readonly string[] => added.get(agent) ?? []

/** Take the ids the person added, as the settings hold them. */
export function setAddedModels(agent: StepAgent, ids: readonly string[]): void {
  if (sameIds(addedModels(agent), ids)) return
  added.set(agent, ids)
  changed()
}

/** Where an added or removed id is saved; the App sets it to the settings, a test to its own. */
export function persistAddedModels(save: ((agent: StepAgent, ids: string[]) => void) | null): void {
  persistAdded = save
}

function saveAdded(agent: StepAgent, ids: string[]): void {
  setAddedModels(agent, ids)
  persistAdded?.(agent, ids)
}

/** Add one id to the agent's list in every picker, and save it. An id the list already holds is not added twice. */
export function addModel(agent: StepAgent, id: string): void {
  if (customModelProblem(agent, id) !== null) return
  const named = [...catalogIds(agent), ...(known.get(agent)?.listed ?? []), ...addedModels(agent)]
  if (!named.includes(id)) saveAdded(agent, [...addedModels(agent), id])
}

/** Remove one added id from the agent's list. */
export function removeAddedModel(agent: StepAgent, id: string): void {
  saveAdded(
    agent,
    addedModels(agent).filter((held) => held !== id),
  )
}

/** The model a new task starts on for one agent, as the settings hold it (Settings › Agents › Models › Make default). */
export const startModel = (agent: StepAgent): string | undefined => starts.get(agent)

export function setStartModel(agent: StepAgent, id: string | undefined): void {
  if (starts.get(agent) === id) return
  if (id === undefined) starts.delete(agent)
  else starts.set(agent, id)
  changed()
}

/** For `useSyncExternalStore`: a number that changes whenever the known or added models do. */
export const knownModelsVersion = (): number => version
export function watchKnownModels(watcher: () => void): () => void {
  watchers.add(watcher)
  return () => watchers.delete(watcher)
}

const catalogIds = (agent: StepAgent): string[] => [
  ...Object.keys(table[agent]?.helperModels ?? {}),
  ...(table[agent]?.plan?.models ?? []).map((m) => m.id),
  ...(table[agent]?.build?.models ?? []).map((m) => m.id),
  ...(table[agent]?.build?.orchestrators ?? []).map((m) => m.id),
]

/** Where one model of an agent's list comes from: the catalog, the agent's own list, or the person. */
export function modelKind(agent: StepAgent, id: string): "catalog" | "reported" | "added" {
  if (catalogIds(agent).includes(id)) return "catalog"
  return known.get(agent)?.listed.includes(id) === true ? "reported" : "added"
}

/**
 * The catalog's models, then the agent's own that the catalog does not name (unless its list only says
 * which catalog models the account has, `adds: false`: Cursor's hundreds), then those the person added.
 */
function withListed(agent: StepAgent, catalog: Model[]): Model[] {
  const named = new Set(catalog.map((model) => model.id))
  const listed = capabilities(agent)?.modelList?.adds === false ? [] : known.get(agent)?.listed
  const extra = [...(listed ?? []), ...addedModels(agent)]
  return [
    ...catalog,
    ...extra.filter((id) => !named.has(id) && named.add(id)).map((id) => ({ id, name: id })),
  ]
}

/**
 * Whether the person's plan does not offer this catalog model: the agent's own list holds every model
 * the account can run (`complete`), is known, and lacks it. Without such a list every model is offered.
 */
export function notOffered(agent: StepAgent, id: string): boolean {
  const from = known.get(agent)
  const requiresListing = agent === "pi" && /^openai\/gpt-6\.2-(sol|astra)$/.test(id)
  return (
    (requiresListing || capabilities(agent)?.modelList?.complete === true) &&
    from !== undefined &&
    from.listed.length > 0 &&
    catalogIds(agent).includes(id) &&
    !from.listed.includes(id)
  )
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
  if (from === null || slash < 0 || capabilities(agent)?.modelList?.complete === true) return null
  if (from.listed.includes(value)) return null
  if (agent === "pi") {
    const provider = value.slice(0, slash)
    if (provider !== "openai" && provider !== "openai-codex") return null
    const other = provider === "openai" ? "openai-codex" : "openai"
    const renamed = other + value.slice(slash)
    return from.listed.includes(renamed) ? renamed : null
  }
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
  piFallback = PI_LEGACY_SOL_MODEL,
): string {
  const moved = renamedProvider(agent, value, from)
  if (moved !== null) return moved
  if (agent === "pi" && value === PI_SOL_MODEL && !from?.listed.includes(value))
    return renamedProvider(agent, piFallback, from) ?? piFallback
  if (capabilities(agent)?.modelList?.complete !== true || from === null || from.own === null)
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
    Object.entries(table[agent]?.helperModels ?? {}).map(([id, name]) => ({ id, name })),
  )
}

/** The models Discuss and Plan may run on, the recommended one first. */
export function planModels(agent: StepAgent): Model[] {
  return withListed(agent, table[agent]?.plan?.models ?? [])
}

/**
 * The model a build session is taken to run, for judging who built the change: the one named, and for
 * Agent’s settings ("") the one QualityLayer recommends, since what the agent has set is not read there.
 */
export const buildingOn = (agent: StepAgent, orchestrator: string): string =>
  orchestrator === AGENT_OWN ? orchestratorModel(agent) : orchestrator

/** The model QualityLayer recommends for Discuss and Plan. */
export function planModel(agent: StepAgent): string {
  return table[agent]?.plan?.model ?? planModels(agent)[0]?.id ?? ""
}

/** The models a build session may run on, the most capable first. */
export function orchestratorModels(agent: StepAgent): Model[] {
  return withListed(agent, table[agent]?.build?.orchestrators ?? [])
}

/** The build session's model QualityLayer recommends for a full task. */
export function orchestratorModel(agent: StepAgent): string {
  return table[agent]?.build?.orchestrator.id ?? orchestratorModels(agent)[0]?.id ?? ""
}

/** The models a build session or its subagents may run on, the recommended one for a full task first. */
export function builderModels(agent: StepAgent): Model[] {
  return withListed(agent, table[agent]?.build?.models ?? [])
}

/** The build session's model QualityLayer recommends for a small change: Sonnet on Claude Code, else the full-task one. */
export function smallChangeModel(agent: StepAgent): string {
  return table[agent]?.build?.small ?? orchestratorModel(agent)
}

/**
 * The catalog's name for a model id (`opus` for `claude-opus-5-5`, `gpt-6-astra` for
 * `openai/gpt-6-astra`): the first of the agent's `modelOrder` the id holds, ignoring a provider prefix.
 */
function modelToken(agent: StepAgent, id: string): string | undefined {
  const bare = (id.split("/").at(-1) ?? id).toLowerCase()
  return table[agent]?.modelOrder?.find((name) => bare === name || bare.includes(`-${name}-`))
}

/**
 * The note a menu shows beside a model: "Default" for the one the App starts with, else how its price
 * compares with that Default's (`costs more`, `costs less`), so every list of one agent reads true
 * whichever model its Default is. A better note the catalog words for the model replaces "costs more".
 */
export function modelNote(agent: StepAgent, id: string, recommended: string): string | undefined {
  if (id === recommended) return "Default"
  const entry = table[agent]
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
  const order = table[agent]?.modelOrder
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
