// What a live session is doing, for `peers list`, so an agent can tell sessions apart without
// asking the person. A status the session set by hand comes first. Without one, a guess from what
// was already written down, in this order: the QualityLayer task the session works on, the
// session's own title, the person's first message. A guess is marked as one. Transcripts are read
// in bounded pieces only, and nothing that looks like a secret is shown.

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { claudeConfigDir, isUuid } from "./base.ts"
import type { Said } from "./claims.ts"
import type { Facts } from "./doing-transcripts.ts"
import { currentTaskText, type TaskStatus } from "./task-status.ts"
import { printable } from "./topics.ts"

export { agoText, branchOf } from "./doing-git.ts"
export {
  type Bounded,
  claudeFacts,
  codexFacts,
  type Facts,
  HEAD_BYTES,
  readBounded,
  TAIL_BYTES,
} from "./doing-transcripts.ts"

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
