// The model calls in an agent's own transcript, each with its time, model and tokens, so the cost
// view can put them on the step they happened in. Claude Code writes one line per message part
// and repeats a resumed session's messages: usage counts once per `message.id`. Codex writes
// cumulative `token_count` totals: a call is the step between two of them.

import type { Tokens } from "./prices.ts"
import { type CodexParserState, codexCalls } from "./transcript-codex.ts"
import { piCalls } from "./transcript-pi.ts"
import {
  type Brief,
  type Call,
  helperIdOf,
  mergeNativeCredits,
  NAMES_HELPER,
  scanBrief,
  textOf,
  timeOf,
  transcriptRows,
} from "./transcript-shared.ts"

export type { Brief, Call, CodexParserState }
export { codexCalls, helperIdOf, mergeNativeCredits, piCalls, scanBrief }

export type ClaudeUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

export function claudeTokens(u: ClaudeUsage): Tokens {
  const written = u.cache_creation_input_tokens ?? 0
  const hour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite1h: hour,
    cacheWrite5m: u.cache_creation?.ephemeral_5m_input_tokens ?? written - hour,
  }
}

/** The shell commands an assistant message ran (its own `tool_use` inputs, never what a tool printed). */
function commandsOf(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const part of content) {
    const p = part as { type?: unknown; input?: { command?: unknown } } | null
    if (p?.type === "tool_use" && typeof p.input?.command === "string") out.push(p.input.command)
  }
  return out
}

type ClaudeAcc = {
  messages: Map<string, Call>
  commands: string[]
  cwd: string | null
  prompt: string | null
}

function applyClaudeRow(row: Record<string, unknown>, acc: ClaudeAcc): void {
  if (acc.cwd === null && typeof row.cwd === "string" && row.cwd !== "") acc.cwd = row.cwd
  if (row.type === "user" && acc.prompt === null) {
    const said = textOf((row.message as { content?: unknown } | undefined)?.content)
    if (said.trim() !== "") acc.prompt = said
  }
  if (row.type !== "assistant") return
  const message = row.message as
    | { id?: string; model?: string; usage?: ClaudeUsage; content?: unknown }
    | undefined
  for (const command of commandsOf(message?.content))
    if (command.includes(NAMES_HELPER)) acc.commands.push(command)
  if (message?.id === undefined || message.usage === undefined || message.model === "<synthetic>")
    return
  // A message's lines share its id; the last one holds the final output count.
  const earlier = acc.messages.get(message.id)
  acc.messages.set(message.id, {
    id: message.id,
    at: earlier?.at ?? timeOf(row),
    model: message.model ?? "unknown",
    tokens: claudeTokens(message.usage),
  })
}

/**
 * One Claude Code transcript: its calls, the folder it started in, and the first thing it was told
 * (a helper's brief names its `qualitylayer progress <id>`). `seen` holds message ids counted
 * already.
 */
export function claudeCalls(
  text: string,
  seen: Set<string> = new Set(),
): {
  calls: Call[]
  cwd: string | null
  prompt: string | null
  brief: Brief
  ownHelper: string | null
} {
  const acc: ClaudeAcc = { messages: new Map(), commands: [], cwd: null, prompt: null }
  for (const row of transcriptRows(text)) applyClaudeRow(row, acc)
  const calls: Call[] = []
  for (const [id, call] of acc.messages) {
    if (seen.has(id)) continue
    seen.add(id)
    calls.push(call)
  }
  return {
    calls,
    cwd: acc.cwd,
    prompt: acc.prompt,
    brief: scanBrief(text, { prompt: acc.prompt, commands: acc.commands }),
    ownHelper: helperIdOf(acc.prompt) ?? helperIdOf(acc.commands.join("\n")),
  }
}
