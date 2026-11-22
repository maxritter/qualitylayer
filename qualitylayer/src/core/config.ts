// ~/.qualitylayer/config.json: the few switches a user has. Missing or broken
// files fall back to the defaults; the final approval is never configurable.
// The shape and the defaults live in config-values.ts, which the page imports.

import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { configDirEnvironment, configDirVariable } from "./agents/config-dir.ts"
import {
  AGENT_NAMES,
  isNativeAgent,
  NATIVE_AGENTS,
  type NativeAgent,
  validModelId,
} from "./agents/ids.ts"
import { codexCacheChanged, listFile, ownModel, readIds } from "./agents/model-list-readers.ts"
import { knownFrom, storedModelLists } from "./agents/model-list-store.ts"
import {
  AGENT_OWN,
  addModelRule,
  builderModels,
  canSetBuildWorkers,
  customModelProblem,
  hasCustomModel,
  type KnownModels,
  nativeModelIds,
  orchestratorModels,
  planModels,
  type StepAgent,
  stepModels,
  usableDefault,
  usableLaunchModel,
} from "./agents/model-values.ts"
import { planningAfterSettings } from "./config-planning.ts"
import {
  ADDED_MODELS_MAX,
  ADVISORIES,
  type Advisories,
  AGENT_VIEWS,
  type AgentSettings,
  type AgentView,
  ANIMATIONS,
  ANSWERS,
  type Answers,
  animationsOf,
  BUILDING_WORKS,
  type BuildDefaults,
  COMMIT_TIMINGS,
  type Config,
  DEFAULT_CONFIG,
  DEFAULTS_AGENTS,
  DEFAULTS_EFFORTS,
  DESIGN_REVIEWS,
  type DefaultsAgent,
  type DefaultsEffort,
  EDITORS,
  type Editor,
  IDLE_STOPS,
  type IdleStop,
  ON_QUIT,
  PLANNING_WORKS,
  type PlanningDefaults,
  planningLaunchOf,
  RUN_PERMISSIONS,
  RUN_WHERE,
  reviewerOf,
  SECOND_OPINION_CHANGE,
  SECOND_OPINION_PLAN,
  SECOND_OPINION_WHEN,
  SESSION_MODEL,
  type SecondOpinionChange,
  type SecondOpinionPlan,
  type SecondOpinionWhen,
  TERMINAL_SESSIONS,
  TEXT_SIZES,
  type TerminalShell,
  THEMES,
  TYPE_FROM,
  textSizeOf,
  themeOf,
  UI_FONTS,
  UPDATE_CHANNELS,
  type UpdateChannel,
  uiFontOf,
  validOtherAgentArgs as validArgs,
  validAbsolutePath as validPath,
  validOtherAgentProgram as validProgram,
  WINDOW_MODES,
} from "./config-values.ts"
import { AGENT_CAPABILITIES, bypassArgsIn, permissionModes } from "./run/launch-spec.ts"
import { isPort, PORT_PROBLEM } from "./server-port.ts"
import { usageDisplayOf, validReading } from "./usage-display.ts"

export {
  type Config,
  type CrossReviewPoint,
  SESSION_MODEL,
  type Theme,
} from "./config-values.ts"

export function configPath(ctx: Ctx): string {
  return join(ctx.home, "config.json")
}

function merge<T extends Record<string, unknown>>(base: T, patch: unknown): T {
  if (typeof patch !== "object" || patch === null) return base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in base)) continue
    const current = base[key]
    if (typeof current === "object" && current !== null && !Array.isArray(current)) {
      out[key] = merge(current as Record<string, unknown>, value)
    } else if (typeof value === typeof current) {
      out[key] = value
    }
  }
  return out as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const AGENTS: readonly StepAgent[] = NATIVE_AGENTS

/** The model ids the person added for each agent, as the settings hold them. */
type Added = Partial<Record<StepAgent, readonly string[]>>

const holds = (added: Added, agent: StepAgent, model: unknown): boolean =>
  typeof model === "string" && (added[agent] ?? []).includes(model)

/** Whether a setting may name `model` for `agent`: its own id, one the catalog lists, or one the person added. */
const offered = (agent: StepAgent, model: unknown, added: Added): boolean =>
  model !== SESSION_MODEL &&
  validModelId(agent, model) &&
  (nativeModelIds(agent) ||
    stepModels(agent).some((m) => m.id === model) ||
    holds(added, agent, model))

const inList = (list: { id: string }[], model: unknown): boolean =>
  typeof model === "string" && list.some((m) => m.id === model)

const RUN_CHECKS = {
  commitTiming: COMMIT_TIMINGS,
  answers: ANSWERS,
  runWhere: RUN_WHERE,
  perm: RUN_PERMISSIONS,
  onQuit: ON_QUIT,
  typeFrom: TYPE_FROM,
  windowMode: WINDOW_MODES,
  designReview: DESIGN_REVIEWS,
} as const

/**
 * The efforts a card may hold for an agent: the levels its entry in `agents.json` lists, or any
 * level for an agent whose effort is part of its model id (it has none of its own to list).
 */
function effortsOf(agent: StepAgent): readonly string[] {
  const own = AGENT_CAPABILITIES[agent].efforts
  return own.length > 0 ? own : DEFAULTS_EFFORTS
}

/**
 * Whether a default may name `v` for `agent`: Agent’s settings (""), its own id, one listed for the
 * step, or one the person added.
 */
const modelOk = (agent: StepAgent, v: unknown, list: { id: string }[], added: Added): boolean =>
  v === AGENT_OWN ||
  (nativeModelIds(agent) ? validModelId(agent, v) : inList(list, v) || holds(added, agent, v))

/** Whether a default may name effort `v` for `agent`: Agent’s settings (""), or a level it lists. */
const effortOk = (agent: StepAgent, v: unknown): boolean =>
  v === AGENT_OWN || effortsOf(agent).includes(v as DefaultsEffort)

/** Each default a card holds, and whether a value is one it may take. */
const planningChecks = (
  added: Added,
): Record<keyof PlanningDefaults, (agent: StepAgent, v: unknown) => boolean> => ({
  model: (agent, v) => modelOk(agent, v, planModels(agent), added),
  effort: effortOk,
  terminalSession: (_, v) => TERMINAL_SESSIONS.includes(v as never),
  planningWorks: (_, v) => PLANNING_WORKS.includes(v as never),
})
const buildChecks = (
  added: Added,
): Record<keyof BuildDefaults, (agent: StepAgent, v: unknown) => boolean> => ({
  orchestrator: (agent, v) => modelOk(agent, v, orchestratorModels(agent), added),
  builder: (agent, v) => modelOk(agent, v, builderModels(agent), added),
  subagents: (agent, v) =>
    v === AGENT_OWN || (canSetBuildWorkers(agent) && modelOk(agent, v, stepModels(agent), added)),
  effort: effortOk,
  goal: (_, v) => typeof v === "boolean",
  terminalSession: (_, v) => TERMINAL_SESSIONS.includes(v as never),
  buildingWorks: (_, v) => BUILDING_WORKS.includes(v as never),
})

/** A defaults card's values that the file holds and may hold; the rest are the base's. */
function settleDefaults<T extends Record<string, unknown>>(
  base: { agent: DefaultsAgent } & Record<StepAgent, T>,
  next: { agent: DefaultsAgent } & Record<StepAgent, T>,
  checks: Record<keyof T, (agent: StepAgent, v: unknown) => boolean>,
): { agent: DefaultsAgent } & Record<StepAgent, T> {
  const out = {
    agent: DEFAULTS_AGENTS.includes(next.agent) ? next.agent : base.agent,
  } as { agent: DefaultsAgent } & Record<StepAgent, T>
  for (const agent of AGENTS) {
    const values: Record<string, unknown> = {}
    for (const key of Object.keys(checks) as (keyof T & string)[])
      values[key] = checks[key](agent, next[agent][key]) ? next[agent][key] : base[agent][key]
    out[agent] = values as T
  }
  return out
}

/** What one key may hold: null, or why a value is refused. */
type Rule = (value: unknown) => string | null
const must = (ok: boolean, why: string): string | null => (ok ? null : why)
const oneOf = (values: readonly string[]): string =>
  values.length === 1 ? (values[0] ?? "") : `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`
const ABSOLUTE = "must be an absolute path or empty"
const ARGUMENTS = "must be an array of at most 128 strings without NUL characters"

/** Every native mode may be saved as the person's default. */
const startModes = (agent: NativeAgent): string[] => [
  "own",
  ...permissionModes(agent).map((mode) => mode.id),
]

/** The keys of an agent's settings: the folder only for an agent that has a way to be moved. */
function agentRules(agent: NativeAgent): Record<keyof AgentSettings, Rule> {
  const at = `agents.${agent}`
  return {
    enabled: (v) => must(typeof v === "boolean", `${at}.enabled must be true or false`),
    command: (v) => must(validPath(v), `${at}.command ${ABSOLUTE}`),
    args: (v) =>
      must(validArgs(v), `${at}.args ${ARGUMENTS}`) ??
      must(
        bypassArgsIn(agent, v as string[]).length === 0,
        `${at}.args may not carry the flags of Bypass mode (${bypassArgsIn(agent, v as string[]).join(", ")}); Bypass is chosen in a run, where it asks you to confirm`,
      ),
    permMode: (v) =>
      must(
        v === "" || startModes(agent).includes(v as string),
        `${at}.permMode must be ${startModes(agent).length ? `${oneOf(startModes(agent))} or empty` : "empty: it has no mode to start in"}`,
      ),
    configDir: (v) =>
      must(validPath(v), `${at}.configDir ${ABSOLUTE}`) ??
      must(
        v === "" || configDirVariable(agent) !== null,
        `${AGENT_NAMES[agent]} has no setting that moves its folder`,
      ),
  }
}
const SHELL_RULES: Record<keyof TerminalShell, Rule> = {
  program: (v) => must(validPath(v), `terminal.shell.program ${ABSOLUTE}`),
  args: (v) => must(validArgs(v), `terminal.shell.args ${ARGUMENTS}`),
}
/** Sections of one level whose keys are all checked here; the rest is `refuseShape`'s. */
const SECTION_RULES: Record<string, Record<string, Rule>> = {
  addedModels: Object.fromEntries(NATIVE_AGENTS.map((agent) => [agent, addedRule(agent)])),
  terminal: { shell: (v) => refuseKeys("terminal.shell", v, SHELL_RULES) },
  sessions: {
    idleStop: (v) =>
      must(IDLE_STOPS.includes(v as IdleStop), `sessions.idleStop must be ${oneOf(IDLE_STOPS)}`),
  },
  updates: {
    channel: (v) =>
      must(
        UPDATE_CHANNELS.includes(v as UpdateChannel),
        `updates.channel must be ${oneOf(UPDATE_CHANNELS)}`,
      ),
  },
}

/** One agent's settings: the file's value for each key it may hold, else the base's. */
function settleAgent(agent: NativeAgent, base: AgentSettings, next: AgentSettings): AgentSettings {
  const rules = agentRules(agent)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(rules) as (keyof AgentSettings)[])
    out[key] = rules[key](next[key]) === null ? next[key] : base[key]
  return out as AgentSettings
}

/** Where approvals happen: the patch's choice (null clears it to follow `answers`), else the one held. */
function approvalsOf(patch: unknown, held: unknown): Answers | undefined {
  if (isRecord(patch) && "approvals" in patch) {
    if (patch.approvals === null) return undefined
    if (ANSWERS.includes(patch.approvals as Answers)) return patch.approvals as Answers
  }
  return ANSWERS.includes(held as Answers) ? (held as Answers) : undefined
}

/** The default view: the patch's choice (null clears it to the terminal), else the one held. */
function agentViewOf(patch: unknown, held: unknown): AgentView | undefined {
  if (isRecord(patch) && "agentView" in patch) {
    if (patch.agentView === null) return undefined
    if (AGENT_VIEWS.includes(patch.agentView as AgentView)) return patch.agentView as AgentView
  }
  return AGENT_VIEWS.includes(held as AgentView) ? (held as AgentView) : undefined
}

/** The update channel: the patch's choice, else the one held (unset until the person chooses). */
function updateChannelOf(patch: unknown, held: unknown): UpdateChannel | undefined {
  const asked = isRecord(patch) && isRecord(patch.updates) ? patch.updates.channel : undefined
  const chosen = (value: unknown) => UPDATE_CHANNELS.find((channel) => channel === value)
  return chosen(asked) ?? chosen(held)
}

/** A kept "when" of a read: the file's if it is one, else the base's. */
const keptWhen = (value: unknown, base: SecondOpinionWhen): SecondOpinionWhen =>
  SECOND_OPINION_WHEN.includes(value as SecondOpinionWhen) ? (value as SecondOpinionWhen) : base

/**
 * Who gives `of`'s second opinion as the settings keep it: another agent, or `auto`. A model the
 * named agent does not offer reads as "", that agent's own second-opinion model.
 */
function settleReviewer(
  of: StepAgent,
  next: Config,
  added: Added,
): Config["secondOpinion"]["reviewers"][StepAgent] {
  const held = reviewerOf(of, next.secondOpinion.reviewers?.[of])
  if (held.agent === "auto") return held
  return { agent: held.agent, model: offered(held.agent, held.model, added) ? held.model : "" }
}

/** Why a patch of `secondOpinion.reviewers` cannot be saved, or null. */
function reviewersProblem(reviewers: unknown, added: Added): string | null {
  if (!isRecord(reviewers)) return "secondOpinion.reviewers must be an object of agents"
  for (const [of, choice] of Object.entries(reviewers)) {
    if (!AGENTS.includes(of as StepAgent)) return `${of} is not an agent`
    const key = `secondOpinion.reviewers.${of}`
    if (!isRecord(choice)) return `${key} must name an agent and a model`
    const extra = Object.keys(choice).find((name) => name !== "agent" && name !== "model")
    if (extra !== undefined) return `${key}.${extra} is not a setting`
    const { agent, model } = choice
    if (agent !== undefined && agent !== "auto" && !isNativeAgent(agent))
      return `${key}.agent must be auto or one of ${AGENTS.join(", ")}`
    if (agent === of) return `${AGENT_NAMES[of as StepAgent]} cannot give its own second opinion`
    if (model !== undefined && typeof model !== "string") return `${key}.model must be a model id`
    if (isNativeAgent(agent) && typeof model === "string" && model !== "")
      if (!offered(agent, model, added)) return `${model} is not a model ${agent} offers`
  }
  return null
}

/** One agent's added model ids: those it can take, once each, in order, at most `ADDED_MODELS_MAX`. */
function settleAdded(agent: StepAgent, held: unknown): string[] {
  if (!Array.isArray(held)) return []
  const kept = held.filter(
    (id): id is string => typeof id === "string" && customModelProblem(agent, id) === null,
  )
  return [...new Set(kept)].slice(0, ADDED_MODELS_MAX)
}

/**
 * What one agent's added ids may be: a short list of ids it can take. An agent that takes none keeps
 * the empty list the config reads back, so the settings a person saved are accepted as they were
 * read; it takes no ids.
 */
function addedRule(agent: NativeAgent): Rule {
  return (ids) => {
    if (!hasCustomModel(agent))
      return Array.isArray(ids) && ids.length === 0
        ? null
        : `${AGENT_NAMES[agent]} takes no model ids of its own`
    if (!Array.isArray(ids) || ids.length > ADDED_MODELS_MAX)
      return `addedModels.${agent} must be a list of at most ${ADDED_MODELS_MAX} model ids`
    const bad = ids.find((id) => typeof id !== "string" || customModelProblem(agent, id) !== null)
    return bad === undefined
      ? null
      : `${String(bad)} is not a model id ${AGENT_NAMES[agent]} takes: ${addModelRule(agent)}`
  }
}

function settleLaunch(next: Config["otherAgent"], base: Config["otherAgent"]) {
  return {
    program: validProgram(next.program) ? next.program : base.program,
    args: validArgs(next.args) ? next.args : base.args,
  }
}

/** Merge a patch into a config, keeping only values the config knows. */
function settle(base: Config, patch: unknown): Config {
  const next = merge(base, patch)
  const addedModels = Object.fromEntries(
    AGENTS.map((agent) => [agent, settleAdded(agent, next.addedModels[agent])]),
  ) as Config["addedModels"]
  for (const key of Object.keys(RUN_CHECKS) as (keyof typeof RUN_CHECKS)[]) {
    if (!(RUN_CHECKS[key] as readonly unknown[]).includes(next[key]))
      Object.assign(next, { [key]: base[key] })
  }
  return {
    ...next,
    usage: usageDisplayOf(next.usage),
    approvals: approvalsOf(patch, next.approvals),
    agentView: agentViewOf(patch, next.agentView),
    theme: themeOf(next.theme),
    animations: animationsOf(next.animations),
    textSize: textSizeOf(next.textSize),
    uiFont: uiFontOf(next.uiFont),
    editor: EDITORS.includes(next.editor) ? next.editor : base.editor,
    addedModels,
    sessions: {
      idleStop: IDLE_STOPS.includes(next.sessions.idleStop)
        ? next.sessions.idleStop
        : base.sessions.idleStop,
    },
    updates: { channel: updateChannelOf(patch, next.updates.channel) },
    // A port saved by hand outside 1024 to 65535 reads as the default.
    cockpit: {
      ...next.cockpit,
      port: isPort(next.cockpit.port) ? next.cockpit.port : base.cockpit.port,
    },
    agents: Object.fromEntries(
      AGENTS.map((agent) => [agent, settleAgent(agent, base.agents[agent], next.agents[agent])]),
    ) as Config["agents"],
    customEditor: settleLaunch(next.customEditor, base.customEditor),
    otherAgent: settleLaunch(next.otherAgent, base.otherAgent),
    terminal: {
      shell: {
        program: validPath(next.terminal.shell.program)
          ? next.terminal.shell.program
          : base.terminal.shell.program,
        args: validArgs(next.terminal.shell.args)
          ? next.terminal.shell.args
          : base.terminal.shell.args,
      },
    },
    // An unknown value keeps the base's.
    secondOpinion: {
      ...next.secondOpinion,
      agent:
        next.secondOpinion.agent === "auto" || isNativeAgent(next.secondOpinion.agent)
          ? next.secondOpinion.agent
          : base.secondOpinion.agent,
      plan: SECOND_OPINION_PLAN.includes(next.secondOpinion.plan as SecondOpinionPlan)
        ? next.secondOpinion.plan
        : base.secondOpinion.plan,
      change: SECOND_OPINION_CHANGE.includes(next.secondOpinion.change as SecondOpinionChange)
        ? next.secondOpinion.change
        : base.secondOpinion.change,
      reviewers: Object.fromEntries(
        AGENTS.map((agent) => [agent, settleReviewer(agent, next, addedModels)]),
      ) as Config["secondOpinion"]["reviewers"],
      whenKept: {
        plan: keptWhen(next.secondOpinion.whenKept?.plan, base.secondOpinion.whenKept.plan),
        change: keptWhen(next.secondOpinion.whenKept?.change, base.secondOpinion.whenKept.change),
      },
    },
    independentReview: {
      enabled:
        typeof next.independentReview.enabled === "boolean"
          ? next.independentReview.enabled
          : base.independentReview.enabled,
    },
    securityScans: {
      enabled:
        typeof next.securityScans?.enabled === "boolean"
          ? next.securityScans.enabled
          : base.securityScans.enabled,
      advisories: ADVISORIES.includes(next.securityScans?.advisories as Advisories)
        ? (next.securityScans?.advisories as Advisories)
        : base.securityScans.advisories,
    },
    planning: {
      lastStart: planningLaunchOf(next.planning.lastStart),
      defaults: settleDefaults(
        base.planning.defaults,
        next.planning.defaults,
        planningChecks(addedModels),
      ),
    },
    implement: {
      lastAgent: isNativeAgent(next.implement.lastAgent) ? next.implement.lastAgent : "",
      defaults: settleDefaults(
        base.implement.defaults,
        next.implement.defaults,
        buildChecks(addedModels),
      ),
    },
  }
}

/** Why a patch to `planning` or `implement` must be refused, or null. */
function refuseDefaults(
  card: "planning" | "implement",
  value: unknown,
  checks: Record<string, (agent: StepAgent, v: unknown) => boolean>,
): string | null {
  if (!isRecord(value)) return `${card} must be an object`
  if (
    Object.keys(value).some(
      (key) =>
        key !== "defaults" &&
        !(card === "planning" && key === "lastStart") &&
        !(card === "implement" && key === "lastAgent"),
    )
  )
    return `${card} holds defaults only`
  if (
    card === "implement" &&
    value.lastAgent !== undefined &&
    value.lastAgent !== "" &&
    !isNativeAgent(value.lastAgent)
  )
    return "implement.lastAgent must be an agent or empty"
  if (
    card === "planning" &&
    value.lastStart !== undefined &&
    value.lastStart !== null &&
    !planningLaunchOf(value.lastStart)
  )
    return "planning.lastStart must be a valid completed planning setup"
  const defaults = value.defaults
  if (defaults === undefined) return null
  if (!isRecord(defaults)) return `${card}.defaults must be an object`
  for (const [key, entry] of Object.entries(defaults)) {
    if (key === "agent") {
      if (!DEFAULTS_AGENTS.includes(entry as DefaultsAgent))
        return `${String(entry)} is not an agent`
      continue
    }
    if (!AGENTS.includes(key as StepAgent)) return `${key} is not an agent`
    const agent = key as StepAgent
    if (!isRecord(entry)) return `${card}.defaults.${agent} must be an object`
    for (const [name, v] of Object.entries(entry)) {
      const check = checks[name]
      if (check === undefined)
        return `${name} is not a ${card === "planning" ? "planning" : "build"} default`
      if (check(agent, v)) continue
      if (name === "model") return `${String(v)} is not a model ${agent} plans on`
      if (name === "orchestrator") return `${String(v)} is not a model ${agent} orchestrates on`
      if (name === "builder") return `${String(v)} is not a model ${agent} builds on`
      if (name === "effort") return `${String(v)} is not an effort`
      if (name === "terminalSession") return `${String(v)} is not a terminal session: this or new`
      if (name === "planningWorks")
        return `${String(v)} is not a planning checkout: checkout or worktree`
      if (name === "buildingWorks")
        return `${String(v)} is not a building checkout: checkout or branch`
      return `${card}.defaults.${agent}.${name} must be true or false`
    }
  }
  return null
}

/** Why `value` must be refused: not an object, a key outside `rules`, or a value its rule refuses. */
function refuseKeys(path: string, value: unknown, rules: Record<string, Rule>): string | null {
  if (!isRecord(value)) return `${path} must be an object`
  for (const [key, held] of Object.entries(value)) {
    const rule = Object.hasOwn(rules, key) ? rules[key] : undefined
    const why = rule === undefined ? `${path}.${key} is not a setting` : rule(held)
    if (why !== null) return why
  }
  return null
}

/** Why a patch to `agents` must be refused, or null. */
function refuseAgents(value: unknown): string | null {
  if (!isRecord(value)) return "agents must be an object of agents"
  for (const [agent, entry] of Object.entries(value)) {
    if (!isNativeAgent(agent)) return `${agent} is not an agent`
    const why = refuseKeys(`agents.${agent}`, entry, agentRules(agent))
    if (why !== null) return why
  }
  return null
}

const launchFields = { program: validProgram, args: validArgs }
const launchProblems = {
  customEditor: {
    program: "Enter a program name or path without control characters.",
    args: "Use up to 128 arguments, one per line. Each argument can be up to 32,768 characters and must not contain NUL characters.",
  },
  otherAgent: {
    program: "otherAgent.program must be a program name or path without control characters",
    args: `otherAgent.args ${ARGUMENTS}`,
  },
}

/** Why a patch to a configured program and its arguments must be refused, or null. */
function refuseLaunchSetting(
  keyName: "otherAgent" | "customEditor",
  value: unknown,
): string | null {
  if (!isRecord(value)) return `${keyName} must name a program and arguments`
  for (const [key, held] of Object.entries(value)) {
    if (key !== "program" && key !== "args")
      return `${key} is not a ${keyName} setting: use program and args`
    if (!launchFields[key](held)) return launchProblems[keyName][key]
  }
  return null
}

/** Why a patch to the agents, the shell, the editor or the idle stop must be refused, or null. */
function refuseTools(patch: Record<string, unknown>): string | null {
  for (const key of ["otherAgent", "customEditor"] as const) {
    if (!(key in patch)) continue
    const why = refuseLaunchSetting(key, patch[key])
    if (why !== null) return why
  }
  if ("agents" in patch) {
    const why = refuseAgents(patch.agents)
    if (why !== null) return why
  }
  for (const [key, rules] of Object.entries(SECTION_RULES)) {
    const why = key in patch ? refuseKeys(key, patch[key], rules) : null
    if (why !== null) return why
  }
  return "editor" in patch && !EDITORS.includes(patch.editor as Editor)
    ? `editor must be ${oneOf(EDITORS)}`
    : null
}

/** The ids the person has added once a patch is applied: those held, with the patch's own for each agent it names. */
function addedAfter(held: Added, patch: unknown): Added {
  const own = isRecord(patch) && isRecord(patch.addedModels) ? patch.addedModels : {}
  const out: Added = { ...held }
  for (const [agent, ids] of Object.entries(own))
    if (isNativeAgent(agent) && Array.isArray(ids))
      out[agent] = ids.filter((id) => typeof id === "string")
  return out
}

/**
 * Why a patch must be refused, or null: an agent that is
 * neither, a model the agent does not offer (`session` is a helpers choice only). Other keys
 * are the merge's business.
 */
export function refuseSettingsPatch(patch: unknown, held: Added = {}): string | null {
  const added = addedAfter(held, patch)
  if (!isRecord(patch)) return null
  const unknown = Object.keys(patch).find((key) => !Object.hasOwn(DEFAULT_CONFIG, key))
  if (unknown !== undefined) return `${unknown} is not a setting`
  for (const key of Object.keys(RUN_CHECKS) as (keyof typeof RUN_CHECKS)[]) {
    if (key in patch && !(RUN_CHECKS[key] as readonly unknown[]).includes(patch[key]))
      return `${key} must be ${RUN_CHECKS[key].join(" or ")}`
  }
  if (
    "approvals" in patch &&
    patch.approvals !== null &&
    !ANSWERS.includes(patch.approvals as Answers)
  )
    return `approvals must be ${ANSWERS.join(" or ")}`
  for (const key of ["answerPlaceChosen", "offerWorkflow"] as const)
    if (key in patch && typeof patch[key] !== "boolean") return `${key} must be true or false`
  const tools = refuseTools(patch)
  if (tools !== null) return tools
  const { models, secondOpinion, independentReview, planning, implement } = patch
  if (
    "agentView" in patch &&
    patch.agentView !== null &&
    !AGENT_VIEWS.includes(patch.agentView as AgentView)
  )
    return "agentView must be conversation or terminal"
  if ("theme" in patch && !THEMES.includes(patch.theme as never))
    return "theme must be system, light or dark"
  if ("animations" in patch && !ANIMATIONS.includes(patch.animations as never))
    return "animations must be system, full or reduced"
  if ("textSize" in patch && !TEXT_SIZES.includes(patch.textSize as never))
    return `textSize must be ${TEXT_SIZES.join(", ")}`
  if ("uiFont" in patch && !UI_FONTS.includes(patch.uiFont as never))
    return "uiFont must be geist, system or atkinson"
  if (independentReview !== undefined) {
    if (!isRecord(independentReview)) return "independentReview must be an object"
    if ("enabled" in independentReview && typeof independentReview.enabled !== "boolean")
      return "independentReview.enabled must be true or false"
  }
  if (patch.securityScans !== undefined) {
    const scans = patch.securityScans
    if (!isRecord(scans)) return "securityScans must be an object"
    const extra = Object.keys(scans).find((key) => !["enabled", "advisories"].includes(key))
    if (extra !== undefined) return `securityScans.${extra} is not a setting`
    if ("enabled" in scans && typeof scans.enabled !== "boolean")
      return "securityScans.enabled must be true or false"
    if ("advisories" in scans && !ADVISORIES.includes(scans.advisories as Advisories))
      return "securityScans.advisories must be online or local"
  }
  if (planning !== undefined) {
    const why = refuseDefaults("planning", planning, planningChecks(added))
    if (why !== null) return why
  }
  if (implement !== undefined) {
    const why = refuseDefaults("implement", implement, buildChecks(added))
    if (why !== null) return why
  }
  if (models !== undefined) {
    if (!isRecord(models)) return "models must be an object of agents"
    for (const [agent, roles] of Object.entries(models)) {
      if (!AGENTS.includes(agent as StepAgent)) return `${agent} is not an agent`
      if (!isRecord(roles)) return `models.${agent} must name helpers, judge or design`
      for (const [role, model] of Object.entries(roles)) {
        if (role !== "helpers" && role !== "judge" && role !== "design")
          return `${role} is not a helper role`
        if (role === "helpers" && model === SESSION_MODEL) continue
        if (!offered(agent as StepAgent, model, added))
          return `${String(model)} is not a model ${agent} offers`
      }
    }
  }
  if (secondOpinion !== undefined) {
    if (!isRecord(secondOpinion)) return "secondOpinion must be an object"
    if ("enabled" in secondOpinion && typeof secondOpinion.enabled !== "boolean")
      return "secondOpinion.enabled must be true or false"
    if (
      "agent" in secondOpinion &&
      secondOpinion.agent !== "auto" &&
      !isNativeAgent(secondOpinion.agent)
    )
      return "secondOpinion.agent must be auto or a native harness"
    if ("plan" in secondOpinion && !SECOND_OPINION_PLAN.includes(secondOpinion.plan as never))
      return "secondOpinion.plan must be off, always or risky"
    if ("change" in secondOpinion && !SECOND_OPINION_CHANGE.includes(secondOpinion.change as never))
      return "secondOpinion.change must be off, risky or always"
    if (secondOpinion.reviewers !== undefined) {
      const why = reviewersProblem(secondOpinion.reviewers, added)
      if (why !== null) return why
    }
    if (secondOpinion.whenKept !== undefined) {
      const kept = secondOpinion.whenKept
      if (
        !isRecord(kept) ||
        Object.keys(kept).some((key) => key !== "plan" && key !== "change") ||
        Object.values(kept).some((when) => !SECOND_OPINION_WHEN.includes(when as never))
      )
        return "secondOpinion.whenKept must be an object of plan and change, each risky or always"
    }
    if (secondOpinion.models !== undefined) {
      if (!isRecord(secondOpinion.models)) return "secondOpinion.models must be an object of agents"
      for (const [agent, model] of Object.entries(secondOpinion.models)) {
        if (!AGENTS.includes(agent as StepAgent)) return `${agent} is not an agent`
        if (!offered(agent as StepAgent, model, added))
          return `${String(model)} is not a model ${agent} offers`
      }
    }
  }
  if (isRecord(patch.cockpit) && "port" in patch.cockpit && !isPort(patch.cockpit.port))
    return `cockpit.port: ${PORT_PROBLEM}`
  if (isRecord(patch.usage)) {
    const usage = patch.usage
    if (usage.percent !== undefined && usage.percent !== "used" && usage.percent !== "remaining")
      return "usage.percent must be used or remaining"
    if (usage.money !== undefined && usage.money !== "spend" && usage.money !== "value")
      return "usage.money must be spend or value"
    if (
      usage.readings !== undefined &&
      (!Array.isArray(usage.readings) ||
        usage.readings.length > 32 ||
        !usage.readings.every(validReading))
    )
      return "usage.readings must contain at most 32 valid agent readings"
  }
  // What the checks above do not name: a section takes only the keys its default has.
  for (const [key, value] of Object.entries(patch)) {
    const known = DEFAULT_CONFIG[key as keyof Config]
    if (!isRecord(value) || !isRecord(known)) continue
    const stray = Object.keys(value).find((inner) => !Object.hasOwn(known, inner))
    if (stray !== undefined) return `${key}.${stray} is not a setting`
  }
  return refuseShape(DEFAULT_CONFIG, patch)
}

function refuseShape(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix = "",
): string | null {
  for (const [key, value] of Object.entries(patch)) {
    const path = `${prefix}${key}`
    if (!Object.hasOwn(base, key)) return `${path} is not a setting`
    // Unset by default, so it has no type to compare with; the checks above name its values.
    if (path === "agentView" || path === "approvals" || path === "updates.channel") continue
    const held = base[key]
    if (isRecord(held)) {
      if (!isRecord(value)) return `${path} must be an object`
      const refused = refuseShape(held, value, `${path}.`)
      if (refused !== null) return refused
    } else if (Array.isArray(held)) {
      if (!Array.isArray(value)) return `${path} must be an array`
    } else if (
      typeof value !== typeof held ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      return `${path} must be ${typeof held}`
  }
  return null
}

/** The settings as the file holds them, with the defaults under what it does not name. */
async function readStoredConfig(ctx: Ctx): Promise<Config> {
  const path = configPath(ctx)
  const exists = await ctx.fs.exists(path)
  const base: Config = { ...DEFAULT_CONFIG }
  if (!exists) return base
  try {
    const parsed: unknown = JSON.parse(await ctx.fs.readFile(path))
    // A file from before the place question: someone who set answers to terminal chose it.
    const saved =
      isRecord(parsed) && !("answerPlaceChosen" in parsed)
        ? { ...parsed, answerPlaceChosen: parsed.answers === "terminal" }
        : parsed
    // Before None was the default, partial reviewer/scope choices inherited enabled: true.
    // Keep that explicit opt-in, without enabling a new, empty or models-only preference.
    if (isRecord(saved) && isRecord(saved.secondOpinion)) {
      const second = saved.secondOpinion
      const legacy = Object.fromEntries(
        AGENTS.flatMap((agent) =>
          typeof second[agent] === "string" ? [[agent, second[agent]]] : [],
        ),
      )
      const enabled =
        !("enabled" in second) &&
        (second.agent === "auto" ||
          isNativeAgent(second.agent) ||
          second.plan === "risky" ||
          second.plan === "always" ||
          second.change === "risky" ||
          second.change === "always")
      return settle(base, {
        ...saved,
        secondOpinion: {
          ...second,
          ...(enabled ? { enabled: true } : {}),
          models: { ...legacy, ...(isRecord(second.models) ? second.models : {}) },
        },
      })
    }
    return settle(base, saved)
  } catch {
    return base
  }
}

/** One agent's model choices, each catalog model its own list says cannot run swapped for its own model. */
function usableModels(config: Config, agent: StepAgent, from: KnownModels | null): Config {
  const use = (model: string) => usableDefault(agent, model, from)
  const launch = (model: string) => usableLaunchModel(agent, model, from)
  const { helpers, judge, design } = config.models[agent]
  const planning = config.planning.defaults[agent]
  const lastStart = config.planning.lastStart
  const build = config.implement.defaults[agent]
  return {
    ...config,
    models: {
      ...config.models,
      [agent]: { helpers: use(helpers), judge: use(judge), design: use(design) },
    },
    secondOpinion: {
      ...config.secondOpinion,
      models: {
        ...config.secondOpinion.models,
        [agent]: use(config.secondOpinion.models[agent]),
      },
    },
    planning: {
      ...config.planning,
      ...(agent === "pi" && lastStart?.agent === agent
        ? { lastStart: { ...lastStart, model: launch(lastStart.model) } }
        : {}),
      defaults: {
        ...config.planning.defaults,
        [agent]: { ...planning, model: launch(planning.model) },
      },
    },
    implement: {
      ...config.implement,
      defaults: {
        ...config.implement.defaults,
        [agent]: {
          ...build,
          orchestrator: launch(build.orchestrator),
          builder: launch(build.builder),
          subagents: launch(build.subagents),
        },
      },
    },
  }
}

/**
 * The settings in force. An agent that lists its own models (`modelList` in `agents.json`) may not
 * have a login for the catalog's: where its stored list is known, a choice that is a catalog model
 * missing from it becomes the model the agent itself would start with. A custom or listed model is
 * never touched. Codex can update its native catalog between reads of our list. This never starts
 * the agent.
 */
export async function readConfig(ctx: Ctx): Promise<Config> {
  const config = await readStoredConfig(ctx)
  const lists = await storedModelLists(ctx)
  const codex = lists.codex
  let nativeCodex: KnownModels | null = null
  if (codex) {
    const env = configDirEnvironment(ctx.env, config.agents)
    if (await codexCacheChanged(ctx, codex.checkedAt, env)) {
      const text = await listFile(ctx, "codex", "models_cache.json", env)
      const listed = text === null ? [] : readIds("codex-cache", "codex", text)
      if (listed.length > 0) {
        const own = await ownModel(ctx, "codex", "codex-config", env)
        nativeCodex = { listed, own: own ?? listed[0] ?? null }
      }
    }
  }
  return AGENTS.reduce((held, agent) => {
    const from = (agent === "codex" ? nativeCodex : null) ?? knownFrom(lists[agent])
    return from === null && agent !== "pi" ? held : usableModels(held, agent, from)
  }, config)
}

export async function writeConfig(ctx: Ctx, patch: unknown): Promise<Config> {
  // Choosing either place, anywhere, answers the place question for good.
  const chosen =
    isRecord(patch) &&
    ("answers" in patch || "approvals" in patch) &&
    !("answerPlaceChosen" in patch)
      ? { ...patch, answerPlaceChosen: true }
      : patch
  const next = settle(await readStoredConfig(ctx), chosen)
  next.planning.lastStart = planningAfterSettings(next, patch, ctx.clock.now())
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.writeFile(configPath(ctx), `${JSON.stringify(next, null, 2)}\n`)
  return readConfig(ctx)
}
