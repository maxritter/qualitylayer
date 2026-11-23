// The hooks an App launch carries, so the App's live rows hear the agent from its first event
// without relying on a hook installed in the person's own agent folder. They are built from the same
// definitions as the installed ones (`agent-settings.ts`), and each calls the command with
// `--launch`. A launch sets `QUALITYLAYER_SESSION_HOOKS` to the agent's id; the installed copy of
// the same agent sees it and exits at once (`hook.ts`, and the Pi and OpenCode extensions), so no
// event is reported twice. An agent or version that cannot take them gets none and no variable: its
// installed hooks keep reporting.
//
//   Claude Code  inline `--settings` JSON (Claude runs the hooks of every settings source; two
//                identical commands are run once, ours differ by `--launch`); on Windows, whose
//                command line is bounded, the same JSON in a file of the launch folder
//   Codex        `-c hooks.<Event>=...` with the hook trust entry, `-c hooks.state=...` (a session-flag
//                hook is untrusted, and does not run, without it); verified on 0.166.x only
//   Pi           `-e` the launch copy of the extension
//   OpenCode     an overlay `OPENCODE_CONFIG_DIR`: the person's entries linked, the installed plugin
//                left out, the launch copy of the plugin written; verified on 2.x only
//   Copilot, Cursor, Grok, Antigravity  no launch hooks; their installed hook file stays, and the
//                run's `QUALITYLAYER_RUN` says which App session an event came from.

import { createHash } from "node:crypto"
import { join } from "node:path"
import type { NativeAgent } from "../agents/ids.ts"
import { launchHookGroups } from "../install/agent-settings.ts"
import { nativeIntegrationFiles } from "../install/native-integrations.ts"

export {
  createLaunchOverlays,
  launchHooksFolder,
  removeLaunchOverlays,
  removeStaleLaunchOverlays,
} from "./launch-overlays.ts"

export type LaunchOverlay = {
  /** A launch-local copy of a documented native settings file, with only these keys overridden. */
  config?: { name: string; values: Record<string, unknown> }
  /** Native state directories that must remain visible at the original home while the client runs. */
  share?: readonly string[]
  /** Where the overlay is created. */
  dir: string
  /** The folder of the person's own whose entries the overlay links, or null. */
  link: { variable: string } | null
  /** Files written into it (absolute paths). */
  files: { path: string; text: string }[]
  /** Entries of the linked folder left out (relative paths): the installed copy of what the launch carries. */
  leave: readonly string[]
  /** Config files of the linked folder copied with their `{file:}` references made absolute. */
  rebase?: readonly string[]
}

export type LaunchHooks = {
  args: string[]
  env: Record<string, string>
  overlays: LaunchOverlay[]
}

export type LaunchHooksInput = {
  permissionMode?: string
  resume?: boolean
  agent: NativeAgent
  /** The launcher the hooks call (`agentEntry`). */
  binary: string
  /** The run's own folder for overlays; created by `createLaunchOverlays`. */
  folder: string
  /** The agent's version as it reports it, when known. */
  version?: string
  /**
   * The command line is short: Windows refuses more than 32,767 characters, and its fifteen Claude
   * Code hooks are a PowerShell script each, about 2,000 characters apiece. Default: this platform
   * is Windows.
   */
  boundedCommandLine?: boolean
}

/** The Codex versions whose session-flag hooks and trust keys were checked: from, up to but not including. */
export const CODEX_LAUNCH_HOOKS = { from: [0, 166, 0], before: [0, 167, 0] } as const
/** The most characters Codex's hook arguments may take where a command line is bounded (Windows: 32,767 in all). */
const CODEX_COMMAND_LINE = 31_000
/** OpenCode 2 reads one config directory and has the plugin shape the launch copy is written for. */
export const OPENCODE_LAUNCH_HOOKS = { from: [2, 0, 0], before: [3, 0, 0] } as const

function inRange(
  version: string | undefined,
  { from, before }: { from: readonly number[]; before: readonly number[] },
): boolean {
  const found = /(?:^|\D)(\d+)\.(\d+)\.(\d+)/.exec(version ?? "")
  if (!found) return false
  const have = found.slice(1, 4).map(Number)
  const compare = (than: readonly number[]) => {
    for (let at = 0; at < 3; at++) {
      const [h, t] = [have[at] ?? 0, than[at] ?? 0]
      if (h !== t) return h > t ? 1 : -1
    }
    return 0
  }
  return compare(from) >= 0 && compare(before) < 0
}

const snake = (event: string) => event.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()

/** A value as TOML text, for Codex's `-c`. */
function toml(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .map(
        ([key, item]) =>
          `${/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)}=${toml(item)}`,
      )
      .join(",")}}`
  throw new Error("Not a TOML value")
}

type Group = ReturnType<typeof launchHookGroups>[number]["group"]

/**
 * Codex's own hash of a hook definition: SHA-256 of its normalised identity, keys sorted. A hook it
 * has no stored hash for is untrusted and does not run.
 */
export function codexHookHash(event: string, group: Group): string {
  const handlers = group.hooks.map((hook) => ({
    async: hook.async === true,
    command: hook.command,
    timeout: hook.timeout,
    type: hook.type,
  }))
  // Key order is sorted: event_name, hooks, matcher.
  const identity = {
    event_name: snake(event),
    hooks: handlers,
    ...(group.matcher !== undefined ? { matcher: group.matcher } : {}),
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`
}

/** `-c` arguments for Codex: every hook of a launch, and the trust of each. */
function codexArguments(binary: string): string[] {
  const events = new Map<string, Group[]>()
  for (const { event, group } of launchHookGroups("codex", binary))
    events.set(event, [...(events.get(event) ?? []), group])
  const args = ["-c", "features.hooks=true"]
  const trust: Record<string, { trusted_hash: string }> = {}
  for (const [event, groups] of events) {
    args.push("-c", `hooks.${event}=${toml(groups)}`)
    groups.forEach((group, index) => {
      trust[`/<session-flags>/config.toml:${snake(event)}:${index}:0`] = {
        trusted_hash: codexHookHash(event, group),
      }
    })
  }
  args.push("-c", `hooks.state=${toml(trust)}`)
  return args
}

/** The `--settings` JSON for Claude Code. */
function claudeSettings(binary: string): string {
  const hooks: Record<string, Group[]> = {}
  for (const { event, group } of launchHookGroups("claude-code", binary))
    hooks[event] = [...(hooks[event] ?? []), group]
  return JSON.stringify({ hooks })
}

/** Where the installed copy of the Pi and OpenCode extensions lives, relative to the agent's folder. */
const OPENCODE_INSTALLED = join("plugins", "qualitylayer")
const NONE_HOOKS: LaunchHooks = { args: [], env: {}, overlays: [] }

type ResolvedHooksInput = LaunchHooksInput & { boundedCommandLine: boolean }

function copilotLaunchHooks(input: ResolvedHooksInput): LaunchHooks {
  if (input.resume || !["ask", "allow-tools"].includes(input.permissionMode ?? ""))
    return NONE_HOOKS
  const dir = join(input.folder, "copilot")
  return {
    args: [],
    env: { COPILOT_HOME: dir },
    overlays: [
      {
        dir,
        link: { variable: "COPILOT_HOME" },
        files: [],
        leave: ["settings.json"],
        share: ["session-state"],
        config: {
          name: "settings.json",
          values: {
            defaultPermissionMode: input.permissionMode === "ask" ? "manual" : "assisted",
          },
        },
      },
    ],
  }
}

function claudeLaunchHooks(input: ResolvedHooksInput): LaunchHooks {
  const env = { QUALITYLAYER_SESSION_HOOKS: input.agent }
  const settings = claudeSettings(input.binary)
  if (!input.boundedCommandLine) return { args: ["--settings", settings], env, overlays: [] }
  // `--settings` takes a file as well as the JSON: the hooks ride in a file of the launch folder.
  const dir = join(input.folder, "claude")
  const path = join(dir, "settings.json")
  return {
    args: ["--settings", path],
    env,
    overlays: [{ dir, link: null, files: [{ path, text: settings }], leave: [] }],
  }
}

function codexLaunchHooks(input: ResolvedHooksInput): LaunchHooks {
  if (!inRange(input.version, CODEX_LAUNCH_HOOKS)) return NONE_HOOKS
  const args = codexArguments(input.binary)
  // Codex takes its hooks only as `-c` arguments. Where they would not leave the rest of the
  // launch room on the command line, the launch carries none: the installed hooks keep reporting.
  if (
    input.boundedCommandLine &&
    args.reduce((sum, arg) => sum + arg.length + 3, 0) > CODEX_COMMAND_LINE
  )
    return NONE_HOOKS
  return { args, env: { QUALITYLAYER_SESSION_HOOKS: input.agent }, overlays: [] }
}

function piLaunchHooks(input: ResolvedHooksInput): LaunchHooks {
  const dir = join(input.folder, "pi")
  const files = nativeIntegrationFiles(
    input.binary,
    { agent: "pi", label: "Pi", skills: join(dir, "skills") },
    { launch: true },
  ).filter((file) => file.path.includes(join("extensions", "qualitylayer")))
  const entry = files.find((file) => file.path.endsWith("index.ts"))
  if (!entry) return NONE_HOOKS
  return {
    args: ["-e", entry.path],
    env: { QUALITYLAYER_SESSION_HOOKS: input.agent },
    overlays: [{ dir, link: null, files, leave: [] }],
  }
}

function opencodeLaunchHooks(input: ResolvedHooksInput): LaunchHooks {
  if (!inRange(input.version, OPENCODE_LAUNCH_HOOKS)) return NONE_HOOKS
  const dir = join(input.folder, "opencode")
  const files = nativeIntegrationFiles(
    input.binary,
    { agent: "opencode", label: "OpenCode", skills: join(dir, "skills") },
    { launch: true },
  ).filter((file) => file.path.includes(OPENCODE_INSTALLED))
  return {
    args: [],
    env: { QUALITYLAYER_SESSION_HOOKS: input.agent, OPENCODE_CONFIG_DIR: dir },
    overlays: [
      {
        dir,
        link: { variable: "OPENCODE_CONFIG_DIR" },
        files,
        leave: [OPENCODE_INSTALLED],
        rebase: ["opencode.json", "opencode.jsonc"],
      },
    ],
  }
}

const HOOK_BUILDERS: Partial<Record<NativeAgent, (input: ResolvedHooksInput) => LaunchHooks>> = {
  copilot: copilotLaunchHooks,
  "claude-code": claudeLaunchHooks,
  codex: codexLaunchHooks,
  pi: piLaunchHooks,
  opencode: opencodeLaunchHooks,
}

/**
 * What a launch of this agent carries. An agent with no launch hooks, or a version that is not one
 * checked, carries nothing and no `QUALITYLAYER_SESSION_HOOKS`: its installed hooks keep reporting.
 */
export function launchHooks(given: LaunchHooksInput): LaunchHooks {
  const input: ResolvedHooksInput = {
    ...given,
    boundedCommandLine: given.boundedCommandLine ?? process.platform === "win32",
  }
  const builder = HOOK_BUILDERS[input.agent]
  return builder ? builder(input) : NONE_HOOKS
}
