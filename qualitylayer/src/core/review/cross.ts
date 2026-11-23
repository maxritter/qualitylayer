// An independent review by the other agent, the second opinion: Claude Code
// reviews Codex's work and Codex reviews Claude Code's, of the Plan and of the
// built change, when the user switched it on (it is off by default).
// Opening the gate that stands in front of a point starts the reviewer itself,
// detached, headless and read-only, on the model from the settings and at high
// effort. It keeps its state and its answer beside the plan, so the user reads
// and comments meanwhile and the working agent folds the findings in when they
// arrive. No second session has to be open.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import type { Reviewer } from "../agents/binary.ts"
import { type ReviewCost, recordReviewCost } from "../cost/reviews.ts"
import { REVIEWS_DIR } from "../docs/names.ts"
import { recordDuration, reviewKind } from "../helper-history.ts"
import type { Task } from "../task/store.ts"
import { briefFor, secondRoundBrief } from "./cross-brief.ts"
import { REVIEW_EFFORT, reviewCommand, reviewerEnv } from "./cross-command.ts"
import { recordBuildScope } from "./cross-diff.ts"
import {
  agentFolders,
  hardStopMs,
  minutesText,
  pointFor,
  reviewerBinary,
  reviewWorkerEnv,
  sessionBinaryEnv,
} from "./cross-env.ts"
import { decidedStepOf, reviewWorkerArguments } from "./cross-flags.ts"
import {
  couldNotRunLead,
  couldNotRunLine,
  handleOf,
  lockReason,
  PLAN_REVIEW_HANDOFF,
  planReviewWork,
  type ReviewHandle,
  reasonOf,
  reviewerOf,
  unanimousKeptLine,
} from "./cross-handles.ts"
import { runPanelReview } from "./cross-panel-run.ts"
import {
  type Attempt,
  brokeRule,
  type CrossReviewResult,
  failureReason,
  findingsIn,
  type Outcome,
  runReviewer,
  secondStep,
} from "./cross-runner.ts"
import {
  type ReviewRun,
  readRun,
  reviewRuns,
  startReview,
  waitForReview,
  writeRun,
} from "./cross-runs.ts"
import {
  type CrossReviewStep,
  crossReviewStep,
  type ReviewPoint,
  reviewFile,
  whyNoReview,
} from "./cross-step.ts"
import { answerOf, progressOf } from "./events.ts"
import { mockupShots, shotPaths } from "./mockup-shots.ts"
import { capturePlanReviewInput, type PlanReviewInput } from "./plan-input.ts"
import { installedAgents } from "./vendors.ts"

export type { CrossReviewResult, CrossReviewStep, Outcome, ReviewHandle, ReviewPoint, ReviewRun }
export {
  agentFolders,
  briefFor,
  brokeRule,
  couldNotRunLead,
  couldNotRunLine,
  crossReviewStep,
  decidedStepOf,
  handleOf,
  hardStopMs,
  installedAgents,
  lockReason,
  PLAN_REVIEW_HANDOFF,
  planReviewWork,
  pointFor,
  readRun,
  reasonOf,
  recordBuildScope,
  reviewCommand,
  reviewerBinary,
  reviewerEnv,
  reviewerOf,
  reviewFile,
  reviewRuns,
  reviewWorkerArguments,
  reviewWorkerEnv,
  runReviewer,
  secondRoundBrief,
  sessionBinaryEnv,
  startReview,
  unanimousKeptLine,
  waitForReview,
}

function makeThrottledProgress(
  ctx: Ctx,
  task: Task,
  by: Reviewer,
  getRun: () => ReviewRun,
  setRun: (next: ReviewRun) => void,
) {
  let latest: string | null = null
  let lastWrite = 0
  let flushing: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<void> = Promise.resolve()
  const flush = () => {
    flushing = null
    if (latest === null) return
    lastWrite = ctx.clock.now()
    const next = { ...getRun(), line: latest, at: lastWrite }
    setRun(next)
    latest = null
    writing = writing.then(() => writeRun(ctx, task, next))
  }
  const seen = (raw: string) => {
    const line = progressOf(by, raw)
    if (line === null) return
    latest = line
    const wait = lastWrite + 1000 - ctx.clock.now()
    if (wait <= 0) flush()
    else if (flushing === null) flushing = setTimeout(flush, wait)
  }
  const stop = async () => {
    if (flushing !== null) clearTimeout(flushing)
    await writing
  }
  return { seen, stop }
}

async function runSingleAttempt(
  ctx: Ctx,
  task: Task,
  point: ReviewPoint,
  spec: {
    step: CrossReviewStep
    executable: string | null
    started: number
    hardStop: number
    input?: PlanReviewInput
    getRun: () => ReviewRun
    setRun: (next: ReviewRun) => void
  },
): Promise<Attempt> {
  const { step, executable, started, hardStop, input, getRun, setRun } = spec
  const lastMessage = `${step.file}.last`
  const progress = makeThrottledProgress(ctx, task, step.by, getRun, setRun)
  const outcome: Outcome =
    executable === null
      ? { code: 127, stdout: [], stderr: `${step.name} is not on PATH`, timedOut: false }
      : await runReviewer(
          task,
          reviewCommand(
            step.by,
            executable,
            step.model,
            task.repoRoot,
            lastMessage,
            point === "plan" ? shotPaths(await mockupShots(ctx, task)) : [],
            step.effort,
          ),
          await briefFor(ctx, task, point, step.kind, { input, recoveryHead: step.recoveryHead }),
          hardStop,
          progress.seen,
          step.by,
          await agentFolders(ctx),
          step.effort,
        )
  await recordReviewCost(
    ctx,
    task,
    {
      point: point as ReviewCost["point"],
      by: step.by,
      name: step.name,
      model: step.model,
      started,
      ended: ctx.clock.now(),
    },
    outcome.stdout.join("\n"),
  )
  await progress.stop()
  let answer = answerOf(step.by, outcome.stdout).trim()
  if (step.by === "codex" && (await ctx.fs.exists(lastMessage))) {
    answer = (await ctx.fs.readFile(lastMessage)).trim()
    await ctx.fs.remove(lastMessage)
  }
  const good = !outcome.timedOut && outcome.code === 0 && answer !== ""
  return { step, outcome, answer, good, reason: failureReason(step.name, outcome) }
}

function formatAttemptFailure(a: Attempt): string {
  const tail = (a.outcome.stderr || a.outcome.stdout.join("\n"))
    .trim()
    .split("\n")
    .slice(-20)
    .join("\n")
  return `The review did not complete (exit ${a.outcome.code}). What ${a.step.name} reported:\n\n\`\`\`\n${tail}\n\`\`\``
}

function formatSingleBody(
  point: ReviewPoint,
  attempts: readonly Attempt[],
  hardStop: number,
): { heading: string; body: string; verdict: string | null } {
  const last = attempts[attempts.length - 1] as Attempt
  const earlier = attempts[0] as Attempt
  const { step, outcome, answer, good } = last
  const verdict = good ? (answer.match(/^(APPROVE|REVISE[^\n]*|BLOCK[^\n]*)/m)?.[1] ?? null) : null
  const label = point === "verify" ? "Verification" : point[0]?.toUpperCase() + point.slice(1)
  const heading = `# ${label} review by ${step.name} (${step.model} · ${step.effort ?? REVIEW_EFFORT})`
  const lead =
    attempts.length > 1 && (good || outcome.timedOut)
      ? `The first review, by ${earlier.step.name}, could not run (${earlier.reason}); ${step.name} read it instead.\n\n`
      : ""
  const timeoutTail = answer !== "" ? `\n\nWhat ${step.name} had said:\n\n${answer}` : ""
  const body = outcome.timedOut
    ? `${lead}The review timed out after ${minutesText(hardStop)}, no findings.${timeoutTail}`
    : good
      ? `${lead}${answer}`
      : attempts.map(formatAttemptFailure).join("\n\n")
  return { heading, body, verdict }
}

async function settleSingleReview(
  ctx: Ctx,
  task: Task,
  spec: {
    point: ReviewPoint
    run: ReviewRun
    attempts: readonly Attempt[]
    hardStop: number
  },
): Promise<Result<CrossReviewResult>> {
  const { point, run, attempts, hardStop } = spec
  const last = attempts[attempts.length - 1] as Attempt
  const { step, outcome, answer, good } = last
  const { heading, body, verdict } = formatSingleBody(point, attempts, hardStop)
  await ctx.fs.writeFile(step.file, `${heading}\n\n${body}\n`)
  const causes = [...new Set(attempts.map((a) => a.reason))]
  const reason =
    causes.length === 1 && attempts.length > 1
      ? `${causes[0]} (tried twice)`
      : causes.join("; then ")
  const settled: ReviewRun = {
    ...run,
    state: outcome.timedOut ? "timed_out" : good ? "done" : "failed",
    ended: ctx.clock.now(),
    ...(good ? { findings: verdict === "APPROVE" ? 0 : findingsIn(answer) } : {}),
    ...(!good && !outcome.timedOut ? { reason } : {}),
  }
  await writeRun(ctx, task, settled)
  if (settled.state === "done" && settled.ended !== undefined) {
    await recordDuration(ctx, reviewKind(point, step.by), settled.ended - settled.started)
  }
  return ok({ ...handleOf(task, settled), completed: good, timedOut: outcome.timedOut, verdict })
}

function buildRunningRecord(
  point: ReviewPoint,
  step: CrossReviewStep,
  started: number,
  why: string | undefined,
  input?: PlanReviewInput,
): ReviewRun {
  return {
    point,
    by: step.by,
    name: step.name,
    model: step.model,
    state: "running",
    started,
    pid: process.pid,
    ...(input !== undefined ? { planInput: input.digest } : {}),
    ...(step.kind !== undefined ? { kind: step.kind } : {}),
    ...(why !== undefined ? { why } : {}),
  }
}

async function runCrossReviewWithInput(
  ctx: Ctx,
  task: Task,
  point: ReviewPoint,
  decided: CrossReviewStep | null,
  input?: PlanReviewInput,
): Promise<Result<CrossReviewResult>> {
  const first = decided ?? (await crossReviewStep(ctx, task, point))
  if (first === null) {
    return err({
      code: "bad_args",
      message:
        `no review by the other agent is set for ${point}: it runs when the Plan is risky or the ` +
        `task asks for it, with another agent installed and signed in; its models are in the App's ` +
        `Settings › Workflow › Second opinion (${await whyNoReview(ctx, task, point)})`,
    })
  }
  if (first.panel !== undefined && first.panel.length >= 2) {
    return runPanelReview(ctx, task, {
      step: first,
      seats: first.panel,
      input,
      runFallback: (fallback) => runCrossReviewWithInput(ctx, task, "plan", fallback, input),
    })
  }
  const binary = await reviewerBinary(ctx, first.by)
  if (binary === null) return err({ code: "bad_args", message: `${first.name} is not on PATH` })
  await ctx.fs.mkdir(join(task.dir, REVIEWS_DIR))
  const hardStop = hardStopMs(ctx, point)
  const gateRun = await readRun(ctx, task, point)
  let run = buildRunningRecord(
    point,
    first,
    gateRun?.started ?? ctx.clock.now(),
    first.why ?? gateRun?.why,
    input,
  )
  await writeRun(ctx, task, run)
  const getRun = () => run
  const setRun = (next: ReviewRun) => {
    run = next
  }
  const attempts: Attempt[] = [
    await runSingleAttempt(ctx, task, point, {
      step: first,
      executable: binary,
      started: run.started,
      hardStop,
      input,
      getRun,
      setRun,
    }),
  ]
  const again = await secondStep(ctx, task, first, attempts[0] as Attempt)
  if (again !== null) {
    const step = first.recoveryHead
      ? { ...again, file: first.file, recoveryHead: first.recoveryHead }
      : again
    run = buildRunningRecord(point, step, run.started, step.why, input)
    await writeRun(ctx, task, run)
    attempts.push(
      await runSingleAttempt(ctx, task, point, {
        step,
        executable: await reviewerBinary(ctx, step.by),
        started: ctx.clock.now(),
        hardStop,
        input,
        getRun,
        setRun,
      }),
    )
  }
  return settleSingleReview(ctx, task, { point, run, attempts, hardStop })
}

/** Run the other agent's review now and write it beside the plan. */
export async function runCrossReview(
  ctx: Ctx,
  task: Task,
  point: ReviewPoint,
  /** The review the gate that started this worker decided on; none when a person runs the command. */
  decided: CrossReviewStep | null = null,
): Promise<Result<CrossReviewResult>> {
  const input = point === "plan" ? await capturePlanReviewInput(ctx, task) : undefined
  try {
    return await runCrossReviewWithInput(ctx, task, point, decided, input)
  } finally {
    await input?.close()
  }
}
