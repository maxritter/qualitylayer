// agents/02-implement.md and agents/03-verify.md: what the build and its judge record, so the
// approved Plan changes only by a visible amendment. Parsed for the verify rules, the gaps handed
// to the fix round, the PR description and the Cockpit's Checks tab.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { appendToSection, sectionText, stampRevision } from "./build-log-edit.ts"
import {
  type Iteration,
  type IterationPart,
  parseIterations,
  type RunStep,
  type Verdict,
} from "./build-log-iterations.ts"
import { agentFileOf, LOGS } from "./names.ts"
import { noteLine } from "./record-lines.ts"
import { sectionRanges } from "./rules/types.ts"

export { decisionsOf } from "./build-decisions.ts"
export { noteTasks } from "./note-tasks.ts"
export {
  appendToSection,
  type Iteration,
  type IterationPart,
  parseIterations,
  type RunStep,
  sectionText,
  stampRevision,
  type Verdict,
}

export type BuildLog = {
  /** The lines under `## Notes` of the Implement agents' file: the build's decisions, one line each; the amendments' full-text blocks are not among them. */
  deviations: string
  verification: Iteration[]
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
    const note = noteLine(line)
    if (note === null) continue
    const raw = note.kind.toLowerCase()
    notes.push({
      task:
        note.task.toLowerCase() === "plan"
          ? null
          : note.task
              .split(",")
              .map((id) => id.trim().toUpperCase())
              .join(", "),
      kind: raw === "glue" ? "tactical" : (raw as NoteKind),
      text: note.text,
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

/** A deviations section that says nothing is treated as empty. */
export function hasDeviations(log: Pick<BuildLog, "deviations">): boolean {
  const text = log.deviations.trim()
  return text !== "" && !/^(-\s*)?none\.?$/i.test(text)
}
