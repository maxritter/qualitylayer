// Settings › Models: every model choice in one section (Max, 5 November 2026). One agent at a time,
// picked by its mark; then what it plans and builds on, what it reviews on, and the list of its models
// with where each is used. Each pick saves at once, like every Settings row; a failed save keeps the
// model in use and says so under the row. A launch can still choose another model.

import { CircleAlertIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { AGENT_DISPLAY_ORDER, AGENT_NAMES, type NativeAgent } from "../../core/agents/ids.ts"
import { canSetBuildWorkers, removeAddedModel } from "../../core/agents/model-values.ts"
import { type Config, SESSION_MODEL } from "../../core/config-values.ts"
import type { Api } from "../api.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { useKnownModels } from "../known-models.ts"
import { ModelPick } from "../ModelPick.tsx"
import { useOptionalRuns } from "../run-context.tsx"
import { Segmented } from "../Segmented.tsx"
import { useAgentHealth } from "./AgentHealth.tsx"
import type { SaveResult } from "./CommitField.tsx"
import { fromPick, toPick } from "./Defaults.tsx"
import { ModelList, ReviewRows } from "./ModelsList.tsx"
import { type ModelRole, modelRolesPatch } from "./model-roles.ts"
import {
  accountOf,
  agentModels,
  BUILD_ROWS,
  type ModelUse,
  removedPatch,
  resetBuildPatch,
  resetReviewsPatch,
  roleOptions,
  saveModelPatch,
  usesOf,
} from "./models-data.tsx"
import { SettingRow, SettingsGroup } from "./Rows.tsx"
import "./models.css"

type Problem = { use: ModelUse; why: string }

function BuildRow({
  row,
  agent,
  value,
  disabled,
  problem,
  onPick,
}: {
  row: (typeof BUILD_ROWS)[number]
  agent: NativeAgent
  value: string
  disabled: boolean
  problem: ReactNode
  onPick: (value: string) => void
}) {
  const own = row.id === "subagents" && !canSetBuildWorkers(agent)
  const helpers = row.id === "helpers"
  return (
    <SettingRow
      label={row.label}
      icon={row.icon}
      hint={own ? `${AGENT_NAMES[agent]} picks its own subagent model.` : row.hint}
      below={problem}
    >
      {own ? (
        <span className="q-model-role-own">Agent decides</span>
      ) : (
        <ModelPick
          label={row.label}
          look="row"
          value={helpers ? value : toPick(value)}
          options={roleOptions(agent, row.id, value)}
          disabled={disabled}
          onChange={(next) => onPick(helpers ? next : fromPick(next))}
        />
      )}
    </SettingRow>
  )
}

export function ModelsTab({
  config,
  api,
  onChange,
  initialAgent,
  onAgent,
  available,
  permitted: allowed,
}: {
  config: Config
  permitted?: boolean
  api?: Pick<Api, "agentHealth" | "checkAgents">
  onChange: (patch: unknown) => SaveResult
  initialAgent?: NativeAgent
  onAgent?: (agent: NativeAgent) => void
  available?: readonly NativeAgent[] | undefined
}) {
  useKnownModels()
  const support = useOptionalRuns()?.support?.canConfigure === true
  const permitted = allowed ?? support
  const { agents } = useAgentHealth(api)
  const [agent, setAgent] = useState<NativeAgent>(initialAgent ?? "claude-code")
  useEffect(() => {
    if (initialAgent !== undefined) setAgent(initialAgent)
  }, [initialAgent])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const name = AGENT_NAMES[agent]
  const account = accountOf(agents.find((row) => row.agent === agent))
  const here = available ?? []
  const models = agentModels(config, agent, here)
  const { roles, buildChanged, reviewChanged, second } = models
  const reviewByLead = roles.helpers === SESSION_MODEL

  const save = async (use: ModelUse, patch: unknown) => {
    if (busy || !permitted) return
    setBusy(true)
    setProblem(null)
    const why = await saveModelPatch(onChange, patch)
    if (why !== null) setProblem({ use, why })
    setBusy(false)
  }
  const pickRole = (role: ModelRole, value: string) =>
    void save(role, modelRolesPatch(agent, { [role]: value }))
  const pickJudge = (value: string) =>
    void save("review", { models: { [agent]: { judge: value } } })
  const pickDesign = (value: string) =>
    void save("design", { models: { [agent]: { design: value } } })
  const pickSecondAgent = (by: NativeAgent) =>
    void save("second", { secondOpinion: { reviewers: { [agent]: { agent: by, model: "" } } } })
  const pickSecondModel = (value: string) =>
    second !== null &&
    void save("second", {
      secondOpinion: { reviewers: { [agent]: { agent: second.agent, model: value } } },
    })
  const resetBuild = () => void save("planning", resetBuildPatch(models, agent))
  const resetReviews = () => void save("review", resetReviewsPatch(models, agent))
  const uses = (id: string) => usesOf(models, agent, id)
  const removed = (id: string) => {
    removeAddedModel(agent, id)
    const patch = removedPatch(models, agent, id)
    if (Object.keys(patch).length > 0) void save("planning", patch)
  }

  const failed = (use: ModelUse) =>
    problem?.use === use ? (
      <p className="q-mdl-problem" role="alert">
        <CircleAlertIcon className="size-[13px]" aria-hidden="true" />
        {problem.why} The model in use stays.
      </p>
    ) : undefined
  const disabled = !permitted || busy
  const reset = (count: number, onReset: () => void) =>
    count === 0 ? (
      "All recommended"
    ) : (
      <>
        <span className="whitespace-nowrap">{count} changed</span>
        <button type="button" className="q-link" disabled={disabled} onClick={onReset}>
          Reset to recommended
        </button>
      </>
    )

  return (
    <div className="q-sgs q-mdl" data-testid="models">
      <SettingsGroup title="Agent" end={account} testId="models-agent">
        <div className="q-model-agent-pick">
          <Segmented
            size="md"
            iconOnly
            label="Agent whose models you set"
            value={agent}
            options={AGENT_DISPLAY_ORDER.map((id) => ({
              id,
              label: AGENT_NAMES[id],
              icon: <AgentMark agent={id} size={14} />,
            }))}
            onChange={(next) => {
              setAgent(next)
              setProblem(null)
              onAgent?.(next)
            }}
          />
          <b>{name}</b>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Plan and Implement"
        end={reset(buildChanged, resetBuild)}
        testId="models-build"
      >
        {BUILD_ROWS.map((row) => (
          <BuildRow
            key={row.id}
            row={row}
            agent={agent}
            value={roles[row.id]}
            disabled={disabled}
            problem={failed(row.id)}
            onPick={(value) => pickRole(row.id, value)}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Reviews"
        end={reset(reviewChanged, resetReviews)}
        testId="models-reviews"
      >
        <ReviewRows
          config={config}
          agent={agent}
          here={here}
          second={second}
          byLead={reviewByLead}
          disabled={disabled}
          failed={failed}
          onJudge={pickJudge}
          onDesign={pickDesign}
          onSecondAgent={pickSecondAgent}
          onSecondModel={pickSecondModel}
        />
      </SettingsGroup>

      <ModelList key={agent} agent={agent} uses={uses} disabled={disabled} onRemoved={removed} />
    </div>
  )
}
