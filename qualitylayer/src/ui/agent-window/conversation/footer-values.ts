// What the footer row names, worked out from the run and the agent's own catalog: its permission
// modes (agents.json), whether it has an effort of its own, and the plan window to warn about.

import { modelName } from "../../../core/agents/model-values.ts"
import type { RunSettings, SettingsWait } from "../../../core/run/contracts.ts"
import { AGENT_CAPABILITIES } from "../../../core/run/launch-spec.ts"
import type { NativeSettingField } from "../../native-settings-error.ts"
import type { RunWindow } from "../../run-context.tsx"
import {
  currentPermission,
  OWN_MODE,
  type PermissionChoice,
  permissionChoices,
  permissionLabel,
  sessionPermissionLabel,
} from "./permission-values.ts"
import { sessionEffort, sessionModelId } from "./session-values.ts"

export { type PermissionChoice, permissionChoices, permissionLabel, sessionPermissionLabel }

type Agent = RunWindow["agent"]

/** How the agent takes an effort: its own list, inside the model name, or not at all. */
export function effortKind(agent: Agent): "separate" | "in-model" | null {
  return AGENT_CAPABILITIES[agent].effort
}

export function effortLabel(effort: string): string {
  return effort === "xhigh" ? "Extra high" : `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

/** The effort levels the agent lists, lowest first. */
export const effortChoices = (agent: Agent): string[] => [...AGENT_CAPABILITIES[agent].efforts]

/** What the session runs with now, as the footer names it and as a change is measured against. */
export type SessionSource = {
  model: string | undefined
  /** The model's name for the chip. */
  name: string | undefined
  effort: string | undefined
  perm: string
}

export function sessionSource(
  run: RunWindow,
  observed: { model?: string; effort?: string },
  unknown: readonly NativeSettingField[] = [],
): SessionSource {
  const agent = run.agent === "other" ? undefined : run.agent
  const model = unknown.includes("model") ? undefined : (observed.model ?? run.settings?.model)
  const effort = sessionEffort({
    agent,
    observedModel: observed.model,
    launchModel: run.settings?.model,
    observedEffort: observed.effort,
    launchEffort: run.settings?.effort,
    unknown,
  })
  const id = sessionModelId(agent, model)
  return {
    model,
    name: model && agent ? modelName(agent, id ?? model) : model,
    effort,
    perm: currentPermission(run.agent, run.settings, run.permissionMode),
  }
}

/** When a queued change applies, as the words that follow "applies". */
export function waitPhrase(waiting: SettingsWait | undefined): string {
  if (waiting === "subagents") return "after the subagents finish"
  if (waiting === "record") return "once the conversation has loaded"
  return "after this turn"
}

/** A queued change laid over what the session runs now. */
export type PendingChange = {
  /** The values the chips show: the requested ones while the change waits, the running ones once it failed. */
  source: SessionSource
  /** The chips the change touches. */
  fields: ReadonlySet<DraftField>
  /** The chip's note: when it applies, or why it did not. */
  note: string
  failed: boolean
}

/**
 * The change the person asked for that the session has not taken yet, or undefined when none waits. A
 * waiting change shows its requested values (the fields that differ from the running ones); a failed one
 * keeps the running values and carries the reason.
 */
export function pendingChange(run: RunWindow, source: SessionSource): PendingChange | undefined {
  const pending = run.pendingSettings
  if (!pending) return undefined
  const agent = run.agent === "other" ? undefined : run.agent
  const asked = pending.settings
  const perm = asked.permMode ?? (asked.perm === "own" ? OWN_MODE : undefined)
  const wanted = {
    model: asked.model,
    effort: asked.effort,
    perm,
  } satisfies Record<DraftField, string | undefined>
  const same = {
    model: sessionModelId(agent, asked.model) === sessionModelId(agent, source.model),
    effort: asked.effort === source.effort,
    perm: perm === source.perm,
  } satisfies Record<DraftField, boolean>
  const touched = (["model", "effort", "perm"] as const).filter(
    (field) => wanted[field] !== undefined,
  )
  if (pending.error)
    return {
      source,
      fields: new Set(touched),
      note: pending.error,
      failed: true,
    }
  const fields = new Set(touched.filter((field) => !same[field]))
  if (fields.size === 0) return undefined
  const shown = { ...source }
  if (fields.has("model") && asked.model !== undefined) {
    shown.model = asked.model
    shown.name = agent
      ? modelName(agent, sessionModelId(agent, asked.model) ?? asked.model)
      : asked.model
  }
  if (fields.has("effort")) shown.effort = asked.effort
  if (fields.has("perm") && perm !== undefined) shown.perm = perm
  return { source: shown, fields, note: `Applies ${waitPhrase(pending.waiting)}`, failed: false }
}

export type Draft = { model?: string | undefined; effort?: string | undefined; perm: string }
export type DraftField = keyof Draft

/** The settings a restart is asked for: only the fields the person changed, each only if it differs. */
export function settingsToApply(
  agent: Agent,
  draft: Draft,
  source: SessionSource,
  edited: ReadonlySet<DraftField>,
  confirmed: Partial<Record<NativeSettingField, string>> = {},
): Partial<RunSettings> {
  const alias = (value: string | undefined) =>
    sessionModelId(agent === "other" ? undefined : agent, value)
  const settings: Partial<RunSettings> = {}
  if (edited.has("model") && alias(draft.model) !== alias(source.model))
    settings.model = draft.model
  if (edited.has("effort") && draft.effort !== source.effort) settings.effort = draft.effort
  if (edited.has("perm") && draft.perm !== source.perm)
    Object.assign(settings, draft.perm === OWN_MODE ? { perm: "own" } : { permMode: draft.perm })
  for (const field of ["model", "effort"] as const) {
    const value = confirmed[field]
    if (value !== undefined && draft[field] === value) settings[field] = value
  }
  return settings
}

export type FooterStatus = { who: "todo" | "agent"; text: string }

/** The state word the footer keeps: watching, loading or retrying. Every other state shows elsewhere. */
export function footerStatus(input: {
  word: string
  who: "todo" | "agent" | "you" | "stop"
  readOnly: boolean
  working: boolean
  failing: boolean
}): FooterStatus | undefined {
  if (input.who === "todo" && input.word !== "Ready") return { who: "todo", text: input.word }
  if (input.failing) return { who: "agent", text: "Retrying" }
  if (input.readOnly && input.who !== "stop")
    return { who: "agent", text: input.working ? "Working · watching" : "Watching" }
  return undefined
}

/** The source's name for the model the session runs now; a model just chosen has none yet. */
export function nameChosen(
  agent: RunWindow["agent"],
  selected: string,
  source: SessionSource,
): string | undefined {
  const known = agent === "other" ? undefined : agent
  return selected === sessionModelId(known, source.model) ? source.name : undefined
}

type Steady = { model?: string | undefined; effort?: string | undefined }
/** The last model and effort known for each session (run id and generation), for this page's life. */
const lastKnown = new Map<string, Steady>()

/**
 * Model and effort as the footer shows them. A field the server cannot vouch for yet (a long
 * record still being read, a setting not seen since a command) keeps the last value known for
 * this session; only a session with no known value says it is unknown.
 */
export function steadySettings(
  session: string,
  read: {
    unknown: readonly NativeSettingField[]
    model?: string | undefined
    effort?: string | undefined
  },
  /** The server has read the record to its end, so the values are the session's own. */
  confirmed = true,
): { model?: string | undefined; effort?: string | undefined; unknown: NativeSettingField[] } {
  const known = lastKnown.get(session) ?? {}
  const fresh: Steady = {
    model: read.unknown.includes("model") ? undefined : read.model,
    effort: read.unknown.includes("effort") ? undefined : read.effort,
  }
  const next: Steady = {
    model: fresh.model ?? (read.unknown.includes("model") ? known.model : undefined),
    effort: fresh.effort ?? (read.unknown.includes("effort") ? known.effort : undefined),
  }
  if (confirmed && (fresh.model !== undefined || fresh.effort !== undefined))
    lastKnown.set(session, {
      model: fresh.model ?? known.model,
      effort: fresh.effort ?? known.effort,
    })
  const unknown = read.unknown.filter(
    (field) => (field === "model" ? next.model : next.effort) === undefined,
  )
  return { ...next, unknown }
}
