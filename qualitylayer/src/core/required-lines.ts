// A task's required lines (core/required-parse.ts), fixed when the task starts: a later change to
// the instructions applies from the next task. The agent records each line done
// or skipped with a reason; a `run:` line of Implement or Verify is a Project check, recorded
// by `qualitylayer check all`. Nothing here holds a step: an open line is listed first in its step's
// replies and reminded once when the step is left. Its recorded outcome never becomes a fake pass.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { FLOW_STEPS, type FlowStepId, flowStepOf } from "./flow.ts"
import { readPersonal, readTeamCopy } from "./instructions.ts"
import { checkStatesOf, validateRequiredLineNote } from "./required-lines-checks.ts"
import { isProjectCheck, type RequiredLine, requiredLines, stepLabel } from "./required-parse.ts"
import { requiredLinesPath } from "./required-skips.ts"
import { appendEvent, type Task } from "./task/store.ts"

export {
  missingCheckError,
  missingFromPlan,
  requiredLimits,
} from "./required-lines-checks.ts"
export { requiredJudgeSection, requiredReply } from "./required-lines-text.ts"
export type { RequiredLine } from "./required-parse.ts"

type Recorded = { state: "done" | "skipped"; note: string; at: number }

type Stored = {
  taken: number
  lines: RequiredLine[]
  /** Project-check commands that were not in the previous task's lines on this computer. */
  newRuns: string[]
  /** `<step> <n>` → what the agent recorded. */
  records: Record<string, Recorded>
  /** The steps whose open lines were already reminded once. */
  reminded: FlowStepId[]
  /** The step the task was in when it took its lines; earlier steps' lines never applied to it. */
  from?: FlowStepId
}

export type RequiredState =
  | "open"
  | "done"
  | "skipped"
  | "not-done"
  /** A Project check not run yet. */
  | "waiting"
  | "passed"
  | "failed"

export type RequiredStatus = RequiredLine & {
  state: RequiredState
  /** The agent's note or reason, or what the check recorded. */
  note?: string
  /** A Project-check command new or changed since the previous task on this computer. */
  changed?: true
}

export type RequiredView = {
  lines: RequiredStatus[]
  /** What changed in the instructions since the task started; the task kept its lines. */
  since: { added: string[]; removed: string[] }
}

const path = requiredLinesPath
const seenPath = (ctx: Ctx) => join(ctx.home, "required-runs-seen.json")
const key = (step: FlowStepId, n: number) => `${step} ${n}`
const order = (step: FlowStepId) => FLOW_STEPS.findIndex((s) => s.id === step)

/** The lines the instructions require now, the team's first. */
export async function currentLines(ctx: Ctx): Promise<RequiredLine[]> {
  const [team, you] = await Promise.all([readTeamCopy(ctx), readPersonal(ctx)])
  return requiredLines(team?.text ?? null, you?.text ?? null)
}

export async function readStoredRequiredLines(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<Stored | null> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(path(task))) as Partial<Stored>
    if (!Array.isArray(parsed.lines)) return null
    const records = parsed.records && typeof parsed.records === "object" ? parsed.records : {}
    return {
      taken: typeof parsed.taken === "number" ? parsed.taken : 0,
      lines: parsed.lines,
      newRuns: Array.isArray(parsed.newRuns) ? parsed.newRuns : [],
      records,
      reminded: Array.isArray(parsed.reminded) ? parsed.reminded : [],
      ...(typeof parsed.from === "string" ? { from: parsed.from } : {}),
    }
  } catch {
    return null
  }
}

const readStored = readStoredRequiredLines

const write = async (ctx: Ctx, task: Pick<Task, "runtimeDir">, stored: Stored) => {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(path(task), `${JSON.stringify(stored, null, 2)}\n`)
}

function parseSeenRuns(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : []
  } catch {
    return []
  }
}

/** Project-check commands this computer's previous task did not have; the list is then updated. */
async function newRunsOf(ctx: Ctx, lines: RequiredLine[]): Promise<string[]> {
  const runs = lines.filter(isProjectCheck).map((line) => line.run as string)
  const raw = await ctx.fs.readFile(seenPath(ctx)).catch(() => null)
  if (raw === null) {
    // First task on this computer: nothing to compare with, nothing marked.
    await ctx.fs.mkdir(ctx.home)
    await ctx.fs.atomicWrite(seenPath(ctx), `${JSON.stringify(runs)}\n`)
    return []
  }
  const seen = parseSeenRuns(raw)
  if (runs.length > 0 || seen.length > 0)
    await ctx.fs.atomicWrite(seenPath(ctx), `${JSON.stringify(runs)}\n`)
  return runs.filter((run) => !seen.includes(run))
}

/**
 * The task's lines, taken from the instructions the first time the task asks for them: a new task
 * at its first reply. A task that was already past a step then (one started before required lines
 * existed) takes only the lines of its current and later steps, so no step it finished is said to
 * have missed a line.
 */
export async function taskLines(ctx: Ctx, task: Task): Promise<Stored> {
  // A Chat keeps no lines and takes none: a Chat promoted to a workflow takes them then.
  if (task.type === "chat") return { taken: 0, lines: [], newRuns: [], records: {}, reminded: [] }
  const stored = await readStored(ctx, task)
  if (stored !== null) return stored
  return ctx.fs.withLock(`${path(task)}.lock`, async () => {
    const again = await readStored(ctx, task)
    if (again !== null) return again
    const from = stepIndexOf(task)
    const lines = (await currentLines(ctx)).filter((line) => order(line.step) >= from)
    const taken: Stored = {
      taken: ctx.clock.now(),
      lines,
      newRuns: await newRunsOf(ctx, lines),
      records: {},
      reminded: [],
      ...(from < FLOW_STEPS.length ? { from: (FLOW_STEPS[from] as { id: FlowStepId }).id } : {}),
    }
    await write(ctx, task, taken)
    if (lines.length > 0)
      await appendEvent(ctx, task, { event: "required_lines_taken", count: lines.length })
    return taken
  })
}

/** The step a task is in for its lines: a shipped task is past every step. */
const stepIndexOf = (task: Pick<Task, "stage">): number =>
  task.stage === "shipped" ? FLOW_STEPS.length : order(flowStepOf(task.stage) ?? "plan")

type LineFacts = {
  stored: Stored
  /** The step index the task is in now. */
  now: number
  checks: Map<string, { passed: boolean; note: string }>
}

/** What became of one line: its record, its check, or where the task is now. */
function stateOf(line: RequiredLine, facts: LineFacts): Pick<RequiredStatus, "state" | "note"> {
  const recorded = facts.stored.records[key(line.step, line.n)]
  if (recorded !== undefined) return { state: recorded.state, note: recorded.note }
  const check = isProjectCheck(line) ? facts.checks.get(line.run as string) : undefined
  if (check !== undefined) return { state: check.passed ? "passed" : "failed", note: check.note }
  // A Project check runs in Verify; any other line in its own step.
  const due = isProjectCheck(line) ? order("verify") : order(line.step)
  if (facts.now > due) return { state: "not-done" }
  return { state: isProjectCheck(line) ? "waiting" : "open" }
}

/** Each line with what became of it so far. */
export async function requiredView(ctx: Ctx, task: Task): Promise<RequiredView> {
  const stored = await taskLines(ctx, task)
  const facts: LineFacts = {
    stored,
    now: stepIndexOf(task),
    checks: stored.lines.some(isProjectCheck) ? await checkStatesOf(ctx, task) : new Map(),
  }
  const lines = stored.lines.map(
    (line): RequiredStatus => ({
      ...line,
      ...(line.run !== undefined && stored.newRuns.includes(line.run) ? { changed: true } : {}),
      ...stateOf(line, facts),
    }),
  )
  const current = await currentLines(ctx)
  const label = (line: RequiredLine) => `${stepLabel(line.step)}: ${line.text}`
  const has = (list: RequiredLine[], line: RequiredLine) =>
    list.some((other) => other.step === line.step && other.text === line.text)
  return {
    lines,
    since: {
      added: current
        .filter((line) => order(line.step) >= order(stored.from ?? "plan"))
        .filter((line) => !has(stored.lines, line))
        .map(label),
      removed: stored.lines.filter((line) => !has(current, line)).map(label),
    },
  }
}

/** The view for the App: null until the task took its lines, so reading never takes them. */
export async function requiredViewIfTaken(ctx: Ctx, task: Task): Promise<RequiredView | null> {
  const stored = await readStored(ctx, task)
  if (stored === null || stored.lines.length === 0) return null
  return requiredView(ctx, task)
}

/** Record a line done or skipped. A Project check is recorded by `check all`; it can only be skipped. */
export async function recordLine(
  ctx: Ctx,
  task: Task,
  input: { step: string; n: number; state: "done" | "skipped"; note: string },
): Promise<Result<RequiredStatus>> {
  const checkedNote = validateRequiredLineNote(input)
  if (!checkedNote.ok) return checkedNote
  const note = checkedNote.data
  // The lines are taken before the lock: taking them holds the same lock.
  const taken = await taskLines(ctx, task)
  return ctx.fs.withLock(`${path(task)}.lock`, async () => {
    const stored = (await readStored(ctx, task)) ?? taken
    const line = stored.lines.find((l) => l.step === input.step && l.n === input.n)
    if (line === undefined) {
      const known = stored.lines.map((l) => key(l.step, l.n)).join(", ")
      return err({
        code: "bad_args",
        message:
          known === ""
            ? "this task has no step checks"
            : `this task has no step check ${input.step} ${input.n}; it has ${known}`,
      })
    }
    if (input.state === "done" && isProjectCheck(line))
      return err({
        code: "bad_args",
        message: `${input.step} ${input.n} is a Project check: \`qualitylayer check all\` runs and records it. If it cannot apply to this task, skip it with the reason.`,
      })
    stored.records[key(line.step, line.n)] = { state: input.state, note, at: ctx.clock.now() }
    await write(ctx, task, stored)
    await appendEvent(ctx, task, {
      event: "required_line_recorded",
      line: key(line.step, line.n),
      state: input.state,
    })
    return ok({ ...line, state: input.state, note })
  })
}

/** The earlier steps reminded now, claimed under the lock so two replies never both remind one. */
export async function claimRequiredReminders(
  ctx: Ctx,
  task: Task,
  stored: Stored,
  unrecorded: RequiredStatus[],
): Promise<FlowStepId[]> {
  if (unrecorded.length === 0) return []
  return ctx.fs.withLock(`${path(task)}.lock`, async () => {
    const latest = (await readStored(ctx, task)) ?? stored
    const fresh = [...new Set(unrecorded.map((line) => line.step))].filter(
      (gone) => !latest.reminded.includes(gone),
    )
    if (fresh.length > 0)
      await write(ctx, task, { ...latest, reminded: [...latest.reminded, ...fresh] })
    return fresh
  })
}
