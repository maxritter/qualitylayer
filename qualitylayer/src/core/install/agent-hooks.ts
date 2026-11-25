// The hook files of the agents that have a hook file of their own. Each keeps its hooks in a
// different shape, so this table says where QualityLayer's turn-end and tool hooks go and how a hook is
// written there; `agent-settings.ts` does the setting, recording and putting back like for the
// other agents. These agents are the ones whose hooks are called with `--agent <id>`: a hook that
// reaches them any other way (Cursor and Grok also run Claude Code's hooks) is ignored, so a turn
// that ends is recorded once.

import { join } from "node:path"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"

export type HookFileAgent = "cursor" | "grok" | "antigravity" | "copilot"

/** One hook in the file: the agent's event, and which of QualityLayer's hooks it runs (`agent-settings.ts` names them). */
export type FileHook = {
  event: string
  /**
   * Set for an event whose hooks stand in a group with this tool matcher, in a file whose other
   * events hold the hooks themselves (Antigravity's tool events).
   */
  matcher?: string
  /** A hook of `agent-settings.ts`: the live-status ones, the prompt and activity hooks, the compaction mark. */
  kind:
    | "liveStop"
    | "liveSessionStart"
    | "liveSessionEnd"
    | "prompt"
    | "activity"
    | "livePre"
    | "liveSubagentStart"
    | "liveSubagentStop"
    | "compactMark"
    | "ownCommand"
    | "liveNotification"
    | "liveFailure"
    | "liveError"
}

type HookFile = {
  /** The hook file, from the agent's configuration folder. */
  file: readonly string[]
  /** What shows the agent was started once (any one entry beside its folder); null: the folder is enough. */
  marker: string | readonly string[] | null
  /**
   * `flat`: an event holds the hooks themselves (`{ command }`). `groups`: it holds groups with a
   * `hooks` list, as Claude Code writes them.
   */
  shape: "flat" | "groups"
  /** How a hook is written: `command`, or per shell (`bash` and `powershell`, with `timeoutSec`) as Copilot does. */
  handler: "command" | "shells"
  /** Where the events stand in the file: at `hooks`, or under the name of a group QualityLayer owns. */
  events: readonly string[]
  /** A key the file needs before it reads the hooks, set only when the file has none. */
  version: number | null
  /** The hooks beyond the turn end, which `agents.json` names: a session that ended, a message the person sent. */
  more: readonly FileHook[]
  /** The file that lists the agent's MCP servers, from its configuration folder; null: none is known. */
  mcp: {
    file: readonly string[]
    format: "json" | "toml"
    /** Fields the agent's server entry needs beside `command` and `args` (Copilot's `type` and `tools`). */
    extra?: Readonly<Record<string, unknown>>
  } | null
}

const FILES: Record<HookFileAgent, HookFile> = {
  cursor: {
    file: ["hooks.json"],
    marker: "cli-config.json",
    shape: "flat",
    handler: "command",
    events: ["hooks"],
    version: 1,
    more: [
      { event: "sessionStart", kind: "liveSessionStart" },
      { event: "sessionEnd", kind: "liveSessionEnd" },
      // Cursor's bundled event list (2026.11.05): every tool call before and after it runs, and one
      // that failed or was refused (no postToolUse follows it); a helper's start and stop.
      // afterFileEdit is left out: only its Write tool runs it, and postToolUse already names the file.
      { event: "preToolUse", kind: "livePre" },
      { event: "postToolUse", kind: "activity" },
      { event: "postToolUseFailure", kind: "liveFailure" },
      { event: "subagentStart", kind: "liveSubagentStart" },
      { event: "subagentStop", kind: "liveSubagentStop" },
    ],
    mcp: { file: ["mcp.json"], format: "json" },
  },
  grok: {
    file: ["hooks", "qualitylayer.json"],
    marker: null,
    shape: "groups",
    handler: "command",
    events: ["hooks"],
    version: null,
    more: [
      { event: "SessionStart", kind: "liveSessionStart" },
      { event: "SessionEnd", kind: "liveSessionEnd" },
      { event: "UserPromptSubmit", kind: "prompt" },
      // Grok's session record names these two events (`hook_execution`: pre_tool_use, post_tool_use).
      { event: "PreToolUse", kind: "livePre" },
      { event: "PostToolUse", kind: "activity" },
    ],
    mcp: { file: ["config.toml"], format: "toml" },
  },
  antigravity: {
    file: ["config", "hooks.json"],
    marker: ["antigravity-cli", "antigravity", "antigravity-ide"],
    // Antigravity 1.4.12 refuses a grouped Stop ("command hook must specify 'command'"): only its
    // tool events take groups, each with a tool matcher ("*" for every tool), as its hook reference
    // (1.5.x) says. PreInvocation delivers prompt/quality feedback via injectSteps.systemMessage.
    shape: "flat",
    handler: "command",
    events: ["qualitylayer"],
    version: null,
    more: [
      { event: "PreInvocation", kind: "prompt" },
      { event: "PreToolUse", kind: "livePre", matcher: "*" },
      { event: "PostToolUse", kind: "activity", matcher: "*" },
    ],
    mcp: null,
  },
  copilot: {
    file: ["hooks", "qualitylayer.json"],
    marker: null,
    shape: "flat",
    handler: "shells",
    events: ["hooks"],
    version: 1,
    more: [
      { event: "sessionStart", kind: "liveSessionStart" },
      { event: "sessionEnd", kind: "liveSessionEnd" },
      { event: "userPromptSubmitted", kind: "prompt" },
      // Copilot's path check refuses a command outside the project, QualityLayer's own included.
      { event: "permissionRequest", kind: "ownCommand" },
      { event: "preToolUse", kind: "livePre" },
      { event: "postToolUse", kind: "activity" },
      { event: "subagentStop", kind: "liveSubagentStop" },
      // Copilot's hook reference lists these three too: a permission or question prompt
      // (`notification`, with its `notification_type`), a tool that failed and an error.
      { event: "notification", kind: "liveNotification" },
      { event: "postToolUseFailure", kind: "liveFailure" },
      { event: "errorOccurred", kind: "liveError" },
      // The mark is returned with the next message (`userPromptSubmitted`): no Copilot payload is
      // known to report a compaction at sessionStart, and the tool hooks' output is not relied on.
      { event: "preCompact", kind: "compactMark" },
    ],
    mcp: {
      file: ["mcp-config.json"],
      format: "json",
      extra: { type: "local", tools: ["*"] },
    },
  },
}

export const HOOK_FILE_AGENTS = Object.keys(FILES) as HookFileAgent[]

export const hasHookFile = (agent: string): agent is HookFileAgent => Object.hasOwn(FILES, agent)

export const hookFile = (agent: HookFileAgent) => FILES[agent]

/** Marker directories/files that prove this hook-file agent was started at least once. */
export function hookFileMarkers(agent: HookFileAgent): readonly string[] {
  const { marker } = FILES[agent]
  if (marker === null) return []
  return typeof marker === "string" ? [marker] : marker
}

export const hookFilePath = (agent: HookFileAgent, root: string): string =>
  join(root, ...FILES[agent].file)

/** The hooks QualityLayer sets in the file: the agent's turn end (`agents.json`), then the rest. */
export function fileHooks(agent: HookFileAgent): FileHook[] {
  return [
    ...AGENT_CAPABILITIES[agent].turnEndHooks.map((event) => ({
      event,
      kind: "liveStop" as const,
    })),
    ...FILES[agent].more,
  ]
}
