// Settings › Models: every model choice in one section (Max, 5 November 2026). One agent at a time,
// picked by its mark; then what it plans and builds on, what it reviews on, and the list of its models
// with where each is used. Each pick saves at once, like every Settings row; a failed save keeps the
// model in use and says so under the row. A launch can still choose another model.

import {
  ChevronRightIcon,
  CircleAlertIcon,
  CodeXmlIcon,
  FilePenIcon,
  NetworkIcon,
  PackageIcon,
  PlusIcon,
  SatelliteDishIcon,
  ScaleIcon,
  ScanEyeIcon,
  SearchIcon,
  SplitIcon,
  Trash2Icon,
  UserCheckIcon,
  UserRoundIcon,
  WorkflowIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AGENT_NAMES, NATIVE_AGENTS, type NativeAgent } from "../../core/agents/ids.ts"
import { modelMaker } from "../../core/agents/model-maker.ts"
import {
  builderModels,
  buildingOn,
  canSetBuildWorkers,
  knownModels,
  modelKind,
  modelName,
  offeredModels,
  orchestratorModels,
  planModels,
  removeAddedModel,
  stepModels,
  takesAddedModels,
  usableDefault,
  usableLaunchModel,
} from "../../core/agents/model-values.ts"
import { type Config, DEFAULT_CONFIG, SESSION_MODEL } from "../../core/config-values.ts"
import { ADD_MODEL_LABEL, AddModelForm } from "../AddModelField.tsx"
import type { Api } from "../api.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { customModelAgent, useKnownModels } from "../known-models.ts"
import { DEFAULT_NOTE, ModelPick, type PickOption } from "../ModelPick.tsx"
import { useOptionalRuns } from "../run-context.tsx"
import { Segmented } from "../Segmented.tsx"
import { useAgentHealth } from "./AgentHealth.tsx"
import type { SaveResult } from "./CommitField.tsx"
import { fromPick, launchModelOptions, modelOptions, toPick } from "./Defaults.tsx"
import { ListPages, PAGE_SIZE } from "./ListPages.tsx"
import { type ModelRole, modelRolesOf, modelRolesPatch } from "./model-roles.ts"
import { SettingRow, SettingsGroup, SettingsMore } from "./Rows.tsx"
import { type SecondOpinionOf, secondOpinionOf } from "./second-opinion.ts"
import "./models.css"

const ICON = "size-[15px]"

/** Plan and Implement: each role's name by its step, its meaning icon (App Model icon map: role.*, the header's
 *  step marks for Plan and Implement) and what it is for. */
const BUILD_ROWS: { id: ModelRole; label: string; icon: ReactNode; hint: string }[] = [
  {
    id: "planning",
    label: "Plan",
    icon: <NetworkIcon className={ICON} />,
    hint: "Reads the request and writes the Plan.",
  },
  {
    id: "full",
    label: "Implement · full task",
    icon: <CodeXmlIcon className={ICON} />,
    hint: "Leads the build of a full task.",
  },
  {
    id: "small",
    label: "Implement · small change",
    icon: <FilePenIcon className={ICON} />,
    hint: "Usually writes a small change directly.",
  },
  {
    id: "subagents",
    label: "Implement subagents",
    icon: <SplitIcon className={ICON} />,
    hint: "Model for the subagents a build starts.",
  },
  {
    id: "helpers",
    label: "Helpers",
    icon: <WorkflowIcon className={ICON} />,
    hint: "Code reading, fixes, security checks and Chat work the lead hands off.",
  },
]

/** Where a model is in use for one agent, by the words its list shows. */
type Use = ModelRole | "review" | "design" | "second"
const USE_WORDS: [Use, string][] = [
  ["planning", "Plan"],
  ["full", "Full task"],
  ["small", "Small change"],
  ["subagents", "Subagents"],
  ["helpers", "Helpers"],
  ["review", "Independent review"],
  ["design", "Design review"],
  ["second", "Second opinion"],
]

/** A role's choices: the models the person's plan offers, and the one it holds, marked if not offered. */
function roleOptions(agent: NativeAgent, role: ModelRole, value: string) {
  const recommended = modelRolesOf(DEFAULT_CONFIG, agent)[role]
  if (role === "helpers")
    return [
      ...modelOptions(agent, offeredModels(agent, stepModels(agent), [value]), recommended),
      {
        id: SESSION_MODEL,
        name: "This session",
        hint: "The lead does the helpers' work itself, the review included.",
      },
    ]
  const models =
    role === "full"
      ? orchestratorModels(agent)
      : role === "small"
        ? builderModels(agent)
        : role === "planning"
          ? planModels(agent)
          : stepModels(agent)
  return launchModelOptions(agent, offeredModels(agent, models, [value]), recommended)
}

/**
 * Every model an agent's list shows (those the person's plan offers, and any other one still in use,
 * marked). The native settings option belongs to launch preferences.
 */
function listRows(
  agent: NativeAgent,
  inUse: (id: string) => boolean,
): { id: string; name: string }[] {
  const catalog = planModels(agent)
  const kept = catalog.filter((model) => inUse(model.id)).map((model) => model.id)
  return offeredModels(
    agent,
    catalog.map((model) => ({ id: model.id, name: modelName(agent, model.id) })),
    kept,
  )
}

function KindMark({ agent, id }: { agent: NativeAgent; id: string }) {
  const kind = modelKind(agent, id)
  const Icon =
    kind === "catalog" ? PackageIcon : kind === "reported" ? SatelliteDishIcon : UserRoundIcon
  const why =
    kind === "catalog"
      ? "Built in"
      : kind === "reported"
        ? `Reported by ${AGENT_NAMES[agent]}`
        : "Added by you"
  return (
    <span className="q-am-kind" role="img" aria-label={why} title={why}>
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  )
}

/** The words a refused or failed save gives back, or null when it was kept. */
async function saved(onChange: (patch: unknown) => SaveResult, patch: unknown) {
  try {
    const why = await onChange(patch)
    return typeof why === "string" && why ? why : null
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Could not save."
  }
}

function ModelList({
  agent,
  uses,
  disabled,
  onRemoved,
}: {
  agent: NativeAgent
  uses: (id: string) => string[]
  disabled: boolean
  onRemoved: (id: string) => void
}) {
  // The caller keys this list by agent, so a new agent's list starts on its first page, unsearched.
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [all, setAll] = useState(false)
  const listId = useId()
  const findId = useId()
  const rows = listRows(agent, (id) => uses(id).length > 0)
  const words = query.trim().toLowerCase()
  const assigned = rows.filter((row) => uses(row.id).length > 0)
  const matches = words
    ? rows.filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(words))
    : all
      ? rows
      : assigned
  const last = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1)
  const at = Math.min(page, last)
  const shown = matches.slice(at * PAGE_SIZE, at * PAGE_SIZE + PAGE_SIZE)
  const name = AGENT_NAMES[agent]
  return (
    <SettingsGroup
      title={
        <button
          type="button"
          className="q-model-disclosure"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRightIcon aria-hidden="true" />
          {name} models{" "}
          <span>
            {rows.length} {rows.length === 1 ? "model" : "models"}
          </span>
        </button>
      }
      testId="models-list"
    >
      <div id={listId} hidden={!expanded}>
        <label className="q-md-find q-mdl-find" htmlFor={findId}>
          <SearchIcon size={14} aria-hidden="true" />
          <Input
            id={findId}
            type="search"
            aria-label={`Search ${name} models`}
            placeholder={`Search ${name} models`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
          />
        </label>
        {words && shown.length === 0 ? (
          <p className="q-sg-foot">No model matches “{query.trim()}”.</p>
        ) : null}
        <ul className="q-mdl-list" aria-label={`${name} models`}>
          {shown.map((row) => {
            const used = uses(row.id)
            return (
              <li className="q-mdl-row" key={row.id || "agent-settings"}>
                <KindMark agent={agent} id={row.id} />
                <span className="q-am-name" title={row.id || undefined}>
                  {row.name}
                </span>
                <span className="q-mdl-uses">{used.join(" · ")}</span>
                {modelKind(agent, row.id) === "added" ? (
                  <button
                    type="button"
                    className="q-am-remove"
                    aria-label={`Remove ${row.id}`}
                    disabled={disabled}
                    onClick={() => onRemoved(row.id)}
                  >
                    <Trash2Icon className="size-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="q-am-gap" aria-hidden="true" />
                )}
              </li>
            )
          })}
        </ul>
        {!words && assigned.length < rows.length ? (
          <button
            type="button"
            className="q-link q-model-list-more"
            onClick={() => {
              setAll(!all)
              setPage(0)
            }}
          >
            {all ? "Show assigned models" : `Show all ${rows.length} models`}
          </button>
        ) : null}
        {matches.length > PAGE_SIZE ? (
          <ListPages
            page={at}
            total={rows.length}
            matched={matches.length}
            change={setPage}
            noun="model"
          />
        ) : null}
        {takesAddedModels(agent) ? (
          <div className="q-mdl-add">
            {adding ? (
              <AddModelForm
                agent={agent}
                onUse={() => {
                  setAdding(false)
                  setAll(true)
                  setQuery("")
                  setPage(Math.floor(rows.length / PAGE_SIZE))
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setAdding(true)}
              >
                <PlusIcon aria-hidden="true" />
                {ADD_MODEL_LABEL}
              </Button>
            )}
          </div>
        ) : null}
        <SettingsMore summary="Where models come from">
          <p className="q-sg-foot q-am-legend">
            <span>
              <PackageIcon className="size-[13px]" aria-hidden="true" />
              Built in
            </span>
            <span>
              <SatelliteDishIcon className="size-[13px]" aria-hidden="true" />
              Reported by {name}
            </span>
            <span>
              <UserRoundIcon className="size-[13px]" aria-hidden="true" />
              Added by you
            </span>
          </p>
        </SettingsMore>
      </div>
    </SettingsGroup>
  )
}

/** What the person is told after a save that did not go through, under the row it belongs to. */
type Problem = { use: Use; why: string }

/** An agent's saved models beside the recommended ones, and how many of each group differ. */
function agentModels(config: Config, agent: NativeAgent, here: readonly NativeAgent[]) {
  const roles = modelRolesOf(config, agent)
  const recommended = modelRolesOf(DEFAULT_CONFIG, agent)
  const judge = config.models[agent].judge
  const design = config.models[agent].design
  const judgeDefault = DEFAULT_CONFIG.models[agent].judge
  const designDefault = DEFAULT_CONFIG.models[agent].design
  const listed = agent === "pi" ? knownModels(agent) : null
  // Who reads this agent's work, and the models this agent reads the others' work on.
  const second = secondOpinionOf(config, agent, here)
  const reads = here
    .filter((other) => other !== agent)
    .map((other) => secondOpinionOf(config, other, here))
    .filter((pick) => pick?.agent === agent)
    .map((pick) => pick?.model)
  const buildChanged = BUILD_ROWS.filter(({ id }) => {
    const model =
      id === "helpers"
        ? usableDefault(agent, recommended[id], listed)
        : usableLaunchModel(agent, recommended[id], listed)
    return counts(agent, id) && roles[id] !== model
  }).length
  const reviewChanged =
    Number(judge !== usableDefault(agent, judgeDefault, listed)) +
    Number(design !== usableDefault(agent, designDefault, listed)) +
    Number(!!second?.changed)
  return {
    roles,
    recommended,
    judge,
    design,
    second,
    reads,
    judgeDefault,
    designDefault,
    buildChanged,
    reviewChanged,
  }
}
type AgentModels = ReturnType<typeof agentModels>

/** Whether a role is the agent's to set: build subagents only for an agent that takes their model. */
const counts = (agent: NativeAgent, role: ModelRole) =>
  role !== "subagents" || canSetBuildWorkers(agent)

/** The Agent group's status: the account, or that the agent is not installed. */
const accountOf = (health: { status?: string; account?: string | null } | undefined) =>
  health?.status === "not-found" ? "Not installed" : (health?.account ?? undefined)

/** Plan and Implement back on the recommended models. */
const resetBuildPatch = (m: AgentModels, agent: NativeAgent) =>
  modelRolesPatch(
    agent,
    Object.fromEntries(
      BUILD_ROWS.filter((row) => counts(agent, row.id)).map((row) => [
        row.id,
        m.recommended[row.id],
      ]),
    ),
  )

/** The review models back on the recommended ones, and the second opinion back on the automatic pick. */
const resetReviewsPatch = (m: AgentModels, agent: NativeAgent) => ({
  models: { [agent]: { judge: m.judgeDefault, design: m.designDefault } },
  secondOpinion: { reviewers: { [agent]: { agent: "auto", model: "" } } },
})

/** Where a model is in use for this agent, by the words its list shows. */
const usesOf = (m: AgentModels, agent: NativeAgent, id: string) =>
  USE_WORDS.filter(([use]) => {
    if (use === "review") return m.roles.helpers !== SESSION_MODEL && m.judge === id
    if (use === "design") return m.design === id
    if (use === "second") return m.reads.includes(id)
    return counts(agent, use) && m.roles[use] === id
  }).map(([, words]) => words)

/** Every role a removed model held, back on its recommended model. */
function removedPatch(m: AgentModels, agent: NativeAgent, id: string) {
  const held = BUILD_ROWS.filter((row) => m.roles[row.id] === id)
  return {
    ...modelRolesPatch(
      agent,
      Object.fromEntries(held.map((row) => [row.id, m.recommended[row.id]])),
    ),
    ...(m.judge === id || m.design === id
      ? {
          models: {
            [agent]: {
              ...(m.judge === id ? { judge: m.judgeDefault } : {}),
              ...(m.design === id ? { design: m.designDefault } : {}),
            },
          },
        }
      : {}),
  }
}

/** One row of Plan and Implement: its model menu, or Agent decides where the agent picks its own subagents. */
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

/** What the independent review's row says: when it checks this agent's change, or why its model waits. */
function reviewHint(name: string, byLead: boolean, enabled: boolean): string {
  if (byLead) return "Helpers is set to This session, so the lead does the review itself."
  if (enabled) return `Checks ${name}'s change in Verify and each recheck.`
  return "Off in Workflow. A Chat review you ask for still uses this model."
}

/** What the second opinion's row says: who reads this agent's work, or why nobody can. */
function secondHint(name: string, second: SecondOpinionOf | null, enabled: boolean): string {
  if (second === null) return "Needs a second coding agent on this computer."
  const by = AGENT_NAMES[second.agent]
  if (!enabled) return `Off in Workflow. When on, ${by} reads ${name}'s risky work.`
  return `${by} reads ${name}'s risky Plans and changes. Changes nothing.`
}

/** The agents that may read `agent`'s work: every other one here, the automatic pick marked Default. */
function reviewerOptions(
  config: Config,
  agent: NativeAgent,
  here: readonly NativeAgent[],
  second: SecondOpinionOf,
): PickOption[] {
  const builds = modelMaker(buildingOn(agent, config.implement.defaults[agent].orchestrator))
  return here
    .filter((other) => other !== agent)
    .map((other) => {
      const same = builds !== null && modelMaker(config.secondOpinion.models[other]) === builds
      const note = other === second.auto ? DEFAULT_NOTE : same ? "Same family" : undefined
      return {
        id: other,
        name: AGENT_NAMES[other],
        icon: <AgentMark agent={other} size={13} />,
        ...(note !== undefined ? { note } : {}),
      }
    })
}

/**
 * Reviews: helper-staff.ts has the agent that builds start the review and the design review as fresh
 * helpers on their own models (with Helpers on This session the lead reviews itself; a Chat review you
 * ask for uses the model even while the workflow's review is off, chat/review.ts). The second opinion
 * on this agent's work is given by the agent and model named here, else the first agent here from
 * another model family on its own model (vendors.ts selectedReviewer).
 */
function ReviewRows({
  config,
  agent,
  here,
  second,
  byLead,
  disabled,
  failed,
  onJudge,
  onDesign,
  onSecondAgent,
  onSecondModel,
}: {
  config: Config
  agent: NativeAgent
  /** The coding agents on this computer that can run. */
  here: readonly NativeAgent[]
  second: SecondOpinionOf | null
  byLead: boolean
  disabled: boolean
  failed: (use: Use) => ReactNode
  onJudge: (value: string) => void
  onDesign: (value: string) => void
  onSecondAgent: (value: NativeAgent) => void
  onSecondModel: (value: string) => void
}) {
  const name = AGENT_NAMES[agent]
  const design = config.models[agent].design
  return (
    <>
      <SettingRow
        label="Independent review"
        icon={<ScaleIcon className={ICON} />}
        hint={reviewHint(name, byLead, config.independentReview.enabled)}
        below={failed("review")}
      >
        {byLead ? (
          <span className="q-model-role-own">This session</span>
        ) : (
          <ModelPick
            label={`Independent review model in ${name}`}
            look="row"
            custom={customModelAgent(agent)}
            value={config.models[agent].judge}
            options={modelOptions(
              agent,
              offeredModels(agent, stepModels(agent), [config.models[agent].judge]),
              DEFAULT_CONFIG.models[agent].judge,
            )}
            disabled={disabled}
            onChange={onJudge}
          />
        )}
      </SettingRow>
      <SettingRow
        label="Design review"
        icon={<ScanEyeIcon className={ICON} />}
        hint={
          config.designReview === "designs"
            ? `Checks each design ${name} draws in Plan, before you see it.`
            : "Off in Workflow. Designs reach you as drawn."
        }
        below={failed("design")}
      >
        <ModelPick
          label={`Design review model in ${name}`}
          look="row"
          custom={customModelAgent(agent)}
          value={design}
          options={modelOptions(
            agent,
            offeredModels(agent, stepModels(agent), [design]),
            DEFAULT_CONFIG.models[agent].design,
          )}
          disabled={disabled}
          onChange={onDesign}
        />
      </SettingRow>
      <SettingRow
        label="Second opinion"
        icon={<UserCheckIcon className={ICON} />}
        hint={secondHint(name, second, config.secondOpinion.enabled)}
        below={failed("second")}
      >
        {second === null ? (
          <span className="q-model-role-own">No other agent</span>
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: two pickers under one name, not a form's fieldset
          <div
            className="q-mdl-so"
            role="group"
            aria-label={`Who gives ${name}'s second opinion`}
            data-testid="second-opinion-pair"
          >
            <ModelPick
              label={`Second opinion agent for ${name}`}
              look="row"
              value={second.agent}
              options={reviewerOptions(config, agent, here, second)}
              disabled={disabled}
              onChange={(next) => onSecondAgent(next as NativeAgent)}
            />
            <ModelPick
              label={`Second opinion model for ${name}`}
              look="row"
              custom={customModelAgent(second.agent)}
              value={second.model}
              options={modelOptions(
                second.agent,
                offeredModels(second.agent, stepModels(second.agent), [second.model]),
                DEFAULT_CONFIG.secondOpinion.models[second.agent],
              )}
              disabled={disabled}
              onChange={onSecondModel}
            />
          </div>
        )}
      </SettingRow>
    </>
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
  /** Whether this window may change settings; left out, the App's run support says. */
  permitted?: boolean
  api?: Pick<Api, "agentHealth" | "checkAgents">
  onChange: (patch: unknown) => SaveResult
  /** The agent the page opens on: the one a launch card or an Agents row asked for. */
  initialAgent?: NativeAgent
  /** The agent on show changed: the address follows, so Back and a reload keep it. */
  onAgent?: (agent: NativeAgent) => void
  /** The coding agents on this computer that can run: who may give a second opinion. */
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

  const save = async (use: Use, patch: unknown) => {
    if (busy || !permitted) return
    setBusy(true)
    setProblem(null)
    const why = await saved(onChange, patch)
    if (why !== null) setProblem({ use, why })
    setBusy(false)
  }
  const pickRole = (role: ModelRole, value: string) =>
    void save(role, modelRolesPatch(agent, { [role]: value }))
  const pickJudge = (value: string) =>
    void save("review", { models: { [agent]: { judge: value } } })
  const pickDesign = (value: string) =>
    void save("design", { models: { [agent]: { design: value } } })
  // Another agent reads this agent's work on its own second-opinion model until a model is picked.
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
  // An added model that leaves the list leaves every role it held, which return to their recommended model.
  const removed = (id: string) => {
    removeAddedModel(agent, id)
    const patch = removedPatch(models, agent, id)
    if (Object.keys(patch).length > 0) void save("planning", patch)
  }

  const failed = (use: Use) =>
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
        {count} changed ·{" "}
        <button type="button" className="q-link" disabled={disabled} onClick={onReset}>
          Reset to recommended
        </button>
      </>
    )

  return (
    <div className="q-sgs q-mdl" data-testid="models">
      <SettingsGroup title="Agent" end={account} testId="models-agent">
        {/* The agent is picked by its mark; the chosen one is named beside the strip, the others by tooltip and accessible name. */}
        <div className="q-model-agent-pick">
          <Segmented
            size="md"
            iconOnly
            label="Agent whose models you set"
            value={agent}
            options={NATIVE_AGENTS.map((id) => ({
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
