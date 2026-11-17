// Pi's session file as conversation events. Each line is an entry of a tree; the file order is the order drawn.
// Tool calls and their results are separate entries, so the state remembers open calls to give a result its diff.

import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
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
  type MapResult,
  nativeEffort,
  type ToolKind,
} from "./types.ts"

export type PiState = {
  turns: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  model?: string
  effort?: string
  contextUsed?: number
  contextWindow?: number
  /** Tool calls waiting for their result, by call id. */
  calls: Record<string, { name: string; args: unknown }>
  /** Pi's own model registry file, where a model's context window is read from. */
  registry: string
  /** Windows already looked up, by `provider/model`; null when the registry does not know the model. */
  windows: Record<string, number | null>
}

type Json = Record<string, unknown>

const OPEN_CALLS = 200

function registryFile(): string {
  const base = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")
  return join(base, "models-store.json")
}

/** A fresh parse state; `registry` points at Pi's models-store.json when it is not in the default place. */
export function piState(registry?: string): PiState {
  return {
    turns: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    calls: {},
    registry: registry ?? registryFile(),
    windows: {},
  }
}

const registries = new Map<string, { mtime: number; windows: Map<string, number> }>()

/** The context window Pi's registry lists for a provider's model, or undefined when it does not say. */
function registryWindow(file: string, provider: string, model: string): number | undefined {
  try {
    const mtime = statSync(file).mtimeMs
    let known = registries.get(file)
    if (!known || known.mtime !== mtime) {
      const windows = new Map<string, number>()
      const store = JSON.parse(readFileSync(file, "utf8")) as Record<string, { models?: Json[] }>
      for (const [name, entry] of Object.entries(store))
        for (const item of entry?.models ?? [])
          if (typeof item.id === "string" && typeof item.contextWindow === "number")
            windows.set(`${name}/${item.id}`, item.contextWindow)
      known = { mtime, windows }
      registries.set(file, known)
    }
    return known.windows.get(`${provider}/${model}`)
  } catch {
    return undefined
  }
}

const object = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined

const text = (value: unknown): string => (typeof value === "string" ? value : "")

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

/** The text of a message's content, which is a string or a list of blocks. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      const item = object(block)
      if (item?.type === "text") return text(item.text)
      if (item?.type === "image") return "[image]"
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

const firstLine = (value: string): string => bounded(value.trim().split("\n")[0] ?? "", 120)

function lines(value: string): number {
  const trimmed = trimEndCharacters(value, "\n")
  return trimmed === "" ? 0 : trimmed.split("\n").length
}

function piTool(name: string, args: Json): { tool: ToolKind; detail?: string } {
  switch (name) {
    case "read":
      return { tool: "read" }
    case "write":
      return { tool: "write" }
    case "edit":
      return { tool: "edit" }
    case "bash":
      return shellKind(text(args.command))
    case "grep":
    case "find":
      return { tool: "search" }
    case "ls":
      return { tool: "list" }
    default:
      return { tool: name.startsWith("mcp__") ? "mcp" : "other" }
  }
}

function targetOf(name: string, args: Json): string | undefined {
  const order =
    name === "bash"
      ? ["command"]
      : name === "grep" || name === "find"
        ? ["pattern", "path"]
        : ["path", "file_path", "command", "pattern", "query", "url"]
  for (const key of order) {
    const value = args[key]
    if (typeof value === "string" && value !== "") return bounded(value, 400)
  }
  return name === "ls" ? "." : undefined
}

/** The change an edit or write call made, from its arguments. */
function argumentDiff(name: string, args: Json): DiffSummary | undefined {
  const path = text(args.path) || text(args.file_path)
  if (!path) return undefined
  if (name === "write" && typeof args.content === "string") return editDiff(path, "", args.content)
  if (name !== "edit") return undefined
  const edits = Array.isArray(args.edits)
    ? args.edits.map(object).filter((edit): edit is Json => !!edit)
    : [args]
  const before = edits.map((edit) => text(edit.oldText)).join("\n")
  const after = edits.map((edit) => text(edit.newText)).join("\n")
  return before === "" && after === "" ? undefined : editDiff(path, before, after)
}

function resultSummary(
  name: string,
  ok: boolean,
  output: string,
  diff?: DiffSummary,
): string | undefined {
  if (!ok) {
    const code = output.match(/exited with code (\d+)/i)?.[1]
    return code ? `exit ${code}` : firstLine(output) || undefined
  }
  if (diff) return `+${diff.added} -${diff.removed}`
  const n = lines(output)
  switch (name) {
    case "read":
      return linesLabel(n)
    case "grep":
      return `${n} matches`
    case "find":
      return `${n} files`
    case "ls":
      return `${n} entries`
    case "bash":
      return n === 0 ? "no output" : linesLabel(n)
    default:
      return n > 1 ? linesLabel(n) : undefined
  }
}

function addUsage(state: PiState, value: unknown) {
  const usage = object(value)
  if (!usage) return
  state.input += count(usage.input)
  state.output += count(usage.output)
  state.cacheRead += count(usage.cacheRead)
  state.cacheWrite += count(usage.cacheWrite)
  state.cost += count(object(usage.cost)?.total)
}

function toolCall(
  state: PiState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  block: Json,
) {
  const callId = text(block.id)
  const name = text(block.name) || "tool"
  const args = object(block.arguments) ?? {}
  const kind = piTool(name, args)
  events.push({
    id,
    at,
    kind: "tool",
    callId,
    name,
    tool: kind.tool,
    target:
      targetOf(name, args) ??
      (kind.tool === "mcp" || kind.tool === "other" ? firstText(args) : undefined),
    detail: kind.detail,
    input: inputJson(args),
  })
  if (callId) {
    state.calls[callId] = { name, args }
    const open = Object.keys(state.calls)
    if (open.length > OPEN_CALLS) delete state.calls[open[0] as string]
  }
}

function assistant(
  state: PiState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  message: Json,
) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : []
  blocks.forEach((raw, index) => {
    const block = object(raw)
    if (!block) return
    const eventId = `${id}:${index}`
    if (block.type === "thinking") {
      const body = text(block.thinking).trim()
      if (body)
        events.push({
          id: eventId,
          at,
          kind: "thinking",
          text: bounded(body, CONVERSATION_LIMITS.textChars),
        })
    } else if (block.type === "text") {
      const body = text(block.text).trim()
      if (body)
        events.push({
          id: eventId,
          at,
          kind: "assistant",
          text: bounded(body, CONVERSATION_LIMITS.textChars),
        })
    } else if (block.type === "toolCall") {
      toolCall(state, events, eventId, at, block)
    } else if (typeof block.type === "string") {
      events.push({ id: eventId, at, kind: "unknown", label: `assistant ${block.type}` })
    }
  })
  const stop = text(message.stopReason)
  if (stop === "stop") events.push({ id: `${id}:end`, at, kind: "turn-end" })
  if (stop === "error" || stop === "aborted")
    events.push({
      id: `${id}:error`,
      at,
      kind: "error",
      text: bounded(
        text(message.errorMessage) || (stop === "aborted" ? "Stopped" : "The request failed"),
        2000,
      ),
    })
  const provider = text(message.provider)
  const model = text(message.model)
  if (model) state.model = model
  const usage = object(message.usage)
  addUsage(state, usage)
  if (usage) {
    const used = count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite)
    if (used > 0) state.contextUsed = used
  }
  if (provider && model) {
    const key = `${provider}/${model}`
    if (!(key in state.windows))
      state.windows[key] = registryWindow(state.registry, provider, model) ?? null
    state.contextWindow = state.windows[key] ?? undefined
  }
}

function toolResult(
  state: PiState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  message: Json,
) {
  const callId = text(message.toolCallId)
  const open = state.calls[callId]
  delete state.calls[callId]
  const name = text(message.toolName) || open?.name || "tool"
  const ok = message.isError !== true
  const body = contentText(message.content)
  let diff: DiffSummary | undefined
  if (ok && (name === "edit" || name === "write")) {
    const patch = text(object(message.details)?.patch)
    diff = patch ? patchDiffs(patch)[0] : undefined
    const path = text(open?.args && object(open.args)?.path)
    if (diff && path) diff = { ...diff, path }
    diff ??= open ? argumentDiff(name, object(open.args) ?? {}) : undefined
  }
  events.push({
    id: `${id}:result`,
    at,
    kind: "tool-result",
    callId,
    ok,
    summary: resultSummary(name, ok, body, diff),
    output: body ? bounded(body, CONVERSATION_LIMITS.outputChars) : undefined,
    diff,
  })
}

function bash(events: ConversationEvent[], id: string, at: string | undefined, message: Json) {
  const command = text(message.command)
  const kind = shellKind(command)
  const code = typeof message.exitCode === "number" ? message.exitCode : undefined
  const output = text(message.output)
  const ok = message.cancelled !== true && (code === undefined || code === 0)
  events.push({
    id: `${id}:command`,
    at,
    kind: "tool",
    callId: id,
    name: "bash",
    tool: kind.tool,
    target: bounded(command, 400),
    detail: kind.detail,
  })
  events.push({
    id: `${id}:result`,
    at,
    kind: "tool-result",
    callId: id,
    ok,
    summary:
      message.cancelled === true ? "cancelled" : code === undefined ? undefined : `exit ${code}`,
    output: output ? bounded(output, CONVERSATION_LIMITS.outputChars) : undefined,
  })
}

function message(
  state: PiState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  value: Json,
) {
  switch (value.role) {
    case "system":
      return
    case "user": {
      const attachments = conversationAttachments(value.content)
      const body = imageMessageText(imageContentText(value.content), attachments)
      if (!body && !attachments.length) return
      state.turns++
      events.push({
        id,
        at,
        kind: "user",
        text: bounded(body, CONVERSATION_LIMITS.textChars),
        ...(attachments.length ? { attachments: attachments } : {}),
      })
      return
    }
    case "assistant":
      return assistant(state, events, id, at, value)
    case "toolResult":
      return toolResult(state, events, id, at, value)
    case "bashExecution":
      return bash(events, id, at, value)
    default:
      events.push({
        id,
        at,
        kind: "unknown",
        label: `message ${text(value.role) || "without role"}`,
      })
  }
}

function entry(state: PiState, events: ConversationEvent[], row: Json) {
  const id = text(row.id)
  if (!id) return
  const at = text(row.timestamp) || undefined
  switch (row.type) {
    case "message": {
      const value = object(row.message)
      if (value) message(state, events, id, at, value)
      return
    }
    case "model_change":
      if (typeof row.modelId === "string") {
        state.model = row.modelId
        state.contextWindow = registryWindow(state.registry, text(row.provider), row.modelId)
      }
      return
    case "compaction":
      addUsage(state, row.usage)
      events.push({
        id,
        at,
        kind: "compaction",
        before: typeof row.tokensBefore === "number" ? row.tokensBefore : undefined,
      })
      return
    case "usage":
      addUsage(state, row.usage)
      return
    case "branch_summary":
      addUsage(state, row.usage)
      events.push({ id, at, kind: "unknown", label: "branch summary" })
      return
    case "custom_message":
      if (row.display === true && !text(row.customType).startsWith("qualitylayer"))
        events.push({
          id,
          at,
          kind: "unknown",
          label: `extension message ${text(row.customType)}`.trim(),
        })
      return
    case "thinking_level_change":
      state.effort = nativeEffort(row.thinkingLevel)
      return
    case "session":
    case "label":
    case "session_info":
    case "custom":
    case "context_edit":
      return
    default:
      events.push({ id, at, kind: "unknown", label: `entry ${text(row.type) || "without type"}` })
  }
}

/** Map complete JSONL lines of a Pi session file, continuing from the state of the lines before. */
export function mapPi(input: string, previous: PiState): MapResult<PiState> {
  const state: PiState = {
    ...previous,
    calls: { ...previous.calls },
    windows: { ...previous.windows },
  }
  const events: ConversationEvent[] = []
  for (const line of input.split("\n")) {
    if (!line.trim()) continue
    try {
      const row = object(JSON.parse(line))
      if (row) entry(state, events, row)
    } catch {
      /* A line this cannot read is skipped, never a failure. */
    }
  }
  const any =
    state.model !== undefined ||
    state.effort !== undefined ||
    state.turns > 0 ||
    state.input + state.output + state.cacheRead + state.cacheWrite > 0
  const usage: ConversationUsage | undefined = any
    ? {
        model: state.model,
        effort: state.effort,
        contextWindow: state.contextWindow,
        contextUsed: state.contextUsed,
        input: state.input,
        output: state.output,
        cacheRead: state.cacheRead,
        cacheWrite: state.cacheWrite,
        costUsd: state.cost > 0 ? state.cost : undefined,
        estimatedUsd: estimatedUsd(state),
        turns: state.turns,
      }
    : undefined
  return { events, usage, state }
}
