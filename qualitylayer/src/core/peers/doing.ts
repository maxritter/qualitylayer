// What a live session is doing, for `peers list`, so an agent can tell sessions apart without
// asking the person. A status the session set by hand comes first. Without one, a guess from what
// was already written down, in this order: the QualityLayer task the session works on, the
// session's own title, the person's first message. A guess is marked as one. Transcripts are read
// in bounded pieces only, and nothing that looks like a secret is shown.

import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { isLineText, skipWhitespace } from "../text-boundaries.ts"
import { asRecord, claudeConfigDir, isUuid } from "./base.ts"
import type { Said } from "./claims.ts"
import { currentTaskText, type TaskStatus } from "./task-status.ts"
import { printable } from "./topics.ts"

/** Read from a transcript's start: the first message is there, a Codex one after ~60 KB of instructions. */
export const HEAD_BYTES = 256 * 1024
/** Read from its end: Claude Code writes the session's title again at the end of every turn. */
export const TAIL_BYTES = 64 * 1024
/** A guessed line is cut to about this many characters. */
export const DOING_CHARS = 80
/** A line QualityLayer wrote from a task: its title is at most 60 characters. */
const TASK_CHARS = 120
/** The most of a first message the secret patterns ever look at. */
const SCAN_CHARS = 4000

export type DoingFrom = "status" | "task" | "title" | "first_message"
export type Doing = { text: string; from: DoingFrom }

/** How each line reads in `peers list`: anything but a status set by hand reads as a guess. */
export const DOING_MARK: Record<DoingFrom, string> = {
  status: "doing:",
  task: "doing (from its task):",
  title: "doing (from its title):",
  first_message: "doing (from its first message):",
}

// ------------------------------------------------------------------ reading

export type Bounded = { head: string; tail: string; bytes: number }

/** The first `head` and last `tail` bytes of a file, the overlap once; null when it cannot be read. */
export function readBounded(path: string, head = HEAD_BYTES, tail = TAIL_BYTES): Bounded | null {
  let fd: number
  try {
    fd = openSync(path, "r")
  } catch {
    return null
  }
  try {
    const size = fstatSync(fd).size
    const start = Buffer.alloc(Math.min(size, head))
    const got = readSync(fd, start, 0, start.length, 0)
    const from = Math.max(got, size - tail)
    const end = Buffer.alloc(Math.max(0, size - from))
    const more = end.length > 0 ? readSync(fd, end, 0, end.length, from) : 0
    return {
      head: start.subarray(0, got).toString("utf8"),
      tail: end.subarray(0, more).toString("utf8"),
      bytes: got + more,
    }
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

/** The whole JSON lines of a piece; a line torn at the piece's edge is skipped. */
function rowsOf(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      const row = asRecord(JSON.parse(line))
      if (row !== null) out.push(row)
    } catch {
      // torn at the edge of what was read
    }
  }
  return out
}

/** What a transcript says about its session: its titles, best first, and the person's first message. */
export type Facts = { titles: string[]; prompt: string | null }

/** Claude Code's title rows, the one set with /rename first. */
const TITLE_ROWS: [string, string][] = [
  ["custom-title", "customTitle"],
  ["ai-title", "aiTitle"],
  ["summary", "summary"],
]

/** Wrappers Claude Code and its peers put around what is not the person's own message. */
const NOT_SAID =
  /^\s*(<(local-command-|command-|system-reminder|bash-|task-notification|cross-session-message|session-peers-request|user-prompt-submit-hook)|\[Request interrupted)/

function partsText(content: unknown): string | null {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return null
  const texts: string[] = []
  for (const part of content) {
    const p = asRecord(part)
    if (p?.type === "tool_result") return null
    if (typeof p?.text === "string") texts.push(p.text)
  }
  return texts.join("\n")
}

/** A Claude Code user row as the person typed it, or null when it is not theirs. */
function claudeSaid(row: Record<string, unknown>): string | null {
  if (row.type !== "user" || row.isMeta === true || row.isSidechain === true) return null
  const text = partsText(asRecord(row.message)?.content)
  if (text === null || text.trim() === "") return null
  const command = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(text)
  if (command !== null) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? ""
    // A command without words (/clear, /model) says nothing about the work.
    return args === "" ? null : `/${command[1]} ${args}`
  }
  return NOT_SAID.test(text) ? null : text
}

export function claudeFacts(read: Bounded): Facts {
  const head = rowsOf(read.head)
  const latest = new Map<string, string>()
  for (const row of [...head, ...rowsOf(read.tail)])
    for (const [type, field] of TITLE_ROWS) {
      const value = row[field]
      if (row.type === type && typeof value === "string" && value.trim() !== "")
        latest.set(type, value)
    }
  let prompt: string | null = null
  for (const row of head) {
    prompt = claudeSaid(row)
    if (prompt !== null) break
  }
  return {
    titles: TITLE_ROWS.map(([type]) => latest.get(type)).filter(
      (t): t is string => t !== undefined,
    ),
    prompt,
  }
}

/** What Codex puts in front of the first turn: its instructions, the environment, a skill, a peer's tag. */
const CODEX_NOT_SAID = /^\s*(# AGENTS\.md instructions|<|\[session-peers )/

/** A Codex thread's title is its name, which its line already shows: only the first message is read. */
export function codexFacts(read: Bounded): Facts {
  for (const row of rowsOf(read.head)) {
    const payload = asRecord(row.payload)
    let text: string | null = null
    if (row.type === "event_msg" && payload?.type === "user_message")
      text = typeof payload.message === "string" ? payload.message : null
    else if (row.type === "response_item" && payload?.type === "message" && payload.role === "user")
      text = partsText(payload.content)
    if (text !== null && text.trim() !== "" && !CODEX_NOT_SAID.test(text))
      return { titles: [], prompt: text }
  }
  return { titles: [], prompt: null }
}

/** A Claude session's transcript: in the folder named for its directory, else in any project's. */
export function claudeTranscript(
  sessionId: string,
  cwd: string | null,
  projects = join(claudeConfigDir(), "projects"),
): string | null {
  if (!isUuid(sessionId)) return null
  const file = `${sessionId}.jsonl`
  if (cwd) {
    const guess = join(projects, cwd.replace(/[^A-Za-z0-9]/g, "-"), file)
    if (existsSync(guess)) return guess
  }
  let folders: string[]
  try {
    folders = readdirSync(projects)
  } catch {
    return null
  }
  for (const folder of folders) {
    const path = join(projects, folder, file)
    if (existsSync(path)) return path
  }
  return null
}

// ------------------------------------------------------------------ showing

const LABELLED =
  /\b(password|passwd|pwd|secret|token|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|client[-_ ]?secret|auth[-_ ]?token)(\s*[:=]\s*|\s+is\s+)("[^"]*"|'[^']*'|[^\s,;]+)/gi

const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
  // The password of a URL: https://user:password@host
  /(?<=:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g,
]

/** A long run of letters and digits mixed: a key, a token, a hash. Task names and ids have hyphens. */
const LONG_TOKEN = /\b[A-Za-z0-9]{32,}\b/g

/** `text` with whatever looks like a secret replaced by "[hidden]". */
export function hideSecrets(text: string): string {
  let shown = text.replace(LABELLED, "$1$2[hidden]")
  for (const pattern of SECRETS) shown = shown.replace(pattern, "[hidden]")
  return shown.replace(LONG_TOKEN, (run) =>
    /\d/.test(run) && /[A-Za-z]/.test(run) ? "[hidden]" : run,
  )
}

/** One clean line: no secret, no control character, whitespace folded, cut at a word near `max`. */
export function oneLine(text: string, max = DOING_CHARS): string {
  const flat = printable(hideSecrets(text.slice(0, SCAN_CHARS)).replace(/\s+/g, " ").trim())
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`
}

/** A status set by hand, shown whole but never with a secret or a control character. */
const handLine = (text: string) => printable(hideSecrets(text))

/**
 * What a session is doing: a status set by hand after it took up its QualityLayer task (or with no
 * task), else that task as it stands now, else its own title (one its line does not already show
 * as its name), else the person's first message. `guess` reads the transcript, only when needed.
 */
export async function doingOf(input: {
  hand: Said | undefined
  task: TaskStatus | null
  guess?: () => Facts | null
  name?: string | null
  ctx?: Ctx
  /** Already loaded once by peers list, shared with its acting-location projection. */
  currentTask?: { text: string } | null
}): Promise<Doing | null> {
  const { hand, task } = input
  if (hand?.text && (task === null || hand.at * 1000 > task.since))
    return { text: handLine(hand.text), from: "status" }
  if (task !== null) {
    const text =
      input.currentTask === undefined
        ? await currentTaskText(task, input.ctx)
        : (input.currentTask?.text ?? null)
    if (text !== null) return { text: oneLine(text, TASK_CHARS), from: "task" }
  }
  const facts = input.guess?.() ?? null
  if (facts === null) return null
  const title = facts.titles.map((t) => oneLine(t)).find((t) => t !== "" && t !== input.name)
  if (title !== undefined) return { text: title, from: "title" }
  const prompt = facts.prompt === null ? "" : oneLine(facts.prompt)
  return prompt === "" ? null : { text: prompt, from: "first_message" }
}

// ------------------------------------------------------------------ where and when

function gitDirectoryPointer(text: string): string | undefined {
  for (const prefix of text.matchAll(/^gitdir:/gm)) {
    const after = prefix.index + prefix[0].length
    const start = skipWhitespace(text, after)
    if (start === text.length) {
      for (let i = start - 1; i >= after; i--) if (isLineText(text.charAt(i))) return text.charAt(i)
      continue
    }
    const remainder = text.slice(start)
    const nextBreak = remainder.search(/[\r\n\u2028\u2029]/)
    return (nextBreak === -1 ? remainder : remainder.slice(0, nextBreak)).trimEnd()
  }
  return undefined
}

/** The branch checked out where `cwd` is, from git's own files; "detached at <sha>" off a branch; null outside git. */
export function branchOf(cwd: string | null): string | null {
  if (!cwd) return null
  let dir = resolve(cwd)
  for (let depth = 0; depth < 64; depth++) {
    const dotGit = join(dir, ".git")
    let gitDir: string | null = null
    try {
      const st = statSync(dotGit)
      if (st.isDirectory()) gitDir = dotGit
      else if (st.isFile()) {
        // A worktree's .git is a file naming its own folder under the repository's.
        const named = gitDirectoryPointer(readFileSync(dotGit, "utf8"))
        if (named !== undefined) gitDir = isAbsolute(named) ? named : resolve(dir, named)
      }
    } catch {
      // not at this level
    }
    if (gitDir !== null) {
      try {
        const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim()
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1]
        if (ref !== undefined) return ref
        return /^[0-9a-f]{7,}$/.test(head) ? `detached at ${head.slice(0, 7)}` : null
      } catch {
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/** "40 s ago", "2 min ago", "3 h ago", "3 d ago". */
export function agoText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s ago`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`
}
