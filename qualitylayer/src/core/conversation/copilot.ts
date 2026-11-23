// GitHub Copilot's session record (`session-state/<id>/events.jsonl`) as Conversation events. Each line is
// `{type, data, id, timestamp}`: the person's message, the assistant's message with the tool calls it asks
// for, a result per call, and `session.usage_record` rows with the tokens of every model call. A turn in the
// record is one model call; the Conversation's turn ends when the assistant answers without asking for a tool.
// Hook, model-timing and other bookkeeping rows are not part of the conversation.
import { conversationAttachments, imageContentText, imageMessageText } from "./attachments.ts"
import { copilotComplete, copilotRequest, copilotUsageRecord } from "./copilot-tools.ts"
import { type Json, jsonCount, jsonObject, jsonText } from "./tools.ts"
import {
  bounded,
  CONVERSATION_LIMITS,
  type ConversationEvent,
  type ConversationUsage,
  type MapResult,
  nativeEffort,
  type ToolKind,
} from "./types.ts"

type OpenCall = { id: string; name: string; tool: ToolKind; input: Json }

export type CopilotState = {
  /** Rows read so far: an event's id is its place in the file, so it survives a re-read. */
  rows: number
  /** Calls by Copilot's call id, kept until they complete. */
  calls: Record<string, OpenCall>
  /** The selected model: `session.start.selectedModel`, then each `session.model_change`. */
  model?: string
  /** The model of the latest call (`session.usage_record`), which Auto/Fusion may route elsewhere. */
  observedModel?: string
  effort?: string
  /** The last assistant message asked for no tool: the next turn end ends the person's turn. */
  answered: boolean
  /** When the person's message was written, and the tokens the model calls used since. */
  startedAt?: number
  turnTokens: number
  turns: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  contextUsed?: number
  contextWindow?: number
}

export const copilotState = (): CopilotState => ({
  rows: 0,
  calls: {},
  answered: false,
  turnTokens: 0,
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
})

const OPEN_CALLS = 200

/** Native selection events name the choice; usage names the model routed for a call. */
export function copilotSelectedModel(type: unknown, value: unknown): string | undefined {
  const data = jsonObject(value)
  if (!data) return undefined
  const chosen =
    type === "session.start"
      ? data.selectedModel
      : type === "session.model_change"
        ? data.newModel
        : undefined
  return jsonText(chosen) || undefined
}

function userMessage(state: CopilotState, events: ConversationEvent[], data: Json, at?: string) {
  const attachments = conversationAttachments(data)
  const text = imageMessageText(imageContentText(data.content), attachments)
  state.startedAt = at ? Date.parse(at) || undefined : undefined
  state.answered = false
  if (!text && !attachments.length) return
  events.push({
    id: `r${state.rows}`,
    at,
    kind: "user",
    text: bounded(text, CONVERSATION_LIMITS.textChars),
    ...(attachments.length ? { attachments } : {}),
  })
}

function assistantMessage(
  state: CopilotState,
  events: ConversationEvent[],
  data: Json,
  at?: string,
) {
  const reasoning = jsonText(data.reasoningText).trim()
  if (reasoning)
    events.push({
      id: `r${state.rows}:thinking`,
      at,
      kind: "thinking",
      text: bounded(reasoning, CONVERSATION_LIMITS.textChars),
    })
  const text = jsonText(data.content).trim()
  if (text)
    events.push({
      id: `r${state.rows}`,
      at,
      kind: "assistant",
      text: bounded(text, CONVERSATION_LIMITS.textChars),
    })
  const requests = Array.isArray(data.toolRequests) ? data.toolRequests : []
  requests.forEach((item, index) => {
    const call = jsonObject(item)
    if (call) copilotRequest(state, events, call, index, at)
  })
  state.answered = requests.length === 0
}

function turnEnd(state: CopilotState, events: ConversationEvent[], at?: string) {
  if (!state.answered) return
  const began = state.startedAt
  const ended = Date.parse(at ?? "")
  events.push({
    id: `r${state.rows}`,
    at,
    kind: "turn-end",
    durationMs:
      began !== undefined && Number.isFinite(ended) && ended > began ? ended - began : undefined,
    tokens: state.turnTokens || undefined,
  })
  state.answered = false
  state.turnTokens = 0
  state.startedAt = undefined
}

type RowHandler = (
  state: CopilotState,
  events: ConversationEvent[],
  data: Json,
  at?: string,
) => void

const ROW_HANDLERS: Record<string, RowHandler> = {
  "user.message": userMessage,
  "assistant.message": assistantMessage,
  "assistant.reasoning": (state, events, data, at) => {
    const text = jsonText(data.content).trim()
    if (text)
      events.push({
        id: `r${state.rows}`,
        at,
        kind: "thinking",
        text: bounded(text, CONVERSATION_LIMITS.textChars),
      })
  },
  "tool.execution_complete": copilotComplete,
  "assistant.turn_end": (state, events, _data, at) => turnEnd(state, events, at),
  "session.usage_record": (state, _events, data) => copilotUsageRecord(state, data),
  "session.start": (state, _events, data) => {
    state.model = copilotSelectedModel("session.start", data) || state.model
    state.effort = nativeEffort(data.reasoningEffort) ?? state.effort
  },
  "session.model_change": (state, _events, data) => {
    const chosen = copilotSelectedModel("session.model_change", data)
    // A call made on the old selection says nothing about the new one.
    if (chosen && chosen !== state.model) state.observedModel = undefined
    state.model = chosen || state.model
    state.effort = nativeEffort(data.reasoningEffort) ?? state.effort
  },
  "session.error": (state, events, data, at) => {
    events.push({
      id: `r${state.rows}`,
      at,
      kind: "error",
      text: bounded(jsonText(data.message) || "Copilot stopped with an error", 400),
    })
  },
  abort: (state, events, _data, at) => {
    events.push({ id: `r${state.rows}`, at, kind: "error", text: "Stopped" })
  },
  "session.compaction_complete": (state, events, data, at) => {
    events.push({
      id: `r${state.rows}`,
      at,
      kind: "compaction",
      before: jsonCount(data.preCompactionTokens) || undefined,
      after: jsonCount(data.postCompactionTokens) || undefined,
    })
  },
}

function row(state: CopilotState, events: ConversationEvent[], value: Json) {
  const handler = ROW_HANDLERS[jsonText(value.type)]
  if (!handler) return
  handler(state, events, jsonObject(value.data) ?? {}, jsonText(value.timestamp) || undefined)
}

function usageOf(state: CopilotState): ConversationUsage | undefined {
  if (state.turns === 0 && state.model === undefined) return undefined
  return {
    model: state.model,
    ...(state.observedModel !== undefined ? { observedModel: state.observedModel } : {}),
    effort: state.effort,
    contextWindow: state.contextWindow,
    contextUsed: state.contextUsed,
    input: state.input,
    output: state.output,
    cacheRead: state.cacheRead,
    cacheWrite: state.cacheWrite,
    turns: state.turns,
  }
}

/** Map complete JSONL lines of a Copilot session record, continuing from the lines before. */
export function mapCopilot(input: string, previous: CopilotState): MapResult<CopilotState> {
  const state: CopilotState = { ...previous, calls: { ...previous.calls } }
  const events: ConversationEvent[] = []
  const lines = input.split("\n")
  if (lines.at(-1) === "") lines.pop()
  for (const line of lines) {
    state.rows++
    if (!line.trim()) continue
    try {
      const value = jsonObject(JSON.parse(line))
      if (value) row(state, events, value)
    } catch {
      // A line this cannot read is skipped, never a failure.
    }
  }
  const open = Object.keys(state.calls)
  for (const stale of open.slice(0, Math.max(0, open.length - OPEN_CALLS)))
    delete state.calls[stale]
  return { events, usage: usageOf(state), state }
}
