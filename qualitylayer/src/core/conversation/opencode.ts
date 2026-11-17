// OpenCode 2.x keeps a session as typed messages in SQLite (`session_message`). An assistant message holds its text,
// reasoning and tool calls as content items and is rewritten while it streams, so the reader returns whole messages
// changed since a watermark and the caller merges the events by id. The terminal stays the agent's engine.

import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { trimEndCharacters } from "../text-boundaries.ts"
import { conversationAttachments, imageContentText, imageMessageText } from "./attachments.ts"
import { estimatedUsd } from "./estimate.ts"
import { editDiff, firstText, inputJson, linesLabel, patchDiffs, shellKind } from "./tools.ts"
import {
  bounded,
  CONVERSATION_LIMITS,
  type ConversationEvent,
  type ConversationUsage,
  type DiffSummary,
  nativeEffort,
  type ToolKind,
} from "./types.ts"

/** One `session_message` row, with the columns this reader uses. */
export type OpencodeRow = {
  id: string
  session: string
  type: string
  seq: number
  created: number
  data: string
}

export type OpencodeRead = {
  events: ConversationEvent[]
  usage?: ConversationUsage
  since: number
  state?: "working" | "idle"
  truncated?: boolean
}

type Json = Record<string, unknown>

const SESSIONS = 256
const ROWS = CONVERSATION_LIMITS.events

const object = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined

const text = (value: unknown): string => (typeof value === "string" ? value : "")

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

function iso(ms: unknown): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return undefined
  try {
    return new Date(ms).toISOString()
  } catch {
    return undefined
  }
}

const firstLine = (value: string): string => bounded(value.trim().split("\n")[0] ?? "", 120)

function lines(value: string): number {
  const trimmed = trimEndCharacters(value, "\n")
  return trimmed === "" ? 0 : trimmed.split("\n").length
}

/** OpenCode 2 names these `shell`, `subagent` and `patch`; sessions migrated from 1.x keep the old names. */
const BUILTIN = new Set([
  "read",
  "write",
  "edit",
  "patch",
  "apply_patch",
  "multiedit",
  "shell",
  "bash",
  "grep",
  "glob",
  "list",
  "subagent",
  "task",
  "todowrite",
  "todoread",
  "webfetch",
  "websearch",
  "codesearch",
  "skill",
  "question",
  "lsp",
  "invalid",
])

function toolKind(name: string, input: Json): { tool: ToolKind; detail?: string } {
  switch (name) {
    case "read":
      return { tool: "read" }
    case "write":
      return { tool: "write" }
    case "edit":
    case "multiedit":
    case "patch":
    case "apply_patch":
      return { tool: "edit" }
    case "shell":
    case "bash":
      return shellKind(text(input.command))
    case "grep":
    case "glob":
    case "codesearch":
      return { tool: "search" }
    case "list":
      return { tool: "list" }
    case "subagent":
    case "task":
      return {
        tool: "subagent",
        detail: text(input.agent) || text(input.subagent_type) || undefined,
      }
    case "todowrite":
    case "todoread":
      return { tool: "todo" }
    case "webfetch":
    case "websearch":
      return { tool: "web" }
    default:
      // OpenCode names an MCP tool `<server>_<tool>`; its own tools are single words.
      return {
        tool:
          !BUILTIN.has(name) && (name.startsWith("mcp") || name.includes("_")) ? "mcp" : "other",
      }
  }
}

function targetOf(name: string, input: Json): string | undefined {
  if (name === "todowrite" && Array.isArray(input.todos)) return `${input.todos.length} items`
  if (name === "question" && Array.isArray(input.questions))
    return text(object(input.questions[0])?.question) || undefined
  const order =
    name === "shell" || name === "bash"
      ? ["command"]
      : name === "subagent" || name === "task"
        ? ["description", "prompt"]
        : name === "grep" || name === "glob"
          ? ["pattern", "path"]
          : ["path", "filePath", "file_path", "url", "query", "pattern", "command", "name"]
  for (const key of order) {
    const value = input[key]
    if (typeof value === "string" && value !== "") return bounded(value, 400)
  }
  return undefined
}

/** The input of a tool call; while the model is still writing it, it is a partial JSON string. */
function inputOf(value: unknown): Json {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value)) ?? {}
    } catch {
      return {}
    }
  }
  return object(value) ?? {}
}

/** The text parts of a tool's result content. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return content
    .map((item) => {
      const part = object(item)
      if (part?.type === "text") return text(part.text)
      if (part?.type === "file") return `[file ${text(part.name) || text(part.mime)}]`.trim()
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

/** Counts a hunk-only patch as OpenCode stores it in a tool's metadata. */
function hunkDiff(path: string, patch: string): DiffSummary {
  let added = 0
  let removed = 0
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++
    else if (line.startsWith("-") && !line.startsWith("---")) removed++
  }
  const body = /^(---|\+\+\+) /.test(patch) ? patch : `--- ${path}\n+++ ${path}\n${patch}`
  return { path, added, removed, patch: bounded(body, CONVERSATION_LIMITS.diffBytes) }
}

function joined(files: DiffSummary[]): DiffSummary | undefined {
  if (files.length === 0) return undefined
  if (files.length === 1) return files[0]
  return {
    path: `${files.length} files`,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
    patch: bounded(files.map((file) => file.patch ?? "").join("\n"), CONVERSATION_LIMITS.diffBytes),
  }
}

/** The change an edit, write or patch made: from the tool's own metadata once it ran, else from its input. */
function toolDiff(name: string, input: Json, metadata: Json | undefined): DiffSummary | undefined {
  const files = Array.isArray(metadata?.files)
    ? metadata.files
        .map(object)
        .filter((file): file is Json => !!file && typeof file.patch === "string")
        .map((file) => hunkDiff(text(file.file) || text(file.path) || "file", text(file.patch)))
    : []
  if (files.length > 0) return joined(files)
  const path = text(input.path) || text(input.filePath) || text(input.file_path)
  if (name === "write" && path && typeof input.content === "string")
    return editDiff(path, "", input.content)
  if (
    name === "edit" &&
    path &&
    (typeof input.oldString === "string" || typeof input.newString === "string")
  )
    return editDiff(path, text(input.oldString), text(input.newString))
  if ((name === "patch" || name === "apply_patch") && typeof input.patchText === "string")
    return joined(patchDiffs(input.patchText))
  return undefined
}

function resultSummary(
  name: string,
  ok: boolean,
  output: string,
  metadata: Json | undefined,
  diff: DiffSummary | undefined,
  error: string,
): string | undefined {
  const exit = typeof metadata?.exit === "number" ? metadata.exit : undefined
  if (!ok) return exit !== undefined ? `exit ${exit}` : firstLine(error || output) || undefined
  if (diff) return `+${diff.added} -${diff.removed}`
  const n = lines(output)
  switch (name) {
    case "read":
      return linesLabel(n)
    case "shell":
    case "bash":
      return exit !== undefined && exit !== 0
        ? `exit ${exit}`
        : n === 0
          ? "no output"
          : linesLabel(n)
    case "grep":
      return `${typeof metadata?.matches === "number" ? metadata.matches : typeof metadata?.count === "number" ? metadata.count : n} matches`
    case "glob":
      return `${typeof metadata?.count === "number" ? metadata.count : n} files`
    case "list":
      return `${n} entries`
    default:
      return undefined
  }
}

function seconds(created: unknown, completed: unknown): number | undefined {
  if (typeof created !== "number" || typeof completed !== "number" || completed < created)
    return undefined
  return Math.round((completed - created) / 100) / 10
}

function assistant(
  events: ConversationEvent[],
  row: OpencodeRow,
  data: Json,
  parent: string | undefined,
) {
  const content = Array.isArray(data.content) ? data.content : []
  content.forEach((raw, index) => {
    const part = object(raw)
    if (!part) return
    const id = `${row.id}:${index}`
    const time = object(part.time)
    if (part.type === "text") {
      const body = text(part.text).trim()
      if (body)
        events.push({
          id,
          at: iso(object(data.time)?.created),
          parent,
          kind: "assistant",
          text: bounded(body, CONVERSATION_LIMITS.textChars),
        })
    } else if (part.type === "reasoning") {
      const body = text(part.text).trim()
      if (body)
        events.push({
          id,
          at: iso(time?.created),
          parent,
          kind: "thinking",
          text: bounded(body, CONVERSATION_LIMITS.textChars),
          seconds: seconds(time?.created, time?.completed),
        })
    } else if (part.type === "tool") {
      tool(events, id, part, parent)
    } else if (typeof part.type === "string") {
      events.push({ id, parent, kind: "unknown", label: `assistant ${part.type}` })
    }
  })
  const error = object(data.error)
  if (error)
    events.push({
      id: `${row.id}:error`,
      at: iso(object(data.time)?.completed) ?? iso(object(data.time)?.created),
      parent,
      kind: "error",
      text: bounded(text(error.message) || text(error.type) || "The request failed", 2000),
    })
}

function tool(events: ConversationEvent[], id: string, part: Json, parent: string | undefined) {
  const name = text(part.name) || "tool"
  const state = object(part.state) ?? {}
  const time = object(part.time)
  const input = inputOf(state.input)
  const kind = toolKind(name, input)
  const callId = text(part.id) || id
  events.push({
    id,
    at: iso(time?.created),
    parent,
    kind: "tool",
    callId,
    name,
    tool: kind.tool,
    target:
      targetOf(name, input) ??
      (kind.tool === "mcp" || kind.tool === "other" ? firstText(input) : undefined),
    detail: kind.detail,
    input: Object.keys(input).length > 0 ? inputJson(input) : undefined,
  })
  const status = text(state.status)
  if (status !== "completed" && status !== "error") return
  const metadata = object(state.metadata)
  // A shell call that ran and exited non-zero is a finished call whose result failed.
  const failedExit =
    (name === "shell" || name === "bash") &&
    typeof metadata?.exit === "number" &&
    metadata.exit !== 0
  const ok = status === "completed" && !failedExit
  const error = text(object(state.error)?.message)
  const output =
    contentText(state.content) || (typeof metadata?.output === "string" ? metadata.output : "")
  const diff = status === "completed" ? toolDiff(name, input, metadata) : undefined
  events.push({
    id: `${id}:result`,
    at: iso(time?.completed),
    parent,
    kind: "tool-result",
    callId,
    ok,
    summary: resultSummary(name, ok, output, metadata, diff, error),
    output: bounded(output || error, CONVERSATION_LIMITS.outputChars) || undefined,
    diff,
  })
}

function shell(events: ConversationEvent[], row: OpencodeRow, data: Json) {
  const command = text(data.command)
  const kind = shellKind(command)
  const time = object(data.time)
  events.push({
    id: row.id,
    at: iso(time?.created),
    kind: "tool",
    callId: row.id,
    name: "shell",
    tool: kind.tool,
    target: bounded(command, 400),
    detail: kind.detail,
  })
  const status = text(data.status)
  if (status === "running") return
  const exit = typeof data.exit === "number" ? data.exit : undefined
  const output = text(object(data.output)?.output)
  events.push({
    id: `${row.id}:result`,
    at: iso(time?.completed),
    kind: "tool-result",
    callId: row.id,
    ok: (exit ?? 0) === 0 && !/kill|timeout|timed|fail|cancel/i.test(status),
    summary: exit === undefined ? status || undefined : `exit ${exit}`,
    output: output ? bounded(output, CONVERSATION_LIMITS.outputChars) : undefined,
  })
}

/**
 * Events for already fetched rows, in the order given. A subagent's session is another `session` value;
 * `parents` points it at the tool call that started it, and its first user message (the task) is not drawn.
 */
export function mapOpencodeRows(
  rows: OpencodeRow[],
  options: { parents?: Record<string, string> } = {},
): ConversationEvent[] {
  const events: ConversationEvent[] = []
  for (const row of rows) {
    let data: Json | undefined
    try {
      data = object(JSON.parse(row.data))
    } catch {
      data = undefined
    }
    if (!data) continue
    const parent = options.parents?.[row.session]
    switch (row.type) {
      case "user": {
        const attachments = conversationAttachments(data).map((image) =>
          image.source?.kind === "inline"
            ? {
                ...image,
                source: {
                  kind: "database" as const,
                  digest: image.source.digest,
                  session: row.session,
                  seq: row.seq,
                  pointer: image.source.pointer ?? [],
                },
              }
            : image,
        )
        const body = imageMessageText(
          text(data.text) || imageContentText(data.content),
          attachments,
        )
        if ((body || attachments.length) && !parent)
          events.push({
            id: row.id,
            at: iso(object(data.time)?.created),
            kind: "user",
            text: bounded(body, CONVERSATION_LIMITS.textChars),
            ...(attachments.length ? { attachments: attachments } : {}),
          })
        break
      }
      case "assistant":
        assistant(events, row, data, parent)
        break
      case "shell":
        shell(events, row, data)
        break
      case "skill": {
        const name = text(data.name)
        const at = iso(object(data.time)?.created)
        events.push({
          id: row.id,
          at,
          parent,
          kind: "tool",
          callId: row.id,
          name: "skill",
          tool: "other",
          target: name || undefined,
        })
        events.push({
          id: `${row.id}:result`,
          at,
          parent,
          kind: "tool-result",
          callId: row.id,
          ok: true,
          summary: "loaded",
        })
        break
      }
      case "compaction": {
        const status = text(data.status)
        const at = iso(object(data.time)?.created)
        if (status === "failed")
          events.push({
            id: `${row.id}:error`,
            at,
            parent,
            kind: "error",
            text: bounded(text(object(data.error)?.message) || "Compaction failed", 2000),
          })
        else events.push({ id: row.id, at, parent, kind: "compaction" })
        break
      }
      case "idle": {
        const error = object(data.error)
        if (data.outcome === "failed")
          events.push({
            id: row.id,
            at: iso(object(data.time)?.created),
            parent,
            kind: "error",
            text: bounded(text(error?.message) || "The run failed", 2000),
          })
        break
      }
      // Bookkeeping, and text the harness injected for the model.
      case "agent-switched":
      case "model-switched":
      case "location-switched":
      case "synthetic":
      case "system":
        break
      default:
        events.push({
          id: row.id,
          at: iso(object(data.time)?.created),
          parent,
          kind: "unknown",
          label: `message ${row.type}`,
        })
    }
  }
  return events
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",")

/** The context window of a model: the ChatGPT sign-in's own list first, else OpenCode's cached models.dev catalog. */
function contextWindow(db: Database, provider: string, model: string): number | undefined {
  if (!model || model.includes('"')) return undefined
  const asNumber = (value: unknown) => (typeof value === "number" && value > 0 ? value : undefined)
  try {
    if (provider === "openai") {
      const lists = db
        .query(
          "SELECT value FROM kv WHERE key LIKE 'plugin:%0063006800610074006700700074%:models:%'",
        )
        .all() as { value: string }[]
      for (const list of lists) {
        const found = (JSON.parse(list.value) as Json[]).find((item) => item.slug === model)
        const window = asNumber(found?.context_window)
        if (window) return window
      }
    }
    if (!provider || provider.includes('"')) return undefined
    const row = db
      .query(
        "SELECT json_extract(json_extract(value, '$.body'), ?) AS window FROM kv WHERE key = 'models-dev:catalog'",
      )
      .get(`$."${provider}".models."${model}".limit.context`) as { window: number | null } | null
    return asNumber(row?.window)
  } catch {
    return undefined
  }
}

/**
 * Events of one OpenCode session and its subagents, changed since a millisecond watermark, with the session's
 * full usage. Null when the database or the session is not there, or the database cannot be read right now.
 */
export function readOpencode(dbPath: string, session: string, since = 0): OpencodeRead | null {
  if (!existsSync(dbPath)) return null
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    db.exec("PRAGMA busy_timeout = 500")
    if (!db.query("SELECT 1 FROM session_v2 WHERE id = ?").get(session)) return null
    const family = (
      db
        .query(
          "WITH RECURSIVE related(id) AS (SELECT id FROM session_v2 WHERE id = ? UNION SELECT s.id FROM session_v2 s JOIN related r ON s.parent_id = r.id) SELECT id FROM related LIMIT ?",
        )
        .all(session, SESSIONS) as { id: string }[]
    ).map((row) => row.id)
    const some = marks(family.length)
    const rawRows = (
      db
        .query(`SELECT id, session, type, seq, created, updated, CASE WHEN bytes <= ? THEN data ELSE NULL END AS data FROM (
        SELECT *, SUM(length(CAST(data AS BLOB))) OVER (ORDER BY created DESC, seq DESC) AS bytes FROM (
          SELECT id, session_id AS session, type, seq, time_created AS created, time_updated AS updated, data
          FROM session_message WHERE session_id IN (${some}) AND time_updated > ? ORDER BY time_created DESC, seq DESC LIMIT ?
        )
      )`)
        .all(CONVERSATION_LIMITS.readBytes, ...family, since, ROWS) as (Omit<
        OpencodeRow,
        "data"
      > & { updated: number; data: string | null })[]
    ).reverse()
    const rows = rawRows.filter(
      (row): row is OpencodeRow & { updated: number } => row.data !== null,
    )
    let parents: Record<string, string> | undefined
    if (family.length > 1) {
      parents = {}
      const links = db
        .query(
          `SELECT json_extract(j.value, '$.id') AS call, json_extract(j.value, '$.state.metadata.sessionID') AS child FROM session_message m, json_each(m.data, '$.content') j WHERE m.session_id IN (${some}) AND m.type = 'assistant' AND json_extract(j.value, '$.type') = 'tool' AND json_extract(j.value, '$.state.metadata.sessionID') IS NOT NULL`,
        )
        .all(...family) as { call: string; child: string }[]
      for (const link of links) parents[link.child] = link.call
    }
    const events = mapOpencodeRows(rows, { parents })
    const watermark = rawRows.reduce((latest, row) => Math.max(latest, row.updated), since)

    const sum = db
      .query(
        `SELECT COUNT(*) AS calls,
          COALESCE(SUM(json_extract(data, '$.tokens.input')), 0) AS input,
          COALESCE(SUM(json_extract(data, '$.tokens.output')), 0) AS output,
          COALESCE(SUM(json_extract(data, '$.tokens.reasoning')), 0) AS reasoning,
          COALESCE(SUM(json_extract(data, '$.tokens.cache.read')), 0) AS cacheRead,
          COALESCE(SUM(json_extract(data, '$.tokens.cache.write')), 0) AS cacheWrite,
          COALESCE(SUM(json_extract(data, '$.cost')), 0) AS cost
        FROM session_message WHERE session_id IN (${some}) AND type IN ('assistant', 'compaction')`,
      )
      .get(...family) as Record<string, number>
    const turns = (
      db
        .query("SELECT COUNT(*) AS n FROM session_message WHERE session_id = ? AND type = 'user'")
        .get(session) as { n: number }
    ).n
    // The context is the latest call of the main session that reported tokens.
    const latest = db
      .query(
        "SELECT json_object('tokens', json_extract(data, '$.tokens'), 'model', json_extract(data, '$.model')) AS data FROM session_message WHERE session_id = ? AND type = 'assistant' AND json_extract(data, '$.tokens') IS NOT NULL ORDER BY seq DESC LIMIT 5",
      )
      .all(session) as { data: string }[]
    let model: string | undefined
    let provider = ""
    let contextUsed: number | undefined
    for (const item of latest) {
      const data = object(safe(item.data))
      const tokens = object(data?.tokens)
      const used =
        count(tokens?.input) +
        count(object(tokens?.cache)?.read) +
        count(object(tokens?.cache)?.write)
      model ??= text(object(data?.model)?.id) || undefined
      provider ||= text(object(data?.model)?.providerID)
      if (used > 0) {
        contextUsed = used
        model = text(object(data?.model)?.id) || model
        provider = text(object(data?.model)?.providerID) || provider
        break
      }
    }
    // The session's selection changes before its next assistant message. Usage still belongs
    // to the last call, but the displayed model/variant follows the current main session.
    let selected: Json | undefined
    try {
      const row = db.query("SELECT model FROM session_v2 WHERE id = ?").get(session) as {
        model: string | null
      } | null
      selected = object(safe(row?.model ?? ""))
    } catch {
      // Older stores do not expose a selected model; retain only observed call metadata.
    }
    const currentModel = text(selected?.id) || model
    const currentProvider = text(selected?.providerID) || provider
    const tokens = {
      input: count(sum.input),
      output: count(sum.output) + count(sum.reasoning),
      cacheRead: count(sum.cacheRead),
      cacheWrite: count(sum.cacheWrite),
    }
    const usage: ConversationUsage = {
      model: currentModel,
      effort: nativeEffort(selected?.variant),
      contextWindow: currentModel ? contextWindow(db, currentProvider, currentModel) : undefined,
      contextUsed,
      ...tokens,
      costUsd: count(sum.cost) > 0 ? count(sum.cost) : undefined,
      estimatedUsd: estimatedUsd({ model: currentModel, ...tokens }),
      turns,
    }

    const tail = db
      .query(
        "SELECT type, json_object('time', json_extract(data, '$.time'), 'finish', json_extract(data, '$.finish')) AS data FROM session_message WHERE session_id = ? AND type IN ('user', 'assistant', 'idle') ORDER BY seq DESC LIMIT 1",
      )
      .get(session) as { type: string; data: string } | null
    return {
      events,
      usage,
      since: watermark,
      state: nativeState(tail),
      ...(rows.length !== rawRows.length ? { truncated: true } : {}),
    }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

function safe(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

/** Working until the turn's closing `idle` message, or a finished reply that is not waiting on tools. */
function nativeState(tail: { type: string; data: string } | null): "working" | "idle" | undefined {
  if (!tail) return undefined
  if (tail.type === "idle") return "idle"
  if (tail.type === "user") return "working"
  const data = object(safe(tail.data))
  const done = typeof object(data?.time)?.completed === "number"
  return done && data?.finish !== "tool-calls" ? "idle" : "working"
}
