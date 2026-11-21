import { type ReactNode, useId } from "react"
import { Input } from "@/components/ui/input"
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
import { LaunchChoice } from "./LaunchChoice.tsx"
import { groupedByFamily } from "./model-family.ts"
import "./agent-launch-fields.css"

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

export type LaunchWorkspaceValue = {
  works: "checkout" | "branch" | "worktree"
  branch: string
  worktreePath: string
}

/** Git remains authoritative; this catches the names it would refuse before anything starts. */
export const invalidBranchName = (branch: string): boolean =>
  !branch ||
  branch.startsWith("-") ||
  /[\s~^:?*[\\]/.test(branch) ||
  branch.includes("..") ||
  branch.includes("@{") ||
  branch.startsWith("/") ||
  branch.endsWith("/") ||
  branch.endsWith(".") ||
  branch.endsWith(".lock") ||
  branch.includes("//")

/** Git remains authoritative; these checks prevent an obviously incomplete launch. */
export function launchWorkspaceProblem(value: LaunchWorkspaceValue): string | null {
  if (value.works === "checkout") return null
  if (invalidBranchName(value.branch)) return "Choose a valid new branch name."
  if (
    value.works === "worktree" &&
    (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value.worktreePath) || value.worktreePath.includes("\0"))
  )
    return "Choose an absolute folder for the new worktree."
  return null
}

/**
 * Why this checkout is contested: files this Plan changes hold uncommitted edits here (`overlap`),
 * another agent session works in it, or it holds work from elsewhere.
 */
export type LaunchContested = { kind: "overlap" | "session" | "changes"; count?: number }

/** The line under the workspace summary: a recommendation for a worktree, the cost for anything else. */
export function launchContestedLine(
  contested: LaunchContested,
  works: LaunchWorkspaceValue["works"],
) {
  const count = contested.count ?? 0
  // A new worktree starts from HEAD, so it never has these edits: the build stays here to keep them.
  if (contested.kind === "overlap") {
    const files = `${count} ${count === 1 ? "file" : "files"}`
    return works === "worktree"
      ? `A new worktree starts without the uncommitted edits to ${files} this Plan changes.`
      : `${files} this Plan changes ${count === 1 ? "has" : "have"} uncommitted edits here, so the build stays in this checkout to keep them.`
  }
  const lead =
    contested.kind === "session"
      ? "another agent session is working in this checkout."
      : `${count} ${count === 1 ? "file here has" : "files here have"} uncommitted changes from other work.`
  return works === "worktree"
    ? `Recommended: ${lead}`
    : `${lead.charAt(0).toUpperCase()}${lead.slice(1)} Commits from both may wait for each other.`
}

export function AgentLaunchWorkspace({
  value,
  onChange,
  checkout,
  currentBranch,
  baseBranch,
  loading = false,
  unavailable = false,
  disabled = false,
  scope = "Launch",
  contested = null,
}: {
  value: LaunchWorkspaceValue
  onChange: (patch: Partial<LaunchWorkspaceValue>) => void
  checkout: string | null
  currentBranch?: string | null
  baseBranch?: string | null
  loading?: boolean
  unavailable?: boolean
  disabled?: boolean
  scope?: string
  contested?: LaunchContested | null
}) {
  const id = useId()
  const problem = launchWorkspaceProblem(value)
  return (
    <section className="q-launch-workspace" title={checkout ?? undefined}>
      <div className="q-launch-workspace-heading">
        <span>Workspace</span>
        {currentBranch ? <small title={checkout ?? undefined}>{currentBranch}</small> : null}
      </div>
      {contested ? (
        <p className="q-launch-why">{launchContestedLine(contested, value.works)}</p>
      ) : null}
      {!checkout ? <p className="q-lands-note">The project checkout is unavailable.</p> : null}
      {loading || unavailable ? (
        <p className="q-lands-note" role="status">
          {loading
            ? "Reading the build branch…"
            : "The build branch and pull request target are unavailable."}
        </p>
      ) : null}
      <ModelPick
        label={`${scope}: workspace`}
        look="row"
        value={value.works}
        disabled={disabled}
        options={[
          { id: "checkout", name: "Project checkout" },
          { id: "branch", name: "New branch" },
          { id: "worktree", name: "New worktree" },
        ]}
        onChange={(works) => onChange({ works: works as LaunchWorkspaceValue["works"] })}
      />
      {value.works !== "checkout" ? (
        <label htmlFor={`${id}-branch`}>
          New branch
          <Input
            id={`${id}-branch`}
            aria-label={`${scope}: new branch`}
            value={value.branch}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange({ branch: event.target.value })}
          />
        </label>
      ) : null}
      {value.works === "worktree" ? (
        <label htmlFor={`${id}-worktree`}>
          Worktree folder
          <Input
            id={`${id}-worktree`}
            aria-label={`${scope}: worktree folder`}
            value={value.worktreePath}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange({ worktreePath: event.target.value })}
          />
        </label>
      ) : null}
      {value.works !== "checkout" ? (
        <p className="q-lands-note">
          Starts from this checkout's HEAD.{" "}
          {baseBranch ? (
            <>
              The pull request targets <code>{baseBranch}</code>.
            </>
          ) : null}
        </p>
      ) : null}
      {value.works === "checkout" && currentBranch && currentBranch === baseBranch ? (
        <p className="q-lands-note">
          This is the pull request target branch. Choose a new branch before opening a pull request
          in Verify.
        </p>
      ) : null}
      {problem ? (
        <p className="q-lands-note" role="status">
          {problem}
        </p>
      ) : null}
    </section>
  )
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
  const mark = (agent: string) => <AgentMark agent={agent} size={14} />
  const options: PickOption[] = [
    ...AGENT_DISPLAY_ORDER.filter((agent) => available.includes(agent)).map((agent) => ({
      id: agent,
      name: AGENT_NAMES[agent],
      icon: mark(agent),
    })),
    ...(unavailable && value.agent !== "other"
      ? [
          {
            id: value.agent,
            name: `${AGENT_NAMES[value.agent]} · unavailable`,
            icon: mark(value.agent),
          },
        ]
      : []),
    ...(nativeOnly && value.agent !== "other"
      ? []
      : [{ id: "other", name: "Another agent", apart: available.length > 0, icon: mark("other") }]),
  ]
  const own = value.agent === "other" ? null : value.agent
  const modelChoices =
    own === null ? [] : (models ?? agentModelChoices(own, value.model, defaultModel))
  // One row everywhere an agent starts (Max, 11 November 2026): agent · model · effort, all in view.
  const efforts = own === null ? [] : agentEfforts(own)
  const tuning =
    own && !retainSettings ? (
      <ModelEffortPicks
        agent={own}
        scope={scope}
        modelRole={modelRole}
        model={value.model}
        effort={value.effort}
        choices={modelChoices}
        efforts={efforts}
        custom={customModelAgent(value.agent)}
        disabled={disabled || !canConfigure || loading || unavailable}
        onChange={onChange}
      />
    ) : null
  return (
    <div className="q-agent-launch" data-testid="agent-launch-fields">
      {heading ? (
        <div className="q-agent-pick-head">
          {heading.icon}
          <span>{heading.label}</span>
        </div>
      ) : null}
      <div
        className="q-agent-launch-fields"
        data-inline
        data-effort={tuning !== null && efforts.length === 0 ? "in-model" : undefined}
      >
        <div className="q-model-field q-pick-agent" title="Agent">
          <ModelPick
            label={`${scope}: agent`}
            look="row"
            value={loading ? "loading" : value.agent}
            options={loading ? [{ id: "loading", name: "Checking installed agents…" }] : options}
            disabled={disabled || !canConfigure || loading}
            onChange={(next) => {
              const agent = next as DefaultsAgent
              onChange({
                agent,
                model:
                  agent === "other"
                    ? ""
                    : ((agent === "pi" ? startModel(agent) : undefined) ?? recommendedModel(agent)),
                effort: "high",
                ...(agent === "other" ? { runWhere: "terminal" } : {}),
              })
            }}
          />
        </div>
        {tuning}
      </div>
      {afterModels}
      {own && retainSettings ? (
        <p className="q-lands-note">Keeps the current session’s model and effort.</p>
      ) : null}
      {loading ? (
        <p className="q-lands-note" role="status">
          Checking installed agents…
        </p>
      ) : null}
      {!loading && available.length === 0 ? (
        <p className="q-lands-note" role="status">
          No supported agent is installed. Run it in your own agent instead.
        </p>
      ) : null}
      {unavailable ? (
        <p className="q-lands-note" role="status">
          This agent is unavailable. Choose an installed agent, or run it in your own agent.
        </p>
      ) : null}
      {location ? (
        <LaunchChoice
          value={own && supported ? value.runWhere : "terminal"}
          onChange={(next) => onChange({ runWhere: next === "terminal" ? "terminal" : "app" })}
          supported={supported}
          terminalOnly={!own}
          disabled={disabled || loading || unavailable || !canConfigure}
        />
      ) : null}
    </div>
  )
}
