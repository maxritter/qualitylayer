// The build proves the Done means steps once itself (plan §3.6b): `check step A<n>` runs a step's
// command on the built tree and records its exit code, with the output under `records/`. `build done`
// reads these records: a step that never ran green is `missing`, so the fresh reviewer is never the
// first to run it.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { proofOf } from "../acceptance.ts"
import { type CommandRunner, checkTimeoutMs, shellRunner } from "../checks.ts"
import { sectionText } from "../docs/build-log.ts"
import { backticked } from "../docs/commands.ts"
import { agentFileOf, RECORDS_DIR } from "../docs/names.ts"
import { buildRevision } from "../gate/revision.ts"
import { selectedReviewCandidate } from "../review-candidate.ts"
import { shellQuote } from "../shell.ts"
import { appendEvent, type Task } from "../task/store.ts"

/** One recorded run of a Done means step. */
export type StepRun = {
  step: string
  command: string
  exit: number | null
  at: number
  /** The build as it was when the step ran; null before a build base is recorded. */
  revision: string | null
  /** The output, from the task folder (`records/step-A1.txt`). */
  log: string
}

const runsPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "step-runs.json")

export async function readStepRuns(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<StepRun[]> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(runsPath(task))) as unknown
    return Array.isArray(parsed) ? (parsed as StepRun[]) : []
  } catch {
    return []
  }
}

/**
 * The commands the build named for a step on its *Proof order* line. The Plan's Action is prose
 * (plan §3.6b: "the build turns it into a command"): its backticked `--lines` or `one\ntwo` are
 * words, and run as a shell line they only fail.
 */
async function commandsOf(ctx: Ctx, task: Task, id: string): Promise<string[]> {
  const path = join(task.dir, agentFileOf("implement"))
  if (!(await ctx.fs.exists(path))) return []
  const order = sectionText(await ctx.fs.readFile(path), "Proof order")
  const line = order.split("\n").find((row) => new RegExp(`^\\s*[-*]?\\s*${id}\\b`, "i").test(row))
  return line === undefined ? [] : backticked(line)
}

/** The Plan's Done means steps whose latest recorded run is not green, in the Plan's order. */
export async function unprovenSteps(ctx: Ctx, task: Task): Promise<{ id: string; text: string }[]> {
  const steps = (await proofOf(ctx, task)).steps
  if (steps.length === 0) return []
  const latest = new Map<string, StepRun>()
  for (const run of await readStepRuns(ctx, task)) latest.set(run.step, run)
  return steps
    .filter((step) => latest.get(step.id)?.exit !== 0)
    .map((step) => ({ id: step.id, text: step.text }))
}

export type StepReply = {
  step: string
  command: string
  exit: number | null
  passed: boolean
  log: string
  timed_out?: true
}

/** One argument for the shell the runner starts, taken literally. */
const quoted = (word: string): string =>
  process.platform === "win32"
    ? /[\s"&|<>^%]/.test(word)
      ? `"${word.replaceAll('"', '""')}"`
      : word
    : /^[\w@%+=:,./-]+$/.test(word)
      ? word
      : shellQuote(word)

/**
 * The command line for the words after `--`: one word is a shell line as written; several are an
 * argv, each quoted so the program receives exactly what the agent's shell passed.
 */
export function stepCommandLine(given: string | readonly string[]): string {
  if (typeof given === "string") return given.trim()
  return given.length === 1 ? (given[0] ?? "").trim() : given.map(quoted).join(" ")
}

/**
 * `check step A<n> [-- <program> <args…>]`: run the command in the checkout and record the result.
 * Without one, the command on the step's *Proof order* line runs.
 */
export async function runStep(
  ctx: Ctx,
  task: Task,
  id: string,
  given: string | readonly string[] | null,
  runner: CommandRunner = shellRunner,
): Promise<Result<StepReply>> {
  const candidate = task.stage === "verify" ? await selectedReviewCandidate(ctx, task) : null
  if (candidate) task = { ...task, repoRoot: candidate.choice.checkout }
  const step = (await proofOf(ctx, task)).steps.find((s) => s.id.toUpperCase() === id.toUpperCase())
  if (step === undefined)
    return err({
      code: "bad_args",
      message: `The Plan's Done means has no step ${id}. Its steps are named A1, A2 … in the Plan.`,
    })
  const commands = given !== null ? [stepCommandLine(given)] : await commandsOf(ctx, task, step.id)
  if (commands.length === 0 || commands.every((c) => c === ""))
    return err({
      code: "bad_args",
      message: `The Plan's Action for ${step.id} is prose, not a command. Run the command that proves it: qualitylayer check step ${step.id} -- <program> <args…> (each argument reaches it as given).`,
    })
  const command = commands.join(" && ")
  const revisionBefore = candidate ? await buildRevision(ctx, task) : null
  const ran = await runner(command, task.repoRoot, checkTimeoutMs(ctx))
  const log = candidate
    ? `${RECORDS_DIR}/step-${step.id}-candidate-${candidate.id.slice(0, 12)}.txt`
    : `${RECORDS_DIR}/step-${step.id}.txt`
  await ctx.fs.mkdir(join(task.dir, RECORDS_DIR))
  await ctx.fs.writeFile(
    join(task.dir, log),
    `$ ${command}\n${ran.output}${ran.output.endsWith("\n") ? "" : "\n"}exit ${ran.exit ?? "at the time limit"}\n`,
  )
  const revision = revisionBefore ?? (await buildRevision(ctx, task).catch(() => null))
  const run: StepRun = {
    step: step.id,
    command,
    exit: ran.exit,
    at: ctx.clock.now(),
    revision,
    log,
  }
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    runsPath(task),
    `${JSON.stringify([...(await readStepRuns(ctx, task)), run])}\n`,
  )
  await appendEvent(ctx, task, { event: "step_checked", step: step.id, exit: ran.exit })
  return ok({
    step: step.id,
    command,
    exit: ran.exit,
    passed: ran.exit === 0,
    log,
    ...(ran.timedOut === true ? { timed_out: true as const } : {}),
  })
}
