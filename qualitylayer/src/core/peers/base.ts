// Messages between agent sessions on one machine: Claude Code sessions and
// Codex threads, in every direction. A port of session-peers (MIT, © 2026 Vlad
// Mocanu; see THIRD_PARTY_NOTICES.md) into QualityLayer, so the bridge ships
// with the binary instead of as a separate skill. This file holds the pieces
// every other part uses: limits, small file helpers and where things live.

import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { nativeCommand, ownerOnlyFile, windows } from "../platform.ts"
import { versionTextOfSync } from "../probe.ts"

// The vendor versions this bridge was measured against. A newer one warns, never fails.
export const CLAUDE_CODE_TESTED = "2.1.289"
export const CODEX_TESTED = "0.160.0"

export const PEER_PROTOCOL = 1
export const PEER_FEATURES = ["notify_idle"]
/** Codex's own input cap, and roughly Claude's inbound line cap. */
export const MAX_TEXT_CHARS = 1_048_576
/** Replies per (thread, Claude session) before the stand-in goes quiet: the loop guard. */
export const REPLY_BUDGET = 3
export const BUDGET_ALLOW_MAX = 20
/** What a running stand-in supports, saved in its own state file. */
export const SHIM_FEATURES = ["budget_allow"]
export const REPLY_BUDGET_WINDOW_DEFAULT = 30 * 60
export const REQUEST_TIMEOUT_DEFAULT = 10 * 60
export const REQUEST_TIMEOUT_MAX = 60 * 60
export const REQUEST_POLL_MS = 100
export const REQUEST_ORPHAN_TTL = 60
export const GC_DAYS_DEFAULT = 7
/** A completion older than this when the stand-in starts is recorded, never posted. */
export const RESTART_DELIVERY_WINDOW = 900
export const PROCESSED_TURN_HISTORY = 200
export const CONTACT_HISTORY = 200
export const MAX_CONCURRENT_CLIENTS = 8
export const MAX_FRAMES_PER_CONNECTION = 16
export const CONN_TIMEOUT_MS = 30_000
export const MAX_RECORD_REWRITES = 2
export const READ_CHUNK = 1024 * 1024
/** No Codex turn is this long; a longer rollout line is skipped, not buffered. */
export const MAX_ROLLOUT_LINE = 8 * 1024 * 1024
/** Per-thread files in the state folder, named `<thread uuid><suffix>`; GC owns them. */
export const THREAD_ARTIFACT_SUFFIXES = [".json", ".log", ".pid", ".budget-reset", ".budget-allow"]
export const BUDDY_USES = [
  "review",
  "brainstorm",
  "second-opinion",
  "co-steer",
  "ping",
  "sanity-check",
] as const
export const BUDDY_KINDS = [
  "cc",
  "codex",
  "pi",
  "opencode",
  "copilot",
  "grok",
  "cursor",
  "antigravity",
] as const
export type PeerKind = (typeof BUDDY_KINDS)[number]

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters from peer text
export const C0_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value)
}

/** A failure with the exit code the command reports. */
export class PeerError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message)
  }
}

/** One stderr line, timestamped: a stand-in's stderr is its log file. */
export function log(message: string): void {
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z")
  process.stderr.write(`[qualitylayer peers ${stamp}] ${message}\n`)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export const nowSeconds = () => Date.now() / 1000

/** Epoch seconds from an ISO string or a numeric epoch (seconds or milliseconds); null if unclear. */
export function parseTime(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") return value > 1e11 ? value / 1000 : value
  if (typeof value !== "string" || value.trim() === "") return null
  const text = value.trim()
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text)
    return numeric > 1e11 ? numeric / 1000 : numeric
  }
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`)
  return Number.isNaN(ms) ? null : ms / 1000
}

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/** Parse a JSON file; absence and corruption both give the default. */
export function readJson<T = unknown>(path: string, fallback: T): T | unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      log(`ignoring unreadable ${path}: ${(cause as Error).message}`)
    }
    return fallback
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Sorted keys, as the original writes them, so diffs of state files stay stable. */
function sortedJson(value: unknown, indent?: number): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    const rec = asRecord(v)
    if (rec === null) return v
    return Object.fromEntries(
      Object.keys(rec)
        .sort()
        .map((k) => [k, sort(rec[k])]),
    )
  }
  return JSON.stringify(sort(value), null, indent)
}

/** Write JSON through a temp file in the same folder at its final mode, then rename. */
export function writeJsonAtomic(path: string, data: unknown, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp.${process.pid}`
  const fd = openSync(tmp, "w", mode)
  try {
    writeSync(fd, `${sortedJson(data, 2)}\n`)
  } finally {
    closeSync(fd)
  }
  chmodSync(tmp, mode)
  renameSync(tmp, path)
}

/** Create one small JSON file exactly once; false when it already exists. */
export function writeJsonExclusive(path: string, data: unknown, mode = 0o600): boolean {
  const created = windows ? `${path}.tmp.${process.pid}.${randomUUID()}` : path
  let fd: number
  try {
    fd = openSync(created, "wx", mode)
  } catch (cause) {
    if (!windows && (cause as NodeJS.ErrnoException).code === "EEXIST") return false
    throw cause
  }
  try {
    if (windows) ownerOnlyFile(created)
    else fchmodSync(fd, mode)
    writeSync(fd, `${sortedJson(data)}\n`)
    fsyncSync(fd)
  } catch (cause) {
    closeSync(fd)
    unlinkQuiet(created)
    throw cause
  }
  closeSync(fd)
  if (windows) {
    try {
      linkSync(created, path)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST") return false
      throw cause
    } finally {
      unlinkSync(created)
    }
  }
  return true
}

export function unlinkQuiet(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // already gone
  }
}

export function fileMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs / 1000
  } catch {
    return null
  }
}

export function utf8Len(text: string): number {
  return Buffer.byteLength(text, "utf8")
}

/** Trim to at most `maxBytes` UTF-8 bytes on a character boundary. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const encoded = Buffer.from(text, "utf8")
  if (encoded.length <= maxBytes) return text
  if (maxBytes <= 0) return ""
  return new TextDecoder("utf-8", { fatal: false })
    .decode(encoded.subarray(0, maxBytes))
    .replace(/\uFFFD$/, "")
}

/** Run a command: [code, stdout, stderr]; a missing binary is 127. */
function commandPath(env: NodeJS.ProcessEnv): string {
  return (
    (windows ? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] : env.PATH) ??
    ""
  )
}

export function runCmd(
  argv: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): [number, string, string] {
  const [first, ...rest] = argv
  const env = options.env ?? process.env
  const resolved =
    first === undefined ? undefined : Bun.which(first, { PATH: commandPath(env), cwd: options.cwd })
  const [command, ...args] = first === undefined ? [] : nativeCommand(resolved ?? first, rest)
  if (command === undefined) return [127, "", "no command"]
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 10_000,
    env,
    cwd: options.cwd,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    return [code === "ENOENT" ? 127 : 126, "", String(result.error.message)]
  }
  return [result.status ?? 1, result.stdout ?? "", result.stderr ?? ""]
}

/** The first existing folder of `preferred`, HOME, `/`: a detached process must not need its starter's. */
export function stableDir(preferred?: string | null): string {
  for (const candidate of [preferred, homedir(), "/"]) {
    if (candidate && existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) return candidate
      } catch {
        // try the next one
      }
    }
  }
  return "/"
}

export function parseVersion(text: string | null): number[] | null {
  const match = text?.match(/(?<!\d)(\d+(?:\.\d+)+)/)
  return match?.[1] !== undefined ? match[1].split(".").map(Number) : null
}

export function versionIsNewer(installed: string | null, pinned: string): boolean {
  const a = parseVersion(installed)
  const b = parseVersion(pinned)
  if (a === null || b === null) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** `binary --version`, asked once per process for a command file that has not changed. */
export function toolVersion(binary: string): string | null {
  const resolved = Bun.which(binary, { PATH: commandPath(process.env) })
  if (resolved === null) return null
  const [program, ...args] = nativeCommand(resolved, ["--version"])
  return (
    versionTextOfSync(resolved, [program as string, ...args], { timeoutMs: 5_000 })?.trim() || null
  )
}

// ------------------------------------------------------------------ roots

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
}

export function claudeSessionsDir(): string {
  return join(claudeConfigDir(), "sessions")
}

export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex")
}

export function codexConfigPath(): string {
  return join(codexHome(), "config.toml")
}

/** QualityLayer's own home for the bridge's state: registrations, stand-ins, requests, topics. */
export function stateDir(): string {
  const root = process.env.QUALITYLAYER_HOME || join(homedir(), ".qualitylayer")
  const path = join(root, "peers")
  mkdirSync(path, { recursive: true, mode: 0o700 })
  try {
    chmodSync(path, 0o700)
  } catch {
    // best effort
  }
  return path
}

function privateDir(...parts: string[]): string {
  const path = join(stateDir(), ...parts)
  mkdirSync(path, { recursive: true, mode: 0o700 })
  try {
    chmodSync(path, 0o700)
  } catch {
    // best effort
  }
  return path
}

export const registeredPath = () => join(stateDir(), "registered.json")
export const threadStatePath = (id: string) => join(stateDir(), `${id}.json`)
export const threadPidPath = (id: string) => join(stateDir(), `${id}.pid`)
export const threadLogPath = (id: string) => join(stateDir(), `${id}.log`)
export const budgetResetPath = (id: string) => join(stateDir(), `${id}.budget-reset`)
export const budgetAllowPath = (id: string) => join(stateDir(), `${id}.budget-allow`)
export const buddiesDir = () => privateDir("buddies")
export const requestDir = () => privateDir("requests")
export const topicsDir = () => privateDir("topics")
export const versionWarningPath = () => join(stateDir(), "version-warnings.json")

export function requestPath(id: string): string {
  if (!isUuid(id)) throw new PeerError("request id must be a UUID", 2)
  return join(requestDir(), `${id}.request.json`)
}

export function requestReplyPath(id: string): string {
  if (!isUuid(id)) throw new PeerError("request id must be a UUID", 2)
  return join(requestDir(), `${id}.reply.json`)
}

/** Warn once a day per installed version newer than the one measured; never fail. */
export function warnVersions(kinds: ("claude" | "codex")[] = ["claude", "codex"]): void {
  const previous = (asRecord(readJson(versionWarningPath(), {})) ?? {}) as Record<string, number>
  let changed = false
  const now = nowSeconds()
  const once = (key: string, message: string) => {
    if (now - (Number(previous[key]) || 0) < 86_400) return
    log(message)
    previous[key] = now
    changed = true
  }
  if (kinds.includes("claude")) {
    const v = toolVersion("claude")
    if (v !== null && versionIsNewer(v, CLAUDE_CODE_TESTED)) {
      once(
        `claude:${v}>${CLAUDE_CODE_TESTED}`,
        `Claude Code ${v} is newer than the tested ${CLAUDE_CODE_TESTED}; if peers stop appearing, run \`qualitylayer peers doctor\``,
      )
    }
  }
  if (kinds.includes("codex")) {
    const v = toolVersion("codex")
    if (v !== null && versionIsNewer(v, CODEX_TESTED)) {
      once(
        `codex:${v}>${CODEX_TESTED}`,
        `Codex CLI ${v} is newer than the tested ${CODEX_TESTED}; if discovery breaks, run \`qualitylayer peers doctor\``,
      )
    }
  }
  if (changed) {
    try {
      writeJsonAtomic(versionWarningPath(), previous)
    } catch {
      // a warning ledger is not worth a failure
    }
  }
}
