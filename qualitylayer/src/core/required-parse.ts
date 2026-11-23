// Required lines: a `- [ ]` line under a step's `## ` heading in the person's or the team's
// instructions. The agent does it or skips it with a reason, and Verify shows which. A line that starts
// `run:` names a command; under Implement or Verify it joins the Plan's Project checks.
// Pure text work, shared by the CLI, the server and the App's editor.

import { FLOW_STEPS, type FlowStepId } from "./flow.ts"

export type RequiredSource = "team" | "you"

export type RequiredLine = {
  step: FlowStepId
  /** 1-based within its step, team lines first: the number `instructions done <step> <n>` takes. */
  n: number
  /** The line as written after the checkbox. */
  text: string
  /** The command of a `run:` line, without its backticks. */
  run?: string
  source: RequiredSource
}

/** The steps whose `run:` lines run with the Project checks; the Plan's the agent runs itself. */
export const CHECK_STEPS: ReadonlySet<FlowStepId> = new Set<FlowStepId>(["implement", "verify"])

const STEP_IDS = new Set<string>(FLOW_STEPS.map((step) => step.id))
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** A closing fence is the marker alone, with trailing spaces at most (CommonMark). */
const CLOSING = /^ {0,3}(`{3,}|~{3,}) *$/
/** A top-level checkbox bullet: an indented one belongs to the bullet above and stays guidance. */
const REQUIRED = /^[-*+] \[[ xX]\] +(\S.*)$/
const RUN = /^run:\s*(\S.*)$/i

/** The step's name as the steps show it: Verify. */
export const stepLabel = (step: FlowStepId): string =>
  FLOW_STEPS.find((s) => s.id === step)?.label ?? step

const stepOf = (line: string): FlowStepId | null => {
  let end = line.length
  while (end > 3 && line.charCodeAt(end - 1) === 32) end--
  const name = line.slice(3, end).toLowerCase()
  return STEP_IDS.has(name) ? (name as FlowStepId) : null
}

type Row = {
  raw: string
  /** The step whose section the row is in; null outside a step's section. */
  step: FlowStepId | null
  /** A `#` or `## ` heading outside a code fence. */
  heading: boolean
  /** The words of a required line in a step's section. */
  required?: string
}

function nextFence(fence: string | null, raw: string): string | null {
  if (fence === null) return FENCE.exec(raw)?.[1] ?? null
  const closing = CLOSING.exec(raw)?.[1]
  const closes = closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length
  return closes ? null : fence
}

function parseRow(raw: string, state: { step: FlowStepId | null; fence: string | null }): Row {
  const wasFenced = state.fence !== null
  state.fence = nextFence(state.fence, raw)
  if (wasFenced || state.fence !== null) return { raw, step: state.step, heading: false }
  const heading = raw.startsWith("## ") || raw.startsWith("# ")
  if (heading) state.step = raw.startsWith("## ") ? stepOf(raw) : null
  const words = state.step === null || heading ? undefined : REQUIRED.exec(raw.trimEnd())?.[1]
  return { raw, step: state.step, heading, ...(words !== undefined ? { required: words } : {}) }
}

/** The text's rows with the section each is in; headings inside code fences start no section. */
function rows(text: string): Row[] {
  const state: { step: FlowStepId | null; fence: string | null } = { step: null, fence: null }
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((raw) => parseRow(raw, state))
}

/** The command a `run:` line names: the backticked span when there is one, else the rest of the line. */
export function runCommand(text: string): string | undefined {
  const rest = RUN.exec(text)?.[1]?.trim()
  if (rest === undefined || rest === "") return undefined
  const ticked = /^`([^`]+)`/.exec(rest)?.[1]?.trim()
  return ticked !== undefined && ticked !== "" ? ticked : rest.replaceAll("`", "").trim()
}

type Found = { step: FlowStepId; text: string; run?: string }

/** Each required line of one file, in order. The whole text is read: no length cap cuts a line. */
const found = (text: string): Found[] =>
  rows(text).flatMap((row) => {
    if (row.step === null || row.required === undefined) return []
    const run = runCommand(row.required)
    return [{ step: row.step, text: row.required, ...(run !== undefined ? { run } : {}) }]
  })

/** A repeated line: the same command exactly, or the same words in any case and spacing. */
const same = (a: Found, b: Found) =>
  a.run !== undefined || b.run !== undefined
    ? a.run === b.run
    : a.text.replace(/\s+/g, " ").trim().toLowerCase() ===
      b.text.replace(/\s+/g, " ").trim().toLowerCase()

/**
 * The required lines of the team's and the person's text, numbered per step with the team's first.
 * A line of the person's that repeats a team line in the same step is the team's.
 */
export function requiredLines(team: string | null, you: string | null): RequiredLine[] {
  const teams = team === null ? [] : found(team)
  const yours = you === null ? [] : found(you)
  const out: RequiredLine[] = []
  for (const { id } of FLOW_STEPS) {
    const fromTeam = teams.filter((line) => line.step === id)
    const fromYou = yours.filter((line) => line.step === id && !fromTeam.some((t) => same(t, line)))
    let n = 0
    for (const line of fromTeam) out.push({ ...line, n: ++n, source: "team" })
    for (const line of fromYou) out.push({ ...line, n: ++n, source: "you" })
  }
  return out
}

/** Whether a `run:` line of this step joins the Project checks. */
export const isProjectCheck = (line: Pick<RequiredLine, "step" | "run">): boolean =>
  line.run !== undefined && CHECK_STEPS.has(line.step)

/**
 * The text with one more required line after the last non-blank row of the step's section; the
 * section is added at the end when the text has none.
 */
export function withRequiredLine(text: string, step: FlowStepId, words: string): string {
  const line = `- [ ] ${words.replace(/\s+/g, " ").trim()}`
  let endOfText = text.length
  while (endOfText > 0 && text.charCodeAt(endOfText - 1) === 10) endOfText--
  const all = rows(text.slice(0, endOfText))
  const start = all.findIndex((row) => row.heading && row.step === step)
  if (start === -1) {
    const before =
      all.length === 1 && all[0]?.raw === "" ? "" : `${all.map((r) => r.raw).join("\n")}\n\n`
    return `${before}## ${stepLabel(step)}\n${line}\n`
  }
  let end = start
  for (let at = start + 1; at < all.length && !(all[at] as Row).heading; at++)
    if ((all[at] as Row).raw.trim() !== "") end = at
  const out = all.map((row) => row.raw)
  out.splice(end + 1, 0, line)
  return `${out.join("\n")}\n`
}

/** The text without the person's `n`-th required line of the step (counted in this text alone). */
export function withoutRequiredLine(text: string, step: FlowStepId, n: number): string {
  const all = rows(text)
  const matching = all.flatMap((row, at) =>
    row.step === step && row.required !== undefined ? [at] : [],
  )
  const drop = matching[n - 1]
  if (drop === undefined) return text
  return all
    .filter((_, at) => at !== drop)
    .map((row) => row.raw)
    .join("\n")
}
