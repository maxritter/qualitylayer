// The agent settings QualityLayer's workflow relies on, set by the installer.
// Like Pilot Shell's installer, it only adds what is missing and says so: a key
// the user already has keeps its value, and a key the user removes after an
// install is not added again. Everything set is recorded, so uninstall puts
// back exactly those keys, and only while they still hold the installer's value.
//
// Every change is one key: a JSON path in Claude Code's settings.json, or a key
// in Codex's config.toml (top level or in one table).
//
// Nothing here ever asks a question.

import { randomUUID } from "node:crypto"
import { basename, delimiter, dirname, isAbsolute, join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import type { Ctx } from "../../ctx.ts"
import { AGENT_NAMES, type NativeAgent } from "../agents/ids.ts"
import { windows, windowsHookCommand } from "../platform.ts"
import { compareVersions } from "../update/versions.ts"
import {
  type FileHook,
  fileHooks,
  HOOK_FILE_AGENTS,
  type HookFileAgent,
  hookFile,
  hookFilePath,
} from "./agent-hooks.ts"
import { codexHookTrust } from "./codex-hook-trust.ts"
import { realDir, userHome } from "./manifest.ts"
import { MEMORY_MCP_NAME } from "./memory-mcp.ts"
import {
  CLAUDE_CODE_MODE_ENV,
  CLAUDE_CODE_MODE_ID,
  CLAUDE_CODE_MODE_MIN_VERSION,
  CLAUDE_NATIVE_IDS,
  CODEX_PERMISSION_IDS,
  claudeNativeDefaults,
  codexPermissionDefaults,
  codexPermissionsMissing,
  nativeConfigWritable,
} from "./native-defaults.ts"
import { jsonGet, jsonSet, tomlGet, tomlSet } from "./settings-document.ts"
import { agentEntry } from "./where.ts"

export { jsonGet, jsonSet, tomlGet, tomlSet } from "./settings-document.ts"

/** The agents whose hooks are set in files of their own settings (`CommandAgent`) or hook file (`HookFileAgent`). */
type CommandAgent = "claude-code" | "codex"
export type SettingAgent = CommandAgent | HookFileAgent

export type SettingItem = {
  /** `<agent>:<setting>`, e.g. `claude-code:prompt-hook`. */
  id: string
  agent: SettingAgent
  label: string
  why: string
  file: string
  /** Human-readable form of the setting change. */
  change: string
  /**
   * available: missing, will be set · applied: as wanted · kept: the
   * user's own value stays.
   */
  state: "applied" | "available" | "unavailable" | "kept"
  /** Why an item cannot be offered, or what is set now. */
  note?: string
  /** A hook QualityLayer's workflow needs, as against a preference the person may keep: integration health counts only these. */
  integration?: true
}

type Key =
  /**
   * `match`: the field of an object value that says whether it is still ours. `member`: the value
   * is a list of paths and ours is one entry of it; uninstall takes out that entry only. `hook`: the
   * value is a list of hook groups and ours is the one that runs this command; likewise.
   */
  | {
      format: "json"
      path: string[]
      value: unknown
      match?: string
      member?: string
      hook?: string
      /** Names the file's format: it stays while anything else is in the file, since that needs it. */
      hold?: true
    }
  | { format: "toml"; table: string | null; key: string; value: string }

/** `keptMessage`: what the install report says while the user's own value stays. */
/** `reshape`: our hook is there in the shape the agent no longer reads; an update rewrites it. */
export type Plan = SettingItem & { key: Key; keptMessage?: string; reshape?: boolean }

export type SettingRecord = {
  id: string
  file: string
  key: Key
  /** The value before install (JSON value, or the raw TOML value text); null when absent. */
  previous: unknown
  /** True when the installer created the TOML table the key lives in. */
  createdTable?: boolean
  /** How many JSON objects along the path the installer created (the innermost ones). */
  createdObjects?: number
  /** The installer created the JSON file itself: uninstall removes it once nothing else is in it. */
  createdFile?: boolean
  applied: number
}

/** Whether a hook runs this command: a group with a `hooks` list, or a flat hook that is the command itself. */
function runs(group: unknown, command: string): boolean {
  const entry = group as { hooks?: unknown } | null
  const handlers = Array.isArray(entry?.hooks) ? entry.hooks : [entry]
  return handlers.some((hook) => handlerCommand(hook) === command)
}

/** The command a hook runs: `command`, or `bash` for an agent that names one per shell (Copilot). */
function handlerCommand(hook: unknown): unknown {
  const entry = hook as { command?: unknown; bash?: unknown } | null
  return entry?.command ?? entry?.bash
}

/** Whether a key still holds what the installer set. */
function holdsOurs(now: unknown, key: Key): boolean {
  if (now === undefined) return false
  if (key.format === "json" && key.hook !== undefined) {
    const command = key.hook
    return Array.isArray(now) && now.some((group) => runs(group, command))
  }
  if (key.format === "json" && key.member !== undefined) {
    return typeof now === "string" && now.split(delimiter).includes(key.member)
  }
  if (key.format === "json" && key.match !== undefined) {
    const field = (v: unknown) =>
      typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key.match as string] : v
    return field(now) === field(key.value)
  }
  return isDeepStrictEqual(now, key.value)
}

function dirOf(ctx: Ctx, name: string, fallback: string): string {
  const value = ctx.env.get(name)
  return realDir(value !== undefined && value !== "" && isAbsolute(value) ? value : fallback)
}

/**
 * Each agent's configuration folder: the variable `agents.json` names as its `configDirEnv` (a test
 * holds the two together), else the default. Cursor and Antigravity have no variable. Antigravity's
 * is `~/.gemini`, which holds its skills and hooks under `config` and its state under
 * `antigravity-cli`.
 */
export function roots(ctx: Ctx): {
  claude: string
  codex: string
  pi: string
  opencode: string
  cursor: string
  grok: string
  antigravity: string
  copilot: string
} | null {
  const home = userHome(ctx)
  if (!home.ok) return null
  return {
    cursor: realDir(join(home.home, ".cursor")),
    grok: dirOf(ctx, "GROK_HOME", join(home.home, ".grok")),
    copilot: dirOf(ctx, "COPILOT_HOME", join(home.home, ".copilot")),
    antigravity: realDir(join(home.home, ".gemini")),
    claude: dirOf(ctx, "CLAUDE_CONFIG_DIR", join(home.home, ".claude")),
    codex: dirOf(ctx, "CODEX_HOME", join(home.home, ".codex")),
    pi: dirOf(ctx, "PI_CODING_AGENT_DIR", join(home.home, ".pi", "agent")),
    opencode: dirOf(
      ctx,
      "OPENCODE_CONFIG_DIR",
      join(dirOf(ctx, "XDG_CONFIG_HOME", join(home.home, ".config")), "opencode"),
    ),
  }
}

async function readText(ctx: Ctx, path: string): Promise<string | null> {
  return (await ctx.fs.exists(path)) ? ctx.fs.readFile(path) : null
}

async function currentValue(ctx: Ctx, file: string, key: Key): Promise<unknown> {
  const text = await readText(ctx, file)
  if (text === null) return undefined
  if (key.format === "json") {
    try {
      return jsonGet(JSON.parse(text), key.path)
    } catch {
      return undefined
    }
  }
  return tomlGet(text, key.table, key.key) ?? undefined
}

// ---------------------------------------------------------------- the settings

/** Where Claude Code keeps Opus 5.5's own effort: its user-level default ignores the top-level key. */
export const EFFORT_OPUS_PATH = ["modelSettings", "claude-opus-5-5", "effortLevel"]

/** The QualityLayer mod's folder, where the installer places it for a Claude Code that loads mods. */
export const modFolder = (ctx: Ctx) => join(ctx.home, "mod", "qualitylayer")

export const MOD_SETTING = "claude-code:mod"

/** The mod's folder appended to the user's own list of plugin folders, which stays. */
async function modPlan(ctx: Ctx, file: string): Promise<Plan> {
  const folder = modFolder(ctx)
  const path = ["env", "CLAUDE_CODE_PLUGIN_DIRS"]
  const now = await currentValue(ctx, file, { format: "json", path, value: null })
  const list = typeof now === "string" ? now.split(delimiter).filter((p) => p !== "") : []
  const state: Plan["state"] =
    now !== undefined && typeof now !== "string"
      ? "kept"
      : list.includes(folder)
        ? "applied"
        : "available"
  return {
    id: MOD_SETTING,
    agent: "claude-code",
    label: "QualityLayer mod",
    why: "In Claude Code 2.1.287 or later, a band above the prompt while a review waits, a pane with the stage track and build progress, and toasts. It only reads; without it everything works through the skill.",
    file,
    change: `env.CLAUDE_CODE_PLUGIN_DIRS gains ${folder}`,
    state,
    key: {
      format: "json",
      path,
      value: [...list, folder].join(delimiter),
      member: folder,
    },
    keptMessage: `QualityLayer mod: env.CLAUDE_CODE_PLUGIN_DIRS in ${file} is not a list of paths; left as it is.`,
  }
}

/** The hooks the installer sets: the agent pipes its event to `qualitylayer hook <sub>`. */
const LIVE_WHY =
  "The App's live status hears it at once: a busy agent is never shown as quiet, and a stopped one is never shown as busy."

type HookEntry = {
  event: string
  /** `qualitylayer hook <sub>` is what runs. */
  sub:
    | "prompt"
    | "activity"
    | "picker"
    | "ask"
    | "approve"
    | "live"
    | "memory-compact"
    | "own-command"
  id: string
  label: string
  why: string
  /** Only for these tools (a PreToolUse matcher). */
  matcher?: string
  /** Seconds the agent lets the hook run; the default suits a hook that answers at once. */
  timeout?: number
  async?: boolean
}

const HOOKS = {
  ownCommand: {
    event: "permissionRequest",
    sub: "own-command",
    id: "own-command-hook",
    label: "QualityLayer's own commands",
    why: "Copilot allows commands only inside your project, and QualityLayer's skills run its own command from its install folder. This hook lets exactly those commands run; anything else still asks you.",
  },
  prompt: {
    event: "UserPromptSubmit",
    sub: "prompt",
    id: "prompt-hook",
    label: "Prompt hook",
    why: "Typing approve records your approval of the gate that session opened, so the agent cannot approve its own plan. A natural-language request to use QualityLayer loads the matching skill; merely mentioning the product does not start a workflow.",
  },
  activity: {
    event: "PostToolUse",
    sub: "activity",
    id: "activity-hook",
    label: "Activity hook",
    why: "Every tool call the agent makes tells the App its session is alive, so a long build is never shown as gone.",
  },
  pickerClaude: {
    event: "PostToolUse",
    sub: "picker",
    id: "picker-hook",
    label: "Native picker answers",
    why: "After the native picker returns, verify its completed transcript before recording the person's choices. Background execution lets the client persist that result first.",
    matcher: "AskUserQuestion",
    async: true,
    timeout: 5,
  },
  pickerCodex: {
    event: "PostToolUse",
    sub: "picker",
    id: "picker-hook",
    label: "Native picker answers",
    why: "After the native picker returns, verify its completed transcript before recording the person's choices. Background execution lets the client persist that result first.",
    matcher: "request_user_input",
    async: true,
    timeout: 5,
  },
  ask: {
    event: "PreToolUse",
    sub: "ask",
    id: "ask-hook",
    label: "Picker guard",
    why: "QualityLayer asks its questions in the App; while a build runs unattended, Claude Code's own picker is refused, so the build never waits on a question.",
    matcher: "AskUserQuestion",
    timeout: 600,
  },
  approve: {
    event: "PermissionRequest",
    sub: "approve",
    id: "approve-hook",
    label: "Permission prompts in the Conversation view",
    why: "Answer permission prompts from the Conversation view while you look at it; otherwise the agent asks in its window.",
    // A prompt waits for a person; the hook gives up after nine minutes and leaves it to the agent.
    timeout: 600,
  },
  livePre: {
    event: "PreToolUse",
    sub: "live",
    id: "live-tool-hook",
    label: "Live status: a tool call starts",
    why: `A command that runs for long (a test suite, a build) keeps the agent shown at work. ${LIVE_WHY}`,
  },
  liveFailure: {
    event: "PostToolUseFailure",
    sub: "live",
    id: "live-tool-failure-hook",
    label: "Live status: a tool call fails",
    why: `A completed failed command leaves the running-tool list. ${LIVE_WHY}`,
  },
  liveSubagentStart: {
    event: "SubagentStart",
    sub: "live",
    id: "live-subagent-start-hook",
    label: "Live status: an agent starts",
    why: `The App lists the agents the session started. ${LIVE_WHY}`,
  },
  liveSubagentStop: {
    event: "SubagentStop",
    sub: "live",
    id: "live-subagent-stop-hook",
    label: "Live status: an agent stops",
    why: `The App lists the agents the session started. ${LIVE_WHY}`,
  },
  liveStop: {
    event: "Stop",
    sub: "live",
    id: "live-stop-hook",
    label: "Live status: a turn ends",
    why: `Keeps the agent waiting while an App answer or check is open, and records turn ends. ${LIVE_WHY}`,
  },
  liveSessionStart: {
    event: "SessionStart",
    sub: "live",
    id: "live-session-start-hook",
    label: "Live status: a session starts",
    why: `The App knows the session is open, so a resume never takes a conversation that is alive in another terminal. ${LIVE_WHY}`,
  },
  liveSessionEnd: {
    event: "SessionEnd",
    sub: "live",
    id: "live-session-end-hook",
    label: "Live status: a session ends",
    why: `The App says the session ended and how to continue. ${LIVE_WHY}`,
  },
  liveNotification: {
    event: "Notification",
    sub: "live",
    id: "live-permission-hook",
    label: "Live status: a permission prompt",
    why: `The App tells you when the agent asks for permission in its window. ${LIVE_WHY}`,
  },
  livePermission: {
    event: "PermissionRequest",
    sub: "live",
    id: "live-permission-hook",
    label: "Live status: a permission prompt",
    why: `The App tells you when the agent asks for permission in its window. It prints nothing, so it never answers the prompt. ${LIVE_WHY}`,
  },
  liveError: {
    event: "errorOccurred",
    sub: "live",
    id: "live-error-hook",
    label: "Live status: an error",
    why: `The App sees that the agent hit an error. ${LIVE_WHY}`,
  },
  compactMark: {
    event: "PreCompact",
    sub: "memory-compact",
    id: "compact-mark-hook",
    label: "Lessons: compaction starts",
    why: "Notes that the session is about to be compacted, so the project's lessons can come back with its next message or tool call.",
  },
  compactReturnClaude: {
    event: "SessionStart",
    sub: "memory-compact",
    id: "compact-return-hook",
    label: "Lessons: compaction done",
    why: "Gives the session its project lessons back right after a compaction made it forget them. A start that is not a compaction gets nothing.",
    matcher: "compact",
  },
  compactReturnCodex: {
    event: "SessionStart",
    sub: "memory-compact",
    id: "compact-return-hook",
    label: "Lessons: compaction done",
    why: "Gives the session its project lessons back right after a compaction made it forget them.",
    matcher: "compact",
  },
} as const satisfies Record<string, HookEntry>

/** The live-status hooks each agent offers: Claude Code says a permission prompt with Notification, Codex with PermissionRequest. */
const LIVE_HOOKS: Record<CommandAgent, (keyof typeof HOOKS)[]> = {
  "claude-code": [
    "livePre",
    "liveSubagentStart",
    "liveSubagentStop",
    "liveStop",
    "liveSessionEnd",
    "liveNotification",
    "liveFailure",
  ],
  codex: [
    "livePre",
    "liveSubagentStart",
    "liveSubagentStop",
    "liveStop",
    "liveSessionEnd",
    "livePermission",
  ],
}

/**
 * The command an agent runs for one of our hooks. The approving hook names its agent, so its answer
 * is filed under the session the App views; `more` adds words after it (`--launch`).
 */
function hookCommand(
  binary: string,
  agent: CommandAgent,
  entry: HookEntry,
  more: readonly string[] = [],
): string {
  const extra = entry.sub === "approve" ? ["--agent", agent] : []
  const args = ["hook", entry.sub, ...extra, ...more]
  return windows
    ? windowsHookCommand(binary, args, { silentIfMissing: true })
    : `${/\s/.test(binary) ? `"${binary}"` : binary} ${args.join(" ")}`
}

/** The group an agent's settings hold for one of our hooks: its matcher, and the command with its limits. */
function hookGroup(agent: CommandAgent, entry: HookEntry, command: string) {
  return {
    ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
    // Codex caps SessionEnd at three seconds and reports a startup error above it.
    hooks: [
      {
        type: "command",
        command,
        timeout: entry.timeout ?? (agent === "codex" && entry.event === "SessionEnd" ? 3 : 10),
        ...(entry.async ? { async: true } : {}),
      },
    ],
  }
}

/** Our hooks as an App launch carries them: the installed ones, and the session start, each calling `--launch`. */
const LAUNCH_HOOKS: Record<CommandAgent, (keyof typeof HOOKS)[]> = {
  "claude-code": [
    "prompt",
    "activity",
    "pickerClaude",
    "ask",
    "approve",
    ...LIVE_HOOKS["claude-code"],
    "liveSessionStart",
    "compactMark",
    "compactReturnClaude",
  ],
  codex: [
    "prompt",
    "activity",
    "pickerCodex",
    "approve",
    ...LIVE_HOOKS.codex,
    "liveSessionStart",
    "compactMark",
    "compactReturnCodex",
  ],
}

export type LaunchHook = {
  event: string
  group: {
    matcher?: string
    hooks: { type: string; command: string; timeout: number; async?: boolean }[]
  }
}

/**
 * The hooks an App launch of Claude Code or Codex carries (`launch-hooks.ts`), built from the same
 * definitions as the installed ones. Each calls the same command with `--launch`: an agent that also
 * runs the installed copy would otherwise report every event twice, and that copy steps aside when
 * the launch sets `QUALITYLAYER_SESSION_HOOKS`.
 */
export function launchHookGroups(agent: CommandAgent, binary: string): LaunchHook[] {
  return LAUNCH_HOOKS[agent].map((name) => {
    const entry: HookEntry = HOOKS[name]
    return {
      event: entry.event,
      group: hookGroup(agent, entry, hookCommand(binary, agent, entry, ["--launch"])),
    }
  })
}

/**
 * A hook of ours: it joins the user's own hooks for the event, which stay. `prompt` records
 * "approve" typed in the session that opened a gate; `activity` keeps the session's heartbeat.
 */
async function hookPlan(
  ctx: Ctx,
  agent: CommandAgent,
  file: string,
  hook: keyof typeof HOOKS,
): Promise<Plan> {
  const entry: HookEntry = HOOKS[hook]
  const { event, id, label, why, matcher } = entry
  const command = hookCommand(agentEntry(ctx), agent, entry)
  // Codex's hooks file may hold its events at the top level, as the session-peers hook leaves it.
  let path = ["hooks", event]
  if (agent === "codex") {
    const root = await currentValue(ctx, file, { format: "json", path: [], value: null })
    if (typeof root === "object" && root !== null && !Array.isArray(root)) {
      const events = root as Record<string, unknown>
      if (Object.keys(events).length > 0 && typeof events.hooks !== "object") {
        path = [event]
      }
    }
  }
  const now = await currentValue(ctx, file, { format: "json", path, value: null })
  const list = Array.isArray(now) ? now : []
  const state: Plan["state"] =
    now !== undefined && !Array.isArray(now)
      ? "kept"
      : list.some((group) => runs(group, command))
        ? "applied"
        : "available"
  return {
    id: `${agent}:${id}`,
    integration: true,
    agent,
    label,
    why,
    file,
    change: `${path.join(".")} runs \`${command}\`${matcher !== undefined ? ` for ${matcher}` : ""}`,
    state,
    key: {
      format: "json",
      path,
      value: [...list, hookGroup(agent, entry, command)],
      hook: command,
    },
    keptMessage: `${label}: ${path.join(".")} in ${file} is not a list; left as it is.`,
  }
}

/**
 * The turn-end hooks of an agent with a hook file of its own (`agent-hooks.ts`): `qualitylayer hook
 * live <event> --agent <id>`. The agent's name rides on the command, so its hooks are told from the
 * same hooks of Claude Code that Cursor and Grok run too.
 */
async function hookFilePlans(ctx: Ctx, agent: HookFileAgent, root: string): Promise<Plan[]> {
  const { version } = hookFile(agent)
  const file = hookFilePath(agent, root)
  const out: Plan[] = []
  if (version !== null) out.push(await versionPlan(ctx, agent, file, version))
  for (const hook of fileHooks(agent)) out.push(await fileHookPlan(ctx, agent, file, hook))
  return out
}

/** The key a hook file needs before the agent reads it, set only when the file has none. */
async function versionPlan(
  ctx: Ctx,
  agent: HookFileAgent,
  file: string,
  version: number,
): Promise<Plan> {
  const key: Key = { format: "json", path: ["version"], value: version, hold: true }
  const set = await currentValue(ctx, file, key)
  const name = AGENT_NAMES[agent]
  return {
    id: `${agent}:hooks-version`,
    integration: true,
    agent,
    label: `${name} hook file`,
    why: `${name} reads a hook file only when it names its format.`,
    file,
    change: `version = ${version}`,
    state: set === undefined ? "available" : set === version ? "applied" : "kept",
    key,
    keptMessage: `${name} hook file: version in ${file} is ${String(set)}; left as it is.`,
  }
}

/** The state of one of our hooks in an event's list: ours is there, the person's own value is, or neither. */
function hookState(now: unknown, command: string): Plan["state"] {
  if (now === undefined) return "available"
  if (!Array.isArray(now)) return "kept"
  return now.some((group) => runs(group, command)) ? "applied" : "available"
}

/** One hook in an agent's hook file: it runs `qualitylayer hook <sub> <event> --agent <id>`. */
async function fileHookPlan(
  ctx: Ctx,
  agent: HookFileAgent,
  file: string,
  { event, kind, matcher }: FileHook,
): Promise<Plan> {
  const { id, label, why, sub } = HOOKS[kind]
  const binary = agentEntry(ctx)
  const args = ["hook", sub, event, "--agent", agent]
  // Bash reads a backslash as an escape, so on Windows its command names the binary with forward slashes.
  const forBash = windows ? binary.replaceAll("\\", "/") : binary
  const posix = `${/\s/.test(forBash) ? `"${forBash}"` : forBash} ${args.join(" ")}`
  const shell = windowsHookCommand(binary, args, { silentIfMissing: true })
  const shells = hookFile(agent).handler === "shells"
  // A hook with a command per shell is told by its bash command.
  const command = windows && !shells ? shell : posix
  const path = [...hookFile(agent).events, event]
  const now = await currentValue(ctx, file, { format: "json", path, value: null })
  const handler = shells
    ? { type: "command", bash: command, powershell: shell, timeoutSec: 10 }
    : { type: "command", command, timeout: 10 }
  // An event with a tool matcher takes a group (Antigravity's tool events) in a file of flat hooks.
  const flat = hookFile(agent).shape === "flat" && matcher === undefined
  // Our hook in the other shape (Antigravity's grouped Stop, which 1.4.12 refuses) is replaced, not
  // kept; a handler of the person's in that group stays (`withoutHook`).
  const ours = (group: unknown) => runs(group, command)
  const fits = (group: unknown) =>
    ours(group) && Array.isArray((group as { hooks?: unknown } | null)?.hooks) !== flat
  const state = hookState(now, command)
  const reshape = state === "applied" && !(now as unknown[]).some(fits)
  return {
    id: `${agent}:${id}`,
    integration: true,
    agent,
    label,
    why,
    file,
    change: `${path.join(".")} runs \`${command}\``,
    state: reshape ? "available" : state,
    ...(reshape ? { reshape } : {}),
    key: {
      format: "json",
      path,
      value: [
        ...(Array.isArray(now) ? withoutHook(now, command, flat) : []),
        flat ? handler : { ...(matcher !== undefined ? { matcher } : {}), hooks: [handler] },
      ],
      hook: command,
    },
    keptMessage: `${label}: ${path.join(".")} in ${file} is not a list; left as it is.`,
  }
}

/**
 * The memory tools for an agent that lists its MCP servers in a file (`agent-hooks.ts`), set as the
 * agent's own command would: the launcher running `memory mcp`. A server the person took out stays
 * out, and one under that name that runs something else is left alone.
 */
async function memoryPlans(ctx: Ctx, agent: HookFileAgent, root: string): Promise<Plan[]> {
  const spec = hookFile(agent).mcp
  if (spec === null) return []
  const file = join(root, ...spec.file)
  const binary = agentEntry(ctx)
  const label = `${AGENT_NAMES[agent]} memory tools`
  const why =
    "The lessons QualityLayer keeps for a project can be searched and saved from a session."
  const keptMessage = `${label}: ${MEMORY_MCP_NAME} in ${file} runs something else; left as it is.`
  if (spec.format === "json") {
    const path = ["mcpServers", MEMORY_MCP_NAME]
    const value = { ...spec.extra, command: binary, args: ["memory", "mcp"] }
    const key: Key = { format: "json", path, value, match: "command" }
    const now = await currentValue(ctx, file, key)
    return [
      {
        id: `${agent}:memory-mcp`,
        agent,
        label,
        why,
        file,
        change: `${path.join(".")} runs ${binary} memory mcp`,
        state: now === undefined ? "available" : holdsOurs(now, key) ? "applied" : "kept",
        key,
        keptMessage,
      },
    ]
  }
  const table = `mcp_servers.${MEMORY_MCP_NAME}`
  const text = (await readText(ctx, file)) ?? ""
  // A key set into a table goes in first, so these two are set in reverse to read command, then args.
  return [
    ["args", '["memory", "mcp"]'],
    ["command", JSON.stringify(binary)],
  ].map(([name, value]) => {
    const set = tomlGet(text, table, name as string)
    return {
      id: `${agent}:memory-mcp-${name}`,
      agent,
      label,
      why,
      file,
      change: `[${table}] ${name} = ${value}`,
      state: set === null ? "available" : set === value ? "applied" : "kept",
      key: { format: "toml", table, key: name as string, value: value as string },
      keptMessage,
    }
  })
}

/** Whether the agent has been started once on this machine: its folder, and the marker beside it. */
async function startedOnce(ctx: Ctx, agent: HookFileAgent, root: string): Promise<boolean> {
  const { marker } = hookFile(agent)
  return (
    (await ctx.fs.exists(root)) && (marker === null || (await ctx.fs.exists(join(root, marker))))
  )
}

/**
 * Grok expires each question after 30 minutes; with no timeout a question waits for the person.
 * Set only when unset, like Codex's picker: a value the person chose stays.
 */
async function grokQuestionWait(ctx: Ctx, root: string): Promise<Plan> {
  const file = join(root, "config.toml")
  const table = "toolset.ask_user_question"
  const set = tomlGet((await readText(ctx, file)) ?? "", table, "timeout_enabled")
  return {
    id: "grok:question-wait",
    agent: "grok",
    label: "Questions wait for you",
    why: "Grok drops a question after 30 minutes. With no timeout it waits until you answer, wherever you are.",
    file,
    change: `[${table}] timeout_enabled = false`,
    state: set === null ? "available" : set === "false" ? "applied" : "kept",
    ...(set !== null && set !== "false"
      ? {
          note: `yours is ${set}`,
          keptMessage: `Questions wait for you: yours stays, yours is ${set}.`,
        }
      : {}),
    key: { format: "toml", table, key: "timeout_enabled", value: "false" },
  }
}

/** The hooks and memory tools of each of Cursor, Grok and Antigravity that has been started once. */
async function hookFileAgentPlans(
  ctx: Ctx,
  dirs: NonNullable<ReturnType<typeof roots>>,
): Promise<Plan[]> {
  const out: Plan[] = []
  for (const agent of HOOK_FILE_AGENTS)
    if (await startedOnce(ctx, agent, dirs[agent])) {
      out.push(...(await hookFilePlans(ctx, agent, dirs[agent])))
      out.push(...(await memoryPlans(ctx, agent, dirs[agent])))
      if (agent === "grok") out.push(await grokQuestionWait(ctx, dirs[agent]))
    }
  return out
}

/** Every recommendation for the agents installed on this machine, with its current state. */
async function plans(ctx: Ctx, claudeVersion: string | null = null): Promise<Plan[]> {
  const dirs = roots(ctx)
  if (dirs === null) return []
  const out: Plan[] = []
  out.push(...(await hookFileAgentPlans(ctx, dirs)))

  if (await ctx.fs.exists(dirs.claude)) {
    const file = join(dirs.claude, "settings.json")
    const codeMode =
      claudeVersion !== null &&
      compareVersions(claudeVersion, CLAUDE_CODE_MODE_MIN_VERSION) >= 0 &&
      ctx.env.get(CLAUDE_CODE_MODE_ENV) === undefined
    const defaults = claudeNativeDefaults(file, (await readText(ctx, file)) ?? "")
    out.push(...defaults.filter((item) => item.id !== CLAUDE_CODE_MODE_ID || codeMode))
    // Effort: high unless the user chose. Subagents inherit the session's level; a
    // top-level effortLevel in user settings does not reach Opus 5.5, so it gets its own.
    for (const [id, path, label] of [
      ["claude-code:effort", ["effortLevel"], "Effort level"],
      ["claude-code:effort-opus", EFFORT_OPUS_PATH, "Effort level for Opus 5.5"],
    ] as const) {
      const effortKey: Key = { format: "json", path: [...path], value: "high" }
      const set = await currentValue(ctx, file, effortKey)
      out.push({
        id,
        agent: "claude-code",
        label,
        why: "The session and its subagents think harder by default; `/effort` still changes it any time.",
        file,
        change: `${path.join(".")} = "high"`,
        state: set === undefined ? "available" : set === "high" ? "applied" : "kept",
        ...(set !== undefined && set !== "high"
          ? {
              note: `yours is ${String(set)}`,
              keptMessage: `${label}: yours stays, yours is ${String(set)}.`,
            }
          : {}),
        key: effortKey,
      })
    }
    out.push(await modPlan(ctx, file))
    out.push(await hookPlan(ctx, "claude-code", file, "prompt"))
    out.push(await hookPlan(ctx, "claude-code", file, "activity"))
    out.push(await hookPlan(ctx, "claude-code", file, "pickerClaude"))
    out.push(await hookPlan(ctx, "claude-code", file, "ask"))
    out.push(await hookPlan(ctx, "claude-code", file, "approve"))
    for (const hook of LIVE_HOOKS["claude-code"])
      out.push(await hookPlan(ctx, "claude-code", file, hook))
    out.push(await hookPlan(ctx, "claude-code", file, "compactMark"))
    out.push(await hookPlan(ctx, "claude-code", file, "compactReturnClaude"))
  }

  if (await ctx.fs.exists(dirs.codex)) {
    const file = join(dirs.codex, "config.toml")
    const text = (await readText(ctx, file)) ?? ""
    out.push(...codexPermissionDefaults(file, text))
    // Effort: high for the main thread and for spawned agents, unless the user chose.
    for (const [id, table, key, label] of [
      ["codex:effort", null, "model_reasoning_effort", "Reasoning effort"],
      [
        "codex:subagent-effort",
        "agents",
        "default_subagent_reasoning_effort",
        "Reasoning effort for subagents",
      ],
    ] as const) {
      const set = tomlGet(text, table, key)
      out.push({
        id,
        agent: "codex",
        label,
        why: "Codex and its subagents think harder by default; you can still change it per session.",
        file,
        change: `${table !== null ? `[${table}] ` : ""}${key} = "high"`,
        state:
          set === null ? "available" : set.replace(/["']/g, "") === "high" ? "applied" : "kept",
        ...(set !== null && set.replace(/["']/g, "") !== "high"
          ? { note: `yours is ${set}`, keptMessage: `${label}: yours stays, yours is ${set}.` }
          : {}),
        key: { format: "toml", table, key, value: '"high"' },
      })
    }

    // The configured model's largest window, from the catalog Codex caches.
    const model = (tomlGet(text, null, "model") ?? "").replace(/^["']|["']$/g, "")
    let max: number | null = null
    const cache = await readText(ctx, join(dirs.codex, "models_cache.json"))
    if (cache !== null && model !== "") {
      try {
        const models = (JSON.parse(cache) as { models?: Record<string, unknown>[] }).models ?? []
        const entry = models.find((m) => m.slug === model)
        max = typeof entry?.max_context_window === "number" ? entry.max_context_window : null
      } catch {
        max = null
      }
    }
    const set = tomlGet(text, null, "model_context_window")
    const current = set === null ? null : Number(set.replaceAll("_", ""))
    const windowKey: Key = {
      format: "toml",
      table: null,
      key: "model_context_window",
      value: String(max ?? 0),
    }
    out.push({
      id: "codex:context-window",
      agent: "codex",
      label: "Largest context window",
      why: "Fewer compactions in long planning and build sessions, at a higher cost per turn. QualityLayer keeps its state in the documents either way.",
      file,
      change: `model_context_window = ${max ?? "?"}`,
      state: max === null ? "unavailable" : current === null ? "available" : "kept",
      ...(max === null
        ? { note: model === "" ? "no model set in config.toml" : `no catalog entry for ${model}` }
        : current !== null && current > max
          ? { note: `set to ${current}, above ${model}'s catalog maximum of ${max}` }
          : { note: `${model}: default ${current ?? "window"}, up to ${max}` }),
      key: windowKey,
    })
    const picker = tomlGet(text, "features", "default_mode_request_user_input")
    out.push({
      id: "codex:default-mode-questions",
      agent: "codex",
      label: "Questions in Terminal mode",
      why: "Codex can ask QualityLayer questions in its native picker outside Plan mode.",
      file,
      change: "[features] default_mode_request_user_input = true",
      state: picker === null ? "available" : picker === "true" ? "applied" : "kept",
      ...(picker !== null && picker !== "true"
        ? {
            note: `yours is ${picker}`,
            keptMessage: `Questions in Terminal mode: yours stays, yours is ${picker}.`,
          }
        : {}),
      key: {
        format: "toml",
        table: "features",
        key: "default_mode_request_user_input",
        value: "true",
      },
    })
    out.push(await hookPlan(ctx, "codex", join(dirs.codex, "hooks.json"), "prompt"))
    out.push(await hookPlan(ctx, "codex", join(dirs.codex, "hooks.json"), "activity"))
    out.push(await hookPlan(ctx, "codex", join(dirs.codex, "hooks.json"), "pickerCodex"))
    out.push(await hookPlan(ctx, "codex", join(dirs.codex, "hooks.json"), "approve"))
    for (const hook of LIVE_HOOKS.codex)
      out.push(await hookPlan(ctx, "codex", join(dirs.codex, "hooks.json"), hook))
    out.push(await hookPlan(ctx, "codex", join(dirs.codex, "hooks.json"), "compactMark"))
    out.push(await hookPlan(ctx, "codex", join(dirs.codex, "hooks.json"), "compactReturnCodex"))
  }
  return out
}

export async function listAgentSettings(ctx: Ctx): Promise<SettingItem[]> {
  return (await plans(ctx)).map(({ key: _key, keptMessage: _k, ...item }) => item)
}

// ---------------------------------------------------------------- applying and undoing

type Records = {
  applied: SettingRecord[]
  /** Every id the installer ever set: one the user removed is not set again. */
  seen: string[]
}

function recordsPath(ctx: Ctx): string {
  return join(ctx.home, "agent-settings.json")
}

async function readRecords(ctx: Ctx): Promise<Records> {
  const text = await readText(ctx, recordsPath(ctx))
  if (text === null) return { applied: [], seen: [] }
  try {
    const raw = JSON.parse(text) as Partial<Records>
    return { applied: raw.applied ?? [], seen: raw.seen ?? [] }
  } catch {
    return { applied: [], seen: [] }
  }
}

async function writeRecords(ctx: Ctx, records: Records): Promise<void> {
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.writeFile(recordsPath(ctx), `${JSON.stringify(records, null, 2)}\n`)
}

async function backup(ctx: Ctx, file: string, text: string): Promise<string> {
  const dir = join(ctx.home, "backup")
  await ctx.fs.mkdir(dir, { mode: 0o700 })
  const path = join(dir, `${basename(file)}.${ctx.clock.now()}.${randomUUID()}`)
  await ctx.fs.writeFile(path, text, { mode: 0o600, exclusive: true })
  return path
}

/** Codex 0.163 accepts context at SessionStart/compact, not at PostCompact. */
async function migrateCodexCompactReturn(
  ctx: Ctx,
  records: Records,
  kept: Map<string, string | null>,
): Promise<boolean> {
  const dirs = roots(ctx)
  if (dirs === null) return false
  const record = records.applied.find(
    (entry) =>
      entry.id === "codex:compact-return-hook" && entry.file === join(dirs.codex, "hooks.json"),
  )
  if (record?.key.format !== "json" || record.key.hook === undefined) return false
  const { key } = record
  if (
    !isDeepStrictEqual(key.path, ["hooks", "PostCompact"]) &&
    !isDeepStrictEqual(key.path, ["PostCompact"])
  )
    return false
  const handler = { type: "command", command: key.hook, timeout: 10 }
  const previousGroup = { hooks: [handler] }
  if (!Array.isArray(key.value) || !isDeepStrictEqual(key.value.at(-1), previousGroup)) return false
  const text = await readText(ctx, record.file)
  if (text === null) return false
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(text)
  } catch {
    return false
  }
  const old = jsonGet(doc, key.path)
  const path = [...key.path.slice(0, -1), "SessionStart"]
  const current = jsonGet(doc, path)
  if (!Array.isArray(old) || (current !== undefined && !Array.isArray(current))) return false
  const target: unknown[] = current ?? []
  if (target.some((group) => runs(group, key.hook as string))) return false
  const matches = old.filter((group) => runs(group, key.hook as string))
  if (matches.length !== 1) return false
  const group = matches[0] as { hooks: unknown[] }
  // Extra user handlers stay, but a changed matcher, disabled flag or command remains their choice.
  if (
    !isDeepStrictEqual({ ...group, hooks: [handler] }, previousGroup) ||
    group.hooks.filter((entry) => isDeepStrictEqual(entry, handler)).length !== 1 ||
    group.hooks.filter((entry) => (entry as { command?: unknown })?.command === key.hook).length !==
      1
  )
    return false
  const index = old.indexOf(group)
  const at = group.hooks.findIndex((entry) => isDeepStrictEqual(entry, handler))
  const config = join(dirs.codex, "config.toml")
  const trustKey = `${record.file}:post_compact:${index}:${at}`
  const table = `hooks.state.${JSON.stringify(trustKey)}`
  const configText = await readText(ctx, config)
  let state: unknown
  try {
    state = jsonGet(Bun.TOML.parse(configText ?? ""), ["hooks", "state", trustKey])
  } catch {
    return false
  }
  if (jsonGet(state, ["enabled"]) === false) return false
  const trustId = `${record.id}:trust`
  const trust = records.applied.find((entry) => entry.id === trustId)
  const hash = jsonGet(state, ["trusted_hash"])
  if (trust === undefined && hash !== undefined) {
    // A manual trust row stays personal. Admit only its unchanged native definition, not its hash
    // as authority over the new event; the normal trust path verifies the new definition separately.
    if (
      records.seen.includes(trustId) ||
      old.length !== 1 ||
      group.hooks.length !== 1 ||
      ctx.runtime?.codexHooks === undefined ||
      typeof hash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(hash)
    )
      return false
    let listed: unknown
    try {
      listed = await ctx.runtime.codexHooks(dirname(record.file), dirs.codex)
    } catch {
      return false
    }
    if ((await readText(ctx, record.file)) !== text || (await readText(ctx, config)) !== configText)
      return false
    const prior = codexHookTrust(listed, dirs.codex, record.file, doc, [
      { event: "PostCompact", group: previousGroup },
    ])
    if (!prior.some((entry) => entry.key === trustKey && entry.trusted && entry.hash === hash))
      return false
  } else if (
    (trust !== undefined || hash !== undefined) &&
    (trust?.file !== config ||
      trust.key.format !== "toml" ||
      trust.key.table !== table ||
      trust.key.key !== "trusted_hash" ||
      trust.key.value !== JSON.stringify(hash))
  )
    return false
  const hooks = group.hooks.filter((entry) => !isDeepStrictEqual(entry, handler))
  const left = old.flatMap((entry) =>
    entry !== group ? [entry] : hooks.length === 0 ? [] : [{ ...group, hooks }],
  )
  const value = [...target, { matcher: "compact", hooks: [handler] }]
  jsonSet(doc, key.path, left.length === 0 ? undefined : left)
  jsonSet(doc, path, value)
  if (!kept.has(record.file)) kept.set(record.file, await backup(ctx, record.file, text))
  await ctx.fs.writeFile(record.file, `${JSON.stringify(doc, null, 2)}\n`)
  record.key = { ...key, path, value }
  record.previous = current ?? null
  // Keep the old trust record for uninstall, but admit the new definition's native hash afresh.
  if (trust !== undefined) records.seen = records.seen.filter((id) => id !== trustId)
  return true
}

export type SettingResult = { id: string; done: boolean; message: string }

async function trustCodexHooks(
  ctx: Ctx,
  items: Plan[],
  records: Records,
  kept: Map<string, string | null>,
): Promise<{ changed: boolean; result?: SettingResult }> {
  if (ctx.runtime?.codexHooks === undefined) return { changed: false }
  const owned = items.filter(
    (item) =>
      item.agent === "codex" &&
      item.key.format === "json" &&
      item.key.hook !== undefined &&
      records.applied.some(
        (record) =>
          record.id === item.id &&
          record.file === item.file &&
          record.key.format === "json" &&
          item.key.format === "json" &&
          record.key.hook === item.key.hook,
      ),
  )
  if (owned.length === 0) return { changed: false }
  const pending = {
    id: "codex:hook-trust",
    done: false,
    message:
      "Codex: open /hooks to review the QualityLayer hooks that could not be trusted automatically.",
  }
  const file = owned[0]?.file as string
  const text = await readText(ctx, file)
  if (text === null) return { changed: false, result: pending }
  let doc: unknown
  let listed: unknown
  const cwd = dirname(file)
  try {
    doc = JSON.parse(text)
    listed = await ctx.runtime.codexHooks(cwd, cwd)
  } catch {
    return { changed: false, result: pending }
  }
  if ((await readText(ctx, file)) !== text) return { changed: false, result: pending }
  // One query per hook: several of ours share an event (PermissionRequest), so a result must name its item.
  const admitted = owned.flatMap((item) =>
    item.key.format === "json" && Array.isArray(item.key.value)
      ? codexHookTrust(listed, cwd, file, doc, [
          { event: item.key.path.at(-1) as string, group: item.key.value.at(-1) },
        ]).map((hook) => ({ hook, item }))
      : [],
  )
  let changed = false
  let ready = 0
  for (const { hook, item } of admitted) {
    const id = `${item.id}:trust`
    if (hook.trusted) {
      if (!records.seen.includes(id)) {
        records.seen.push(id)
        changed = true
      }
      ready++
      continue
    }
    if (records.seen.includes(id)) continue
    const config = join(cwd, "config.toml")
    const table = `hooks.state.${JSON.stringify(hook.key)}`
    const current = (await readText(ctx, config)) ?? ""
    // Preserve a person's trust choice, including an old hash that Codex marks modified.
    if (tomlGet(current, table, "trusted_hash") !== null) continue
    const value = JSON.stringify(hook.hash)
    try {
      Bun.TOML.parse(tomlSet(current, table, "trusted_hash", value).text)
    } catch {
      continue
    }
    const applied = await apply(
      ctx,
      {
        id,
        agent: "codex",
        label: item.label,
        why: item.why,
        file: config,
        change: "trust its installed QualityLayer hook definition",
        state: "available",
        key: { format: "toml", table, key: "trusted_hash", value },
      },
      records,
      kept,
    )
    if (applied.done) {
      changed = true
      ready++
    }
  }
  return {
    changed,
    result:
      ready === owned.length
        ? { id: "codex:hook-trust", done: true, message: "Codex: QualityLayer hooks are ready." }
        : pending,
  }
}

/**
 * What uninstall needs to put one key back. A setting set again (the person took it out, Repair
 * puts it back) replaces its earlier record and keeps what that one stood for: the value before
 * QualityLayer and what it created.
 */
function recordApplied(
  ctx: Ctx,
  records: Records,
  item: Plan,
  made: Pick<SettingRecord, "previous" | "createdTable" | "createdObjects" | "createdFile">,
): void {
  const place = (key: Key) => (key.format === "json" ? [key.path, key.hook] : [key.table, key.key])
  const earlier = records.applied.filter(
    (r) =>
      r.id === item.id && r.file === item.file && isDeepStrictEqual(place(r.key), place(item.key)),
  )
  records.applied = records.applied.filter((r) => !earlier.includes(r))
  const created = (field: "createdTable" | "createdFile") =>
    made[field] === true || earlier.some((r) => r[field] === true)
  const objects = Math.max(made.createdObjects ?? 0, ...earlier.map((r) => r.createdObjects ?? 0))
  records.applied.push({
    id: item.id,
    file: item.file,
    key: item.key,
    previous: earlier.length > 0 ? earlier[0]?.previous : made.previous,
    ...(created("createdTable") ? { createdTable: true } : {}),
    ...(objects > 0 ? { createdObjects: objects } : {}),
    ...(created("createdFile") ? { createdFile: true } : {}),
    applied: ctx.clock.now(),
  })
}

/**
 * `kept` holds the one backup per file of this run: the file as it was before the
 * run's first change, never a half-changed state that happened to share its name.
 */
async function apply(
  ctx: Ctx,
  item: Plan,
  records: Records,
  kept: Map<string, string | null>,
): Promise<SettingResult> {
  const found = await readText(ctx, item.file)
  if (
    item.agent === "codex" &&
    item.key.format === "toml" &&
    !(await nativeConfigWritable(ctx, item.file, found))
  )
    return {
      id: item.id,
      done: false,
      message: "Your existing Codex configuration is unreadable or read-only; left alone.",
    }
  const text = found ?? ""
  const native = CLAUDE_NATIVE_IDS.has(item.id)
  if (
    native &&
    claudeNativeDefaults(item.file, text).find((plan) => plan.id === item.id)?.state !== "available"
  )
    return { id: item.id, done: false, message: item.keptMessage ?? "Your native setting stays." }
  let next: string
  let previous: unknown
  let createdTable = false
  let createdObjects = 0
  if (item.key.format === "json") {
    let doc: Record<string, unknown> = {}
    if (text.trim() !== "") {
      try {
        doc = JSON.parse(text) as Record<string, unknown>
      } catch {
        return { id: item.id, done: false, message: `${item.file} is not valid JSON; left alone` }
      }
    }
    previous = jsonGet(doc, item.key.path) ?? null
    const parents = item.key.path.slice(0, -1)
    let existing = 0
    while (
      existing < parents.length &&
      jsonGet(doc, parents.slice(0, existing + 1)) !== undefined
    ) {
      existing++
    }
    createdObjects = parents.length - existing
    // A hook group joins the list as it is now: two of ours on one event (the picker guard and
    // the live status on PreToolUse) each add their own, and neither drops the other.
    const hook = item.key.hook
    const value =
      hook !== undefined && Array.isArray(item.key.value)
        ? ((now: unknown) => {
            const list = Array.isArray(now) ? now : []
            const added = (item.key.value as unknown[]).at(-1)
            const grouped = (group: unknown) =>
              Array.isArray((group as { hooks?: unknown } | null)?.hooks)
            // Ours in the shape the file wants stays; ours in the other shape (an older install's
            // grouped Antigravity Stop) is replaced by the new entry. Only our handler leaves its
            // group: a handler the person added there stays, in the shape the event takes now.
            if (list.some((group) => runs(group, hook) && grouped(group) === grouped(added)))
              return list
            return [...withoutHook(list, hook, !grouped(added)), added]
          })(previous)
        : item.key.value
    jsonSet(doc, item.key.path, value)
    next = `${JSON.stringify(doc, null, 2)}\n`
  } else {
    previous = tomlGet(text, item.key.table, item.key.key)
    const set = tomlSet(text, item.key.table, item.key.key, String(item.key.value))
    next = set.text
    createdTable = set.createdTable
  }
  let saved = kept.get(item.file)
  if (saved === undefined) {
    saved = text === "" ? null : await backup(ctx, item.file, text)
    kept.set(item.file, saved)
  }
  await ctx.fs.mkdir(dirname(item.file))
  if (native && (await readText(ctx, item.file)) !== found)
    return {
      id: item.id,
      done: false,
      message: "Native settings changed during setup; left as they are.",
    }
  await ctx.fs.writeFile(item.file, next)
  if (!records.seen.includes(item.id)) records.seen.push(item.id)
  recordApplied(ctx, records, item, {
    previous,
    ...(createdTable ? { createdTable } : {}),
    ...(createdObjects > 0 ? { createdObjects } : {}),
    ...(found === null && item.key.format === "json" ? { createdFile: true } : {}),
  })
  return {
    id: item.id,
    done: true,
    message: `${item.label}: ${item.change} in ${item.file}${saved !== null ? ` (previous file kept in ${saved})` : ""}`,
  }
}

/**
 * On install and update: set every setting that is missing and was never set
 * before (a key the user removed stays removed). A value of the user's own stays
 * and is said in the result. Nothing is asked. One result per item set or
 * kept with something to say. The mod's setting names a folder, so it is set only when `mod` says
 * the installer placed one.
 */
async function applyCodexPermissions(
  ctx: Ctx,
  items: Plan[],
  records: Records,
  kept: Map<string, string | null>,
): Promise<SettingResult[]> {
  const pair = items.filter((item) => CODEX_PERMISSION_IDS.has(item.id))
  if (
    pair.length !== 2 ||
    pair.some((item) => item.state !== "available" || records.seen.includes(item.id))
  )
    return []
  const file = pair[0]?.file
  if (file === undefined) return []
  const found = await readText(ctx, file)
  if (!(await nativeConfigWritable(ctx, file, found)))
    return pair.map((item) => ({
      id: item.id,
      done: false,
      message: "Your existing Codex configuration is unreadable or read-only; left alone.",
    }))
  const text = found ?? ""
  if (!codexPermissionsMissing(text))
    return pair.map((item) => ({
      id: item.id,
      done: false,
      message: item.keptMessage ?? "Your native permission policy stays.",
    }))
  let next = text
  for (const item of pair) {
    if (item.key.format !== "toml") throw new Error("Native permission defaults must be TOML keys")
    next = tomlSet(next, item.key.table, item.key.key, item.key.value).text
  }
  if (!kept.has(file)) kept.set(file, text === "" ? null : await backup(ctx, file, text))
  await ctx.fs.mkdir(dirname(file))
  const current = await readText(ctx, file)
  if (current !== found || !(await nativeConfigWritable(ctx, file, current)))
    return pair.map((item) => ({
      id: item.id,
      done: false,
      message: "Native permission settings changed during setup; left as they are.",
    }))
  const mode = (await ctx.fs.stat?.(file))?.mode
  await ctx.fs.atomicWrite(file, next, {
    followSymlink: true,
    ...(mode === undefined ? {} : { mode }),
  })
  for (const item of pair) {
    records.seen.push(item.id)
    recordApplied(ctx, records, item, { previous: null })
  }
  return pair.map((item) => ({
    id: item.id,
    done: true,
    message: `${item.label}: ${item.change} in ${file}`,
  }))
}

export async function configureAgents(
  ctx: Ctx,
  options: { mod?: boolean; repair?: NativeAgent; claudeVersion?: string | null } = {},
): Promise<SettingResult[]> {
  const results: SettingResult[] = []
  const records = await readRecords(ctx)
  const kept = new Map<string, string | null>()
  let changed = false
  // A settings file that is gone (a rebuilt dev container that kept only ~/.qualitylayer, an agent
  // installed afresh) took the installer's settings with it. The person removed none of them, so
  // their records go and they are set again.
  const gone = new Set<string>()
  for (const record of records.applied) {
    if (!gone.has(record.file) && (await readText(ctx, record.file)) === null) gone.add(record.file)
  }
  if (gone.size > 0) {
    const lost = new Set(records.applied.filter((r) => gone.has(r.file)).map((r) => r.id))
    records.applied = records.applied.filter((r) => !gone.has(r.file))
    records.seen = records.seen.filter((id) => !lost.has(id))
    changed = true
  }
  changed = (await migrateCodexCompactReturn(ctx, records, kept)) || changed
  const items = (await plans(ctx, options.claudeVersion)).filter(
    (item) => options.repair === undefined || item.agent === options.repair,
  )
  const permissions = await applyCodexPermissions(ctx, items, records, kept)
  changed ||= permissions.some((result) => result.done)
  results.push(...permissions)
  for (const item of items) {
    if (CODEX_PERMISSION_IDS.has(item.id) && item.state === "available") continue
    if (item.id === MOD_SETTING && options.mod !== true) continue
    // The mod's setting follows the files the installer just placed, even after an uninstall. A
    // hook the person took out is put back only when they ask for the repair.
    const repairs = options.repair !== undefined && item.integration === true
    if (
      item.state === "available" &&
      (item.id === MOD_SETTING ||
        repairs ||
        item.reshape === true ||
        !records.seen.includes(item.id))
    ) {
      changed = true
      results.push(await apply(ctx, item, records, kept))
    } else if (item.state === "kept" && item.keptMessage !== undefined) {
      results.push({ id: item.id, done: false, message: item.keptMessage })
    }
  }
  const trust = await trustCodexHooks(ctx, items, records, kept)
  changed ||= trust.changed
  if (trust.result !== undefined) results.push(trust.result)
  if (changed) await writeRecords(ctx, records)
  return results
}

/** A key that names the file's format stays while anything else is in the file. */
function neededByOthers(doc: Record<string, unknown>, key: Key): boolean {
  return (
    key.format === "json" &&
    key.hold === true &&
    Object.keys(doc).some((name) => name !== key.path[0])
  )
}

/**
 * The hooks of an event without ours: a flat hook goes whole, a group loses only our handler. The
 * person's handlers that shared our group stay: in their group, or, with `flat` (the event takes no
 * groups any more: Antigravity's Stop), each as a hook of its own, which is how that event reads them.
 */
function withoutHook(groups: unknown[], command: string, flat = false): unknown[] {
  return groups.flatMap((group) => {
    if (!runs(group, command)) return [group]
    const entry = group as { hooks?: unknown }
    if (!Array.isArray(entry.hooks)) return []
    const hooks = entry.hooks.filter((handler) => handlerCommand(handler) !== command)
    if (hooks.length === 0) return []
    return flat ? hooks : [{ ...entry, hooks }]
  })
}

function pruneCreatedParents(doc: Record<string, unknown>, record: SettingRecord): boolean {
  if (record.key.format !== "json") return false
  const parents = record.key.path.slice(0, -1)
  let changed = false
  for (let depth = parents.length; depth > parents.length - (record.createdObjects ?? 0); depth--) {
    const path = parents.slice(0, depth),
      node = jsonGet(doc, path)
    if (typeof node !== "object" || node === null || Object.keys(node).length > 0) break
    jsonSet(doc, path, undefined)
    changed = true
  }
  return changed
}

/** Put back what the installer set, only where the key still holds its value. */
export async function revertAgentSettings(ctx: Ctx): Promise<SettingResult[]> {
  const records = await readRecords(ctx)
  const results: SettingResult[] = []
  // Last set, first put back: an object the installer created for the first of two settings
  // A parent object is removed only after all settings QualityLayer added to it are gone.
  for (const record of [...records.applied].reverse()) {
    const now = await currentValue(ctx, record.file, record.key)
    if (!holdsOurs(now, record.key)) {
      if (now === undefined && record.key.format === "json" && (record.createdObjects ?? 0) > 0) {
        const doc = JSON.parse((await readText(ctx, record.file)) ?? "{}") as Record<
          string,
          unknown
        >
        if (pruneCreatedParents(doc, record))
          await ctx.fs.writeFile(record.file, `${JSON.stringify(doc, null, 2)}\n`)
      }
      results.push({
        id: record.id,
        done: false,
        message: `${record.id}: changed since install; left as it is`,
      })
      continue
    }
    const text = (await readText(ctx, record.file)) ?? ""
    if (record.key.format === "json") {
      const doc = JSON.parse(text) as Record<string, unknown>
      // A list of paths or of hook groups: only our entry goes, whatever the user added since.
      const { member, hook } = record.key
      if (neededByOthers(doc, record.key)) {
        results.push({
          id: record.id,
          done: false,
          message: `${record.id}: kept, the other settings in ${record.file} need it`,
        })
        continue
      }
      const left =
        member !== undefined
          ? String(now)
              .split(delimiter)
              .filter((entry) => entry !== "" && entry !== member)
          : hook !== undefined
            ? withoutHook(now as unknown[], hook)
            : null
      const gone = left !== null ? left.length === 0 : record.previous === null
      const rest = hook !== undefined ? left : left?.join(delimiter)
      jsonSet(doc, record.key.path, gone ? undefined : (rest ?? record.previous))
      // Objects the installer created along the path go too, when nothing else moved in.
      pruneCreatedParents(doc, record)
      if (record.createdFile === true && Object.keys(doc).length === 0) {
        await ctx.fs.remove(record.file)
      } else {
        await ctx.fs.writeFile(record.file, `${JSON.stringify(doc, null, 2)}\n`)
      }
    } else {
      const restored = tomlSet(
        text,
        record.key.table,
        record.key.key,
        record.previous === null ? null : String(record.previous),
        record.createdTable === true,
      )
      await ctx.fs.writeFile(record.file, restored.text)
    }
    results.push({ id: record.id, done: true, message: `${record.id}: put back in ${record.file}` })
  }
  await writeRecords(ctx, { applied: [], seen: records.seen })
  return results
}
