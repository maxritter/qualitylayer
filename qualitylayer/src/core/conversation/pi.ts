// Pi's session file as conversation events. Each line is an entry of a tree; the file order is the order drawn.
// Tool calls and their results are separate entries, so the state remembers open calls to give a result its diff.

import { homedir } from "node:os"
import { join } from "node:path"
import { estimatedUsd } from "./estimate.ts"
import { addPiUsage, piMessage } from "./pi-messages.ts"
import { type PiJson, piObject, piRegistryWindow, piText } from "./pi-tools.ts"
import {
  type ConversationEvent,
  type ConversationUsage,
  type MapResult,
  nativeEffort,
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

type EntryHandler = (
  state: PiState,
  events: ConversationEvent[],
  id: string,
  at: string | undefined,
  row: PiJson,
) => void

const IGNORED_ENTRIES = new Set(["session", "label", "session_info", "custom", "context_edit"])

const ENTRY_HANDLERS: Record<string, EntryHandler> = {
  message: (state, events, id, at, row) => {
    const value = piObject(row.message)
    if (value) piMessage(state, events, id, at, value)
  },
  model_change: (state, _events, _id, _at, row) => {
    if (typeof row.modelId !== "string") return
    state.model = row.modelId
    state.contextWindow = piRegistryWindow(state.registry, piText(row.provider), row.modelId)
  },
  compaction: (state, events, id, at, row) => {
    addPiUsage(state, row.usage)
    events.push({
      id,
      at,
      kind: "compaction",
      before: typeof row.tokensBefore === "number" ? row.tokensBefore : undefined,
    })
  },
  usage: (state, _events, _id, _at, row) => addPiUsage(state, row.usage),
  branch_summary: (state, events, id, at, row) => {
    addPiUsage(state, row.usage)
    events.push({ id, at, kind: "unknown", label: "branch summary" })
  },
  custom_message: (_state, events, id, at, row) => {
    if (row.display === true && !piText(row.customType).startsWith("qualitylayer")) {
      events.push({
        id,
        at,
        kind: "unknown",
        label: `extension message ${piText(row.customType)}`.trim(),
      })
    }
  },
  thinking_level_change: (state, _events, _id, _at, row) => {
    state.effort = nativeEffort(row.thinkingLevel)
  },
}

function entry(state: PiState, events: ConversationEvent[], row: PiJson) {
  const id = piText(row.id)
  if (!id) return
  const at = piText(row.timestamp) || undefined
  const type = piText(row.type)
  if (IGNORED_ENTRIES.has(type)) return
  const handler = ENTRY_HANDLERS[type]
  if (handler) {
    handler(state, events, id, at, row)
    return
  }
  events.push({ id, at, kind: "unknown", label: `entry ${type || "without type"}` })
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
      const row = piObject(JSON.parse(line))
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
