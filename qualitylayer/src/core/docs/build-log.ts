// agents/02-implement.md and agents/03-verify.md: what the build and its judge record, so the
// approved Plan changes only by a visible amendment. Parsed for the verify rules, the gaps handed
// to the fix round, the PR description and the Cockpit's Checks tab.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { agentFileOf, LOGS } from "./names.ts"
import { proseLines, sectionRanges } from "./rules/types.ts"
import { OPTIONAL_SLOT_LINE, slotHeading } from "./slots.ts"

export { noteTasks } from "./note-tasks.ts"

export type Verdict = {
  /**
   * NOTE: a finding that does not fail the build; it reaches the user at the final approval.
   * USER: a point only the person can confirm; it never fails a round and reaches Review as a Confirm item.
   */
  verdict: "PASS" | "FAIL" | "MISSING" | "NOTE" | "USER"
  /** check | dod | scenario | acceptance | review */
  kind: string
  /** T3, 2, A1 … ("" for kinds without a subject) */
  subject: string
  text: string
  line: number
}

export type Iteration = {
  n: number
  /** With parts: fail when any part fails, pass when every part passes, null while one has no result. */
  result: "pass" | "fail" | null
  /** Who ruled: a fresh helper, or the build session when the agent has none. */
  judge: string | null
  assignment?: string
  revision?: string
  verdicts: Verdict[]
  /** The pictures of the whole change the judge saved, each with its caption. */
  pictures: RunPicture[]
  /** Steps to try the whole change end to end; a passing round holds them. */
  tryIt: RunStep[]
  /** The line of the iteration's heading; of its first part when several judges recorded one. */
  line: number
  /** The parts of an iteration several judges recorded side by side, one per `### Iteration N · share K`. */
  parts?: IterationPart[]
}

/** What one judge recorded of an iteration judged in shares; its verdicts are merged into the iteration. */
export type IterationPart = {
  share: number
  result: "pass" | "fail" | null
  judge: string | null
  assignment?: string
  revision?: string
  line: number
}

/** One step of a run's `**Try it:**` list: a line to read, and a command to copy when the line ends in one. */
export type RunStep = { text: string; command: string | null }

/** One captured file the run shows a person, with its one-line caption. */
export type RunPicture = { file: string; caption: string }

export type BuildLog = {
  /** The lines under `## Notes` of the Implement agents' file: the build's decisions, one line each; the amendments' full-text blocks are not among them. */
  deviations: string
  verification: Iteration[]
}

const ITERATION = /^### Iteration (\d+)(?:\s*[·-]\s*share (\d+))?\s*$/i
const VERDICT =
  /^[-*] \[(PASS|FAIL|MISSING|NOTE|USER)\]\s+([a-z-]+)(?:\s+([A-Za-z0-9_-]+))?\s*:\s*((?:\S.*)?)$/
/** `- [MISSING] scenario 3 App view: …`: a numbered subject with words before the colon. */
function wordyVerdict(line: string): string[] | null {
  const prefix = /^[-*] \[(PASS|FAIL|MISSING|NOTE|USER)\]\s+([a-z-]+)\s+(\d+|[Tt]\d+)(\s+)/.exec(
    line,
  )
  if (prefix === null) return null
  const rest = line.slice(prefix[0].length)
  const colon = rest.indexOf(":")
  if (colon < 0 || (colon === 0 && (prefix[4]?.length ?? 0) < 2)) return null
  const tail = /^\s*((?:\S.*)?)$/.exec(rest.slice(colon + 1))
  return tail === null
    ? null
    : [line, prefix[1] ?? "", prefix[2] ?? "", prefix[3] ?? "", rest.slice(0, colon), tail[1] ?? ""]
}
const RESULT = /^\*\*Result:\*\*\s*(pass|fail)\b/i
const JUDGE = /^\*\*Judge:\*\*\s*(\S.*)$/i
const OPTIONAL_SLOT = OPTIONAL_SLOT_LINE

/** The text under a `## heading`, without the heading, trimmed; "" when absent. */
export function sectionText(markdown: string, heading: string): string {
  const range = sectionRanges(markdown).find((r) => r.heading === heading)
  if (range === undefined) return ""
  return markdown
    .split(/\r?\n/)
    .slice(range.start, range.end - 1)
    .filter((line) => !OPTIONAL_SLOT.test(line))
    .join("\n")
    .trim()
}

type Block = {
  result: "pass" | "fail" | null
  revision?: string
  verdicts: Verdict[]
}

/**
 * The `### ` blocks of one `## section`, each opened by a heading `open`
 * recognises; the lines every block shares (verdicts, Revision, Result) are
 * read here, the rest by `other`.
 */
function readBlocks<T extends Block>(
  markdown: string,
  section: string,
  open: (line: string, lineNo: number) => T | null,
  other: (block: T, line: string) => void,
): T[] {
  const blocks: T[] = []
  const range = sectionRanges(markdown).find((r) => r.heading === section)
  if (range === undefined) return blocks
  let block: T | null = null
  for (const { text, line: lineNo } of proseLines(markdown)) {
    if (lineNo <= range.start || lineNo >= range.end) continue
    const line = text.trimEnd()
    if (OPTIONAL_SLOT.test(line)) continue
    const opened = open(line, lineNo)
    if (opened !== null) {
      block = opened
      blocks.push(block)
      continue
    }
    if (/^### /.test(line)) block = null
    if (block === null) continue
    const revision = line.match(/^\*\*Revision:\*\*\s*(\S+)\s*$/)
    if (revision) {
      block.revision = revision[1]
      continue
    }
    const verdict = line.match(VERDICT)
    if (verdict !== null) {
      block.verdicts.push({
        verdict: verdict[1] as Verdict["verdict"],
        kind: verdict[2] ?? "",
        subject: verdict[3] ?? "",
        text: (verdict[4] ?? "").trim(),
        line: lineNo,
      })
      continue
    }
    const wordy = wordyVerdict(line)
    if (wordy !== null) {
      block.verdicts.push({
        verdict: wordy[1] as Verdict["verdict"],
        kind: wordy[2] ?? "",
        subject: wordy[3] ?? "",
        text: `${(wordy[4] ?? "").trimEnd()}: ${(wordy[5] ?? "").trimStart()}`.trim(),
        line: lineNo,
      })
      continue
    }
    const result = line.match(RESULT)
    if (result !== null) {
      block.result = (result[1] ?? "").toLowerCase() as "pass" | "fail"
      continue
    }
    other(block, line)
  }
  return blocks
}

const PICTURE = /^[-*]\s+`(evidence\/[^`\s]+)`\s*[—–-]\s*(\S.*)$/
const STEP = /^\d+[.)]\s+(\S.*)$/

/** A numbered line of a `**Try it:**` list; a wrapped line joins the step before it. */
function addStepLine(raw: string[], text: string): void {
  const step = text.match(STEP)
  if (step !== null) raw.push(step[1] ?? "")
  else if (text !== "" && raw.length > 0) raw[raw.length - 1] += ` ${text}`
}

/** The iterations recorded under `## Verification` in any document. */
export function parseIterations(markdown: string): Iteration[] {
  let listing = false
  let raw: string[] = []
  const blocks = readBlocks<Iteration & { share?: number }>(
    markdown,
    "Verification",
    (line, lineNo) => {
      const iter = line.match(ITERATION)
      if (iter === null) return null
      listing = false
      raw = []
      return {
        n: Number(iter[1]),
        ...(iter[2] !== undefined ? { share: Number(iter[2]) } : {}),
        result: null,
        judge: null,
        verdicts: [],
        pictures: [],
        tryIt: [],
        line: lineNo,
      }
    },
    (iteration, line) => {
      const assignment = line.match(/^\*\*Assignment:\*\*\s*(\S+)\s*$/)
      if (assignment) {
        iteration.assignment = assignment[1]
        return
      }
      const judge = line.match(JUDGE)
      if (judge !== null) {
        iteration.judge = (judge[1] ?? "").trim()
        return
      }
      if (/^\*\*Try it:\*\*/i.test(line)) {
        listing = true
        return
      }
      if (/^\*\*[^*]+:\*\*/.test(line)) {
        listing = false
        return
      }
      const picture = line.match(PICTURE)
      if (picture !== null) {
        iteration.pictures.push({ file: picture[1] ?? "", caption: (picture[2] ?? "").trim() })
        return
      }
      if (listing) {
        addStepLine(raw, line.trim())
        iteration.tryIt = raw.map(stepOf)
      }
    },
  )
  return mergeParts(blocks)
}

/**
 * The parts several judges recorded of one iteration read as that iteration, at the place of
 * its first part: their verdicts, pictures and steps together. A block without a share stays
 * an iteration of its own.
 */
function mergeParts(blocks: (Iteration & { share?: number })[]): Iteration[] {
  const merged = new Map<number, Iteration>()
  const out: Iteration[] = []
  for (const { share, ...block } of blocks) {
    if (share === undefined) {
      out.push(block)
      continue
    }
    const part: IterationPart = {
      share,
      result: block.result,
      judge: block.judge,
      ...(block.assignment !== undefined ? { assignment: block.assignment } : {}),
      ...(block.revision !== undefined ? { revision: block.revision } : {}),
      line: block.line,
    }
    const whole = merged.get(block.n)
    if (whole === undefined) {
      const first: Iteration = { ...block, parts: [part] }
      merged.set(block.n, first)
      out.push(first)
      continue
    }
    whole.parts?.push(part)
    whole.verdicts.push(...block.verdicts)
    whole.pictures.push(...block.pictures)
    whole.tryIt.push(...block.tryIt)
    whole.judge ??= block.judge
    if (whole.assignment === undefined) whole.assignment = block.assignment
    if (whole.revision === undefined) whole.revision = block.revision
  }
  for (const whole of merged.values()) {
    const results = (whole.parts ?? []).map((p) => p.result)
    whole.result = results.includes(null) ? null : results.includes("fail") ? "fail" : "pass"
  }
  return out
}

/** A try-it line: a trailing command in backticks is kept apart so it can be copied. */
function stepOf(line: string): RunStep {
  const tail = line.replace(/[.:]$/, "").trimEnd()
  const close = tail.endsWith("`") ? tail.length - 1 : -1
  const open = close < 0 ? -1 : tail.lastIndexOf("`", close - 1)
  const before = open < 0 ? "" : tail.slice(0, open).trim()
  // Only a line whose text before the command stands on its own: "Build it: `cmd`".
  if (open >= 0 && close > open + 1 && /[:.]$/.test(before))
    return { text: before, command: tail.slice(open + 1, close) }
  return { text: line, command: null }
}

/**
 * The log with the `**Revision:**` line of the block that opens at `line` (an iteration's
 * heading) pointing at `revision`; unchanged when the block records none.
 */
export function setRevision(markdown: string, line: number, revision: string): string {
  const lines = markdown.split(/\r?\n/)
  for (let index = line; index < lines.length && !/^#{1,3}\s/.test(lines[index] ?? ""); index++) {
    // Any Revision line, a placeholder a helper wrote ("recorded by QualityLayer") included.
    if (/^\*\*Revision:\*\*/.test(lines[index] ?? "")) {
      lines[index] = `**Revision:** ${revision}`
      return lines.join("\n")
    }
  }
  return markdown
}

/**
 * The log with the block that opens at `line` stamped with `revision`: its `**Revision:**` line
 * set, or, where the block has none (a helper writes no hash), one added under its heading.
 */
export function stampRevision(markdown: string, line: number, revision: string): string {
  const lines = markdown.split(/\r?\n/)
  for (let index = line; index < lines.length && !/^#{1,3}\s/.test(lines[index] ?? ""); index++)
    if (/^\*\*Revision:\*\*/.test(lines[index] ?? "")) return setRevision(markdown, line, revision)
  lines.splice(line, 0, "", `**Revision:** ${revision}`)
  return lines.join("\n")
}

/** What a note under `## Notes` of the Implement agents' file records. */
export type NoteKind = "tactical" | "amended" | "agreed" | "judged" | "baseline"

export type Note = {
  /**
   * T5, every task of a note for several (`T1, T2, T5`, as `- T1, T2, T5 (amended): …` names
   * them; `noteTasks` lists them), or null for a plan-level note (`- Plan (amended): …`, `- Baseline: …`).
   */
  task: string | null
  kind: NoteKind
  text: string
  line: number
}

const NOTE =
  /^[-*]\s+(T\d+(?:\s*,\s*T\d+)*|Plan)\s*\((tactical|glue|amended|agreed|judged)\)\s*:\s*(.+)$/i
const BASELINE = /^[-*]\s+Baseline\s*:\s*(\S.*)$/i

/** The heading of the Implement agents' file that holds the build's decisions and Plan amendments. */
export const NOTES = "Notes"

/**
 * The notes under `## Notes`, one line each:
 * `- T5 (tactical|glue|amended|agreed|judged): …`, or `- T1, T2, T5 (…): …`
 * for one decision about several tasks (one amendment names every task it covers),
 * `- Plan (amended|agreed): …` for a change to the plan as a whole, and
 * `- Baseline: …` for what was found before the build. Other lines are no note. A `(glue)` line,
 * the coordinator's small fitting edit, is read as a `tactical` note: the same kind of decision,
 * shown and checked like one.
 */
export function parseNotes(markdown: string): Note[] {
  const range = sectionRanges(markdown).find((r) => r.heading === NOTES)
  if (range === undefined) return []
  const lines = markdown.split(/\r?\n/)
  const notes: Note[] = []
  for (let index = range.start; index < range.end - 1; index++) {
    const line = (lines[index] ?? "").trim()
    const baseline = line.match(BASELINE)
    if (baseline !== null) {
      notes.push({
        task: null,
        kind: "baseline",
        text: (baseline[1] ?? "").trim(),
        line: index + 1,
      })
      continue
    }
    const note = line.match(NOTE)
    if (note === null) continue
    const raw = (note[2] ?? "").toLowerCase()
    notes.push({
      task:
        note[1]?.toLowerCase() === "plan"
          ? null
          : (note[1] ?? "")
              .split(",")
              .map((id) => id.trim().toUpperCase())
              .join(", "),
      kind: raw === "glue" ? "tactical" : (raw as NoteKind),
      text: (note[3] ?? "").trim(),
      line: index + 1,
    })
  }
  return notes
}

export function parseBuildLog(markdown: string): BuildLog {
  return {
    deviations: sectionText(markdown, NOTES)
      .split("\n")
      .filter((line) => /^\s*[-*]\s/.test(line))
      .join("\n"),
    verification: parseIterations(markdown),
  }
}

type LogTask = Pick<Task, "dir">

/** The people's Implement file: `02-implement.md`, the summary, the slices, the decisions and the limits. */
export const implementLogPath = (task: LogTask): string => join(task.dir, LOGS.implement)

/** Where notes, Plan amendments and the recorded checks are read and written: `agents/02-implement.md`. */
export const implementAgentsPath = (task: LogTask): string =>
  join(task.dir, agentFileOf("implement"))

/** Where the security review and the judge's iterations are read and written: `agents/03-verify.md`. */
export const verifyLogPath = (task: LogTask): string => join(task.dir, LOGS.verify)

/**
 * The build record of a task: the notes of the Implement agents' file and the verification
 * iterations of the Verify file. A file that is not there reads empty.
 */
export async function readBuildRecord(ctx: Ctx, task: LogTask): Promise<BuildLog> {
  const read = async (path: string) => ((await ctx.fs.exists(path)) ? ctx.fs.readFile(path) : "")
  const log = parseBuildLog(await read(implementAgentsPath(task)))
  return { ...log, verification: parseBuildLog(await read(verifyLogPath(task))).verification }
}

export function lastIteration(log: Pick<BuildLog, "verification">): Iteration | null {
  return log.verification[log.verification.length - 1] ?? null
}

export { decisionsOf } from "./build-decisions.ts"

/** A deviations section that says nothing is treated as empty. */
export function hasDeviations(log: Pick<BuildLog, "deviations">): boolean {
  const text = log.deviations.trim()
  return text !== "" && !/^(-\s*)?none\.?$/i.test(text)
}

/**
 * Append a line at the end of a `## heading` section, creating the section when missing.
 * A `- ` list line joins the list above it; anything else (a note, a run block) starts its own paragraph.
 */
export function appendToSection(markdown: string, heading: string, line: string): string {
  const lines = markdown.trimEnd().split(/\r?\n/)
  const range = sectionRanges(markdown).find((r) => r.heading === heading)
  if (heading === "Checks" && range) {
    const key = (text: string) =>
      text.match(/`/g)?.length === 2
        ? /^- \[[A-Z ]+\] (.+?) · ([a-f0-9]{7,64}|uncommitted) · (`[^`]+`)(?= · |$)/
            .exec(text)
            ?.slice(1)
            .join("\0")
        : undefined
    const identity = key(line)
    if (identity) {
      const repeats = lines.flatMap((text, index) =>
        index >= range.start && index < range.end - 1 && key(text) === identity
          ? [{ index, text }]
          : [],
      )
      if (repeats.length) {
        const count = repeats.reduce(
          (n, row) => n + Number(/ · (\d+) runs$/.exec(row.text)?.[1] ?? 1),
          1,
        )
        const remove = new Set(repeats.map((row) => row.index))
        return appendToSection(
          lines.filter((_, index) => !remove.has(index)).join("\n"),
          heading,
          `${line.replace(/ · \d+ runs$/, "")} · ${count} runs`,
        )
      }
    }
  }
  if (range === undefined) {
    // The template left a slot for this section: it takes the slot's place and the slot goes.
    const slot = lines.findIndex((text) => slotHeading(text) === heading)
    if (slot !== -1) {
      lines.splice(slot, 1, `## ${heading}`, "", line)
      return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`
    }
    return `${lines.join("\n")}\n\n## ${heading}\n\n${line}\n`
  }
  // An optional section slot is the next section's place, even before it has its heading.
  let end = Math.min(range.end - 1, lines.length)
  const slot = lines.findIndex(
    (text, index) => index >= range.start && index < end && OPTIONAL_SLOT.test(text),
  )
  if (slot !== -1) end = slot
  while (end > range.start && (lines[end - 1] ?? "").trim() === "") end--
  const before = lines.slice(0, end)
  const after = lines.slice(end)
  const gap = end === range.start || !line.startsWith("- ") ? [""] : []
  return `${[...before, ...gap, line, ...(after.length > 0 ? ["", ...after] : [])].join("\n").replace(/\n{3,}/g, "\n\n")}\n`
}
