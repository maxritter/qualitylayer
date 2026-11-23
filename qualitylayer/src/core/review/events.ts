// What the other agent's headless run says while it works. Codex prints
// `codex exec --json` events, Claude Code `--output-format stream-json`; each
// line of either becomes one short line for the Cockpit's status box, and the
// final answer is taken from the stream when the agent does not write it to a file.
// Cursor, Grok and Antigravity print streams of their own, read in headless-events.ts.

import type { Reviewer } from "../agents/binary.ts"
import { clip, hint, parse, text } from "./event-lines.ts"
import { readerOf } from "./headless-events.ts"

/** OpenCode's tool call as a status line. */
function opencodeProgress(event: Record<string, unknown>): string | null {
  const part = event.part as Record<string, unknown> | undefined
  return part
    ? clip(`${text(part.tool)} ${hint((part.state as Record<string, unknown> | undefined)?.input)}`)
    : null
}

/** Codex's started command, tool call or search as a status line. */
function codexProgress(event: Record<string, unknown>): string | null {
  const item = event.item as Record<string, unknown> | undefined
  if (event.type !== "item.started" || item === undefined) return null
  if (item.type === "command_execution") return clip(`running ${text(item.command)}`)
  if (item.type === "mcp_tool_call") return clip(`calling ${text(item.tool)}`)
  if (item.type === "web_search") return clip(`searching ${text(item.query)}`)
  return null
}

/** Claude's latest tool call in an assistant message, or null. */
function claudeProgress(event: Record<string, unknown>): string | null {
  if (event.type !== "assistant") return null
  const content = (event.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return null
  const tool = [...content]
    .reverse()
    .find((block) => (block as Record<string, unknown>).type === "tool_use") as
    | Record<string, unknown>
    | undefined
  return tool ? clip(`${text(tool.name)} ${hint(tool.input)}`) : null
}

/** One short line for an event that starts a tool call, or null when it says nothing new. */
export function progressOf(agent: Reviewer, raw: string): string | null {
  const reader = readerOf(agent)
  if (reader !== undefined) return reader.progress(raw)
  const event = parse(raw)
  if (event === null) return null
  if (agent === "pi")
    return event.type === "tool_execution_start"
      ? clip(`${text(event.toolName)} ${hint(event.args)}`)
      : null
  if (agent === "opencode") return event.type === "tool_use" ? opencodeProgress(event) : null
  return agent === "codex" ? codexProgress(event) : claudeProgress(event)
}

/** The text of a finished assistant message in Pi's stream, or "" for any other event. */
function piAnswer(event: Record<string, unknown>): string {
  const message = event.message as { role?: string; content?: unknown } | undefined
  if (event.type !== "message_end" || message?.role !== "assistant") return ""
  if (!Array.isArray(message.content)) return ""
  return message.content
    .filter((x) => x?.type === "text")
    .map((x) => text(x.text))
    .join("\n")
}

function claudeMessageText(event: Record<string, unknown>): string {
  const content = (event.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return ""
  let latest = ""
  for (const block of content) {
    const part = block as Record<string, unknown>
    if (part.type === "text" && text(part.text) !== "") latest = text(part.text)
  }
  return latest
}

function nextAnswer(
  agent: Reviewer,
  event: Record<string, unknown>,
  current: string,
): { value: string; done?: true } {
  if (agent === "pi") return { value: piAnswer(event) || current }
  if (agent === "opencode") {
    const part = event.part as { text?: unknown } | undefined
    const chunk = event.type === "text" ? text(part?.text) : ""
    return { value: chunk ? current + chunk : current }
  }
  if (agent === "codex") {
    const item = event.item as Record<string, unknown> | undefined
    const msg =
      event.type === "item.completed" && item?.type === "agent_message" ? text(item.text) : ""
    return { value: msg || current }
  }
  if (event.type === "result") return { value: text(event.result), done: true }
  return { value: event.type === "assistant" ? claudeMessageText(event) || current : current }
}

/** The reviewer's last words as the stream carries them, or "" when it carries none. */
export function answerOf(agent: Reviewer, lines: string[]): string {
  const reader = readerOf(agent)
  if (reader !== undefined) return reader.answer(lines)
  let answer = ""
  for (const raw of lines) {
    const event = parse(raw)
    if (event === null) continue
    const step = nextAnswer(agent, event, answer)
    answer = step.value
    if (step.done) return answer
  }
  return answer
}
