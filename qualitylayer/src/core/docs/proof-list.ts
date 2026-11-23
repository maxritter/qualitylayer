// The one reader of the Plan's Done means: the task's points and its list of proof. Every consumer
// (the verdicts, the briefs, the App's pages, the export) gets the same points and steps from here.
//
//   `Runs as: <how the test runs>` and the setup the steps share; then `### 1. <the outcome>`, one
//   sentence on how it shows, and a `| Step | Action | Expected |` table whose ids A1, A2 … run
//   across the section; a step that proves a second point is named under it (`also A2`). A bug's
//   table has a fourth column, `| Step | Action | Before the fix | After the fix |`: what shows the
//   bug, and what shows it gone (read as `expected`).
//
// Pure text in, a list out, with no file or Node import, so the App's pages read it too. The
// file-reading entry points are in `acceptance.ts`.

import {
  addAlso,
  addRow,
  alsoLine,
  columnsOf,
  FEATURE_COLUMNS,
  isDelimiter,
  type ProofColumns,
  plainText,
  replacePoint,
  runsAsLine,
} from "./proof-table.ts"

export type ProofStep = {
  /** `A1`. */
  id: string
  n: number
  /** What the step does. */
  action: string
  /** What passes (a bug's *After the fix*). */
  expected: string
  /** What shows the bug before the fix: a bug's *Before the fix* column. "" when the table has none. */
  before: string
  /** The step as one line: `action → expected`. */
  text: string
  /** The Done means points the step proves: its own first, then those that name it with `also`. */
  points: number[]
}

export type ProofPoint = {
  /** The Plan's number for the Done means point. */
  n: number
  /** The point as the heading says it. */
  text: string
  /** How it shows: the prose under the heading, before its table, in one line. "" when none. */
  how: string
  /** The steps written under the heading. */
  steps: ProofStep[]
  /** Ids named with `also`, written or not. */
  also: string[]
}

export type ProofList = {
  /** The Done means points, in the order written. */
  points: ProofPoint[]
  /** Every step once, in the order written. */
  steps: ProofStep[]
  /** How the test runs, in the Plan's words; null when the Plan does not say. */
  runsAs: string | null
}

/** The steps that prove point `n`: its own and the ones that name it with `also`, in the order written. */
export function stepsOfPoint(list: ProofList, n: number): ProofStep[] {
  return list.steps.filter((step) => step.points.includes(n))
}

const FENCE = /^\s*(```|~~~)/
const POINT = /^###\s+(\d+)[.)]\s*((?:\S.*)?)$/

/** The section's lines without its `## ` heading. */
function linesOf(section: string): string[] {
  const lines = section.split(/\r?\n/).map((line) => line.trimEnd())
  const first = lines.findIndex((line) => line.trim() !== "")
  if (first >= 0 && /^## /.test(lines[first] ?? "")) lines.splice(first, 1)
  return lines
}

/** The lines outside fenced blocks. */
function proseOf(lines: string[]): string[] {
  let fenced = false
  return lines.filter((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced
      return false
    }
    return !fenced
  })
}

type ParseState = {
  points: ProofPoint[]
  steps: ProofStep[]
  byId: Map<string, ProofStep>
  point: ProofPoint | null
  columns: ProofColumns
  runsAs: string | null
  runsOpen: boolean
}

function handleRunsAs(text: string, state: ParseState): boolean {
  const runs = runsAsLine(text)
  if (runs !== null && state.runsAs === null) {
    state.runsAs = (runs[1] ?? "").trim()
    state.runsOpen = true
    return true
  }
  if (!state.runsOpen) return false
  if (text === "" || text.startsWith("#") || text.startsWith("|")) {
    state.runsOpen = false
    return false
  }
  state.runsAs = `${state.runsAs ?? ""} ${text}`.trim()
  return true
}

function handlePointBody(text: string, state: ParseState): void {
  const { point } = state
  if (point === null || text === "") return
  if (text.startsWith("|")) {
    const header = columnsOf(text)
    if (header !== null) state.columns = header
    else if (!isDelimiter(text)) addRow(text, state.columns, point, state.byId, state.steps)
    return
  }
  if (alsoLine(text) !== null) {
    addAlso(text, point)
    return
  }
  // The sentence on how the point shows, before its table.
  if (point.steps.length === 0 && !text.startsWith("#") && !text.startsWith(">")) {
    point.how = `${point.how} ${plainText(text)}`.trim()
  }
}

function linkAlsoSteps(points: ProofPoint[], byId: Map<string, ProofStep>): void {
  for (const each of points) {
    for (const id of each.also) {
      const step = byId.get(id)
      if (step !== undefined && !step.points.includes(each.n)) step.points.push(each.n)
    }
  }
}

function pointsList(lines: string[]): ProofList {
  const state: ParseState = {
    points: [],
    steps: [],
    byId: new Map(),
    point: null,
    columns: FEATURE_COLUMNS,
    runsAs: null,
    runsOpen: false,
  }
  for (const line of lines) {
    const text = line.trim()
    const heading = POINT.exec(text)
    if (heading !== null) {
      state.point = {
        n: Number(heading[1]),
        text: plainText(heading[2] ?? "").replace(/[.:]$/, ""),
        how: "",
        steps: [],
        also: [],
      }
      replacePoint(state.points, state.steps, state.byId, state.point)
      state.columns = FEATURE_COLUMNS
      state.runsOpen = false
      continue
    }
    if (handleRunsAs(text, state)) continue
    handlePointBody(text, state)
  }
  linkAlsoSteps(state.points, state.byId)
  return {
    points: state.points,
    steps: state.steps,
    runsAs: state.runsAs === "" ? null : state.runsAs,
  }
}

/** The proof list of a Done means section's text (with or without its `## ` heading). */
export function proofOfSection(section: string): ProofList {
  return pointsList(proseOf(linesOf(section)))
}
