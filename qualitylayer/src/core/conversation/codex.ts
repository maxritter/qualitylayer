// Codex's rollout file (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) as Conversation events. Codex writes
// most things twice: a `response_item` (what the model saw) and an `event_msg` (what the app showed).
// Messages, reasoning and tool calls come from the response items; command runs, file changes and MCP
// results come from the finished items of the event stream, which is where Codex 0.16 reports them.

import { type ChecklistState, checklistState } from "./checklist.ts"
import { codexEventMsg, codexResponseItem } from "./codex-events.ts"
import { type CodexCtx, type CodexJson, codexClean, codexObj, codexStr } from "./codex-helpers.ts"
import { estimatedUsd } from "./estimate.ts"
import { type QuestionState, questionState } from "./questions.ts"
import {
  type ConversationEvent,
  type ConversationUsage,
  type DiffSummary,
  type MapResult,
  nativeEffort,
  type ToolKind,
} from "./types.ts"

/** Input (cached included), cached input, cache writes and output tokens, as Codex counts them. */
type Totals = { input: number; cached: number; written: number; output: number }

type OpenCall = { name: string; tool: ToolKind; diffs?: DiffSummary[]; planStart?: number }
export type CodexPlanObservation = { callId: string; start: number; end: number }

export type CodexState = {
  checklist: ChecklistState
  planObservation?: CodexPlanObservation
  question: QuestionState
  line: number
  model?: string
  effort?: string
  contextWindow?: number
  contextUsed?: number
  total?: Totals
  /** Calls whose result is still to come, by call id. */
  calls: Record<string, OpenCall>
  /** Calls that never get a row (polling, code-mode wrappers), so their output stays quiet too. */
  quiet: Record<string, "wrapper" | "poll">
  /** Calls whose result is drawn: Codex reports many of them twice. */
  resulted: Record<string, true>
  /** Messages already drawn, by id. */
  said: Record<string, true>
  prompts: Record<string, true>
  /** When a `compacted` record was last drawn, so its twin item is not drawn again. */
  compactedAt?: number
}

export function codexState(): CodexState {
  return {
    line: 0,
    calls: {},
    quiet: {},
    resulted: {},
    said: {},
    prompts: {},
    checklist: checklistState(),
    question: questionState(),
  }
}

function* records(lines: string): Generator<{ record: CodexJson; start: number; end: number }> {
  const rows = lines.split("\n")
  let position = 0
  for (let index = 0; index < rows.length; index++) {
    const line = rows[index] as string
    const start = position
    position += Buffer.byteLength(line) + (index < rows.length - 1 ? 1 : 0)
    if (line.trim() === "") continue
    try {
      const record = codexObj(JSON.parse(line))
      if (record) yield { record, start, end: position }
    } catch {
      // a torn or damaged line is skipped
    }
  }
}

function mapRecord(
  rec: CodexJson,
  state: CodexState,
  out: ConversationEvent[],
  source?: CodexCtx["source"],
): void {
  const payload = codexObj(rec.payload)
  if (!payload) return
  const ordinal = typeof rec.ordinal === "number" ? rec.ordinal : undefined
  const ctx: CodexCtx = {
    at: codexStr(rec.timestamp),
    seq: String(ordinal ?? `l${state.line}`),
    state,
    out,
    source,
  }
  switch (codexStr(rec.type)) {
    case "turn_context": {
      const model = codexStr(payload.model)
      if (model) state.model = model
      state.effort = nativeEffort(payload.effort ?? payload.reasoning_effort)
      return
    }
    case "response_item":
      codexResponseItem(payload, ctx)
      return
    case "event_msg":
      codexEventMsg(payload, ctx)
      return
    case "compacted": {
      state.compactedAt = ctx.at ? Date.parse(ctx.at) : Date.now()
      out.push(
        codexClean({
          id: `compaction:${ctx.seq}`,
          at: ctx.at,
          kind: "compaction" as const,
          before: state.contextUsed,
        }),
      )
      return
    }
  }
}

function usageOf(state: CodexState): ConversationUsage | undefined {
  const turns = Object.keys(state.prompts).length
  if (!state.total && turns === 0 && !state.model && !state.effort) return undefined
  const total = state.total ?? { input: 0, cached: 0, written: 0, output: 0 }
  const input = Math.max(0, total.input - total.cached)
  return codexClean({
    model: state.model,
    effort: state.effort,
    contextWindow: state.contextWindow,
    contextUsed: state.contextUsed,
    input,
    output: total.output,
    cacheRead: total.cached,
    cacheWrite: total.written,
    estimatedUsd: estimatedUsd({
      model: state.model,
      input,
      output: total.output,
      cacheRead: total.cached,
      cacheWrite: total.written,
    }),
    turns,
  })
}

export function mapCodex(
  lines: string,
  state: CodexState,
  sourceOffset?: number,
): MapResult<CodexState> {
  const events: ConversationEvent[] = []
  for (const row of records(lines)) {
    state.line++
    try {
      mapRecord(
        row.record,
        state,
        events,
        sourceOffset === undefined
          ? undefined
          : { start: sourceOffset + row.start, end: sourceOffset + row.end },
      )
    } catch {
      // a record shaped unlike any known one is skipped, never fatal
    }
  }
  return {
    events,
    usage: usageOf(state),
    checklist: state.checklist.value,
    question: state.question.value,
    state,
  }
}
