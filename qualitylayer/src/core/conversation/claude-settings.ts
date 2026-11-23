import { realpathSync } from "node:fs"
import { nativeEffort } from "./types.ts"

function stdoutSettingsFields(content: string): ("model" | "effort")[] {
  const stdout = /<local-command-stdout>([\s\S]*)<\/local-command-stdout>/.exec(content)?.[1]
  if (!stdout) return []
  if (/^\s*(?:Kept|Set|Changed|Switched)\s+model\s+(?:as|to)\b/i.test(stdout))
    return ["model", "effort"]
  return /^\s*(?:Kept|Set|Changed|Switched)\s+effort\s+(?:as|to)\b/i.test(stdout) ? ["effort"] : []
}

/** Only native local-command metadata can withdraw an older assistant selection. */
export function claudeSettingsCommand(row: Record<string, unknown>): ("model" | "effort")[] {
  if (row.type !== "system" || row.subtype !== "local_command" || row.isSidechain === true)
    return []
  if (typeof row.content !== "string") return []
  if (row.content.length > 16_384) return ["model", "effort"]
  const command = /<command-name>\s*\/(model|effort)\s*<\/command-name>/.exec(row.content)?.[1]
  if (command) return command === "model" ? ["model", "effort"] : ["effort"]
  return stdoutSettingsFields(row.content)
}

export type ClaudeSettingsScope = { session: string; cwd: string }
type Field = "model" | "effort"
type Pending = {
  stage: "command" | "stdout"
  id: string
  prompt: string
  version: string
  at: number
  field?: Field
}
export type ClaudeSettingsCursor = {
  scope?: ClaudeSettingsScope & { aliases: readonly string[] }
  pending?: Pending
  last?: { prompt: string; at: number }
}
export type ClaudeSettingsChange = { withdrawn: Field[]; values?: Partial<Record<Field, string>> }
export function claudeSettingsCursor(scope?: ClaudeSettingsScope): ClaudeSettingsCursor {
  if (!scope) return {}
  const aliases = [scope.cwd]
  try {
    const canonical = realpathSync(scope.cwd)
    if (canonical !== scope.cwd) aliases.push(canonical)
  } catch {
    /* An unavailable checkout retains only its exact known spelling. */
  }
  return { scope: { ...scope, aliases } }
}

const CAVEAT =
  "<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user. It's recorded here as context for later messages.</local-command-caveat>"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SETTINGS_COMMAND =
  /^<command-name>\/(model|effort)<\/command-name>\s*<command-message>\1<\/command-message>\s*<command-args>[^<>]{0,256}<\/command-args>$/
const MODELS = new Map([
  ["Sonnet 5.5", "claude-sonnet-5-5"],
  ["Opus 5.5", "claude-opus-5-5"],
])

type SettingsFrame = {
  id: string
  parent: unknown
  prompt: string
  version: string
  at: number
  text: string
}

function matchesScope(row: Record<string, unknown>, scope: ClaudeSettingsCursor["scope"]): boolean {
  if (!scope || row.type !== "user" || row.isSidechain !== false) return false
  if (row.sessionId !== scope.session || row.userType !== "external" || row.entrypoint !== "cli")
    return false
  return typeof row.cwd === "string" && scope.aliases.includes(row.cwd)
}

function parseFrameMeta(
  row: Record<string, unknown>,
): { id: string; prompt: string; version: string; at: number } | undefined {
  if (typeof row.uuid !== "string" || !UUID.test(row.uuid)) return undefined
  if (typeof row.promptId !== "string" || !UUID.test(row.promptId)) return undefined
  if (
    typeof row.version !== "string" ||
    row.version.length > 64 ||
    !/^\d+\.\d+\.\d+$/.test(row.version)
  )
    return undefined
  const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN
  return Number.isFinite(at)
    ? { id: row.uuid, prompt: row.promptId, version: row.version, at }
    : undefined
}

function frame(
  row: Record<string, unknown>,
  scope: ClaudeSettingsCursor["scope"],
): SettingsFrame | undefined {
  if (!matchesScope(row, scope)) return undefined
  const message = row.message as { role?: unknown; content?: unknown } | undefined
  if (
    message?.role !== "user" ||
    typeof message.content !== "string" ||
    message.content.length > 16_384
  )
    return undefined
  const meta = parseFrameMeta(row)
  return meta ? { ...meta, parent: row.parentUuid, text: message.content } : undefined
}

function isCorrelated(
  row: Record<string, unknown>,
  current: SettingsFrame,
  pending: Pending | undefined,
): pending is Pending {
  if (!pending || row.isMeta === true) return false
  if (current.prompt !== pending.prompt || current.version !== pending.version) return false
  return (
    current.parent === pending.id &&
    current.id !== pending.id &&
    Math.abs(current.at - pending.at) <= 5_000
  )
}

function parseStdoutChange(
  current: SettingsFrame,
  field: Field | undefined,
): ClaudeSettingsChange | undefined {
  if (field === "effort") {
    const level =
      /^<local-command-stdout>Set effort level to ([a-z]+) \(saved as your default for new sessions\): [^<>]+<\/local-command-stdout>$/.exec(
        current.text,
      )?.[1]
    const effort = nativeEffort(level)
    return { withdrawn: ["effort"], ...(effort ? { values: { effort } } : {}) }
  }
  if (field !== "model") return undefined
  const name =
    /^<local-command-stdout>Set model to `([^`]+)` for this session only<\/local-command-stdout>$/.exec(
      current.text,
    )?.[1]
  const model = name === undefined ? undefined : MODELS.get(name)
  return { withdrawn: ["model", "effort"], ...(model ? { values: { model } } : {}) }
}

function handleCommandStage(
  current: SettingsFrame,
  cursor: ClaudeSettingsCursor,
): ClaudeSettingsChange | undefined {
  const field = SETTINGS_COMMAND.exec(current.text)?.[1]
  if (field !== "model" && field !== "effort") return undefined
  cursor.pending = {
    id: current.id,
    prompt: current.prompt,
    version: current.version,
    at: current.at,
    stage: "stdout",
    field,
  }
  return { withdrawn: field === "effort" ? ["effort"] : ["model", "effort"] }
}

/** A native caveat authorizes only its two immediately following, correlated command records. */
export function readClaudeSettingsChange(
  row: Record<string, unknown>,
  cursor: ClaudeSettingsCursor,
): ClaudeSettingsChange | undefined {
  const current = frame(row, cursor.scope)
  const pending = cursor.pending
  cursor.pending = undefined
  if (!current) return undefined
  if (row.isMeta === true && current.text === CAVEAT) {
    if (!cursor.last || (current.prompt !== cursor.last.prompt && current.at >= cursor.last.at - 5))
      cursor.pending = {
        id: current.id,
        prompt: current.prompt,
        version: current.version,
        at: current.at,
        stage: "command",
      }
    return undefined
  }
  if (!isCorrelated(row, current, pending)) return undefined
  if (pending.stage === "command") return handleCommandStage(current, cursor)
  cursor.last = { prompt: current.prompt, at: current.at }
  return parseStdoutChange(current, pending.field)
}
