// Claude Code's transcript (~/.claude/projects/<slug>/<session>.jsonl) as Conversation events. One call maps
// the complete lines it is given and keeps in `state` what later lines need: open tool calls, message ids
// whose usage was counted, and the running totals. The same line fed twice gives the same events.

import { type ChecklistState, checklistState } from "./checklist.ts"
import {
  type ClaudeCounts,
  type ClaudeJson,
  type ClaudeOpenCall,
  claudeCount,
  claudeObj,
  claudeStr,
  completedClaudeTask,
  nativeTaskOrigin,
} from "./claude-helpers.ts"
import { claudeAssistant, claudeSystem, claudeUser, humanQueuedCommand } from "./claude-records.ts"
import {
  type ClaudeSettingsChange,
  type ClaudeSettingsCursor,
  type ClaudeSettingsScope,
  claudeSettingsCursor,
  readClaudeSettingsChange,
} from "./claude-settings.ts"
import { claudeUsageOf } from "./claude-usage.ts"
import { type QuestionState, questionState } from "./questions.ts"
import type { ConversationEvent, ConversationWorker, MapResult } from "./types.ts"

export type ClaudeState = {
  checklist: ChecklistState
  question: QuestionState
  /** The Task/Agent call that started this transcript, when it is a subagent's own file and the caller knows it. */
  parent?: string
  line: number
  calls: Record<string, ClaudeOpenCall>
  /** Subagent id to the call that started it, learned from that call's result. */
  agents: Record<string, string>
  workers: Record<string, ConversationWorker>
  /** An omitted worker cannot later be matched safely without retaining unbounded IDs. */
  workersIncomplete: boolean
  /** Usage counted per API message id: one message spans several records and a resumed session repeats them. */
  messages: Record<string, ClaudeCounts>
  /** What each of those messages cost at list prices; negative when its model has no price. */
  spent: Record<string, number>
  /** The sum of the messages with a price, and how many have none (then the session has no estimate). */
  estimate: number
  unpriced: number
  /** Child telemetry cannot retain message IDs indefinitely; unknown totals are omitted. */
  usageCapped: boolean
  /** Real prompts already counted. */
  prompts: Record<string, true>
  total: ClaudeCounts
  model?: string
  effort?: string
  settingsUnknown?: ("model" | "effort")[]
  settingsAt?: Partial<Record<"model" | "effort", string>>
  localSettings?: ClaudeSettingsCursor
  contextUsed?: number
  /** The most context any call used, to tell a 1M window from a 200k one. */
  contextMost: number
  costUsd?: number
  lastBoundary?: string
}

export function claudeState(parent?: string, scope?: ClaudeSettingsScope): ClaudeState {
  return {
    checklist: checklistState(),
    question: questionState(),
    ...(parent ? { parent } : {}),
    line: 0,
    calls: {},
    agents: {},
    workers: {},
    workersIncomplete: false,
    messages: {},
    spent: {},
    estimate: 0,
    unpriced: 0,
    usageCapped: false,
    prompts: {},
    total: [0, 0, 0, 0],
    contextMost: 0,
    localSettings: claudeSettingsCursor(parent ? undefined : scope),
  }
}

function* records(lines: string): Generator<ClaudeJson> {
  for (const line of lines.split("\n")) {
    if (line.trim() === "") continue
    try {
      const record = claudeObj(JSON.parse(line))
      if (record) yield record
    } catch {
      // a torn or damaged line is skipped
    }
  }
}

function applySettingsChange(
  rec: ClaudeJson,
  change: ClaudeSettingsChange,
  state: ClaudeState,
): void {
  for (const field of change.withdrawn) delete state[field]
  Object.assign(state, change.values)
  for (const field of ["model", "effort"] as const) {
    if (change.values?.[field] !== undefined && typeof rec.timestamp === "string")
      state.settingsAt = { ...state.settingsAt, [field]: rec.timestamp }
  }
  state.settingsUnknown = [
    ...new Set([...(state.settingsUnknown ?? []), ...change.withdrawn]),
  ].filter((field) => change.values?.[field] === undefined)
}

function handleAttachment(rec: ClaudeJson, state: ClaudeState, out: ConversationEvent[]): void {
  const attachment = claudeObj(rec.attachment)
  if (
    attachment?.type === "queued_command" &&
    attachment.commandMode === "task-notification" &&
    nativeTaskOrigin(claudeObj(attachment.origin))
  ) {
    completedClaudeTask(claudeStr(attachment.prompt) ?? "", state)
    return
  }
  humanQueuedCommand(rec, attachment, state, out)
}

function mapRecord(rec: ClaudeJson, state: ClaudeState, out: ConversationEvent[]): void {
  state.localSettings ??= claudeSettingsCursor()
  const change = readClaudeSettingsChange(rec, state.localSettings)
  if (change) {
    applySettingsChange(rec, change, state)
    return
  }
  const type = claudeStr(rec.type)
  if (type === "assistant") claudeAssistant(rec, state, out)
  else if (type === "user") claudeUser(rec, state, out)
  else if (type === "attachment") handleAttachment(rec, state, out)
  else if (type === "system") claudeSystem(rec, state, out)
  else if (type === "cost-state") {
    const cost = claudeCount(rec.totalCostUSD)
    if (cost > 0) state.costUsd = cost
  }
}

export function mapClaude(lines: string, state: ClaudeState): MapResult<ClaudeState> {
  const events: ConversationEvent[] = []
  for (const record of records(lines)) {
    state.line++
    try {
      mapRecord(record, state, events)
    } catch {
      // a record shaped unlike any known one is skipped, never fatal
    }
  }
  return {
    events,
    checklist: state.checklist.value,
    question: state.question.value,
    usage: state.usageCapped ? null : claudeUsageOf(state),
    workers: Object.values(state.workers),
    workersIncomplete: state.workersIncomplete,
    state,
  }
}
