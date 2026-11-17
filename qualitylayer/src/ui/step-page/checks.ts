// The Checks section of an Implement document, read for the step page. `qualitylayer check` appends
// one line per run to the document: `- T1 · 6edffcfd · `command` · exit 0 · 1.7s`. The page folds
// those lines into rows (the latest run of each command per task or slice, with how often it ran)
// and a one-line summary. Reading never changes the document, and the Reader keeps every line.

export type CheckState = "passed" | "failed" | "not-run"

export type CheckRow = {
  command: string
  state: CheckState
  /** The latest run's own words when they say more than a pass: `exit 1`, `failed: …`, `reused`. */
  status: string
  secs: number | null
  rev: string
  reused: boolean
  /** How many times this command ran under this label. */
  runs: number
  /** An earlier run failed and a later one passed. */
  failedBefore: boolean
}

export type CheckGroup = { label: string; rows: CheckRow[] }

export type ChecksModel = {
  /** Every run line the section holds. */
  runs: number
  groups: CheckGroup[]
  /** Rows whose latest run failed, and rows that were not run. */
  failed: number
  notRun: number
  /** What the section says that is not a run line: kept, so nothing the agent wrote is dropped. */
  other: string[]
}

type Run = Omit<CheckRow, "runs" | "failedBefore"> & { label: string; repeats: number }

const RUN = /^- (.+?) · ([^·]+?) · `(.+?)` · (.+)$/
const SECONDS = /^\d+(?:\.\d+)?s$/
/** A line the CLI wrote again for the same check ends in how many times it ran. */
const REPEATS = /^(\d+) runs$/

function runOf(line: string): Run | null {
  const found = RUN.exec(line.trim())
  const [, name, rev, command, rest] = found ?? []
  if (name === undefined || rev === undefined || command === undefined || rest === undefined)
    return null
  const parts = rest.split(" · ")
  const duration = parts.find((part) => SECONDS.test(part))
  const repeats = Number(parts.map((part) => REPEATS.exec(part)?.[1]).find(Boolean) ?? 1)
  const words = parts.filter((part) => !SECONDS.test(part) && !REPEATS.test(part))
  const status = words.join(" · ")
  const secs = duration === undefined ? null : Number.parseFloat(duration)
  const first = words[0] ?? ""
  const reused = words.some((word) => word.startsWith("reused"))
  const state: CheckState = first.startsWith("not run")
    ? "not-run"
    : reused || /^exit 0$/.test(first)
      ? "passed"
      : "failed"
  return { label: name, command, rev, secs, status, reused, state, repeats }
}

/** T1, T2, … by number first, then slice 1, slice 2, …, then every other label as it first ran. */
function rank(label: string): [number, number] {
  const task = /^T(\d+)$/.exec(label)
  if (task !== null) return [0, Number(task[1])]
  const slice = /^slice (\d+)$/.exec(label)
  if (slice !== null) return [1, Number(slice[1])]
  return [2, 0]
}

/** The section's body as rows, or null when it holds no run line (it then draws as Markdown). */
export function parseChecks(markdown: string): ChecksModel | null {
  const runs: Run[] = []
  const other: string[] = []
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("- ")) continue
    const run = runOf(line)
    if (run !== null) runs.push(run)
    else other.push(line.slice(2).trim())
  }
  if (runs.length === 0) return null

  const rows = new Map<string, { label: string; row: CheckRow }>()
  for (const run of runs) {
    const key = JSON.stringify([run.label, run.command])
    const before = rows.get(key)
    const { label, repeats, ...latest } = run
    rows.set(key, {
      label,
      row: {
        ...latest,
        runs: (before?.row.runs ?? 0) + repeats,
        failedBefore:
          run.state === "passed" &&
          (before?.row.failedBefore === true || before?.row.state === "failed"),
      },
    })
  }

  const byLabel = new Map<string, CheckRow[]>()
  for (const { label, row } of rows.values())
    byLabel.set(label, [...(byLabel.get(label) ?? []), row])
  const groups = [...byLabel.entries()]
    .map(([label, list]) => ({ label, rows: list }))
    .sort((a, b) => {
      const [ka, na] = rank(a.label)
      const [kb, nb] = rank(b.label)
      return ka - kb || na - nb
    })
  const latest = groups.flatMap((g) => g.rows)
  return {
    runs: runs.reduce((sum, run) => sum + run.repeats, 0),
    groups,
    failed: latest.filter((row) => row.state === "failed").length,
    notRun: latest.filter((row) => row.state === "not-run").length,
    other,
  }
}

/** What the Checks fold says of itself: `41 recorded · 2 red`, and the first red check as its takeaway. */
export function checksCount(checks: ChecksModel): string {
  return `${checks.runs} recorded${checks.failed > 0 ? ` · ${checks.failed} red` : ""}`
}

/** The rows of a group with the red ones first, then those not run, then the passed, in run order. */
export const redFirst = (rows: readonly CheckRow[]): CheckRow[] => {
  const rank = (row: CheckRow) => (row.state === "failed" ? 0 : row.state === "not-run" ? 1 : 2)
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row)
}

/** The checks of one slice: the task labels (`T3`) and `slice 3` that belong to it. */
export type SliceChecks = {
  /** The slice number; null for the checks that belong to no slice (the whole change, a scenario). */
  slice: number | null
  rows: CheckRow[]
  failed: number
}

/**
 * The checks grouped by the slice they ran for, the slices with a red check first, then by number,
 * the checks of the whole change last. `sliceOf` says which slice a label (`T3`, `slice 3`) is in.
 */
export function checksBySlice(
  checks: ChecksModel,
  sliceOf: (label: string) => number | null,
): SliceChecks[] {
  const bySlice = new Map<number | null, CheckRow[]>()
  for (const group of checks.groups) {
    const slice = sliceOf(group.label)
    bySlice.set(slice, [...(bySlice.get(slice) ?? []), ...group.rows])
  }
  return [...bySlice.entries()]
    .map(([slice, rows]) => ({
      slice,
      rows: redFirst(rows),
      failed: rows.filter((row) => row.state === "failed").length,
    }))
    .sort(
      (a, b) =>
        Number(b.failed > 0) - Number(a.failed > 0) ||
        Number(a.slice === null) - Number(b.slice === null) ||
        (a.slice ?? 0) - (b.slice ?? 0),
    )
}

export type ChecksSummary = {
  count: number
  /** What follows the count: `runs · all passed`. */
  line: string
  tone: "ok" | "danger"
}

export function checksSummary(checks: ChecksModel): ChecksSummary {
  const problems = [
    ...(checks.failed > 0 ? [`${checks.failed} failed`] : []),
    ...(checks.notRun > 0 ? [`${checks.notRun} not run`] : []),
  ]
  return {
    count: checks.runs,
    line: `${checks.runs === 1 ? "run" : "runs"} · ${problems.length > 0 ? problems.join(" · ") : "all passed"}`,
    tone: checks.failed > 0 ? "danger" : "ok",
  }
}

/** A duration as the record says it under a minute, in minutes and seconds past one. */
export function formatSecs(secs: number): string {
  if (secs < 60) return `${secs}s`
  const whole = Math.round(secs)
  return `${Math.floor(whole / 60)}m ${whole % 60}s`
}

/**
 * A verdict that names the environment (a deploy, a network, a missing key) left the point unverified:
 * the check never ran, so nothing failed. Red is for a failed check and a stopped run only.
 */
export const environmental = (sentence: string | null | undefined) =>
  /^environment:\s*\S/i.test(sentence ?? "")
