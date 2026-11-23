// Where an agent's command is: an explicit path in the environment, else the PATH QualityLayer was
// started with. Kept apart from the review runner so the Cockpit's bundle never pulls in workflow
// text.

import { accessSync, constants, statSync } from "node:fs"
import { isAbsolute } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { readConfig } from "../config.ts"
import { findAgentBinary, withCommandFolder } from "../install/agents-found.ts"
import { nativeCommand } from "../platform.ts"
import type { BinaryCheckObservation, DiscoveryObservation } from "../run/launch-diagnostics.ts"
import { AGENT_NAMES, BINARIES, type NativeAgent } from "./ids.ts"

export type Reviewer = NativeAgent

/**
 * The environment variable that names the executable of each agent. It wins over PATH, so a wrapper
 * launcher or guard that comes first there cannot stand in for the real agent. A review sets it for
 * its worker from the session that started it; a harness or a user may set it themselves.
 */
export const BINARY_VARIABLES: Record<Reviewer, string> = {
  "claude-code": "QUALITYLAYER_CLAUDE_BIN",
  codex: "QUALITYLAYER_CODEX_BIN",
  pi: "QUALITYLAYER_PI_BIN",
  opencode: "QUALITYLAYER_OPENCODE_BIN",
  cursor: "QUALITYLAYER_CURSOR_BIN",
  grok: "QUALITYLAYER_GROK_BIN",
  antigravity: "QUALITYLAYER_ANTIGRAVITY_BIN",
  copilot: "QUALITYLAYER_COPILOT_BIN",
}

/**
 * What each agent's `--version` output must look like. Pi and Antigravity print only a bare version,
 * which says nothing about who printed it, so the file must also be named for its agent: an `agy`
 * given as Pi's command (or the reverse) is refused.
 */
const VERSION_IDENTITY: Record<Reviewer, { output: RegExp; named?: true }> = {
  "claude-code": { output: /\bClaude Code\b/ },
  codex: { output: /\bcodex-cli\s+\d/ },
  pi: { output: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, named: true },
  opencode: { output: /^(?:opencode\s+v?)?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i },
  cursor: { output: /^\d{4}\.\d{1,2}\.\d{1,2}-[0-9a-f]{6,}$/ },
  grok: { output: /^grok\s+\d+\.\d+\.\d+/ },
  antigravity: { output: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, named: true },
  copilot: { output: /^GitHub Copilot CLI\s+\d+\.\d+\.\d+/ },
}

/** The file's name without its folder and Windows extension: `/home/person/.local/bin/agy` is `agy`. */
const commandName = (path: string): string =>
  (path.split(/[\\/]/).pop() ?? "").replace(/\.(?:exe|cmd|bat)$/i, "")

/** Whether the version text and, for a bare version, the file's name belong to this agent. */
export function identifiesAgent(agent: Reviewer, path: string, version: string): boolean {
  const identity = VERSION_IDENTITY[agent]
  return (
    identity.output.test(version) &&
    (identity.named !== true || commandName(path) === BINARIES[agent])
  )
}

/** A file with an absolute path that this user may run. */
export function runnableFile(path: string): boolean {
  try {
    if (!isAbsolute(path) || !statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The path the environment names for the agent, when it is a file that can run. */
export function namedBinary(ctx: Ctx, agent: Reviewer): string | null {
  const named = ctx.env.get(BINARY_VARIABLES[agent])?.trim()
  return named !== undefined && named !== "" && runnableFile(named) ? named : null
}

/** The command Settings › Agents names for the agent: an absolute path, or "" when none is set. */
export async function configuredBinary(ctx: Ctx, agent: Reviewer): Promise<string> {
  return (await readConfig(ctx)).agents[agent].command
}

/**
 * The agent's command, first match wins:
 *   1. `QUALITYLAYER_<AGENT>_BIN` in the environment, a path a harness, wrapper or review worker sets;
 *   2. `agents.<id>.command` in Settings, the path the person chose;
 *   3. the command on PATH.
 */
export async function agentBinary(ctx: Ctx, agent: Reviewer): Promise<string | null> {
  return namedBinary(ctx, agent) ?? (await settingsOrPathBinary(ctx, agent))
}

/**
 * Steps 2 and 3 of `agentBinary`. A command in Settings that cannot run is not skipped: the agent
 * counts as missing, so a typo never starts a different program than the one the person named.
 */
async function settingsOrPathBinary(ctx: Ctx, agent: Reviewer): Promise<string | null> {
  const configured = await configuredBinary(ctx, agent)
  if (configured !== "") return runnableFile(configured) ? configured : null
  return Bun.which(BINARIES[agent], { PATH: ctx.env.get("PATH") ?? "" }) ?? null
}

/**
 * Where the agent's command is and how it was found. A command in Settings that cannot run is
 * returned as `unrunnable`, never searched past: the person named that program.
 */
async function discoverBinary(
  ctx: Ctx,
  agent: Reviewer,
): Promise<{ path: string | null; discovery: DiscoveryObservation; unrunnable?: string }> {
  const configured = await configuredBinary(ctx, agent)
  const named = namedBinary(ctx, agent)
  const direct = await agentBinary(ctx, agent)
  const missing: DiscoveryObservation = { source: "missing", knownFoldersChecked: 0 }
  if (direct !== null) {
    const source = direct === named || direct === configured ? "override" : "path"
    return { path: direct, discovery: { source, knownFoldersChecked: 0 } }
  }
  if (configured !== "" && named === null)
    return { path: null, discovery: missing, unrunnable: configured }
  let discovery = missing
  const path = await findAgentBinary(ctx, agent, (found) => {
    discovery = found
  })
  return { path, discovery }
}

const LOCATED_FOR_MS = 20_000
type Located = { at: number; path: string | null }
const located = new WeakMap<Ctx["env"], Map<Reviewer, Located | Promise<string | null>>>()

function cachedBinarySearch(
  ctx: Ctx,
  agent: Reviewer,
  kept: Map<Reviewer, Located | Promise<string | null>>,
): Promise<string | null> {
  const search = findAgentBinary(ctx, agent).then(
    (path) => {
      kept.set(agent, { at: ctx.clock.now(), path })
      return path
    },
    () => {
      kept.delete(agent)
      return null
    },
  )
  kept.set(agent, search)
  return search
}

/**
 * Whether the agent is on this computer, for a list that names what can start: `agentBinary`, then
 * the same search the executable check makes (login shell, the folders agents install to, npm's
 * global folder). A command in Settings that cannot run is not searched past. The search starts a
 * shell, so one answer is kept for a few seconds and concurrent askers share it.
 */
export async function installedBinary(ctx: Ctx, agent: Reviewer): Promise<string | null> {
  const direct = await agentBinary(ctx, agent)
  if (direct !== null || (await configuredBinary(ctx, agent)) !== "") return direct
  const kept = located.get(ctx.env) ?? new Map<Reviewer, Located | Promise<string | null>>()
  located.set(ctx.env, kept)
  const known = kept.get(agent)
  if (known instanceof Promise) return known
  if (known !== undefined && ctx.clock.now() - known.at < LOCATED_FOR_MS) return known.path
  return cachedBinarySearch(ctx, agent, kept)
}

/** The oldest version of Pi and OpenCode that has native sessions; null for an agent with no minimum. */
const MINIMUM_VERSION: Partial<Record<Reviewer, number[]>> = {
  pi: [1, 2, 0],
  opencode: [2, 0, 29],
}

/** Whether `version` is older than the agent's minimum for native sessions. */
function tooOld(agent: Reviewer, version: string): boolean {
  const minimum = MINIMUM_VERSION[agent]
  if (minimum === undefined) return false
  const numbers = (version.match(/(?:^|\D)(\d+\.\d+\.\d+)/)?.[1] ?? "0.0.0").split(".").map(Number)
  const difference =
    numbers.map((part, index) => part - (minimum[index] ?? 0)).find((part) => part !== 0) ?? 0
  return difference < 0
}

/** Where the search looked, and how to say where the command is when it lives elsewhere. */
export const notFound = (agent: Reviewer): string =>
  `${AGENT_NAMES[agent]} was not found on PATH, in your login shell or in the usual install folders${agent === "codex" ? ", the ChatGPT app included" : ""}. If it lives elsewhere, choose its file in Edit launch… › Command.`

/** Probe once at Start with the same explicit environment the managed agent receives. */
export async function checkedAgentBinary(
  ctx: Ctx,
  agent: Reviewer,
  options: {
    env: Record<string, string>
    timeoutMs?: number
    observe?: (observation: BinaryCheckObservation) => void
  },
): Promise<{ path: string; version: string }> {
  const launchCtx: Ctx = {
    ...ctx,
    env: { ...ctx.env, get: (name) => options.env[name] ?? ctx.env.get(name) },
  }
  const { path, discovery, unrunnable } = await discoverBinary(launchCtx, agent)
  const observed = (result: BinaryCheckObservation["result"], nativeVersion?: string) =>
    options.observe?.({ ...discovery, result, ...(nativeVersion ? { nativeVersion } : {}) })
  if (path === null) {
    observed("not-found")
    throw new Error(
      unrunnable === undefined
        ? notFound(agent)
        : `${AGENT_NAMES[agent]}'s command in Settings cannot run: ${unrunnable}`,
    )
  }
  observed("incomplete")
  const timeout = options.timeoutMs ?? 5000
  if (!Number.isFinite(timeout) || timeout < 1) {
    observed("invalid-timeout")
    throw new Error(`Invalid version timeout for ${path}`)
  }
  let child: Bun.Subprocess<"ignore", "pipe", "pipe">
  try {
    child = Bun.spawn(nativeCommand(path, ["--version"]), {
      cwd: ctx.env.cwd(),
      env: withCommandFolder(options.env, path) as Record<string, string>,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (error) {
    observed("spawn-failed")
    throw new Error(`Cannot check ${path}: ${String(error)}`)
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, timeout)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const version = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n")
    if (timedOut || code !== 0 || !identifiesAgent(agent, path, version)) {
      observed(timedOut ? "version-timeout" : code !== 0 ? "version-exit" : "identity-mismatch")
      throw new Error(
        `Refused ${path}: ${timedOut ? "version check timed out" : `--version did not identify ${agent} (exit ${code}): ${version.slice(0, 512)}`}`,
      )
    }
    if (tooOld(agent, version)) {
      observed("unsupported-version", version.match(/(?:^|\D)(\d+\.\d+\.\d+)/)?.[1])
      throw new Error(
        `${agent} ${MINIMUM_VERSION[agent]?.join(".")} or later is required for native sessions; found ${version}`,
      )
    }
    observed("passed", version.match(/(?:^|\D)(\d+\.\d+\.\d+)/)?.[1])
    return { path, version }
  } finally {
    clearTimeout(timer)
  }
}
