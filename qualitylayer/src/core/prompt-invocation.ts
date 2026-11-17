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

import { dirname, join } from "node:path"
import type { Ctx } from "../ctx.ts"
import type { NativeAgent } from "./agents/ids.ts"
import { hasHookFile } from "./install/agent-hooks.ts"
import { roots } from "./install/agent-settings.ts"
import { userHome } from "./install/manifest.ts"
import {
  ARTIFACT_NAME,
  CHAT_NAME,
  MANAGE_NAME,
  PEERS_NAME,
  type QualityLayerSkill,
  SKILL_NAME,
} from "./install/skill-names.ts"
import { detectAgents } from "./install/skills.ts"

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

const INJECTED_OPEN = /<(cross-session-message|system-reminder|task-notification)(?=[\s>/])[^>]*>/gi

/**
 * A whole turn QualityLayer's own peers delivered: a Codex thread's `[session-peers from=@…]` tag
 * line, a `<session-peers-request>` block, or a Codex message as Claude Code receives it. Another
 * session wrote it, so no command or name in it is the person's.
 */
const PEER_ENVELOPE =
  /^\s*(?:\[session-peers from=@\S* sid=\S*(?: mid=\S*)?(?: ask=0)? reply=[^\]\n]*\]|<session-peers-request[\s>]|Message from Codex thread [^\n:]+:\n|Message from a peer session:\n)/

/** Where code stands in the text (fenced blocks and inline spans), as [start, end) pairs. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let fence: { mark: string; start: number } | null = null
  let offset = 0
  for (const line of text.split("\n")) {
    const end = offset + line.length + 1
    const fenced = /^\s*(```+|~~~+)/.exec(line)
    if (fenced !== null) {
      const mark = (fenced[1] as string).charAt(0)
      if (fence === null) fence = { mark, start: offset }
      else if (fence.mark === mark) {
        ranges.push([fence.start, end])
        fence = null
      }
    } else if (fence === null) {
      for (const span of line.matchAll(/`[^`]*`/g)) {
        ranges.push([offset + span.index, offset + span.index + span[0].length])
      }
    }
    offset = end
  }
  if (fence !== null) ranges.push([fence.start, text.length])
  return ranges
}

/**
 * The message without the blocks the person did not type. Each block becomes a line holding one
 * placeholder, so a command after it no longer opens the message. A tag written inside code is
 * only a mention; an unclosed tag runs to the end of the message.
 */
function withoutInjected(prompt: string): string {
  if (!/<(cross-session-message|system-reminder|task-notification)/i.test(prompt)) return prompt
  const code = codeRanges(prompt)
  const inCode = (at: number) => code.some(([from, to]) => at >= from && at < to)
  let out = ""
  let from = 0
  INJECTED_OPEN.lastIndex = 0
  for (;;) {
    const open = INJECTED_OPEN.exec(prompt)
    if (open === null) break
    if (inCode(open.index) || open.index < from) continue
    const name = (open[1] as string).toLowerCase()
    const close = prompt.toLowerCase().indexOf(`</${name}>`, open.index + open[0].length)
    const end = close === -1 ? prompt.length : close + name.length + 3
    out += `${prompt.slice(from, open.index)}\n\u0001\n`
    from = end
    INJECTED_OPEN.lastIndex = end
  }
  return out + prompt.slice(from)
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
    const fenced = /^\s*(```+|~~~+)/.exec(line)
    if (fenced !== null) {
      const mark = (fenced[1] as string).charAt(0)
      fence = fence === null ? mark : fence === mark ? null : fence
      first = false
      continue
    }
    if (fence !== null || /^\s*>/.test(line)) {
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

/** The first command the person invoked, excluding command examples and product discussion. */
export function findInvocation(promptText: string): Invocation | null {
  const lines = [...typedLines(promptText)]
  const lead = lines.find(({ text }) => text.trim() !== "")?.text ?? ""
  const markerAt = lead.search(MARKER)
  const leadProse = markerAt < 0 ? lead : lead.slice(0, markerAt)
  const reading = READING_REQUEST.test(leadProse) && COMMAND_SUBJECT.test(leadProse)
  for (const { text, first } of lines) {
    for (const found of text.matchAll(MARKER)) {
      const prefix = text.slice(0, found.index + (found[1]?.length ?? 0)).trim()
      const atStart = first && text.trimStart().startsWith(found[2] as string)
      if (!atStart && (reading || (prefix !== "" && !RUN_REQUEST.test(prefix)))) continue
      return {
        marker: found[2] as string,
        args: text
          .slice(found.index + found[0].length)
          .trim()
          .slice(0, MAX_ARGS),
        atStart,
      }
    }
  }
  return null
}

/** The name as the person wrote it: the words that stood for QualityLayer. */
export type Mention = { name: string }

const NAME = "qualitylayer"
/** How many typing slips still count as the name. */
const NAME_SLIPS = 2

/** What sentences and markup put around a word; a `$` is not among it, so `$ql` stays a command. */
const EDGE = /[\s"'“”‘’«».,;:!?()[\]{}<>*_…–—-]/u

function trimWordEdges(token: string): string {
  let start = 0
  let end = token.length
  while (start < end && EDGE.test(token.charAt(start))) start++
  while (end > start && EDGE.test(token.charAt(end - 1))) end--
  return token.slice(start, end)
}

/** Whether `a` is at most `limit` single-letter edits away from `b`. */
function within(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (row[j] as number) + 1,
        (next[j - 1] as number) + 1,
        (row[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    row = next
  }
  return (row[b.length] as number) <= limit
}

/**
 * One word of a line cleaned for the name: its edge punctuation and a possessive taken off.
 * Null for what is not prose: a path, a URL, a dotted identifier (`ql.ts`).
 */
function wordOf(token: string): string | null {
  if (/[/\\]/.test(token)) return null
  const word = trimWordEdges(token).replace(/['’]s$/i, "")
  return word === "" || word.includes(".") ? null : word
}

/**
 * The first place the message names QualityLayer, or null. Lenient on purpose, since a false find
 * only adds a line the agent judges: a word, two adjacent words or a hyphenated pair that, cut down
 * to its letters, is the name or within two typing slips of it, or `ql` as a word of its own
 * (`ql-feedback` and `ql.ts` are not). Code, quotations, paths, URLs and the blocks a harness
 * injected never count, and a `/ql`-style command is `findInvocation`'s.
 */
export function findMention(promptText: string): Mention | null {
  for (const { text } of typedLines(promptText)) {
    const words = text.split(/\s+/).filter((token) => token !== "")
    for (let at = 0; at < words.length; at++) {
      const one = wordOf(words[at] as string)
      if (one === null) continue
      const embedded =
        /(?:^|[^\p{Script_Extensions=Latin}\p{N}_.$/-])(Quality[ -]?Layer|QL)(?=$|[^\p{Script_Extensions=Latin}\p{N}_.$/-])/iu.exec(
          one,
        )
      if (embedded) return { name: embedded[1] as string }
      if (one.toLowerCase() === "ql") return { name: one }
      const letters = one.toLowerCase().replace(/[^\p{L}]/gu, "")
      if (within(letters, NAME, NAME_SLIPS)) return { name: one }
      const second = at + 1 < words.length ? wordOf(words[at + 1] as string) : null
      if (second === null) continue
      const joined = letters + second.toLowerCase().replace(/[^\p{L}]/gu, "")
      if (within(joined, NAME, NAME_SLIPS)) return { name: `${one} ${second}` }
    }
  }
  return null
}

export type PromptAgent = NativeAgent

const commandTemplate = (found: Invocation) =>
  /^(?:implement|review|answer)\s+<[^>]+>/i.test(found.args)

/** The folder the install placed the skills in for Cursor, Grok, Copilot or Antigravity, which each read their own. */
function installedFolder(ctx: Ctx, agent: PromptAgent): string[] {
  const home = userHome(ctx)
  return home.ok && hasHookFile(agent)
    ? detectAgents(ctx.env, home.home)
        .filter((target) => target.agent === agent)
        .map((target) => target.skills)
    : []
}

/**
 * The skill file the agent can read: Claude Code keeps its skill out of the model's own reach (only
 * the person's `/ql` starts it), so the model is pointed at the file. The user's folder first, then
 * the project's; null when neither holds it.
 */
async function skillFile(
  ctx: Ctx,
  agent: PromptAgent,
  cwd: string,
  name: QualityLayerSkill,
): Promise<string | null> {
  const dirs = roots(ctx)
  const home = userHome(ctx)
  const candidates =
    agent === "pi" && home.ok
      ? [
          join(
            ctx.env.get("PI_CODING_AGENT_DIR") || join(home.home, ".pi", "agent"),
            "skills",
            name,
            "SKILL.md",
          ),
          join(cwd, ".pi", "skills", name, "SKILL.md"),
        ]
      : agent === "opencode" && home.ok
        ? [
            join(
              ctx.env.get("OPENCODE_CONFIG_DIR") ||
                join(ctx.env.get("XDG_CONFIG_HOME") || join(home.home, ".config"), "opencode"),
              "skills",
              name,
              "SKILL.md",
            ),
            join(cwd, ".opencode", "skills", name, "SKILL.md"),
          ]
        : agent === "claude-code"
          ? [
              ...(dirs !== null ? [join(dirs.claude, "skills", name, "SKILL.md")] : []),
              join(cwd, ".claude", "skills", name, "SKILL.md"),
            ]
          : [
              ...installedFolder(ctx, agent).map((folder) => join(folder, name, "SKILL.md")),
              ...(home.ok ? [join(home.home, ".agents", "skills", name, "SKILL.md")] : []),
              join(cwd, ".agents", "skills", name, "SKILL.md"),
            ]
  for (const file of candidates) if (await ctx.fs.exists(file)) return file
  return null
}

/**
 * How the agent gets the skill's instructions, since `/ql` may already have started it: it names
 * the agent's own command (`/ql` in Claude Code, `$ql` in Codex) and asks for it only when its
 * instructions are not in the conversation yet.
 */
async function startingTheSkill(
  ctx: Ctx,
  agent: PromptAgent,
  cwd: string,
  name: QualityLayerSkill = SKILL_NAME,
): Promise<string> {
  const file = await skillFile(ctx, agent, cwd, name)
  const unless = `unless ${name}'s instructions are already in this conversation`
  return file !== null
    ? `${unless}, read ${file} and follow it`
    : `${unless}, use the ${name} skill`
}

/**
 * The one line the hook prints for the agent. The person's own words stay in the message; this
 * says that they are the opt-in and what to run.
 */
export async function invocationLine(
  ctx: Ctx,
  agent: PromptAgent,
  found: Invocation,
  cwd: string,
): Promise<string> {
  const said = `${found.marker}${found.args !== "" ? ` ${found.args}` : ""}`
  const marker = found.marker.toLowerCase()
  const name = marker.endsWith("-chat")
    ? CHAT_NAME
    : marker.endsWith("-artifact")
      ? ARTIFACT_NAME
      : marker.endsWith("-peer")
        ? PEERS_NAME
        : marker.endsWith("-manage")
          ? MANAGE_NAME
          : SKILL_NAME
  const how = await startingTheSkill(ctx, agent, cwd, name)
  const run = `Use ${name} now: ${how}, ${found.args !== "" ? `with the request "${found.args}" (the words after ${found.marker})` : "with no arguments"}.`
  if (commandTemplate(found))
    return `QualityLayer: "${said}" still contains a placeholder. Keep the current task unchanged and show the command with an actual task or ask id; this template is not a request to create a task.`
  return `QualityLayer: the user invoked "${said}". ${run}`
}

/**
 * The line for a message that names QualityLayer without a command. The hook cannot tell a request
 * from a question, in any language, so the agent judges: asked to carry the request, the person has
 * opted in; only mentioned, asked about, worked on or refused, nothing starts and the line stays
 * unsaid. The same line says which `next` a build request runs.
 */
async function mentionLine(
  ctx: Ctx,
  agent: PromptAgent,
  found: Mention,
  cwd: string,
): Promise<string> {
  const file = await skillFile(ctx, agent, cwd, SKILL_NAME)
  const location = file
    ? `Read only the needed skill at ${dirname(dirname(file))}/<skill>/SKILL.md if its instructions are not loaded.`
    : "Load only the needed installed skill if its instructions are not loaded."
  return `QualityLayer or QL is named ("${found.name}"). Interpret the person's request in its language: ${CHAT_NAME} handles an explicit Chat request such as "Using QualityLayer, chat about …"; ${SKILL_NAME} carries a three-step task (Plan, Implement, Verify); ${ARTIFACT_NAME} creates, opens, edits or manages artifacts and feedback; ${PEERS_NAME} contacts other agent sessions; ${MANAGE_NAME} handles lookup, memory, sharing, setup and diagnostics. ${location} A Chat, artifact or management operation does not start a workflow. For workflow continuation or recovery, preserve the named task's recorded stage. Product discussion, examples, refusals, work on QualityLayer itself and peer-delivered content are not workflow opt-ins. Ordinary software requests do not activate Chat.`
}

/**
 * What the prompt hook prints for a message, or null. A command is the person's opt-in and wins;
 * without one, the name alone only lets the agent read the request; without the name, nothing.
 * Codex starts `$ql` itself wherever it stands, so only its `/ql` needs a line. `agentOf` names the
 * agent for the marker found (none for a mention).
 */
export async function promptLine(
  ctx: Ctx,
  prompt: string,
  cwd: string,
  agentOf: (marker: string) => PromptAgent,
): Promise<string | null> {
  const found = findInvocation(prompt)
  if (found !== null) {
    const agent = agentOf(found.marker)
    return invocationLine(ctx, agent, found, cwd)
  }
  const mention = findMention(prompt)
  return mention === null ? null : mentionLine(ctx, agentOf(""), mention, cwd)
}
