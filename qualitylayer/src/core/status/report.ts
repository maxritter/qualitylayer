// The task this session works on, read from git and the task files: the report `status --json`
// gives the Claude Code mod. Nothing here writes task state. It runs every few seconds in every
// session, so a read makes exactly one git call; everything else is a file read.

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { taskSummary } from "../../server/api.ts"
import { cockpitUrl, liveLock } from "../../server/lock.ts"
import { appLinkOpensHere } from "../../server/machines/served.ts"
import { statusOf } from "../../ui/live-status.ts"
import { homeNeedsYou } from "../../ui/model.ts"
import type { Answers } from "../config-values.ts"
import { FLOW_STEPS, flowStepOf, isAutonomousBuildStage } from "../flow.ts"
import { readGate } from "../gate/gate.ts"
import { activity } from "../helpers.ts"
import { openCount } from "../items.ts"
import {
  type BuildProgress,
  type ProgressWords,
  progressWords,
  readBuildProgress,
} from "../live/progress.ts"
import { readLimit, readRefusal } from "../live/read.ts"
import { openNeeds, readNeeds } from "../need/need.ts"
import { type RepoRef, repoIdFrom } from "../paths.ts"
import { canonicalPath } from "../platform.ts"
import { passRoles, type QualityRow, qualityRowsFor } from "../polish.ts"
import { readRun } from "../review/cross.ts"
import type { AnswerModeInfo } from "../task/answer-mode.ts"
import { isArchived } from "../task/archive.ts"
import { boundSlug, keyOf, sessionKey } from "../task/binding.ts"
import { taskItems } from "../task/items.ts"
import type { Stage } from "../task/machine.ts"
import { approvalsOf } from "../task/sides.ts"
import { isTerminal, listTasks, readSession, type Session, type Task } from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { taskFlow } from "../task-flow.ts"
import {
  awaitingBuildStart,
  type DecisionSummary,
  managerStatus,
  type WaitingOn,
} from "./manager.ts"

/** One step of the flow on a task's track: done, the one it stands on, or still to come. */
export type TrackStage = {
  id: string
  label: string
  /** Plan, Build (Implement) or Check (Verify): how the mod groups the steps. */
  group: "Plan" | "Build" | "Check"
  state: "done" | "now" | "todo"
}

const GROUPS: Record<string, TrackStage["group"]> = {
  plan: "Plan",
  implement: "Build",
  verify: "Check",
}

/** The task's three steps with where it stands; a shipped task has every step done. */
export function trackOf(stage: Stage): TrackStage[] {
  if (stage === "chat") return []
  const steps = FLOW_STEPS
  const at = steps.findIndex((step) => step.id === flowStepOf(stage))
  return steps.map((step, i) => ({
    id: step.id,
    label: step.label,
    group: GROUPS[step.id] ?? "Plan",
    state: stage === "shipped" || i < at ? "done" : i === at ? "now" : "todo",
  }))
}

/** A task nobody touched for a day stops taking a line, unless it waits for the user. */
const LIVE_MS = 24 * 60 * 60_000
const UNSETTLED_MS = 5_000

/** `raw` keeps the output as git wrote it: porcelain lines start with a meaningful space. */
export function git(
  cwd: string,
  args: string[],
  options: { raw?: boolean; timeout?: number } = {},
) {
  const searchPath = (process.env.PATH ?? (process.platform === "win32" ? "" : "/usr/bin:/bin"))
    .split(delimiter)
    .map((entry) => (process.platform === "win32" ? entry.replace(/^"(.*)"$/, "$1") : entry))
    .filter(isAbsolute)
    .join(delimiter)
  const executable = Bun.which("git", { PATH: searchPath, cwd: dirname(process.execPath) })
  if (!executable || !isAbsolute(executable)) return null
  const run = spawnSync(executable, ["-C", cwd, "--no-optional-locks", ...args], {
    encoding: "utf8",
    timeout: options.timeout ?? 2000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  })
  if (run.status !== 0) return null
  return options.raw === true ? run.stdout : run.stdout.trim()
}

/** The checkout at `cwd`, from one git call; its branch is read from HEAD itself. */
export type Checkout = { repo: RepoRef; branch: string | null }

export function probeCheckout(cwd: string): Checkout | null {
  const out = git(cwd, ["rev-parse", "--show-toplevel", "--git-common-dir", "--git-dir"])
  if (out === null) return null
  const [top, common, own] = out.split("\n")
  if (top === undefined || common === undefined || own === undefined) return null
  // The same resolution as resolveRepo, so the repository id matches the CLI's.
  const commonDir = canonicalPath(isAbsolute(common) ? resolve(common) : resolve(cwd, common))
  const gitDir = isAbsolute(own) ? own : resolve(cwd, own)
  let branch: string | null = null
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim()
    branch = head.startsWith("ref: ")
      ? head.slice(5).replace(/^refs\/heads\//, "")
      : head.slice(0, 7) || null
  } catch {
    branch = null
  }
  return {
    repo: { root: canonicalPath(resolve(top)), id: repoIdFrom(commonDir), commonDir },
    branch,
  }
}

/** What the user has to do for the task, if anything. */
export type Attention =
  | { kind: "review"; doc: string }
  | { kind: "final" }
  /** The Plan is approved: the user starts Implement in a fresh session. */
  | { kind: "implement" }
  /** Decided in the App after the agent stopped waiting: the agent needs a nudge. */
  | { kind: "continue" }

export async function attentionFor(ctx: Ctx, task: Task): Promise<Attention | null> {
  const gate = await readGate(ctx, task)
  if (gate !== null && gate.settled !== true) {
    if (gate.decision === "pending") {
      if (gate.target === "final") return { kind: "final" }
      return { kind: "review", doc: gate.target }
    }
    // A waiting agent settles a decision within a poll; one still unsettled after
    // a few seconds was made after the agent stopped waiting.
    if (ctx.clock.now() - (gate.decided ?? gate.opened) > UNSETTLED_MS) return { kind: "continue" }
  }
  // Approved, and no build started yet: the user's next move is the Implement prompt.
  if (await awaitingBuildStart(ctx, task)) {
    return { kind: "implement" }
  }
  return null
}

/**
 * The task this session works on, or null when none is live: no open task, or one nobody touched
 * for a day that does not wait for the user and whose branch is not checked out. A session known
 * by its id sees only its own open, unarchived task: never another session's.
 * With `boundOnly` (the mod, which names its session) only the task the session is bound to: a
 * session that never ran QualityLayer sees none, whatever the branch.
 */
export async function liveTaskFor(
  ctx: Ctx,
  checkout: Checkout,
  sessionId: string,
  options: { boundOnly?: boolean } = {},
): Promise<{
  task: Task
  tasks: Task[]
  attention: Attention | null
  session: Session | null
} | null> {
  const { repo, branch } = checkout
  const tasks: Task[] = []
  for (const task of await listTasks(ctx, repo)) {
    if (!isTerminal(task.stage) && !(await isArchived(ctx, task))) tasks.push(task)
  }
  if (tasks.length === 0) return null
  const key = sessionId !== "" ? keyOf(sessionId) : sessionKey(ctx.env)
  const bound = key !== null ? boundSlug(ctx, repo.id, key) : null
  // A branch names a task only when that task alone started on it.
  const onBranch = tasks.filter((t) => branch !== null && t.branch === branch)
  const branchTask = onBranch.length === 1 ? onBranch[0] : undefined
  // A named session has no branch or newest-task fallback. Plain terminal status
  // without a session keeps those choices.
  const task =
    tasks.find((t) => t.slug === bound) ??
    (options.boundOnly === true || key !== null
      ? undefined
      : (branchTask ??
        [...tasks].sort((a, b) => b.created - a.created || b.slug.localeCompare(a.slug))[0]))
  if (task === undefined) return null

  const attention = await attentionFor(ctx, task)
  const session = await readSession(ctx, task)
  const touched = session?.heartbeat ?? task.created
  const checkedOut = branchTask !== undefined && branchTask.slug === task.slug
  if (attention === null && !checkedOut && ctx.clock.now() - touched > LIVE_MS) return null
  return { task, tasks, attention, session }
}

/** A helper that has not reported for longer than this is no longer shown. */
const HELPER_SHOWN_MS = 30 * 60_000

/** What `qualitylayer status --json` reports for the open task: everything the terminal mod draws. */
export type StatusReport = {
  waiting_on: WaitingOn
  last_decision: DecisionSummary | null
  answer_mode: AnswerModeInfo
  /** Where the approvals happen and who last moved them; null fields before any change. */
  approval_mode: AnswerModeInfo
  /** `kind` is the task's kind in words: Feature or Bug fix. */
  task: {
    id: string
    slug: string
    title: string
    kind: string
    stage: Stage
    answers: Answers
    approvals: Answers
  }
  /** The three steps grouped Plan, Build and Check, with where the task stands. */
  track: TrackStage[]
  /** The gate waiting for the user, null once decided. */
  gate: { target: string; minutes: number; cockpit: string | null } | null
  build: {
    slices: { n: number; title: string; done: number; total: number }[]
  } | null
  quality: QualityRow[]
  helpers: {
    id: string
    role: string | null
    model: string | null
    model_source?: "requested" | "unknown"
    state: "queued" | "running" | "done" | "failed" | "timed_out"
    line: string
    minutes: number
  }[]
  /** The second opinion on the built change when it exists, else on the Plan. */
  review: {
    name: string
    model: string
    state: string
    findings: number | null
    line: string | null
  } | null
  /** How many items wait for the person in this task. */
  open_items: number
  /** Whether the task stands in Home's Needs you, with the App's words for it; null when it does not. */
  needs_you: { words: string } | null
  /** The question the agent asks next in its own window, when one is open: the band names it. */
  question: string | null
  /** Where the build stands during Implement: slice and task. */
  progress: (BuildProgress & { words: ProgressWords }) | null
  /** What the build needs from the person (a key, a login), still open; `waiting` once nothing else is left. */
  needs: { for: string; what: string; waiting: boolean }[]
  /** QualityLayer's own refusal, how often it came in a row and how many errors the latest named; null when there is none. */
  refusal: { lead: string; words: string; count: number; errors: number } | null
  /** The task's agent stopped on its plan limit: when the plan resets (null when unsaid). Absent when it did not. */
  limit?: { at: number | null; resetsAt: number | null; window: string | null }
}

/** The role a task's current set of helpers was handed out for; `activity` does not carry it. */
async function helperRole(ctx: Ctx, task: Task): Promise<string | null> {
  try {
    const file = JSON.parse(await ctx.fs.readFile(join(task.runtimeDir, "helpers.json"))) as {
      role?: unknown
    }
    return typeof file.role === "string" ? file.role : null
  } catch {
    return null
  }
}

/**
 * The report for the task this session works on, or null when none is live. Reads only, from the
 * task files and one git call.
 */
export async function statusFor(
  ctx: Ctx,
  checkout: Checkout,
  sessionId = "",
  options: { boundOnly?: boolean; task?: Task } = {},
): Promise<StatusReport | null> {
  const live = options.task
    ? { task: options.task }
    : await liveTaskFor(ctx, checkout, sessionId, options)
  if (live === null) return null
  const { task } = live
  const gateFile = await readGate(ctx, task)
  const activities = await activity(ctx, task, { remember: false })
  const management = await managerStatus(ctx, task, activities, gateFile)
  if (task.type === "chat")
    return {
      task: {
        answers: task.answers,
        approvals: approvalsOf(task),
        id: `${task.repoId}~${task.slug}`,
        slug: task.slug,
        title: task.title,
        kind: "Chat",
        stage: task.stage,
      },
      track: [],
      gate: null,
      build: null,
      quality: [],
      helpers: [],
      review: null,
      open_items: 0,
      needs_you: await needsYouOf(ctx, task),
      ...management,
      ...(await liveFields(ctx, task)),
    }
  const now = ctx.clock.now()
  const minutesSince = (at: number) => Math.round((now - at) / 60_000)

  const lock =
    gateFile?.decision === "pending" && appLinkOpensHere(ctx.home) ? await liveLock(ctx) : null
  const gate =
    gateFile?.decision === "pending"
      ? {
          target: gateFile.target,
          minutes: minutesSince(gateFile.opened),
          cockpit: lock !== null ? cockpitUrl(lock, `${task.repoId}~${task.slug}`) : null,
        }
      : null

  const { flow, plan: outline } = await taskFlow(ctx, task)
  const build =
    outline !== null
      ? {
          slices: outline.slices.map((slice) => ({
            n: slice.n,
            title: slice.title,
            done: slice.tasks.filter((t) => t.checked).length,
            total: slice.tasks.length,
          })),
        }
      : null

  const running = activities.filter((row) => row.kind === "helper")
  const role = await helperRole(ctx, task)
  const helpers = running.flatMap((row) =>
    row.at !== null && row.line !== null && now - row.at < HELPER_SHOWN_MS
      ? [
          {
            id: row.id,
            role: row.role ?? role,
            state: row.state,
            model: row.model ?? null,
            model_source: row.model ? ("requested" as const) : ("unknown" as const),
            line: row.line,
            minutes: minutesSince(row.at),
          },
        ]
      : [],
  )

  const quality = await qualityRowsFor(
    ctx,
    task,
    passRoles(flow),
    running.map((row) => row.id),
  )

  const run = (await readRun(ctx, task, "verify")) ?? (await readRun(ctx, task, "plan"))
  return {
    task: {
      answers: task.answers,
      approvals: approvalsOf(task),
      id: `${task.repoId}~${task.slug}`,
      slug: task.slug,
      title: task.title,
      kind: task.type === "bugfix" ? "Bug fix" : "Feature",
      stage: task.stage,
    },
    track: trackOf(task.stage),
    gate,
    build,
    quality,
    helpers,
    review:
      run === null
        ? null
        : {
            name: run.name,
            model: run.model,
            state: run.state,
            findings: run.findings ?? null,
            line: run.state === "running" ? (run.line ?? null) : null,
          },
    open_items: await openItemsOf(ctx, task, gateFile),
    needs_you: await needsYouOf(ctx, task),
    ...management,
    ...(await liveFields(ctx, task)),
  }
}

/** Home's own answer for this task (ui/model.ts `homeNeedsYou`), so the band never works it out apart. */
async function needsYouOf(ctx: Ctx, task: Task): Promise<{ words: string } | null> {
  const summary = await taskSummary(ctx, `${task.repoId}~${task.slug}`)
  const now = ctx.clock.now()
  if (!summary.ok || !homeNeedsYou(summary.data, now)) return null
  return { words: statusOf(summary.data, now).row.words }
}

/** The live part of the report: the build's progress, its open needs, a refusal (core/live, core/need). */
async function liveFields(
  ctx: Ctx,
  task: Task,
): Promise<Pick<StatusReport, "progress" | "needs" | "refusal" | "limit">> {
  const refusal = await readRefusal(ctx, task)
  const progress = await readBuildProgress(ctx, task).catch(() => null)
  const limit = await readLimit(ctx, task).catch(() => null)
  return {
    ...(limit ? { limit } : {}),
    progress: progress !== null ? { ...progress, words: progressWords(progress) } : null,
    needs: openNeeds(await readNeeds(ctx, task)).map((n) => ({
      for: n.for,
      what: n.what,
      waiting: n.waiting !== null,
    })),
    refusal:
      refusal !== null
        ? {
            lead: refusal.lead,
            words: refusal.words,
            count: refusal.count,
            errors: refusal.errors,
          }
        : null,
  }
}

/** Items waiting for the person; a task that holds none the list can show (or whose items cannot be read) says 0. */
async function openItemsOf(ctx: Ctx, task: Task, gate: Awaited<ReturnType<typeof readGate>>) {
  // The band asks often: read the items only where one can be open (as the App's task list does).
  const here = gate?.decision === "pending" || task.stage === "plan"
  // In the agents' steps nothing waits for the person, whatever gate file was left behind: the
  // same rule as the App's Needs you, so the band and Home never count differently.
  if (!here || isAutonomousBuildStage(task.stage, (await readVerifyMode(ctx, task)) ?? undefined))
    return 0
  try {
    return openCount(await taskItems(ctx, task, gate))
  } catch {
    return 0
  }
}
