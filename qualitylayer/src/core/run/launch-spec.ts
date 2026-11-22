import agents from "../agents/agents.json" with { type: "json" }
import { AGENT_NAMES, BINARIES, isNativeAgent, type NativeAgent } from "../agents/ids.ts"
import type { Config, PlanningLaunch } from "../config-values.ts"
import type { AgentKind, RunPurpose } from "./contracts.ts"
import { worktreeName } from "./worktree-plan.ts"

/** How far a permission mode loosens the agent's prompts: its own setting, fewer prompts, or none. */
export type PermissionLevel = "own" | "fewer" | "bypass"
/** One entry of an agent's footer list: what the person sees, and the arguments a start adds. */
export type PermissionMode = {
  id: string
  label: string
  /** One sentence for the footer's list: what the mode does. */
  hint: string
  args: readonly string[]
  /**
   * Variables the mode sets besides its arguments: Copilot's `COPILOT_ALLOW_ALL=true` also answers
   * its folder-trust question, which no argument of a managed start can.
   */
  env?: Readonly<Record<string, string>>
  level: PermissionLevel
  /**
   * Other spellings of a Bypass-level mode, for extra arguments that would start the agent in it
   * without the mode: each is a list of argument sequences that must all be present (`-s
   * danger-full-access` together with `-a never`).
   */
  aliases?: readonly (readonly (readonly string[])[])[]
}
/** How a managed start gives a session id QualityLayer chose: behind a flag, or by resuming a created one. */
type StartSession = {
  flag?: string
  id?: "uuid" | "native" | "ses_hex"
  create?: readonly string[]
}
/** The format of an agent's own record that shows a turn ended when its hook did not run. */
export type TurnRecordFormat = "cursor" | "grok" | "antigravity"
export type AgentCapabilities = {
  interruptKey: string | null
  resume: "flag" | "subcommand" | null
  resumeArg: string | null
  sessionId: "chosen" | "discovered"
  worktreeFlag: string | null
  goal: boolean
  permissionModes: readonly PermissionMode[]
  permissionSource: string | null
  turnEndHooks: readonly string[]
  promptDelivery: "argument" | "explicit-input"
  promptFlag: string | null
  managedArgs: readonly string[]
  conversation: boolean
  effort: "separate" | "in-model" | null
  /** The levels a session may be set to, lowest first; empty when the agent has no separate effort. */
  efforts: readonly string[]
  limits: "usage-command" | "session-record" | null
  modelIds: "listed" | "native"
  /**
   * Where the agent itself says which models it can use now, appended to the catalog's in every model
   * picker: the output of a read-only `command` (OpenCode `models`, Pi `--list-models`), or, with no
   * command, a file of its own folder, `config.toml` unless `file` names another (Grok's
   * `[model.<id>]` blocks, Codex's `models_cache.json`). `format` names how the text is read and
   * `own` the reader of the model the agent's own settings pick (`model-list.ts`).
   */
  modelList: {
    command: readonly string[] | null
    file?: string
    format: "lines" | "table" | "toml-blocks" | "copilot-help" | "codex-cache" | "id-rows"
    /** False when the list only says which catalog models the account has (Cursor lists hundreds). */
    adds?: boolean
    /**
     * Whether the list holds every model the agent can run: only then is a catalog model missing from
     * it unusable, and pickers show only the models it holds (`offeredModels`).
     */
    complete: boolean
    /** Null when the agent's own settings file is not read for its model. */
    own: string | null
  } | null
  /**
   * The agent takes a model id the catalog does not name, added by the person: `shape` is how it writes
   * one (`id`, or `provider/model`), `unlessListed` hides the Add a model entry while its own list
   * (`modelList`) is known, because that list is then every id it takes.
   */
  customModel: {
    shape: "id" | "provider/model"
    placeholder: string
    hint: string
    unlessListed: boolean
  } | null
  configDirEnv: string | null
  picker: boolean
  modelFlag: string | null
  effortArgs: readonly string[] | null
  addDirFlag: string | null
  worktreeName: "separate" | "attached" | null
  trustArgs: readonly string[]
  startSession: StartSession | null
  sessionEnv: string | null
  /** The variables that name the agent when set in the commands and hooks it runs. */
  identityEnv: readonly string[]
  /** The variables that hold the agent's own session id there, the first one set first. */
  sessionIdEnv: readonly string[]
  turnRecord: TurnRecordFormat | null
}
export const AGENT_CAPABILITIES: Record<AgentKind, AgentCapabilities> = {
  "claude-code": agents["claude-code"].capabilities as AgentCapabilities,
  codex: agents.codex.capabilities as AgentCapabilities,
  pi: agents.pi.capabilities as AgentCapabilities,
  opencode: agents.opencode.capabilities as AgentCapabilities,
  cursor: agents.cursor.capabilities as AgentCapabilities,
  grok: agents.grok.capabilities as AgentCapabilities,
  antigravity: agents.antigravity.capabilities as AgentCapabilities,
  copilot: agents.copilot.capabilities as AgentCapabilities,
  other: agents.unknown.capabilities as AgentCapabilities,
}
export const permissionModes = (agent: AgentKind): readonly PermissionMode[] =>
  AGENT_CAPABILITIES[agent].permissionModes

/** A native report, as an id, label or native flag value; unknown spellings never select a mode. */
export function reportedPermission(
  agent: AgentKind,
  reported: string | undefined,
): PermissionMode | undefined {
  if (!reported) return undefined
  const word = reported.toLowerCase().replace(/[ _-]+/g, "")
  const alias =
    agent === "copilot"
      ? (
          {
            manual: "ask",
            assisted: "allow-tools",
            off: "ask",
            auto: "allow-tools",
            on: "bypass",
          } as Record<string, string>
        )[word]
      : agent === "claude-code" && word === "default"
        ? "ask"
        : undefined
  return permissionModes(agent).find(
    (mode) =>
      mode.id === alias ||
      [mode.id, mode.label, mode.args.at(-1)].some(
        (value) => value?.toLowerCase().replace(/[ _-]+/g, "") === word,
      ),
  )
}
/** Whether `args` holds the sequence: side by side, as `--flag=value`, or for a short flag as `-fvalue`. */
function holdsSequence(args: readonly string[], sequence: readonly string[]): boolean {
  const [flag, value] = sequence
  if (sequence.length === 2 && flag !== undefined && value !== undefined) {
    if (args.includes(`${flag}=${value}`)) return true
    if (/^-[A-Za-z]$/.test(flag) && args.includes(`${flag}${value}`)) return true
  }
  return args.some((_, at) => sequence.every((word, offset) => args[at + offset] === word))
}
/** Every way `mode` can be spelled: its arguments, its aliases, and its flag set to the mode's id. */
function spellings(mode: PermissionMode): (readonly (readonly string[])[])[] {
  const [flag] = mode.args
  const byId = mode.args.length === 2 && flag !== undefined ? [[[flag, mode.id]]] : []
  return [[mode.args], ...(mode.aliases ?? []), ...byId]
}
/**
 * The Bypass-level modes that `args` would start the agent in, each as the spelling found.
 * Extra arguments may not skip permission checks: Bypass is a mode, confirmed on each run.
 */
export function bypassArgsIn(agent: AgentKind, args: readonly string[]): string[] {
  return permissionModes(agent)
    .filter((mode) => mode.level === "bypass" && mode.args.length > 0)
    .flatMap((mode) => {
      const found = spellings(mode).find((spelling) =>
        spelling.every((sequence) => holdsSequence(args, sequence)),
      )
      return found === undefined ? [] : [found.map((sequence) => sequence.join(" ")).join(" ")]
    })
}
export const supportsPermission = (agent: AgentKind, level: PermissionLevel): boolean =>
  level === "own" ||
  (agent === "pi" && level === "bypass") ||
  permissionModes(agent).some((mode) => mode.level === level)
export const permissionFor = (agent: AgentKind, requested: PermissionLevel) =>
  supportsPermission(agent, requested) ? requested : "own"
export function defaultPermissionChoice(
  config: Pick<Config, "perm" | "agents">,
  agent: AgentKind,
  remembered?: PlanningLaunch | null,
) {
  if (agent === "other") return { perm: "own" as const, permMode: undefined }
  if (remembered?.agent === agent)
    return permissionChoice(agent, {
      perm: remembered.perm,
      ...(remembered.permMode ? { permMode: remembered.permMode } : {}),
    })
  const mode = config.agents[agent].permMode
  return permissionChoice(
    agent,
    mode === "own"
      ? { perm: "own" }
      : mode
        ? { permMode: mode }
        : { perm: permissionFor(agent, config.perm) },
  )
}

export function permissionDescription(
  agent: AgentKind,
  perm?: PermissionLevel,
  permMode?: string,
): string {
  const selected = resolvePermission(agent, perm, permMode)
  if (agent === "pi")
    return `${selected.level === "bypass" ? "Bypass" : "Agent settings"} · Pi has no approval switch`
  if (agent === "opencode" && selected.level === "bypass") return "Bypass · explicit denies apply"
  return selected.mode?.label ?? "Agent settings"
}
/**
 * The level and mode a run's choices name, or the reason they cannot be started. A mode id fixes
 * the level; a level alone means the first mode of that level; own with no mode adds no argument.
 */
export function resolvePermission(
  agent: AgentKind,
  perm?: PermissionLevel,
  permMode?: string,
): { level: PermissionLevel; mode: PermissionMode | undefined } {
  if (agent === "other") {
    if ((perm ?? "own") !== "own" || permMode !== undefined)
      throw new Error("Another agent uses its own settings")
    return { level: "own", mode: undefined }
  }
  const modes = permissionModes(agent)
  if (permMode !== undefined) {
    const mode = modes.find((candidate) => candidate.id === permMode)
    if (!mode) throw new Error(`${agent} has no permission mode ${permMode}`)
    if (perm !== undefined && perm !== mode.level)
      throw new Error(`Permission mode ${mode.id} belongs to the ${mode.level} level`)
    return { level: mode.level, mode }
  }
  const level = perm ?? "own"
  if (!supportsPermission(agent, level))
    throw new Error(
      `${agent} does not support the requested permission override; use its own settings`,
    )
  return { level, mode: level === "own" ? undefined : modes.find((mode) => mode.level === level) }
}
/** What a mode id may look like on the wire; whether the agent has it is `resolvePermission`'s answer. */
export const PERMISSION_MODE_ID = /^[a-z][a-z0-9-]{0,39}$/
/**
 * A settings choice with its level and mode made consistent for this agent, to merge over a run's
 * settings: naming only a level drops the old mode, naming a mode sets its level. Empty when the
 * choice names neither.
 */
export function permissionChoice(
  agent: AgentKind,
  choice: { perm?: PermissionLevel; permMode?: string },
): { perm?: PermissionLevel; permMode?: string | undefined } {
  if (choice.perm === undefined && choice.permMode === undefined) return {}
  const { level, mode } = resolvePermission(agent, choice.perm, choice.permMode)
  return { perm: level, permMode: mode?.id }
}
/** The settings with `permissionChoice` applied; none stays none. */
export const withPermission = <T extends { perm?: PermissionLevel; permMode?: string }>(
  agent: AgentKind,
  settings: T | undefined,
): T | undefined => settings && { ...settings, ...permissionChoice(agent, settings) }
/** Ask runs and another agent use the agent's own settings: no level above own, and no mode. */
export const ownPermissionOnly = (settings: { perm?: PermissionLevel; permMode?: string }) =>
  (settings.perm ?? "own") === "own" && settings.permMode === undefined
/** The default row of the permission list: the agent's own setting and where it comes from. */
export const ownPermissionNote = (agent: AgentKind, reported?: string): string => {
  const source = AGENT_CAPABILITIES[agent].permissionSource
  return `${source ? `From ${source}` : "Your agent’s settings"}${reported ? ` · ${reported}` : ""}`
}
export type LaunchSpec = {
  agent: AgentKind
  program: string
  args: string[]
  env: Record<string, string>
  prompt: string
  capabilities: AgentCapabilities
  purpose: RunPurpose
}
export type LaunchSpecInput = {
  /** Validated server-owned paths, retained with the managed run for recovery. */
  launchFiles?: readonly { path: string }[]
  answers?: "app" | "terminal"
  agent: AgentKind
  purpose: RunPurpose
  managed?: boolean
  session?: string
  /** Resume an existing native session; otherwise a managed start gives the session id it chose. */
  resume?: boolean
  /** A task's current stage; omitted for a fresh Implement start. */
  stage?: string
  /** Open a resumed session without sending a continuation prompt. */
  continue?: boolean
  perm?: PermissionLevel
  /** A mode id from the agent's `permissionModes`; it fixes the level and the arguments. */
  permMode?: string
  model?: string
  effort?: string
  subagentModel?: string
  /** Accepted from legacy handoffs but never changes the agent's own speed preference. */
  fastMode?: boolean
  works?: "checkout" | "worktree" | "branch"
  mode?: "goal" | "plain"
  /** Server-derived generated inputs for a validated, bound task. Never a request choice. */
  taskBriefsDir?: string
  /**
   * The folder of QualityLayer's own command. Copilot refuses a command outside its granted folders,
   * and its skills run QualityLayer by that absolute path, so a managed Copilot start grants it.
   */
  toolsFolder?: string
  /** Server-derived inputs belonging to one managed planning run, including after binding. */
  runBriefsDir?: string
  otherAgent?: { program: string; args: string[] }
  /** `agents.<id>.args`: extra arguments added to every start, before QualityLayer's own flags. */
  agentArgs?: string[]
  /** Exact context resolved from the registered artifact and its current source witness. */
  artifactPrompt?: string
  /**
   * What a managed App launch carries for its hooks (`launch-hooks.ts` `launchHooks`): arguments
   * before the prompt, and variables. Absent: the agent reports through its installed hooks.
   */
  hooks?: { args: readonly string[]; env: Readonly<Record<string, string>> }
}

export const doubleQuoted = (text: string): string => `"${text.replace(/[\\"$`]/g, "\\$&")}"`
export const singleQuoted = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`
export { worktreeName }

export const launchAgent = (agent: string | null | undefined): AgentKind =>
  isNativeAgent(agent) ? agent : "other"
export const agentInvocation = (_agent: AgentKind, answers?: "app" | "terminal") =>
  `Using QualityLayer${answers === "terminal" ? " in the terminal" : ""},`
export const otherTaskPrompt = (task: string, answers?: "app" | "terminal") =>
  `${agentInvocation("other", answers)} continue the recorded stage of task ${task}`

export function stagePrompt(
  agent: AgentKind,
  task: string,
  stage: string,
  answers?: "app" | "terminal",
): string {
  if (stage === "chat") return `${agentInvocation(agent, answers)} continue chat task ${task}`
  const planning = stage === "plan"
  const action = planning
    ? "continue planning task"
    : stage === "verify"
      ? "continue verification of task"
      : stage === "shipped"
        ? // Approved: the conversation goes on (merge, deploy, tweaks); `next` says where it stands.
          "continue the approved task"
        : "implement the approved plan for task"
  return `${agentInvocation(agent, answers)} ${action} ${task}`
}

export const taskLaunchPrompt = (
  agent: AgentKind,
  task: string,
  stage = "implement",
  answers?: "app" | "terminal",
) => (agent === "other" ? otherTaskPrompt(task, answers) : stagePrompt(agent, task, stage, answers))

const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NATIVE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The session id QualityLayer chooses for a managed start of this agent, when a flag takes one.
 * An agent that picks its own id, or whose id comes from a subcommand, has none to choose.
 */
export function chosenNativeSession(agent: AgentKind): string | undefined {
  const fresh = AGENT_CAPABILITIES[agent].startSession
  if (!fresh?.flag) return undefined
  const id = crypto.randomUUID()
  return fresh.id === "ses_hex" ? `ses_${id.replaceAll("-", "")}` : id
}

/** What the start types for the person, or nothing for a plain terminal. */
function launchPrompt(input: LaunchSpecInput, capabilities: AgentCapabilities): string {
  const { agent, purpose } = input
  let prompt: string
  if (purpose.kind === "terminal") {
    // A plain session: the agent or shell opens and waits for the person; nothing is typed for them.
    prompt = ""
  } else if (purpose.kind === "artifact") {
    if (!input.artifactPrompt)
      throw new Error("Artifact iteration needs its validated source context")
    prompt = input.artifactPrompt
  } else if (purpose.kind === "new-task") {
    const request = purpose.request.trim()
    prompt = `${agentInvocation(agent, input.answers)} ${purpose.type === "chat" ? "start chat:" : "plan"} ${request}`
  } else {
    prompt = taskLaunchPrompt(agent, purpose.task, input.stage, input.answers)
    if (input.mode === "goal" && capabilities.goal) prompt = `/goal ${prompt}`
  }
  if (prompt && input.launchFiles?.length)
    prompt += `\n\nRead these files attached to this request before starting:\n${input.launchFiles.map((file) => JSON.stringify(file.path)).join("\n")}`
  return prompt
}

function checkedSession(agent: NativeAgent, session: string | undefined, uuid: boolean): string {
  if (!session || !(uuid ? UUID : NATIVE_ID).test(session))
    throw new Error(
      `Managed ${AGENT_NAMES[agent]} needs a ${uuid ? "session UUID" : "native session id"}`,
    )
  return session
}

/**
 * The arguments that resume a session, or that start the one QualityLayer chose, and what a managed
 * start adds around them: the agent's own managed arguments, its trust question answered, and the
 * variable that lets commands the agent runs name the session.
 */
function sessionArguments(
  input: LaunchSpecInput,
  agent: NativeAgent,
  capabilities: AgentCapabilities,
  args: string[],
  env: Record<string, string>,
) {
  if (input.resume) {
    if (!input.session || !NATIVE_ID.test(input.session))
      throw new Error("Invalid native session id")
    args.push(capabilities.resumeArg as string, input.session)
  }
  if (!input.managed) return
  args.push(...capabilities.managedArgs)
  const fresh = capabilities.startSession
  if (fresh && !input.resume) {
    const id = checkedSession(agent, input.session, fresh.id === "uuid")
    args.push(fresh.flag ?? (capabilities.resumeArg as string), id)
  }
  args.push(...capabilities.trustArgs)
  if (capabilities.sessionEnv && input.session) env[capabilities.sessionEnv] = input.session
}

/** OpenCode starts through its plugin, which takes the permission level, model and effort from the environment. */
function opencodePermission(
  input: LaunchSpecInput,
  perm: PermissionLevel,
  mode: PermissionMode | undefined,
  args: string[],
  env: Record<string, string>,
) {
  if (input.managed && input.purpose.kind !== "terminal") env.QUALITYLAYER_OPENCODE_AGENT = "build"
  if (!input.managed && input.model) {
    if (perm !== "own") env.QUALITYLAYER_OPENCODE_PERMISSION = perm
  } else args.push(...(mode?.args ?? []))
}

function modelArguments(
  input: LaunchSpecInput,
  agent: NativeAgent,
  capabilities: AgentCapabilities,
  args: string[],
  env: Record<string, string>,
) {
  if (agent === "opencode") {
    if (input.model) {
      env.QUALITYLAYER_OPENCODE_MODEL = input.model
      if (!input.managed && capabilities.modelFlag)
        args.push(capabilities.modelFlag, input.model.replace(/#[^#]*$/, ""))
    }
    if (input.effort) env.QUALITYLAYER_OPENCODE_EFFORT = input.effort
    return
  }
  if (input.model && capabilities.modelFlag) args.push(capabilities.modelFlag, input.model)
  if (input.effort && capabilities.effortArgs)
    args.push(...capabilities.effortArgs.map((arg) => arg.replace("{effort}", input.effort ?? "")))
}

const insideGeneratedInputs = (path: string) =>
  ABSOLUTE.test(path) &&
  !/[\0\r\n]/.test(path) &&
  !path.split(/[\\/]/).some((part) => part === "..")

/** The folders a start may grant, each checked whether or not the agent can take it. */
function grantedFolders(input: LaunchSpecInput): string[] {
  const { purpose } = input
  const folders = new Set<string>()
  for (const file of input.launchFiles ?? []) {
    if (!ABSOLUTE.test(file.path) || /[\0\r\n]/.test(file.path))
      throw new Error("Invalid launch attachment path")
    folders.add(file.path.replace(/[\\/][^\\/]+$/, ""))
  }
  const task = input.taskBriefsDir
  if (task !== undefined) {
    if (purpose.kind !== "task" || !insideGeneratedInputs(task) || !/[\\/]briefs$/.test(task))
      throw new Error("Invalid bound task briefs directory")
    folders.add(task)
  }
  const run = input.runBriefsDir
  if (run !== undefined) {
    if (
      !input.managed ||
      !["new-task", "task"].includes(purpose.kind) ||
      !insideGeneratedInputs(run) ||
      !/[\\/]runs[\\/][A-Za-z0-9][A-Za-z0-9_-]{0,127}[\\/]briefs$/.test(run)
    )
      throw new Error("Invalid bound run briefs directory")
    folders.add(run)
  }
  const tools = input.toolsFolder
  if (input.agent === "copilot" && input.managed && tools !== undefined) {
    if (!ABSOLUTE.test(tools) || /[\0\r\n]/.test(tools)) throw new Error("Invalid tools folder")
    folders.add(tools)
  }
  return [...folders]
}

/** A new worktree's flag, with the request's name where the flag takes one. */
function worktreeArguments(input: LaunchSpecInput, capabilities: AgentCapabilities): string[] {
  const flag = capabilities.worktreeFlag
  if (input.works !== "worktree" || flag === null) return []
  const name = input.purpose.kind === "new-task" ? worktreeName(input.purpose.request) : undefined
  if (name !== undefined && capabilities.worktreeName === "separate") return [flag, name]
  if (name !== undefined && capabilities.worktreeName === "attached") return [`${flag}=${name}`]
  return [flag]
}

function nativeArguments(
  input: LaunchSpecInput,
  agent: NativeAgent,
  prompt: string,
  args: string[],
  env: Record<string, string>,
) {
  const capabilities = AGENT_CAPABILITIES[agent]
  const { level: perm, mode } = resolvePermission(agent, input.perm, input.permMode)
  const nativeAssisted = agent === "copilot" && input.managed && mode?.id === "allow-tools"
  if (nativeAssisted && !input.resume && !input.hooks?.env.COPILOT_HOME)
    throw new Error(
      "Copilot's Assisted Permissions must be selected in its Terminal with /permissions. Use Agent settings or Allow All for a new App session, or continue in the native Terminal.",
    )
  if (agent === "opencode" && input.model && !input.managed) args.unshift("mini")
  // Claude Code's rating prompt takes a typed 1, 2 or 3 while the input is empty: a person answering
  // a question with "1" in the App would rate the session instead. A QualityLayer window never shows it.
  if (agent === "claude-code") env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY = "1"
  if (agent === "claude-code" && input.subagentModel)
    env.CLAUDE_CODE_SUBAGENT_MODEL = input.subagentModel
  if (agent === "codex" && input.subagentModel)
    args.push("-c", `agents.default_subagent_model=${JSON.stringify(input.subagentModel)}`)
  sessionArguments(input, agent, capabilities, args, env)
  if (agent === "opencode") opencodePermission(input, perm, mode, args, env)
  else if (!nativeAssisted) args.push(...(mode?.args ?? []))
  Object.assign(
    env,
    nativeAssisted
      ? { COPILOT_ALLOW_ALL: "false", COPILOT_ASSISTED_APPROVAL: "false" }
      : (mode?.env ?? {}),
  )
  const folders = grantedFolders(input)
  const readOnlyCodex =
    agent === "codex" &&
    (holdsSequence(mode?.args ?? input.agentArgs ?? [], ["-s", "read-only"]) ||
      holdsSequence(mode?.args ?? input.agentArgs ?? [], ["--sandbox", "read-only"]))
  const inheritedCodex = agent === "codex" && perm === "own" && !mode
  if (capabilities.addDirFlag && !readOnlyCodex && !inheritedCodex)
    for (const folder of folders) args.push(capabilities.addDirFlag, folder)
  modelArguments(input, agent, capabilities, args, env)
  args.push(...worktreeArguments(input, capabilities))
  if (input.managed && input.hooks) {
    args.push(...input.hooks.args)
    Object.assign(env, input.hooks.env)
  }
  if (prompt && (!input.resume || input.continue !== false))
    args.push(...(capabilities.promptFlag ? [capabilities.promptFlag, prompt] : [prompt]))
}

export function launchSpec(input: LaunchSpecInput): LaunchSpec {
  const { agent, purpose } = input
  const capabilities = AGENT_CAPABILITIES[agent]
  // Refuses a permission choice the agent does not have before anything launches.
  resolvePermission(agent, input.perm, input.permMode)
  if (purpose.kind === "task" && input.works === "worktree")
    throw new Error("Create the approved task's worktree before launching its agent")
  const prompt = launchPrompt(input, capabilities)
  const program = agent === "other" ? (input.otherAgent?.program ?? "") : BINARIES[agent]
  const args = [...((agent === "other" ? input.otherAgent?.args : input.agentArgs) ?? [])]
  const env: Record<string, string> = {}
  if (program.includes("\0") || args.some((arg) => arg.includes("\0")))
    throw new Error("Invalid agent program or arguments")
  if (agent !== "other") nativeArguments(input, agent, prompt, args, env)
  return { agent, program, args, env, prompt, capabilities, purpose }
}

/** A shell view only; managed starts use the raw program and argument array. */
export function launchCommand(spec: LaunchSpec): string {
  const safe = (arg: string) => (/^[A-Za-z0-9_./:=@+-]+$/.test(arg) ? arg : singleQuoted(arg))
  const args = spec.args.map((arg, index) =>
    spec.capabilities.promptDelivery === "argument" &&
    index === spec.args.length - 1 &&
    arg === spec.prompt
      ? spec.agent === "claude-code"
        ? doubleQuoted(arg)
        : singleQuoted(arg)
      : safe(arg),
  )
  const command = [safe(spec.program), ...args].join(" ")
  const entries = Object.entries(spec.env)
  return entries.length
    ? `env ${entries.map(([key, value]) => `${key}=${safe(value)}`).join(" ")} ${command}`
    : command
}

export function resumeLine(
  agent: AgentKind,
  session: string,
  options: { managed?: boolean; prompt?: string } = {},
): string {
  const capabilities = AGENT_CAPABILITIES[agent]
  if (!/^[A-Za-z0-9_-]+$/.test(session) || capabilities.resume === null)
    throw new Error("Invalid native session")
  const args = [capabilities.resumeArg as string, session]
  if (options.managed || agent === "opencode") args.push(...capabilities.managedArgs)
  if (options.prompt)
    args.push(
      ...(capabilities.promptFlag ? [capabilities.promptFlag] : []),
      agent === "codex" ? singleQuoted(options.prompt) : doubleQuoted(options.prompt),
    )
  return [agent === "other" ? "" : BINARIES[agent], ...args].join(" ")
}

export const startBranchLine = (
  works: "checkout" | "branch" | "worktree",
  branch?: string,
): string | null =>
  branch !== undefined && works !== "worktree" ? `git switch -c ${branch}` : null
