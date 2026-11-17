// An independent review by the other agent, the second opinion: Claude Code
// reviews Codex's work and Codex reviews Claude Code's, of the Plan and of the
// built change, when the user switched it on (it is off by default).
// Opening the gate that stands in front of a point starts the reviewer itself,
// detached, headless and read-only, on the model from the settings and at high
// effort. It keeps its state and its answer beside the plan, so the user reads
// and comments meanwhile and the working agent folds the findings in when they
// arrive. No second session has to be open.

import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { dirname, join } from "node:path"
import { phaseText } from "#workflow"
import type { Ctx } from "../../ctx.ts"
import { err, ok, type Result } from "../../ctx.ts"
import {
  agentBinary,
  BINARY_VARIABLES,
  configuredBinary,
  namedBinary,
  type Reviewer,
} from "../agents/binary.ts"
import { configDirEnvironment, configDirVariable } from "../agents/config-dir.ts"
import { sessionAgentBinary } from "../agents/detect.ts"
import { AGENT_NAMES, isNativeAgent, NATIVE_AGENTS, validModelId } from "../agents/ids.ts"
import { modelMaker } from "../agents/model-maker.ts"
import { modelName } from "../agents/model-values.ts"
import { freshSessionWhy, PANEL_SEATS } from "../agents/reviewer-pick.ts"
import { parseArtifactReference } from "../artifact/reference.ts"
import { artifactReferenceSource } from "../artifact/reference-source.ts"
import { contextOf } from "../build-package.ts"
import { type CrossReviewPoint, readConfig } from "../config.ts"
import { DEFAULT_CONFIG, SESSION_MODEL } from "../config-values.ts"
import { type ReviewCost, recordReviewCost } from "../cost/reviews.ts"
import { parseMarkers } from "../docs/markers.ts"
import { NAMES as FILE_NAMES, folderDoc, REVIEWS_DIR } from "../docs/names.ts"
import { artifactPath, extractFences } from "../docs/visuals.ts"
import { readComments } from "../gate/comments.ts"
import { buildBase } from "../git/base.ts"
import { readBuildStart } from "../git/build-start.ts"
import { type TaskCommitDiff, taskCommitDiff, taskDiffArgs } from "../git/task-diff.ts"
import { PANEL_REVIEW_KIND, recordDuration, reviewKind } from "../helper-history.ts"
import { instructionsSection } from "../instructions.ts"
import { nativeCommand, windows } from "../platform.ts"
import { pidAlive, selfCommand } from "../self.ts"
import { shellQuote } from "../shell.ts"
import { reviewFindings } from "../task/items.ts"
import { readSession, type Task } from "../task/store.ts"
import { taskFlow } from "../task-flow.ts"
import { codeDiff } from "../verification.ts"
import { type Checkout, disposableCheckout, needsCheckout } from "./checkout.ts"
import { copyMs } from "./copy-limits.ts"
import { answerOf, progressOf } from "./events.ts"
import { type Delivery, deliverBrief, hasHeadlessReview, headlessCommand } from "./headless.ts"
import { guardOf } from "./headless-events.ts"
import { mockupSection, mockupShots, shotPaths } from "./mockup-shots.ts"
import { opencodeReviewEnvironment } from "./native-environment.ts"
import { type PanelProgress, type PanelSeat, runPanel } from "./panel.ts"
import { capturePlanReviewInput, type PlanReviewInput } from "./plan-input.ts"
import { plannerEfforts, readPlanners } from "./planners.ts"
import { type ProcessResult, runProcess } from "./reviewer-process.ts"
import { stopStrayWorkers } from "./stray-workers.ts"
import { installedAgents, type SelectedReviewer, selectedReviewer } from "./vendors.ts"

export type { Reviewer }

const NAMES = AGENT_NAMES
/** Every review thinks at high effort; it is no setting. An extra planner reads at its own. */
const REVIEW_EFFORT = "high"
const MINUTE = 60_000

/**
 * What a review reads: the Plan (`plan`), the built change at the final gate (`verify`), or the
 * Outline and the first finished slices while the rest is still being built (`build`). Only the
 * first two stand in front of a gate; `build` runs beside Implement and blocks nothing.
 */
export type ReviewPoint = CrossReviewPoint | "build"

/** Minutes the reviewer is told it has, and the minutes after which the CLI stops it. */
const HARD_STOP_MINUTES: Record<ReviewPoint, number> = { plan: 12, verify: 12, build: 12 }

/** The hard stop of a point; tests shorten it with QUALITYLAYER_REVIEW_TIMEOUT_MS. */
export function hardStopMs(ctx: Ctx, point: ReviewPoint): number {
  const override = Number(ctx.env.get("QUALITYLAYER_REVIEW_TIMEOUT_MS"))
  return Number.isFinite(override) && override > 0 ? override : HARD_STOP_MINUTES[point] * MINUTE
}

function minutesText(ms: number): string {
  return ms >= MINUTE ? `${Math.round(ms / MINUTE)} min` : `${Math.max(1, Math.round(ms / 1000))} s`
}

/** The gate each review point stands in front of (gate.ts names the last one FINAL). */
export const POINT_TARGET: Record<CrossReviewPoint, string> = {
  plan: FILE_NAMES.plan,
  verify: "final",
}

export function pointFor(target: string): CrossReviewPoint | null {
  const entry = Object.entries(POINT_TARGET).find(([, t]) => t === target)
  return entry !== undefined ? (entry[0] as CrossReviewPoint) : null
}

export { installedAgents }

/** The variable each agent has that moves its folder (`configDirEnv` in `agents.json`). */
const CONFIG_DIR_VARIABLES = NATIVE_AGENTS.flatMap((agent) => configDirVariable(agent) ?? [])

/**
 * The environment of the detached review worker: the parent's actual HOME, USERPROFILE, PATH,
 * provider, runtime and session fields (Windows names matched without case), then the executable
 * the session runs, when no variable already names one.
 */
export async function reviewWorkerEnv(
  ctx: Ctx,
  admitted: readonly Reviewer[],
  step: Pick<CrossReviewStep, "by">,
): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.toUpperCase() === "QUALITYLAYER_RUN") delete env[key]
  for (const name of [
    "HOME",
    "USERPROFILE",
    "PATH",
    ...CONFIG_DIR_VARIABLES,
    "PI_CODING_AGENT_SESSION_DIR",
    "OPENCODE_DB",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "QUALITYLAYER_HOME",
    "QUALITYLAYER_TASK",
    "QUALITYLAYER_REVIEW_TIMEOUT_MS",
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CODEX_THREAD_ID",
    ...Object.values(BINARY_VARIABLES),
    "QUALITYLAYER_SESSION_BINARY",
  ]) {
    for (const key of Object.keys(env))
      if (key === name || (windows && key.toUpperCase() === name)) delete env[key]
    const value = ctx.env.get(name)
    if (value !== undefined) env[name] = value
  }
  // The worker outlives this command, so its parents are gone: it learns now which executable
  // the session runs, and starts that one.
  const session = await sessionBinaryEnv(ctx, admitted)
  // The reviewer this command chose runs from the executable it just found: the worker does not
  // look for it again along a PATH of its own.
  const chosen = await reviewerBinary(ctx, step.by)
  const own =
    chosen !== null && namedBinary(ctx, step.by) === null
      ? { [BINARY_VARIABLES[step.by]]: chosen }
      : {}
  // The folders Settings names for the agents stand where the environment names none.
  const folders = configDirEnvironment(ctx.env, (await readConfig(ctx)).agents)
  return { ...folders, ...env, ...session, ...own }
}

/**
 * The executable a review starts for `agent`: the path the environment names, else the command
 * the person set in Settings, else the executable of the session that started the review (a
 * wrapper launcher or guard that comes first on PATH refuses under a temporary HOME or inside a
 * sandbox, and the session never used it), else PATH.
 */
export async function reviewerBinary(
  ctx: Ctx,
  agent: Reviewer,
  session: () => { agent: string; path: string } | null = () => sessionAgentBinary(ctx.env),
): Promise<string | null> {
  const named = namedBinary(ctx, agent)
  if (named !== null) return named
  if ((await configuredBinary(ctx, agent)) !== "") return agentBinary(ctx, agent)
  const own = session()
  if (own !== null && own.agent === agent) return own.path
  return agentBinary(ctx, agent)
}

export function reviewFile(task: Pick<Task, "dir">, point: ReviewPoint): string {
  return join(task.dir, REVIEWS_DIR, `${point}.md`)
}

/**
 * `sonnet`: no second vendor can run, so a fresh reviewer of the working agent's own vendor reads the
 * Plan. `same-family`: another agent reviews, but its model is of the builder's maker (no other
 * maker's model is available).
 */
export type ReviewKind = "sonnet" | "same-family"

/** A seat of a Plan's review panel: an agent this computer can run, on its reviewing model. */
export type ReviewSeat = PanelSeat & { by: Reviewer }

export type CrossReviewStep = {
  point: ReviewPoint
  by: Reviewer
  name: string
  model: string
  /** The effort it reads at: an extra planner's own choice; every other review's is `REVIEW_EFFORT`. */
  effort?: string
  file: string
  kind?: ReviewKind
  /** Why this reviewer: "Codex (GPT) checks Claude's work." */
  why?: string
  /**
   * A Plan's review panel (the task's extra planners): two or three seats that review side by side
   * and answer each other once. `by` and `model` are then the first seat's, `name` every seat's.
   */
  panel?: ReviewSeat[]
}

/** "Codex", "Codex and Grok", "Codex, Grok and Pi". */
function namesOf(seats: readonly PanelSeat[]): string {
  const names = seats.map((s) => s.name)
  return names.length < 3
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

/** The panel's review as a step: the worker runs both rounds and writes the one review file. */
function panelStep(task: Task, seats: ReviewSeat[]): CrossReviewStep {
  const first = seats[0] as ReviewSeat
  return {
    point: "plan",
    by: first.by,
    name: namesOf(seats),
    model: first.model,
    file: reviewFile(task, "plan"),
    why: `A panel reads the Plan: ${namesOf(seats)}.`,
    panel: seats,
  }
}

/**
 * The Plan's review in a task (D8, D18): the other vendor's second opinion when it can run,
 * else a fresh reviewer of the working agent's own vendor on its helpers' model (Sonnet for Claude
 * Code), else none. Whether one runs at all is the flow's `planReview` (Settings › Second opinion
 * › On the Plan, and the task's own words).
 */
async function planReviewStep(ctx: Ctx, task: Task): Promise<CrossReviewStep | null> {
  if ((await taskFlow(ctx, task)).flow.planReview === "none") return null
  const config = await readConfig(ctx)
  const working = (await readSession(ctx, task))?.agent ?? "unknown"
  const installed = await installedAgents(ctx)
  // The task's extra planners (`task start --planners`) read the Plan on the models and efforts the
  // person chose: two answer each other once as a panel, one reviews alone. One that cannot run here
  // is left out; with none left the review is picked as before.
  const extra = (await readPlanners(ctx, task)).filter((p) => installed.includes(p.agent))
  if (extra.length >= 2)
    return panelStep(
      task,
      extra.map((p) => ({
        by: p.agent,
        name: NAMES[p.agent],
        model: p.model,
        ...(p.effort !== undefined ? { effort: p.effort } : {}),
      })),
    )
  const only = extra[0]
  if (only !== undefined)
    return {
      point: "plan",
      by: only.agent,
      name: NAMES[only.agent],
      model: only.model,
      ...(only.effort !== undefined ? { effort: only.effort } : {}),
      file: reviewFile(task, "plan"),
      why: `${NAMES[only.agent]} reads the Plan as this task's extra planner.`,
    }
  const other = await selectedReviewer(ctx, working, task)
  if (other !== null && installed.includes(other.agent)) return stepOf("plan", task, other)
  return sameVendorStep(task, config, working, installed)
}

/** The review a pick stands for: who, on which model, and why. */
function stepOf(point: ReviewPoint, task: Task, pick: SelectedReviewer): CrossReviewStep {
  return {
    point,
    by: pick.agent,
    name: NAMES[pick.agent],
    model: pick.model,
    file: reviewFile(task, point),
    why: pick.why,
    ...(pick.sameFamily ? { kind: "same-family" as const } : {}),
  }
}

/** The Plan's fresh reviewer of the working agent's own vendor, when that agent can run here. */
function sameVendorStep(
  task: Task,
  config: Awaited<ReturnType<typeof readConfig>>,
  working: string,
  installed: Reviewer[],
): CrossReviewStep | null {
  if (!isNativeAgent(working) || !installed.includes(working)) return null
  // "No subagents" is the session's own model: a reviewer needs a model of its own.
  const configured = config.models[working].helpers
  const model = configured === SESSION_MODEL ? DEFAULT_CONFIG.models[working].helpers : configured
  return {
    point: "plan",
    by: working,
    name: modelName(working, model),
    model,
    file: reviewFile(task, "plan"),
    kind: "sonnet",
    why: freshSessionWhy(working, modelMaker(model)),
  }
}

/**
 * What runs when a review could not (D19): the Plan's other-vendor review falls back to a fresh
 * reviewer of the working agent's own vendor (D18); anything else is tried once more as it was.
 */
async function retryStep(ctx: Ctx, task: Task, failed: CrossReviewStep): Promise<CrossReviewStep> {
  if (failed.point === "plan" && failed.kind !== "sonnet") {
    const working = (await readSession(ctx, task))?.agent ?? "unknown"
    const fallback = sameVendorStep(
      task,
      await readConfig(ctx),
      working,
      await installedAgents(ctx),
    )
    if (fallback !== null) return fallback
  }
  return failed
}

/**
 * The command line of the detached worker a gate starts. It carries the review the gate decided on
 * (who reviews, on which model), so the worker runs that review rather than working it out again
 * from its own look at the machine, which a detached process on another system may see differently.
 */
export function reviewWorkerArguments(
  task: Pick<Task, "slug">,
  step: Pick<CrossReviewStep, "point" | "by" | "model" | "effort" | "kind" | "panel">,
): string[] {
  return [
    "review",
    step.point,
    "--task",
    task.slug,
    "--by",
    step.by,
    "--model",
    step.model,
    ...(step.effort !== undefined && step.panel === undefined ? ["--effort", step.effort] : []),
    ...(step.kind !== undefined ? ["--kind", step.kind] : []),
    // The panel the draft decided on: `codex=gpt-6.1-sol,grok=grok-4.7`, a seat's own effort after
    // its agent (`codex:medium=gpt-6.1-sol`).
    ...(step.panel !== undefined
      ? [
          "--panel",
          step.panel
            .map(
              (seat) =>
                `${seat.by}${seat.effort !== undefined ? `:${seat.effort}` : ""}=${seatModel(seat.model)}`,
            )
            .join(","),
        ]
      : []),
  ]
}

/** An effort the worker was told for this agent's review: a level the agent takes. */
const reviewEffortOf = (agent: Reviewer, effort: string): boolean =>
  plannerEfforts(agent).includes(effort)

/**
 * A seat's model as `--panel` carries it. Commas separate the seats, so a comma inside a model
 * (Cursor's `claude-opus-4-8[context=1m,effort=high]`) travels as `%2C`, and a `%` as `%25`.
 */
const seatModel = (model: string) =>
  model.replace(/[%,]/g, (sign) => (sign === "," ? "%2C" : "%25"))
const modelOfSeat = (sent: string) =>
  sent.replace(/%(2C|25)/g, (_, code: string) => (code === "2C" ? "," : "%"))

/** The seats `--panel` names, or the sentence that says what is wrong with it. */
function seatsOf(value: string | true): ReviewSeat[] | string {
  const wrong = "--panel names two or three reviewers as agent[:effort]=model, separated by commas"
  if (value === true) return wrong
  const seats: ReviewSeat[] = []
  for (const part of value.split(",")) {
    const at = part.indexOf("=")
    const [by, effort, ...rest] = part.slice(0, at).split(":")
    const model = modelOfSeat(part.slice(at + 1))
    if (at < 1 || rest.length > 0 || !isNativeAgent(by) || !validModelId(by, model)) return wrong
    if (effort !== undefined && !reviewEffortOf(by, effort)) return wrong
    if (seats.some((seat) => seat.by === by)) return wrong
    seats.push({ by, name: NAMES[by], model, ...(effort !== undefined ? { effort } : {}) })
  }
  return seats.length >= 2 && seats.length <= PANEL_SEATS ? seats : wrong
}

/** The agents `--by` accepts, as a phrase: `claude-code, codex or pi`. */
function reviewerNames(): string {
  return `${NATIVE_AGENTS.slice(0, -1).join(", ")} or ${NATIVE_AGENTS.at(-1)}`
}

/**
 * The review a worker was told to run, from the flags of `review <point>`: null when it was told
 * none (a person ran the command, so the worker decides), an error for flags that do not make a
 * review. The model is a plain name: it reaches the reviewer's command line.
 */
export function decidedStepOf(
  task: Pick<Task, "dir">,
  point: ReviewPoint,
  flags: Record<string, string | true>,
): Result<CrossReviewStep | null> {
  const { by, model, kind, panel, effort } = flags
  if (
    by === undefined &&
    model === undefined &&
    kind === undefined &&
    panel === undefined &&
    effort === undefined
  )
    return ok(null)
  if (panel !== undefined) {
    const seats = seatsOf(panel)
    if (typeof seats === "string") return err({ code: "bad_args", message: seats })
    if (point !== "plan")
      return err({ code: "bad_args", message: "--panel belongs to the Plan's review" })
    const first = seats[0] as ReviewSeat
    return ok({
      point,
      by: first.by,
      name: namesOf(seats),
      model: first.model,
      file: reviewFile(task, point),
      panel: seats,
    })
  }
  if (!isNativeAgent(by))
    return err({ code: "bad_args", message: `--by names the reviewer: ${reviewerNames()}` })
  if (!validModelId(by, model))
    return err({ code: "bad_args", message: "--model names the reviewer's model, as one word" })
  if (kind !== undefined && kind !== "sonnet" && kind !== "same-family")
    return err({ code: "bad_args", message: "--kind is sonnet or same-family, or left out" })
  if (effort !== undefined && (effort === true || !reviewEffortOf(by, effort)))
    return err({
      code: "bad_args",
      message: "--effort names an effort the reviewer takes, or is left out",
    })
  return ok({
    point,
    by,
    name: kind === "sonnet" ? modelName(by, model) : NAMES[by],
    model,
    ...(effort !== undefined ? { effort } : {}),
    file: reviewFile(task, point),
    ...(kind !== undefined ? { kind } : {}),
  })
}

/** A review that stands in front of a gate: the Plan's or the built change's. */
type GateStep = CrossReviewStep & { point: CrossReviewPoint }
type GateRun = ReviewRun & { point: CrossReviewPoint }

/** The review this point asks for, or null when it is off or no other agent can run it. */
export function crossReviewStep(
  ctx: Ctx,
  task: Task,
  point: CrossReviewPoint,
): Promise<GateStep | null>
export function crossReviewStep(
  ctx: Ctx,
  task: Task,
  point: ReviewPoint,
): Promise<CrossReviewStep | null>
export async function crossReviewStep(
  ctx: Ctx,
  task: Task,
  point: ReviewPoint,
): Promise<CrossReviewStep | null> {
  if (point === "plan") return planReviewStep(ctx, task)
  if (!(await taskFlow(ctx, task)).flow.changeSecondOpinion) return null
  const session = await readSession(ctx, task)
  const pick = await selectedReviewer(ctx, session?.agent ?? "unknown", task)
  if (pick === null) return null
  if (!(await installedAgents(ctx)).includes(pick.agent)) return null
  return stepOf(point, task, pick)
}

// --- the state of a running review, kept in the task's runtime folder --------

export type ReviewState = "running" | "done" | "failed" | "timed_out"

export type ReviewRun = {
  point: ReviewPoint
  by: Reviewer
  name: string
  model: string
  state: ReviewState
  started: number
  ended?: number
  /** Why this reviewer: "Codex (GPT) checks Claude's work." Absent when a person ran the review. */
  why?: string
  /** The findings in the answer, when it has any to count. */
  findings?: number
  /** What the reviewer is doing now. */
  line?: string
  /** Why a review that could not run did not, in plain words (the details are in the review file). */
  reason?: string
  at?: number
  /** The process doing the work. */
  pid?: number
  /** `sonnet` and `same-family`: see `ReviewKind`. */
  kind?: ReviewKind
  /** A panel's round and how each member stands; absent for a single review. */
  panel?: PanelProgress
  /** Digest of the Plan documents supplied to the reviewer. Older records have no binding. */
  planInput?: string
}

const runPath = (task: Pick<Task, "runtimeDir">, point: ReviewPoint) =>
  join(task.runtimeDir, `review-${point}.json`)
const runLockPath = (task: Pick<Task, "runtimeDir">, point: ReviewPoint) =>
  join(task.runtimeDir, `review-${point}.lock`)
const startupPath = (task: Pick<Task, "runtimeDir">, point: ReviewPoint, started: number) =>
  join(task.runtimeDir, `review-${point}-${started}-startup.log`)

async function writeRun(ctx: Ctx, task: Pick<Task, "runtimeDir">, run: ReviewRun): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.withLock(runLockPath(task, run.point), () => writeRunRecord(ctx, task, run), {
    createParent: false,
    label: "updating review state",
  })
}

async function writeRunRecord(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  run: ReviewRun,
): Promise<void> {
  await ctx.fs.atomicWrite(runPath(task, run.point), `${JSON.stringify(run, null, 2)}\n`)
}

async function storedRun(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  point: ReviewPoint,
): Promise<ReviewRun | null> {
  const path = runPath(task, point)
  if (!(await ctx.fs.exists(path))) return null
  try {
    return JSON.parse(await ctx.fs.readFile(path)) as ReviewRun
  } catch {
    return null
  }
}

/** A review's state; one whose process ended without an answer counts as failed. */
export async function readRun(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  point: ReviewPoint,
): Promise<ReviewRun | null> {
  const run = await storedRun(ctx, task, point)
  if (run === null) return null
  // The process ended without writing an answer (killed, crashed): the review is over.
  if (run.state === "running" && run.pid !== undefined && !pidAlive(run.pid)) {
    return ctx.fs.withLock(
      runLockPath(task, point),
      async () => {
        const current = await storedRun(ctx, task, point)
        if (
          current === null ||
          current.started !== run.started ||
          current.pid !== run.pid ||
          current.state !== "running" ||
          current.pid === undefined ||
          pidAlive(current.pid)
        )
          return current
        const log = startupPath(task, point, current.started)
        const size = await ctx.fs.stat?.(log)
        const reason = (await ctx.fs.exists(log))
          ? (ctx.fs.readRange && size
              ? await ctx.fs.readRange(log, Math.max(0, size.size - 4096), 4096)
              : (await ctx.fs.readFile(log)).slice(-4096)
            ).trim()
          : ""
        const failed: ReviewRun = {
          ...current,
          state: "failed",
          ended: ctx.clock.now(),
          reason: `${current.name} stopped before it answered`,
          ...(reason ? { line: `Review worker stopped before its report: ${reason}` } : {}),
        }
        await writeRunRecord(ctx, task, failed)
        return failed
      },
      { createParent: false, label: "updating review state" },
    )
  }
  return run
}

/** A finished Plan review returns to its planner, rather than creating human decision cards. */
export async function planReviewWork(ctx: Ctx, task: Task) {
  const run = await readRun(ctx, task, "plan")
  if (run === null || run.state === "running") return null
  const file = reviewFile(task, "plan")
  const text = (await ctx.fs.exists(file)) ? await ctx.fs.readFile(file) : ""
  const found = run.state === "done" ? reviewFindings(text) : []
  // A finding every reviewer of a panel backs is the person's to keep: the planner takes it or asks
  // them (`Answer: Ask`), and Kept settles it only once they picked the keep choice of a question
  // that names it. The change choice leaves Kept unsettled, and so do their own typed words: the
  // gate cannot read whether they mean keep or change, so the planner takes the finding or asks
  // again with the two choices (Max, 10 November 2026: the person's answer binds).
  const answers = found.some((f) => f.stance === "kept" && f.panel?.backing === "all")
    ? await readComments(ctx, task)
    : []
  const keptByPerson = (n: number) => {
    const kind = answers.findLast(
      (c) => c.item === `plan:finding:${n}` && c.kind !== undefined,
    )?.kind
    return kind === "keep"
  }
  const unanimousKept = found.flatMap((finding, index) =>
    finding.stance === "kept" && finding.panel?.backing === "all" && !keptByPerson(index + 1)
      ? [index + 1]
      : [],
  )
  const pending = found.filter(
    (finding, index) =>
      (finding.stance !== "taken" && finding.stance !== "kept") ||
      unanimousKept.includes(index + 1),
  )
  return { run, file, pending, unanimousKept }
}

export const PLAN_REVIEW_HANDOFF =
  'Answer each finding of the review under it (Answer: Taken · <what changed>, Answer: Kept · <why>, or Answer: Ask · <the question> for one only the person can decide), then open the Plan gate again. A finding marked `Panel: all` is backed by every reviewer: answer it Taken, or Ask and put the question to the person; Kept settles it only after they picked the question\'s keep choice (`"kind": "keep"`); after the change choice take it, and after their own typed words take it or ask again with the two choices.'

/** What to do about findings every reviewer backs that the planner kept on its own; "" when none. */
export function unanimousKeptLine(numbers: readonly number[]): string {
  if (numbers.length === 0) return ""
  const which =
    numbers.length === 1 ? `Finding ${numbers[0]} is` : `Findings ${numbers.join(", ")} are`
  return ` ${which} backed by every reviewer and cannot be kept without the person: answer Taken, or Answer: Ask · <the question> and ask them. Kept counts once they picked that question's keep choice ("kind": "keep", "settles": ["plan:finding:<n>"]); after the change choice take the finding, and after their own typed words take it or ask again with the two choices.`
}

/** The reviews this task has started, for the Cockpit's status box. */
export async function reviewRuns(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<ReviewRun[]> {
  const runs: ReviewRun[] = []
  for (const point of Object.keys(POINT_TARGET) as CrossReviewPoint[]) {
    const run = await readRun(ctx, task, point)
    if (run !== null) runs.push(run)
  }
  return runs
}

/** What `gate open` and `next` hand the agent for a review in flight. */
export type ReviewHandle = {
  point: ReviewPoint
  by: Reviewer
  name: string
  model: string
  state: ReviewState
  file: string
  started: number
  status: string
  instructions: string
  /** Set when the review did not complete: why, in plain words. */
  reason?: string
  /** Blocks (run it in the background) until the review is done or timed out. */
  wait: string
  /** `sonnet` and `same-family`: see `ReviewKind`. */
  kind?: ReviewKind
  /** Why this reviewer, when the review's record says. */
  why?: string
}

/** Who reviews, as a sentence's subject: a panel's name is a list, so the sentence is about the panel. */
export const reviewerOf = (run: Pick<ReviewRun, "name" | "panel">): string =>
  run.panel !== undefined ? `The panel (${run.name})` : run.name

export function handleOf(
  task: Pick<Task, "dir"> & Partial<Pick<Task, "stage">>,
  run: ReviewRun,
): ReviewHandle {
  const file = reviewFile(task, run.point)
  const wait = "qualitylayer wait --for review"
  const who = reviewerOf(run)
  const status =
    run.state === "running"
      ? `${who} is reviewing`
      : run.state === "done"
        ? `${who}'s review is in`
        : `${who}'s review ${run.state === "timed_out" ? "timed out" : "did not complete"}`
  // Facts only: what the agent does with the findings is its step's text.
  const instructions =
    run.state === "running"
      ? `${status} in the background; \`${wait}\` returns its result (run it in the background).`
      : run.state === "done"
        ? `${status}: answer each finding in ${file} with Answer: Taken · <what changed> or Answer: Kept · <why>${run.panel !== undefined ? ", or Answer: Ask · <the question> for one only the person can decide" : ""}.`
        : `${run.state === "failed" ? couldNotRunLine(run) : status}; the second opinion is advice, not an approval. Details: ${file}.`
  return {
    point: run.point,
    by: run.by,
    name: run.name,
    model: run.model,
    state: run.state,
    file,
    wait,
    started: run.started,
    status,
    instructions,
    ...(run.state === "failed" ? { reason: reasonOf(run) } : {}),
    ...(run.kind !== undefined ? { kind: run.kind } : {}),
    ...(run.why !== undefined ? { why: run.why } : {}),
  }
}

/** Why a review that did not complete did not, in plain words. */
export const reasonOf = (run: Pick<ReviewRun, "name" | "reason">): string =>
  run.reason ?? `${run.name} stopped before it answered`

/**
 * What a gate's reply starts with when its review could not run (D19), so the agent tells the
 * person before anything else; nothing for a review in any other state.
 */
export function couldNotRunLead(
  review: Pick<ReviewRun, "state" | "point" | "name" | "reason"> | null | undefined,
): string {
  return review?.state === "failed"
    ? `${couldNotRunLine(review)}. Tell the person so in one plain line before anything else: ` +
        "the page says it too, and the details are in `reviews[0].file`. "
    : ""
}

/** The one plain line a review that could not run puts on the page and in the agent's reply. */
export function couldNotRunLine(run: Pick<ReviewRun, "point" | "name" | "reason">): string {
  const what =
    run.point === "plan"
      ? "The Plan review"
      : run.point === "build"
        ? "The review of the first finished slices"
        : "The second opinion on the change"
  return `${what} could not run: ${reasonOf(run)}`
}

/** "Approve unlocks when the Codex review is in (running 4:12)", or once the agent has read it. */
export function lockReason(run: ReviewRun, now: number): string {
  // A panel is named as one, with the round it is in; one reviewer by its name, as before.
  const whose = run.panel !== undefined ? "panel's" : run.name
  if (run.state !== "running") {
    return `Approve unlocks when the agent has read the ${whose} review and opened the gate again`
  }
  const seconds = Math.max(0, Math.floor((now - run.started) / 1000))
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  return run.panel !== undefined
    ? `Approve unlocks when the panel's review is in (round ${run.panel.round} of 2, running ${clock})`
    : `Approve unlocks when the ${run.name} review is in (running ${clock})`
}

/**
 * Start the review a ready document asks for, once per point: a review that
 * already ran, ran out of time or failed is not started again, and a gate
 * opened a second time finds its answer.
 */
export function startReview(ctx: Ctx, task: Task, step: GateStep): Promise<GateRun>
export function startReview(ctx: Ctx, task: Task, step: CrossReviewStep): Promise<ReviewRun>
export async function startReview(ctx: Ctx, task: Task, step: CrossReviewStep): Promise<ReviewRun> {
  const known = await readRun(ctx, task, step.point)
  if (known !== null) return known
  // A review written by hand before reviews started themselves is an answer too.
  if (await ctx.fs.exists(step.file)) {
    const answered: ReviewRun = {
      point: step.point,
      by: step.by,
      name: step.name,
      model: step.model,
      state: "done",
      started: ctx.clock.now(),
      ended: ctx.clock.now(),
      ...(step.kind !== undefined ? { kind: step.kind } : {}),
      ...(step.why !== undefined ? { why: step.why } : {}),
    }
    await writeRun(ctx, task, answered)
    return answered
  }
  const run: ReviewRun = {
    point: step.point,
    by: step.by,
    name: step.name,
    model: step.model,
    state: "running",
    started: ctx.clock.now(),
    ...(step.kind !== undefined ? { kind: step.kind } : {}),
    ...(step.why !== undefined ? { why: step.why } : {}),
    ...(step.panel !== undefined
      ? {
          panel: {
            round: 1 as const,
            members: step.panel.map((seat) => ({ ...seat, round1: "running" as const })),
          },
        }
      : {}),
  }
  try {
    const [command, ...args] = selfCommand(reviewWorkerArguments(task, step))
    const [program, ...parameters] = nativeCommand(command as string, args)
    await ctx.fs.mkdir(task.runtimeDir)
    const log = startupPath(task, step.point, run.started)
    await ctx.fs.writeFile(log, "", { mode: 0o600, exclusive: true })
    const stderr = openSync(log, "a")
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(program as string, parameters, {
        cwd: task.repoRoot,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", stderr, stderr],
        env: await reviewWorkerEnv(ctx, await installedAgents(ctx), step),
      })
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve)
        child.once("error", reject)
      })
    } finally {
      closeSync(stderr)
    }
    child.unref()
    if (child.pid !== undefined) run.pid = child.pid
  } catch (cause) {
    const failed: ReviewRun = {
      ...run,
      state: "failed",
      ended: ctx.clock.now(),
      line: String(cause),
      reason: `${step.name} could not be started`,
    }
    await writeRun(ctx, task, failed)
    return failed
  }
  await writeRun(ctx, task, run)
  return run
}

/**
 * The variable that names the session's own executable, unless the environment already names one.
 * Only for an agent this parent admitted (`installedAgents`): the variable would make the worker
 * see that agent as installed, and the worker must see exactly the providers the parent does.
 */
export async function sessionBinaryEnv(
  ctx: Ctx,
  admitted: readonly Reviewer[],
  session: () => { agent: Reviewer; path: string } | null = () => sessionAgentBinary(ctx.env),
): Promise<Record<string, string>> {
  const { agents } = await readConfig(ctx)
  if (admitted.every((agent) => namedBinary(ctx, agent) !== null || agents[agent].command !== ""))
    return {}
  const own = session()
  // A command set in Settings is the person's choice; a variable here would outrank it.
  if (
    own === null ||
    !admitted.includes(own.agent) ||
    namedBinary(ctx, own.agent) !== null ||
    agents[own.agent].command !== ""
  )
    return {}
  return { [BINARY_VARIABLES[own.agent]]: own.path }
}

/** Block until the review has ended, one way or another; null when none was started. */
export async function waitForReview(
  ctx: Ctx,
  task: Task,
  point: ReviewPoint,
): Promise<ReviewRun | null> {
  const began = ctx.clock.now()
  for (;;) {
    const run = await readRun(ctx, task, point)
    if (run === null || run.state !== "running") return run
    // A reviewer that works in a copy spends the copy's time before its own hard stop starts.
    const seats = run.panel?.members ?? [run]
    const copying = seats.some((seat) => needsCheckout(seat.by as Reviewer)) ? copyMs() : 0
    // A panel runs two rounds, each with its own hard stop and copy.
    const rounds = run.panel !== undefined ? 2 : 1
    if (ctx.clock.now() - began > rounds * (hardStopMs(ctx, point) + copying) + MINUTE) return run
    await ctx.clock.sleep(500)
  }
}

// --- the review itself --------------------------------------------------------

/** The files the reviewer reads: the plan, the build's record for the built change, and every mockup they embed. */
async function documentsFor(
  ctx: Ctx,
  task: Task,
  point: ReviewPoint,
  input?: PlanReviewInput,
): Promise<string[]> {
  // The Plan is read with its agents' file; the built change with the Plan, Implement's agents' file
  // and the diff. The Verify record stays on demand (build-package.ts).
  const files =
    input === undefined
      ? await contextOf(
          ctx,
          point === "plan" ? "secondPlan" : point === "build" ? "secondBuild" : "secondVerify",
          task,
        )
      : [...input.files.keys()]
  // Every mockup a document embeds is part of what it says.
  for (const path of [...files]) {
    const source = input?.files.get(path) ?? path
    if (!(await ctx.fs.exists(source))) continue
    for (const fence of extractFences(await ctx.fs.readFile(source))) {
      if (fence.kind !== "artifact") continue
      const named = artifactPath(fence)
      if ("path" in named) files.push(join(task.dir, named.path))
    }
  }
  // The Plan names its artifacts with `ql:artifact <name>` markers: each is read too.
  const plan = join(task.dir, folderDoc("plan"))
  const planSource = input?.files.get(plan) ?? plan
  if (await ctx.fs.exists(planSource))
    for (const marker of parseMarkers(await ctx.fs.readFile(planSource)).markers)
      if (marker.name === "artifact") {
        const reference = parseArtifactReference(marker.args[0] ?? "")
        if (!reference) continue
        if (reference.scope === "task") files.push(join(task.dir, reference.file))
        else {
          const source = await artifactReferenceSource(
            ctx,
            { taskDir: task.dir, repoRoot: task.repoRoot },
            reference,
            { pack: false },
          ).catch(() => null)
          if (source) files.push(source.path)
        }
      }
  return [...new Set(files.map((file) => input?.files.get(file) ?? file))]
}

/** Paths handed to one git call, so a huge change stays under the command line's limit. */
const PATHS_PER_CALL = 200

/** The change through git's own filters (an encrypted file reads as plain text), for the paths given. */
async function diffOf(
  ctx: Ctx,
  repo: string,
  range: string,
  paths: string[],
  /** Files git does not track yet (a build's new files): shown whole, as added. */
  untracked: ReadonlySet<string> = new Set(),
  owned?: TaskCommitDiff | null,
): Promise<string | null> {
  let text = ""
  const tracked = paths.filter((p) => !untracked.has(p))
  for (let i = 0; i < tracked.length; i += PATHS_PER_CALL) {
    const result = await ctx.git.run(
      repo,
      owned
        ? taskDiffArgs(owned.commits, tracked.slice(i, i + PATHS_PER_CALL))
        : ["diff", range, "--", ...tracked.slice(i, i + PATHS_PER_CALL)],
    )
    if (result.code !== 0) return null
    text += result.stdout
  }
  for (const path of paths.filter((p) => untracked.has(p))) {
    // `--no-index` exits 1 when the files differ, which a new file always does.
    const result = await ctx.git.run(repo, ["diff", "--no-index", "--", "/dev/null", path])
    if (result.code > 1) return null
    text += result.stdout
  }
  return text
}

// --- the build review's scope: the slices that were finished when it started ---------------

/** The finished slices a build review reads, and the files their cards name. */
export type BuildScope = { slices: number[]; files: string[] }

const buildScopePath = (task: Pick<Task, "runtimeDir">) =>
  join(task.runtimeDir, "review-build-scope.json")

/** Keep the scope the build review was started for, so its brief reads those slices and no others. */
export async function recordBuildScope(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  scope: BuildScope,
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(buildScopePath(task), `${JSON.stringify(scope)}\n`)
}

export async function readBuildScope(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<BuildScope | null> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(buildScopePath(task))) as Partial<BuildScope>
    if (!Array.isArray(parsed.files) || !Array.isArray(parsed.slices)) return null
    return {
      slices: parsed.slices.filter((n): n is number => typeof n === "number"),
      files: parsed.files.filter((f): f is string => typeof f === "string"),
    }
  } catch {
    return null
  }
}

/**
 * Which of `files` the working tree changed against `range`'s commit, and which of those git does
 * not track yet. Null when git cannot say. The work of a build in progress is not committed.
 */
async function worktreeChanges(
  ctx: Ctx,
  repo: string,
  range: string,
  files: string[],
): Promise<{ changed: string[]; untracked: Set<string> } | null> {
  const changed = new Set<string>()
  const untracked = new Set<string>()
  for (let i = 0; i < files.length; i += PATHS_PER_CALL) {
    const slice = files.slice(i, i + PATHS_PER_CALL)
    const tracked = await ctx.git.run(repo, ["diff", "--name-only", "-z", range, "--", ...slice])
    const fresh = await ctx.git.run(repo, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...slice,
    ])
    if (tracked.code !== 0 || fresh.code !== 0) return null
    for (const path of tracked.stdout.split("\0")) if (path !== "") changed.add(path)
    for (const path of fresh.stdout.split("\0"))
      if (path !== "") {
        changed.add(path)
        untracked.add(path)
      }
  }
  return { changed: [...changed], untracked }
}

async function changeSection(
  ctx: Ctx,
  task: Task,
  range: string,
  /** The build review: only these finished slices' files, from the working tree against `range`. */
  scope?: BuildScope,
): Promise<string> {
  const name = scope !== undefined ? "build" : "verify"
  const owned = scope === undefined ? await taskCommitDiff(ctx, task) : null
  const command =
    scope !== undefined
      ? `Run \`git diff ${range} -- ${scope.files.map((f) => shellQuote(f)).join(" ")}\` in \`${task.repoRoot}\` to see it.`
      : `Run \`${owned?.command ?? codeDiff(range)}\` in \`${task.repoRoot}\` to see it.`
  let untracked: ReadonlySet<string> = new Set()
  let inRange: string[]
  if (scope !== undefined) {
    const found = await worktreeChanges(ctx, task.repoRoot, range, scope.files)
    if (found === null) return `## The change\n\n${command}`
    inRange = found.changed
    untracked = found.untracked
  } else if (owned) {
    inRange = owned.files
  } else {
    const listed = await ctx.git.run(task.repoRoot, [
      "diff",
      "--name-only",
      "-z",
      range,
      "--",
      ".",
      ":(exclude)docs/plans/**",
    ])
    if (listed.code !== 0) return `## The change\n\n${command}`
    inRange = listed.stdout.split("\0").filter((p) => p !== "")
  }
  const paths = inRange
  if (scope !== undefined && paths.length === 0)
    return "## The change\n\nThe files of the finished slices show no change against the build's base."
  const folder = join(task.dir, REVIEWS_DIR)
  await ctx.fs.mkdir(folder)
  const text = await diffOf(ctx, task.repoRoot, range, paths, untracked, owned)
  if (text === null) return `## The change\n\n${command}`
  const file = join(folder, `${name}-change.diff`)
  await ctx.fs.writeFile(file, text)
  return `## The change\n\nThe change is written to \`${file}\` (${paths.length} file${paths.length === 1 ? "" : "s"}).`
}

export async function briefFor(
  ctx: Ctx,
  task: Task,
  point: ReviewPoint,
  kind?: ReviewKind,
  input?: PlanReviewInput,
): Promise<string> {
  const files: string[] = []
  for (const path of await documentsFor(ctx, task, point, input)) {
    if (await ctx.fs.exists(path)) files.push(path)
  }
  const parts = [
    phaseText("cross-review") ?? "",
    ...(kind === "sonnet"
      ? [
          "## Your place\n\nNo other vendor's agent is installed, so you are a fresh reviewer of the same family as the agent that planned this. You did not write this Plan and you have seen none of the conversation behind it: read it as someone who must build it tomorrow and would stop at its first wrong turn. Be as independent as a second vendor would be: check each claim against the code, and do not assume a decision is sound because it is stated confidently.",
        ]
      : kind === "same-family"
        ? [
            "## Your place\n\nNo other maker's model is available, so you run on a model of the same family as the one that wrote this. You did not write it and you have seen none of the conversation behind it: read it as someone who must build on it tomorrow and would stop at its first wrong turn. Be as independent as another maker's model would be: check each claim against the code, and do not assume a decision is sound because it is stated confidently.",
          ]
        : []),
    `## You are reviewing: ${REVIEWING[point]}`,
    `## Read these files\n\n${files.map((f) => `- \`${f}\``).join("\n")}`,
  ]
  if (input !== undefined)
    parts.push(
      "Read the saved Plan documents listed here. Links in them resolve from their original locations in the task folder.",
    )
  // The Plan's artifacts as drawn, not only their HTML: the reviewer is told where the pictures are.
  if (point === "plan") {
    const mockups = mockupSection(await mockupShots(ctx, task))
    if (mockups !== null) parts.push(mockups)
  }
  if (point === "verify") {
    // The independent review proves Done means and cites the security review; this one hunts breakage.
    parts.push(
      "## What this review is for\n\nThe independent review proves each Done means point on the running program, and the security review has its own record: do not repeat either. Hunt what would break: bugs, regressions, claims in the build's or the checks' record that the diff does not support, and tests that would pass without the change.",
    )
    const base = await buildBase(ctx, task)
    parts.push(await changeSection(ctx, task, base !== null ? `${base}..HEAD` : "HEAD~1..HEAD"))
    // What the build review found, and the answers: not found again.
    const answered = reviewFile(task, "build")
    if (await ctx.fs.exists(answered))
      parts.push(
        `## Already reviewed during the build\n\n\`${answered}\` holds the findings of an earlier review of the first finished slices, and the build's answer under each (Answer: Taken · … or Answer: Kept · …). ` +
          "A finding answered there is settled: do not repeat it. One with no answer is still open; report it again only if the code still has the fault. " +
          "Check that a Taken answer holds in the diff, and report what that file did not reach.",
      )
  }
  if (point === "build") {
    parts.push(
      "## What this review is for\n\nThe build is not finished: you read the task cards, the build log and the files of the slices that are finished so far, while the other slices are still being built. " +
        "The independent review proves each Done means point on the running program later, and the slices not built yet are not missing: do not prove Done means and do not list unbuilt work. " +
        "Hunt what would break: bugs, regressions, a slice that departs from the Plan's artifact or the cards' modules, claims in the build log that the diff does not support, and tests that would pass without the change. " +
        "The rest of the build will follow what you find, so name the file and the line.",
    )
    const base = (await readBuildStart(ctx, task))?.head ?? (await buildBase(ctx, task)) ?? "HEAD"
    const scope = await readBuildScope(ctx, task)
    parts.push(
      scope !== null
        ? await changeSection(ctx, task, base, scope)
        : "## The change\n\nNo finished slice is recorded for this review: read the task cards and the build log, and say under *Not checked* that no diff was read.",
    )
  }
  const instructions = await instructionsSection(ctx, task, point === "plan" ? "plan" : "verify")
  if (instructions !== null) parts.push(instructions)
  parts.push(`The repository is \`${task.repoRoot}\`. Change no file.`)
  return parts.join("\n\n")
}

const REVIEWING: Record<ReviewPoint, string> = {
  plan: "the plan",
  verify: "the built change",
  build: "the first finished slices of the build",
}

/** The headless, read-only command line for one reviewer, streaming JSON events. */
export function reviewCommand(
  agent: Reviewer,
  binary: string,
  model: string,
  repo: string,
  output: string,
  /** Pictures the reviewer looks at: Codex takes them as attachments (`-i`); Claude Code reads the paths. */
  images: readonly string[] = [],
  /** An extra planner's chosen effort; every other review thinks at `REVIEW_EFFORT`. */
  effort: string = REVIEW_EFFORT,
): string[] {
  return (
    headlessCommand(agent, binary, model, effort, images) ??
    builtInReviewCommand(agent, { binary, model, repo, output, images, effort })
  )
}

/** The review command of the agents whose line is built here rather than named in `agents.json`. */
function builtInReviewCommand(
  agent: Reviewer,
  spec: {
    binary: string
    model: string
    repo: string
    output: string
    images: readonly string[]
    effort: string
  },
): string[] {
  const { binary, model, repo, output, images, effort } = spec
  if (agent === "pi")
    return [
      binary,
      "--print",
      "--mode",
      "json",
      "--model",
      model,
      "--thinking",
      effort,
      "--no-session",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--tools",
      "read,grep,find,ls",
      ...images.map((path) => `@${path}`),
    ]
  if (agent === "opencode")
    return [
      binary,
      "run",
      "--standalone",
      "--agent",
      "plan",
      "--model",
      `${model.replace(/#[^#]*$/, "")}#${effort}`,
      "--format",
      "json",
      ...images.flatMap((path) => ["--file", path]),
    ]
  if (agent === "codex") {
    return [
      binary,
      "exec",
      // `-i` takes a list, so it stands before the flags that end it and the prompt comes last.
      ...images.flatMap((image) => ["-i", image]),
      "-m",
      model,
      "-c",
      `model_reasoning_effort="${effort}"`,
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "--json",
      "-C",
      repo,
      "-o",
      output,
      "-",
    ]
  }
  return [
    binary,
    "-p",
    "--model",
    model,
    "--effort",
    effort,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "Read Grep Glob Bash(git diff:*) Bash(git log:*) Bash(git show:*)",
    "--no-session-persistence",
    // The pictures stand outside the repository: the folder is made readable (last, as it takes a list).
    ...(images.length > 0 ? ["--add-dir", ...new Set(images.map((image) => dirname(image)))] : []),
  ]
}

/**
 * Whether QualityLayer's own code inside the reviewer must know it only reviews: the plugins of Pi
 * and OpenCode, and the hooks that run inside the agents the catalog describes (Cursor and Grok also
 * read Claude Code's hooks).
 */
const knowsItReviews = (agent: Reviewer): boolean =>
  agent === "pi" || agent === "opencode" || hasHeadlessReview(agent)

/** The reviewer starts as itself; the private marker keeps it owned for run cleanup. */
export function reviewerEnv(agent?: Reviewer): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const name of [
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CODEX_THREAD_ID",
    "PI_SESSION_ID",
    "OPENCODE_SESSION_ID",
    "GROK_SESSION_ID",
    "GROK_HOOK_EVENT",
    "GROK_HOOK_NAME",
    "GROK_WORKSPACE_ROOT",
    "COPILOT_CLI",
    "COPILOT_CLI_BINARY_VERSION",
    "COPILOT_HOOK_DIR",
    "COPILOT_PROJECT_DIR",
    "ANTIGRAVITY_CONVERSATION_ID",
    "CURSOR_PROJECT_DIR",
    "CURSOR_TRANSCRIPT_PATH",
    "CURSOR_PLUGIN_ROOT",
    "QUALITYLAYER_SESSION",
    "QUALITYLAYER_AGENT",
    "QUALITYLAYER_NATIVE_PID",
    "QUALITYLAYER_OPENCODE_MODEL",
    "QUALITYLAYER_OPENCODE_EFFORT",
    "QUALITYLAYER_OPENCODE_PERMISSION",
    "QUALITYLAYER_OPENCODE_AGENT",
    "QUALITYLAYER_PARENT_SESSION",
    "QUALITYLAYER_PEER_ORIGIN",
    "QUALITYLAYER_RUN",
    // An App launch's own: a reviewer's installed hooks must not be silenced by it.
    "QUALITYLAYER_SESSION_HOOKS",
  ]) {
    for (const key of Object.keys(env)) if (key.toUpperCase() === name) delete env[key]
  }
  if (agent !== undefined && knowsItReviews(agent)) env.QUALITYLAYER_REVIEW_READ_ONLY = "1"
  return env
}

export type CrossReviewResult = ReviewHandle & {
  /** The reviewer ran to the end and answered. */
  completed: boolean
  timedOut: boolean
  verdict: string | null
}

export type Outcome = {
  code: number
  stdout: string[]
  stderr: string
  timedOut: boolean
  /** What the reviewer did that broke the rule that a review changes no file, when the guard stopped it. */
  broke?: string[]
}

/** The folders Settings names for the agents, for a reviewer started in this process. */
export async function agentFolders(ctx: Ctx): Promise<Record<string, string>> {
  return configDirEnvironment(ctx.env, (await readConfig(ctx)).agents)
}

/**
 * Run the reviewer to its end or its hard stop, keeping its progress for the Cockpit. `folders` are
 * the agents' folders Settings names (`agentFolders`): the environment's own variables win over them.
 */
export async function runReviewer(
  task: Pick<Task, "repoRoot" | "runtimeDir" | "dir">,
  cmd: string[],
  brief: string,
  hardStop: number,
  seen: (line: string) => void,
  agent?: Reviewer,
  folders: Record<string, string> = {},
): Promise<Outcome> {
  let copy: Checkout | null = null
  let delivery: Delivery | null = null
  let native: ReturnType<typeof opencodeReviewEnvironment> | null = null
  try {
    // An agent that only reports an edit afterwards never works in the person's tree.
    const made = needsCheckout(agent) ? await disposableCheckout(task, agent, brief) : null
    if (typeof made === "string") return { code: 1, stdout: [], stderr: made, timedOut: false }
    copy = made
    const cwd = copy?.dir ?? task.repoRoot
    const baseEnv = { ...folders, ...reviewerEnv(agent), PWD: cwd }
    delivery = deliverBrief(agent, task.runtimeDir, copy?.remap(brief) ?? brief)
    if (agent === "opencode")
      native = opencodeReviewEnvironment(baseEnv, task.runtimeDir, process.execPath)
    const [command, ...args] = [...cmd, ...delivery.args]
    const [program, ...parameters] = nativeCommand(command as string, args)
    const done = await runProcess({
      program: program as string,
      args: parameters,
      cwd,
      env: native?.env ?? (baseEnv as NodeJS.ProcessEnv),
      stdin: delivery.stdin,
      hardStop,
      seen,
      guard: agent === undefined ? null : guardOf(agent, cwd),
    })
    return outcomeOf(agent, done)
  } finally {
    // Cursor leaves a detached worker server for the folder after every headless run. With no copy
    // nothing ran, and the workers in the person's own repository are theirs.
    if (agent === "cursor" && copy !== null) stopStrayWorkers(copy.dir)
    native?.close()
    delivery?.close()
    copy?.close()
  }
}

/** The outcome of a run; one the guard stopped is a failure that says which rule it broke. */
function outcomeOf(agent: Reviewer | undefined, done: ProcessResult): Outcome {
  const { broke, ...outcome } = done
  if (agent === undefined || broke === null) return outcome
  const said = `${ruleBreak(NAMES[agent], [broke])}. The review is discarded.`
  return {
    ...outcome,
    code: outcome.code === 0 ? 1 : outcome.code,
    broke: [broke],
    stderr: outcome.stderr === "" ? said : `${said}\n${outcome.stderr}`,
  }
}

/** The rule-break sentence of an outcome that has one, else null. */
export const brokeRule = (name: string, outcome: Outcome): string | null =>
  outcome.broke === undefined ? null : ruleBreak(name, outcome.broke)

/** Who broke the rule that a review changes no file, and what the stream shows they did. */
export const ruleBreak = (name: string, found: readonly string[]): string =>
  `${name} broke the rule that a review changes no file: it ${found.join(", ")}`

/** How many findings the answer lists: its numbered items. */
function findingsIn(answer: string): number {
  return (answer.match(/^[^\S\r\n\u2028\u2029]*\d+[.)]\s/gm) ?? []).length
}

/** How an attempt to run the reviewer ended; `reason` is the plain-words cause when it did not answer. */
type Attempt = {
  step: CrossReviewStep
  outcome: Outcome
  answer: string
  good: boolean
  reason: string
}

/**
 * The review to try once more after `tried` (D19), or null when none is. A review that ran out of
 * time is not tried again (it would only run out again), and neither is one that broke the rule that a
 * review changes no file by the same reviewer: it would only break it a second time.
 */
async function secondStep(
  ctx: Ctx,
  task: Task,
  first: CrossReviewStep,
  tried: Attempt,
): Promise<CrossReviewStep | null> {
  if (tried.good || tried.outcome.timedOut) return null
  const again = await retryStep(ctx, task, first)
  return tried.outcome.broke !== undefined && again.by === first.by ? null : again
}

/** Why a reviewer that did not answer did not, without exit codes. */
function failureReason(name: string, outcome: Outcome): string {
  const { code, broke } = outcome
  if (broke !== undefined) return ruleBreak(name, broke)
  if (code === 126 || code === 127) return `${name} could not be started`
  if (code !== 0) return `${name} stopped with an error`
  return `${name} returned no answer`
}

/** What stood in the way of a review, in a few words: the facts `crossReviewStep` weighs. */
async function whyNoReview(ctx: Ctx, task: Task, point: ReviewPoint): Promise<string> {
  try {
    const flow = (await taskFlow(ctx, task)).flow
    const agent = (await readSession(ctx, task))?.agent ?? "none"
    const installed = (await installedAgents(ctx)).join(", ") || "none"
    const asked = point === "plan" ? flow.planReview : flow.changeSecondOpinion
    return `the task's flow asks for it: ${String(asked)}; session agent: ${agent}; agents set up and on PATH: ${installed}`
  } catch (cause) {
    return `could not read why: ${cause instanceof Error ? cause.message : String(cause)}`
  }
}

/** A panel member's own answer of a round, kept beside the merged review: `reviews/plan-codex-1.md`. */
export const panelAnswerFile = (task: Pick<Task, "dir">, by: string, round: 1 | 2): string =>
  join(task.dir, REVIEWS_DIR, `plan-${by}-${round}.md`)

/** The second round's brief: its text, the Plan's files and the findings, quoted as data. */
export async function secondRoundBrief(
  ctx: Ctx,
  task: Task,
  findings: string,
  input?: PlanReviewInput,
): Promise<string> {
  const files: string[] = []
  for (const path of await documentsFor(ctx, task, "plan", input)) {
    if (await ctx.fs.exists(path)) files.push(path)
  }
  return [
    phaseText("cross-review-round") ?? "",
    `## The Plan's files\n\n${files.map((f) => `- \`${f}\``).join("\n")}`,
    findings,
    `The repository is \`${task.repoRoot}\`. Change no file.`,
  ].join("\n\n")
}

/**
 * Run a Plan's review panel (the task's extra planners): both rounds, each member's answers kept,
 * and the merged list written as the Plan's one review file. One survivor's review stands alone in
 * the single review's format; with none, the fresh reviewer of the planner's own agent reads the
 * Plan, as after a single review that could not run.
 */
async function runPanelReview(
  ctx: Ctx,
  task: Task,
  step: CrossReviewStep,
  seats: ReviewSeat[],
  input?: PlanReviewInput,
): Promise<Result<CrossReviewResult>> {
  await ctx.fs.mkdir(join(task.dir, REVIEWS_DIR))
  const hardStop = hardStopMs(ctx, "plan")
  const gateRun = await readRun(ctx, task, "plan")
  const why = step.why ?? gateRun?.why
  let run: ReviewRun = {
    point: "plan",
    by: step.by,
    name: step.name,
    model: step.model,
    state: "running",
    started: gateRun?.started ?? ctx.clock.now(),
    pid: process.pid,
    ...(input !== undefined ? { planInput: input.digest } : {}),
    ...(why !== undefined ? { why } : {}),
    panel: { round: 1, members: seats.map((seat) => ({ ...seat, round1: "running" as const })) },
  }
  await writeRun(ctx, task, run)
  // Members finish in any order: their record updates are written one after the other.
  let writing: Promise<void> = Promise.resolve()
  const folders = await agentFolders(ctx)
  const shots = shotPaths(await mockupShots(ctx, task))
  const roundEnds = new Map<number, number>()

  const result = await runPanel(
    seats,
    {
      async run(seat, round, findings) {
        const member = seat as ReviewSeat
        const lastMessage = `${panelAnswerFile(task, member.by, round)}.last`
        const executable = await reviewerBinary(ctx, member.by)
        const started = ctx.clock.now()
        // One limit per round, shared by a member's retry: `review wait plan` counts on two rounds.
        const ends = roundEnds.get(round) ?? started + hardStop
        roundEnds.set(round, ends)
        const left = ends - started
        const outcome: Outcome =
          executable === null
            ? { code: 127, stdout: [], stderr: `${member.name} is not on PATH`, timedOut: false }
            : left <= 0
              ? { code: 124, stdout: [], stderr: "", timedOut: true }
              : await runReviewer(
                  task,
                  reviewCommand(
                    member.by,
                    executable,
                    member.model,
                    task.repoRoot,
                    lastMessage,
                    round === 1 ? shots : [],
                    member.effort,
                  ),
                  round === 1
                    ? await briefFor(ctx, task, "plan", undefined, input)
                    : await secondRoundBrief(ctx, task, findings ?? "", input),
                  left,
                  () => {},
                  member.by,
                  folders,
                )
        await recordReviewCost(
          ctx,
          task,
          {
            point: "plan",
            by: member.by,
            name: member.name,
            model: member.model,
            started,
            ended: ctx.clock.now(),
            seat: `${member.by}-${round}`,
          },
          outcome.stdout.join("\n"),
        )
        // Codex writes its final message to a file; the others' is in their stream.
        let answer = answerOf(member.by, outcome.stdout).trim()
        if (member.by === "codex" && (await ctx.fs.exists(lastMessage))) {
          answer = (await ctx.fs.readFile(lastMessage)).trim()
          await ctx.fs.remove(lastMessage)
        }
        return {
          good: !outcome.timedOut && outcome.code === 0 && answer !== "",
          timedOut: outcome.timedOut,
          answer,
          reason: failureReason(member.name, outcome),
        }
      },
      async save(seat, round, text) {
        const heading = `# Plan review by ${seat.name} (${seat.model} · ${seat.effort ?? REVIEW_EFFORT}) · round ${round} of the panel`
        await ctx.fs.writeFile(panelAnswerFile(task, seat.by, round), `${heading}\n\n${text}\n`)
      },
      progress(state) {
        run = { ...run, panel: structuredClone(state), at: ctx.clock.now() }
        const snapshot = run
        writing = writing.then(() => writeRun(ctx, task, snapshot))
        return writing
      },
    },
    REVIEW_EFFORT,
  )
  await writing

  if (result.kind === "empty") {
    // Nobody answered: what a single review that could not run falls back to (D18), when it can.
    const { panel: _seats, ...single } = step
    const fallback = result.timedOut ? single : await retryStep(ctx, task, single)
    if (fallback.kind === "sonnet")
      return runCrossReviewWithInput(ctx, task, "plan", fallback, input)
    await ctx.fs.writeFile(
      step.file,
      `# Plan review by a panel: ${step.name}\n\nThe review did not complete: no reviewer answered.\n\n${result.members.map((m) => `- ${m.name}: ${m.reason ?? (m.round1 === "timed_out" ? "ran out of time" : "did not answer")}`).join("\n")}\n`,
    )
    run = {
      ...run,
      state: result.timedOut ? "timed_out" : "failed",
      ended: ctx.clock.now(),
      panel: { round: 1, members: result.members },
      ...(result.timedOut ? {} : { reason: result.reason }),
    }
    await writeRun(ctx, task, run)
    return ok({
      ...handleOf(task, run),
      completed: false,
      timedOut: result.timedOut,
      verdict: null,
    })
  }

  const verdictOf = (answer: string): string | null =>
    answer.match(/^(APPROVE|REVISE[^\n]*|BLOCK[^\n]*)/m)?.[1] ?? null
  let verdict: string | null
  let findings: number
  if (result.kind === "single") {
    // One reviewer answered: its review stands alone, in the single review's own format.
    const seat = result.seat as ReviewSeat
    const others = result.members
      .filter((m) => m.by !== seat.by)
      .map((m) => m.name)
      .join(" and ")
    verdict = verdictOf(result.answer)
    findings = verdict === "APPROVE" ? 0 : findingsIn(result.answer)
    await ctx.fs.writeFile(
      step.file,
      `# Plan review by ${seat.name} (${seat.model} · ${seat.effort ?? REVIEW_EFFORT})\n\n${others} did not answer, so ${seat.name}'s review stands alone.\n\n${result.answer}\n`,
    )
    run = { ...run, by: seat.by, name: seat.name, model: seat.model }
  } else {
    verdict = result.verdict
    findings = result.findings
    await ctx.fs.writeFile(step.file, result.text)
  }
  const { panel: _progress, ...settled } = run
  run = {
    ...settled,
    state: "done",
    ended: ctx.clock.now(),
    findings,
    // A lone survivor is a single review; a panel keeps how each member ended.
    ...(result.kind === "panel"
      ? { panel: { round: run.panel?.round ?? 1, members: result.members } }
      : {}),
  }
  await writeRun(ctx, task, run)
  if (result.kind === "panel" && run.ended !== undefined)
    await recordDuration(ctx, PANEL_REVIEW_KIND, run.ended - run.started)
  return ok({ ...handleOf(task, run), completed: true, timedOut: false, verdict })
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
  if (first.panel !== undefined && first.panel.length >= 2)
    return runPanelReview(ctx, task, first, first.panel, input)
  const binary = await reviewerBinary(ctx, first.by)
  if (binary === null) return err({ code: "bad_args", message: `${first.name} is not on PATH` })
  await ctx.fs.mkdir(join(task.dir, REVIEWS_DIR))
  const hardStop = hardStopMs(ctx, point)

  // The gate that started this process already wrote the start time its lock counts from, and why
  // it chose this reviewer.
  const gateRun = await readRun(ctx, task, point)
  const runOf = (step: CrossReviewStep, started: number): ReviewRun => {
    const why = step === first ? (step.why ?? gateRun?.why) : step.why
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
  let run = runOf(first, gateRun?.started ?? ctx.clock.now())
  await writeRun(ctx, task, run)

  /** One reviewer, run to its end or its hard stop. */
  const attempt = async (
    step: CrossReviewStep,
    executable: string | null,
    started: number,
  ): Promise<Attempt> => {
    const lastMessage = `${step.file}.last`
    // The latest tool call is the status line; it is written at most once a second, and
    // the last one of a burst is not lost.
    let latest: string | null = null
    let lastWrite = 0
    let flushing: ReturnType<typeof setTimeout> | null = null
    let writing: Promise<void> = Promise.resolve()
    const flush = () => {
      flushing = null
      if (latest === null) return
      lastWrite = ctx.clock.now()
      run = { ...run, line: latest, at: lastWrite }
      latest = null
      const snapshot = run
      writing = writing.then(() => writeRun(ctx, task, snapshot))
    }
    const seen = (raw: string) => {
      const line = progressOf(step.by, raw)
      if (line === null) return
      latest = line
      const wait = lastWrite + 1000 - ctx.clock.now()
      if (wait <= 0) flush()
      else if (flushing === null) flushing = setTimeout(flush, wait)
    }
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
            await briefFor(ctx, task, point, step.kind, input),
            hardStop,
            seen,
            step.by,
            await agentFolders(ctx),
          )
    await recordReviewCost(
      ctx,
      task,
      {
        // The cost ledger types its point as plan | verify; a build review's row says "build".
        point: point as ReviewCost["point"],
        by: step.by,
        name: step.name,
        model: step.model,
        started,
        ended: ctx.clock.now(),
      },
      outcome.stdout.join("\n"),
    )
    if (flushing !== null) clearTimeout(flushing)
    await writing

    // Codex writes its final message to a file; Claude Code's is in its stream.
    let answer = answerOf(step.by, outcome.stdout).trim()
    if (step.by === "codex" && (await ctx.fs.exists(lastMessage))) {
      answer = (await ctx.fs.readFile(lastMessage)).trim()
      await ctx.fs.remove(lastMessage)
    }
    const good = !outcome.timedOut && outcome.code === 0 && answer !== ""
    return { step, outcome, answer, good, reason: failureReason(step.name, outcome) }
  }

  // D19: a review that could not run is tried once more, by the same-vendor reviewer of D18 when the
  // other vendor's could not start. One that ran out of time is not: it would only run out again.
  const attempts: Attempt[] = [await attempt(first, binary, run.started)]
  const tried = attempts[0] as Attempt
  const again = await secondStep(ctx, task, first, tried)
  if (again !== null) {
    const step = again
    run = runOf(step, run.started)
    await writeRun(ctx, task, run)
    attempts.push(await attempt(step, await reviewerBinary(ctx, step.by), ctx.clock.now()))
  }

  const last = attempts[attempts.length - 1] as Attempt
  const { step, outcome, answer, good } = last
  const verdict = good ? (answer.match(/^(APPROVE|REVISE[^\n]*|BLOCK[^\n]*)/m)?.[1] ?? null) : null
  const heading = `# ${point === "verify" ? "Verification" : point[0]?.toUpperCase() + point.slice(1)} review by ${step.name} (${step.model} · ${step.effort ?? REVIEW_EFFORT})`
  const earlier = attempts[0] as Attempt
  const lead =
    attempts.length > 1 && (good || outcome.timedOut)
      ? `The first review, by ${earlier.step.name}, could not run (${earlier.reason}); ${step.name} read it instead.\n\n`
      : ""
  const reported = (a: Attempt) =>
    `The review did not complete (exit ${a.outcome.code}). What ${a.step.name} reported:\n\n\`\`\`\n${(a.outcome.stderr || a.outcome.stdout.join("\n")).trim().split("\n").slice(-20).join("\n")}\n\`\`\``
  const body = outcome.timedOut
    ? `${lead}The review timed out after ${minutesText(hardStop)}, no findings.${answer !== "" ? `\n\nWhat ${step.name} had said:\n\n${answer}` : ""}`
    : good
      ? `${lead}${answer}`
      : attempts.map(reported).join("\n\n")
  await ctx.fs.writeFile(step.file, `${heading}\n\n${body}\n`)
  // Plain words for the person: each cause once, and that it was tried twice.
  const causes = [...new Set(attempts.map((a) => a.reason))]
  const reason =
    causes.length === 1 && attempts.length > 1
      ? `${causes[0]} (tried twice)`
      : causes.join("; then ")
  run = {
    ...run,
    state: outcome.timedOut ? "timed_out" : good ? "done" : "failed",
    ended: ctx.clock.now(),
    ...(good ? { findings: verdict === "APPROVE" ? 0 : findingsIn(answer) } : {}),
    ...(!good && !outcome.timedOut ? { reason } : {}),
  }
  await writeRun(ctx, task, run)
  // Only a review that answered tells how long one takes; a stop at the limit tells the limit.
  if (run.state === "done" && run.ended !== undefined) {
    await recordDuration(ctx, reviewKind(point, step.by), run.ended - run.started)
  }
  return ok({
    ...handleOf(task, run),
    completed: good,
    timedOut: outcome.timedOut,
    verdict,
  })
}
