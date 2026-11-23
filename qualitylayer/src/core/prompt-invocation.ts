// A QualityLayer command the person wrote inside a message. The agents start a skill only when its
// command opens what was typed, so a `/ql implement <task>` copied from the stop prompt into a
// larger paste, or after a line of text, reaches the agent as plain words and the workflow never
// starts. The prompt hook (`qualitylayer hook prompt`) finds the command here and tells the agent.
//
// A command on its own line, or one the person asks to run in prose, is an explicit opt-in.
// Discussing a command as a UI option is not. A path (`src/ql/x.ts`), a URL (`https://host/ql`), a quoted passage
// (`"/ql implement x"`, a `>` line), a code span or a fenced block is never one, and neither is the
// word "QualityLayer". A message that only names it (`findMention`, typos included) gets a line
// that lets the agent judge the request; a message without the name gets nothing. Text inside
// `<cross-session-message>`, `<system-reminder>` and `<task-notification>` blocks is what a harness
// or another session put into the turn, not what the person typed, so it never counts;
// `<pasted_content>` is the person's own paste and still does. Finding is pure and cheap; only the
// line looks for the skill file.

import { invocationLine, type PromptAgent, promptLine } from "./prompt-invocation-lines.ts"
import { findMentionInLine, withoutInjected } from "./prompt-invocation-mention.ts"

export { invocationLine, type PromptAgent, promptLine }

export type Invocation = {
  /** The command as written: `/ql`, `$ql` or `/qualitylayer`. */
  marker: string
  /** The words after it on its line, which are the skill's arguments. */
  args: string
  /** It opens the message: the agent's own command handling may already have started the skill. */
  atStart: boolean
}

const MARKER =
  /(^|\s)(\/skill:ql(?:-workflow|-artifact|-peer|-manage|-chat)?|\/ql(?:-workflow|-artifact|-peer|-manage|-chat)?|\$ql(?:-workflow|-artifact|-peer|-manage|-chat)?|\/qualitylayer)(?=\s|$)/gi
/** The longest argument list passed on: a line of pasted text, not a document. */
const MAX_ARGS = 400

/**
 * A whole turn QualityLayer's own peers delivered: a Codex thread's `[session-peers from=@…]` tag
 * line, a `<session-peers-request>` block, or a Codex message as Claude Code receives it. Another
 * session wrote it, so no command or name in it is the person's.
 */
const PEER_ENVELOPE =
  /^\s*(?:\[session-peers from=@\S* sid=\S*(?: mid=\S*)?(?: ask=0)? reply=[^\]\n]*\]|<session-peers-request[\s>]|Message from Codex thread [^\n:]+:\n|Message from a peer session:\n)/

function updateFence(
  fence: string | null,
  line: string,
): { fence: string | null; fenced: boolean } {
  const mark = /^\s*(```+|~~~+)/.exec(line)?.[1]?.charAt(0)
  if (mark === undefined) return { fence, fenced: fence !== null }
  return { fence: fence === null ? mark : fence === mark ? null : fence, fenced: true }
}

/**
 * The lines the person typed as prose: not a fenced block, not a `>` quotation, not a block the
 * harness injected, with inline code blanked so what stands around it still counts. `first` says
 * that nothing but blank lines came before it.
 */
function* typedLines(promptText: string): Generator<{ text: string; first: boolean }> {
  if (PEER_ENVELOPE.test(promptText)) return
  const prompt = withoutInjected(promptText)
  let fence: string | null = null
  let first = true
  for (const raw of prompt.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const state = updateFence(fence, line)
    fence = state.fence
    if (state.fenced || /^\s*>/.test(line)) {
      first = false
      continue
    }
    const text = line.replace(/`[^`]*`/g, " ")
    yield { text, first }
    if (text.trim() !== "") first = false
  }
}

const RUN_REQUEST =
  /(?:^|[.!?;:,]\s*)(?:(?:please|now|then|ok|okay)\s+)*(?:(?:(?:can|could|would)\s+you\s+|i\s+(?:want|would\s+like)\s+to\s+)?(?:run|start|invoke|execute|resume|continue|use)|now|then|hi|hello|ok|okay)\s*:?$/i
const READING_REQUEST =
  /\b(?:explain|describe|review|document|discuss|rewrite|write|show|understand|artifact|what\s+(?:does|would)|how\s+(?:does|would))\b/i
const COMMAND_SUBJECT =
  /\b(?:command|example|readme|documentation|instructions|option|button|menu|choice|chooser|terminal|following|below|this|it|how\s+to\s+(?:run|start|invoke|use))\b/i

function invocationInLine(text: string, first: boolean, reading: boolean): Invocation | null {
  for (const found of text.matchAll(MARKER)) {
    const marker = found[2] as string
    const prefix = text.slice(0, found.index + (found[1]?.length ?? 0)).trim()
    const atStart = first && text.trimStart().startsWith(marker)
    const allowed = atStart || (!reading && (prefix === "" || RUN_REQUEST.test(prefix)))
    if (!allowed) continue
    return {
      marker,
      args: text
        .slice(found.index + found[0].length)
        .trim()
        .slice(0, MAX_ARGS),
      atStart,
    }
  }
  return null
}

/** The first command the person invoked, excluding command examples and product discussion. */
export function findInvocation(promptText: string): Invocation | null {
  const lines = [...typedLines(promptText)]
  const lead = lines.find(({ text }) => text.trim() !== "")?.text ?? ""
  const markerAt = lead.search(MARKER)
  const leadProse = markerAt < 0 ? lead : lead.slice(0, markerAt)
  const reading = READING_REQUEST.test(leadProse) && COMMAND_SUBJECT.test(leadProse)
  for (const { text, first } of lines) {
    const found = invocationInLine(text, first, reading)
    if (found !== null) return found
  }
  return null
}

/** The name as the person wrote it: the words that stood for QualityLayer. */
export type Mention = { name: string }

/**
 * The first place the message names QualityLayer, or null. Lenient on purpose, since a false find
 * only adds a line the agent judges: a word, two adjacent words or a hyphenated pair that, cut down
 * to its letters, is the name or within two typing slips of it, or `ql` as a word of its own
 * (`ql-feedback` and `ql.ts` are not). Code, quotations, paths, URLs and the blocks a harness
 * injected never count, and a `/ql`-style command is `findInvocation`'s.
 */
export function findMention(promptText: string): Mention | null {
  for (const { text } of typedLines(promptText)) {
    const name = findMentionInLine(text)
    if (name !== null) return { name }
  }
  return null
}
