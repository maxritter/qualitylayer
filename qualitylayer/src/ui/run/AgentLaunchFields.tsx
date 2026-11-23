import type { ReactNode } from "react"
import {
  AGENT_DISPLAY_ORDER,
  AGENT_NAMES,
  NATIVE_AGENTS,
  type NativeAgent,
} from "../../core/agents/ids.ts"
import {
  offeredModels,
  planModels,
  type StepAgent,
  startModel,
} from "../../core/agents/model-values.ts"
import type { DefaultsAgent, EffortChoice } from "../../core/config-values.ts"
import { AGENT_CAPABILITIES } from "../../core/run/launch-spec.ts"
import type { SubagentModels } from "../api.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { customModelAgent, useKnownModels } from "../known-models.ts"
import { ModelPick, type PickOption } from "../ModelPick.tsx"
import {
  fromPick,
  launchEfforts,
  launchModelOptions,
  recommendedModel,
  toPick,
} from "../settings/Defaults.tsx"
import {
  AgentLaunchWorkspace,
  invalidBranchName,
  type LaunchContested,
  type LaunchWorkspaceValue,
  launchContestedLine,
  launchWorkspaceProblem,
} from "./AgentLaunchWorkspace.tsx"
import { LaunchChoice } from "./LaunchChoice.tsx"
import { groupedByFamily } from "./model-family.ts"
import "./agent-launch-fields.css"

export {
  AgentLaunchWorkspace,
  invalidBranchName,
  type LaunchContested,
  type LaunchWorkspaceValue,
  launchContestedLine,
  launchWorkspaceProblem,
}

export type AgentLaunchValue = {
  agent: DefaultsAgent
  model: string
  effort: EffortChoice
  runWhere: "app" | "terminal"
}

export type LaunchAgentDiscovery = readonly (NativeAgent | SubagentModels)[]
export const availableLaunchAgents = (installed: LaunchAgentDiscovery | null | undefined) =>
  NATIVE_AGENTS.filter((agent) =>
    installed?.some((entry) =>
      typeof entry === "string" ? entry === agent : entry.agent === agent && entry.runnable,
    ),
  )

/** Discovery order is stable; saved agent profiles never select an unavailable client. */
export const preferredLaunchAgent = (
  installed: LaunchAgentDiscovery | null | undefined,
): DefaultsAgent => availableLaunchAgents(installed)[0] ?? "other"

export const launchAgentAvailable = (
  agent: DefaultsAgent,
  installed: LaunchAgentDiscovery | null | undefined,
) => agent === "other" || availableLaunchAgents(installed).includes(agent)

export type AgentLaunchFieldsProps = {
  value: AgentLaunchValue
  onChange: (patch: Partial<AgentLaunchValue>) => void
  installed?: LaunchAgentDiscovery | null
  supported: boolean
  disabled?: boolean
  canConfigure?: boolean
  scope?: string
  models?: PickOption[]
  retainSettings?: boolean
  location?: boolean
  nativeOnly?: boolean
  modelRole?: "Planner" | "Build session" | "Build model" | "Lead"
  defaultModel?: string
  /**
   * The quiet heading over the row that names the role ("Planner", "Builder", "Agent"); none where the
   * card's own title says it (the Agent tab's cards).
   */
  heading?: { label: string; icon: ReactNode }
  /** What follows the row inside the same block: the extra planners, the build's explanation. */
  afterModels?: ReactNode
}

/**
 * The model and effort picks of one agent, label-free: each pick's name is its tooltip and accessible
 * name. An agent whose effort is part of the model id (Cursor, Antigravity) has no effort pick at all.
 */
export function ModelEffortPicks({
  agent,
  scope,
  modelRole,
  model,
  effort,
  choices,
  efforts,
  custom,
  disabled,
  onChange,
}: {
  agent: NativeAgent
  scope: string
  modelRole: AgentLaunchFieldsProps["modelRole"]
  model: string
  effort: EffortChoice
  choices: PickOption[]
  efforts: PickOption[]
  /** The agent whose model menu also takes a typed provider/model id. */
  custom: StepAgent | undefined
  disabled: boolean
  onChange: (patch: { model?: string; effort?: EffortChoice }) => void
}) {
  return (
    <>
      <div className="q-model-field q-pick-model" title={modelRole ?? "Model"}>
        <ModelPick
          label={`${scope}: ${modelRole?.toLowerCase() ?? "model"}`}
          look="row"
          value={toPick(model)}
          options={groupedByFamily(choices, AGENT_NAMES[agent])}
          custom={custom}
          disabled={disabled}
          onChange={(next) => onChange({ model: fromPick(next) })}
        />
      </div>
      {efforts.length > 0 ? (
        <div className="q-model-field q-pick-effort" title="Effort">
          <ModelPick
            label={`${scope}: effort`}
            look="row"
            value={toPick(effort)}
            options={efforts}
            disabled={disabled}
            onChange={(next) => onChange({ effort: fromPick(next) as EffortChoice })}
          />
        </div>
      ) : null}
    </>
  )
}

/** The effort levels an agent's launch offers; none when its effort is part of the model id. */
export const agentEfforts = (agent: NativeAgent): PickOption[] =>
  AGENT_CAPABILITIES[agent].effort === "in-model" ? [] : launchEfforts(agent)

/** The model menu of an agent: its catalog, the models it reports and the one already chosen. */
export function agentModelChoices(agent: NativeAgent, model: string, defaultModel?: string) {
  return launchModelOptions(
    agent,
    offeredModels(agent, planModels(agent), [model]),
    defaultModel ?? startModel(agent) ?? recommendedModel(agent),
  )
}

function buildAgentOptions(
  available: NativeAgent[],
  current: DefaultsAgent,
  unavailable: boolean,
  nativeOnly: boolean,
): PickOption[] {
  const mark = (agent: string) => <AgentMark agent={agent} size={14} />
  const options: PickOption[] = AGENT_DISPLAY_ORDER.filter((agent) =>
    available.includes(agent),
  ).map((agent) => ({ id: agent, name: AGENT_NAMES[agent], icon: mark(agent) }))
  if (unavailable && current !== "other") {
    options.push({
      id: current,
      name: `${AGENT_NAMES[current]} · unavailable`,
      icon: mark(current),
    })
  }
  if (!nativeOnly || current === "other") {
    options.push({
      id: "other",
      name: "Another agent",
      apart: available.length > 0,
      icon: mark("other"),
    })
  }
  return options
}

function agentSelectionPatch(next: string): Partial<AgentLaunchValue> {
  const agent = next as DefaultsAgent
  if (agent === "other") return { agent, model: "", effort: "high", runWhere: "terminal" }
  const model = (agent === "pi" ? startModel(agent) : undefined) ?? recommendedModel(agent)
  return { agent, model, effort: "high" }
}

function LaunchStatusNotes({
  own,
  retainSettings,
  loading,
  availableCount,
  unavailable,
}: {
  own: NativeAgent | null
  retainSettings: boolean
  loading: boolean
  availableCount: number
  unavailable: boolean
}) {
  return (
    <>
      {own && retainSettings ? (
        <p className="q-lands-note">Keeps the current session’s model and effort.</p>
      ) : null}
      {loading ? (
        <p className="q-lands-note" role="status">
          Checking installed agents…
        </p>
      ) : null}
      {!loading && availableCount === 0 ? (
        <p className="q-lands-note" role="status">
          No supported agent is installed. Run it in your own agent instead.
        </p>
      ) : null}
      {unavailable ? (
        <p className="q-lands-note" role="status">
          This agent is unavailable. Choose an installed agent, or run it in your own agent.
        </p>
      ) : null}
    </>
  )
}

function AgentPickerRow({
  scope,
  value,
  loading,
  options,
  disabled,
  unavailable,
  own,
  retainSettings,
  modelRole,
  modelChoices,
  efforts,
  onChange,
}: {
  scope: string
  value: AgentLaunchValue
  loading: boolean
  options: PickOption[]
  disabled: boolean
  unavailable: boolean
  own: NativeAgent | null
  retainSettings: boolean
  modelRole: AgentLaunchFieldsProps["modelRole"]
  modelChoices: PickOption[]
  efforts: PickOption[]
  onChange: (patch: Partial<AgentLaunchValue>) => void
}) {
  const showTuning = own !== null && !retainSettings
  return (
    <div
      className="q-agent-launch-fields"
      data-inline
      data-effort={showTuning && efforts.length === 0 ? "in-model" : undefined}
    >
      <div className="q-model-field q-pick-agent" title="Agent">
        <ModelPick
          label={`${scope}: agent`}
          look="row"
          value={loading ? "loading" : value.agent}
          options={loading ? [{ id: "loading", name: "Checking installed agents…" }] : options}
          disabled={disabled}
          onChange={(next) => onChange(agentSelectionPatch(next))}
        />
      </div>
      {showTuning ? (
        <ModelEffortPicks
          agent={own}
          scope={scope}
          modelRole={modelRole}
          model={value.model}
          effort={value.effort}
          choices={modelChoices}
          efforts={efforts}
          custom={customModelAgent(value.agent)}
          disabled={disabled || unavailable}
          onChange={onChange}
        />
      ) : null}
    </div>
  )
}

export function AgentLaunchFields({
  value,
  onChange,
  installed,
  supported,
  disabled = false,
  canConfigure = true,
  scope = "Launch",
  models,
  retainSettings = false,
  location = true,
  nativeOnly = false,
  modelRole,
  defaultModel,
  heading,
  afterModels,
}: AgentLaunchFieldsProps) {
  useKnownModels()
  const loading = installed == null
  const available = availableLaunchAgents(installed)
  const unavailable = !loading && !launchAgentAvailable(value.agent, installed)
  const options = buildAgentOptions(available, value.agent, unavailable, nativeOnly)
  const own = value.agent === "other" ? null : value.agent
  const modelChoices =
    own === null ? [] : (models ?? agentModelChoices(own, value.model, defaultModel))
  // One row everywhere an agent starts (Max, 11 November 2026): agent · model · effort, all in view.
  const efforts = own === null ? [] : agentEfforts(own)
  const fieldDisabled = disabled || !canConfigure || loading
  return (
    <div className="q-agent-launch" data-testid="agent-launch-fields">
      {heading ? (
        <div className="q-agent-pick-head">
          {heading.icon}
          <span>{heading.label}</span>
        </div>
      ) : null}
      <AgentPickerRow
        scope={scope}
        value={value}
        loading={loading}
        options={options}
        disabled={fieldDisabled}
        unavailable={unavailable}
        own={own}
        retainSettings={retainSettings}
        modelRole={modelRole}
        modelChoices={modelChoices}
        efforts={efforts}
        onChange={onChange}
      />
      {afterModels}
      <LaunchStatusNotes
        own={own}
        retainSettings={retainSettings}
        loading={loading}
        availableCount={available.length}
        unavailable={unavailable}
      />
      {location ? (
        <LaunchChoice
          value={own && supported ? value.runWhere : "terminal"}
          onChange={(next) => onChange({ runWhere: next === "terminal" ? "terminal" : "app" })}
          supported={supported}
          terminalOnly={!own}
          disabled={fieldDisabled || unavailable}
        />
      ) : null}
    </div>
  )
}
