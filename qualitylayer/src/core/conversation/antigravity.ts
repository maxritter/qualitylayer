// Antigravity's transcript (~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript*.jsonl) as
// Conversation events. One row per step: the person's request, the model's thinking, reply and tool calls, and a
// `GENERIC` row with each tool's output after the call. Rows carry no call ids, so a result belongs to the oldest
// call of the model's latest response that has none yet. A step the person denied is not written, so its call
// stays without a result. The record has no approvals and no turn marker: a reply with no tool call ends the turn.
import { conversationAttachments, imageContentText, imageMessageText } from "./attachments.ts"
import {
  inputJson,
  type Json,
  jsonCount,
  jsonObject,
  jsonText,
  linesLabel,
  resultSummary,
  shellKind,
  targetOf,
} from "./tools.ts"
import {
  bounded,
  CONVERSATION_LIMITS,
  type ConversationEvent,
  type ConversationUsage,
  type MapResult,
  type ToolKind,
} from "./types.ts"

type OpenCall = { id: string; callId: string; tool: ToolKind }

export type AntigravityState = {
  /** Calls of the latest response still waiting for their output, oldest first. */
  calls: OpenCall[]
  /** Result events already drawn, by step, so a step written twice is drawn once. */
  resulted: Record<string, true>
  /** When the current request was made, for the length of its turn. */
  startedAt?: string
  turns: number
  input: number
  output: number
  cacheRead: number
  contextUsed?: number
}

export const antigravityState = (): AntigravityState => ({
  calls: [],
  resulted: {},
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
})

const RESULTS_KEPT = 400
const TARGETS = [
  "CommandLine",
  "AbsolutePath",
  "TargetFile",
  "Path",
  "SearchPath",
  "DirectoryPath",
  "Pattern",
  "Query",
  "Url",
  "toolSummary",
]

/** What a tool does, by its name; the first pattern that matches decides. */
const KINDS: [RegExp, ToolKind][] = [
  [/^(run_command|send_command_input)$/, "shell"],
  [/^(read_file|view_file|view_file_outline)$/, "read"],
  [/^(write_to_file|write_file)$/, "write"],
  [/replace|^edit_file$/, "edit"],
  [/search|^(find|grep)/, "search"],
  [/^list/, "list"],
  [/url|^browser/, "web"],
  [/subagent/, "subagent"],
  [/^mcp/, "mcp"],
]

const toolKind = (name: string): ToolKind =>
  KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? "other"

/** Antigravity writes every argument as JSON text: `"\"ls -la\""` is the string `ls -la`. */
function toolArguments(raw: unknown): Json {
  const args: Json = {}
  for (const [key, value] of Object.entries(jsonObject(raw) ?? {})) {
    if (typeof value !== "string") {
      args[key] = value
      continue
    }
    try {
      args[key] = JSON.parse(value)
    } catch {
      args[key] = value
    }
  }
  return args
}

/** The request the person typed, out of the wrapper Antigravity puts around it (the end may be cut). */
function request(raw: string): string {
  const inner = raw.match(/<USER_REQUEST>([\s\S]*?)(?:<\/USER_REQUEST>|$)/)?.[1]
  return (inner ?? raw).trim()
}

function toolCalls(
  state: AntigravityState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  calls: unknown[],
) {
  state.calls = []
  calls.forEach((raw, index) => {
    const call = jsonObject(raw)
    if (!call) return
    const name = jsonText(call.name) || "tool"
    const args = toolArguments(call.args)
    const tool = toolKind(name)
    const kind = tool === "shell" ? shellKind(jsonText(args.CommandLine)) : { tool }
    const callId = `${id}:call${index}`
    state.calls.push({ id: callId, callId, tool: kind.tool })
    events.push({
      id: callId,
      at,
      kind: "tool",
      callId,
      name,
      tool: kind.tool,
      target: targetOf(kind.tool, args, TARGETS),
      detail: "detail" in kind ? kind.detail : undefined,
      input: inputJson(args),
    })
  })
}

function response(
  state: AntigravityState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  step: Json,
) {
  const thinking = jsonText(step.thinking).trim()
  const content = jsonText(step.content).trim()
  const calls = Array.isArray(step.tool_calls) ? step.tool_calls : []
  if (thinking)
    events.push({
      id: `${id}:thinking`,
      at,
      kind: "thinking",
      text: bounded(thinking, CONVERSATION_LIMITS.textChars),
    })
  if (content)
    events.push({
      id: `${id}:text`,
      at,
      kind: "assistant",
      text: bounded(content, CONVERSATION_LIMITS.textChars),
    })
  toolCalls(state, events, id, at, calls)
  const input = jsonCount(step.input_tokens)
  const cacheRead = jsonCount(step.cache_read_tokens)
  state.input += input
  state.output += jsonCount(step.output_tokens)
  state.cacheRead += cacheRead
  if (input + cacheRead > 0) state.contextUsed = input + cacheRead
  if (content && calls.length === 0) {
    const began = Date.parse(state.startedAt ?? "")
    const ended = Date.parse(at ?? "")
    events.push({
      id: `${id}:end`,
      at,
      kind: "turn-end",
      durationMs: ended >= began ? ended - began : undefined,
    })
  }
}

/** A tool's output row: `Created At: …\nCompleted At: …\n` leads the text. */
function output(
  state: AntigravityState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  step: Json,
) {
  if (state.resulted[id]) return
  const call = state.calls.shift()
  if (!call) return
  state.resulted[id] = true
  const keys = Object.keys(state.resulted)
  if (keys.length > RESULTS_KEPT) delete state.resulted[keys[0] as string]
  const text = jsonText(step.content)
    .replace(/^(?:(?:Created|Completed) At: .*\n)+/, "")
    .trim()
  const ok = !/error|fail|cancel|denied/i.test(jsonText(step.status))
  // A file read says which lines it shows; that count is the file's, the header line is not.
  const shown = text.match(/^Showing lines (\d+)-(\d+) of \d+/)
  events.push({
    id: `${id}:result`,
    at,
    kind: "tool-result",
    callId: call.callId,
    ok,
    summary:
      shown && ok
        ? linesLabel(Number(shown[2]) - Number(shown[1]) + 1)
        : resultSummary(call.tool, ok, text),
    output: text ? bounded(text, CONVERSATION_LIMITS.outputChars) : undefined,
  })
}

function userInput(
  state: AntigravityState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  value: Json,
) {
  const attachments = conversationAttachments(value)
  const text = imageMessageText(request(imageContentText(value.content)), attachments)
  if (!text && !attachments.length) return
  state.calls = []
  state.startedAt = at
  state.turns++
  events.push({
    id,
    at,
    kind: "user",
    text: bounded(text, CONVERSATION_LIMITS.textChars),
    ...(attachments.length ? { attachments } : {}),
  })
}

const STEP_HANDLERS: Record<
  string,
  (
    state: AntigravityState,
    events: ConversationEvent[],
    id: string,
    at: string | undefined,
    step: Json,
  ) => void
> = {
  USER_INPUT: userInput,
  PLANNER_RESPONSE: response,
  GENERIC: output,
}

function step(state: AntigravityState, events: ConversationEvent[], value: Json) {
  const index = value.step_index
  if (typeof index !== "number") return
  const handler = STEP_HANDLERS[jsonText(value.type)]
  handler?.(state, events, `s${index}`, jsonText(value.created_at) || undefined, value)
}

function usageOf(state: AntigravityState): ConversationUsage | undefined {
  if (state.turns === 0) return undefined
  return {
    input: state.input,
    output: state.output,
    cacheRead: state.cacheRead,
    cacheWrite: 0,
    contextUsed: state.contextUsed,
    turns: state.turns,
  }
}

/** Map complete JSONL lines of an Antigravity transcript, continuing from the lines before. */
export function mapAntigravity(
  input: string,
  previous: AntigravityState,
): MapResult<AntigravityState> {
  const state: AntigravityState = {
    ...previous,
    calls: [...previous.calls],
    resulted: { ...previous.resulted },
  }
  const events: ConversationEvent[] = []
  for (const line of input.split("\n")) {
    if (!line.trim()) continue
    try {
      const value = jsonObject(JSON.parse(line))
      if (value) step(state, events, value)
    } catch {
      // A line this cannot read is skipped, never a failure.
    }
  }
  return { events, usage: usageOf(state), state }
}
