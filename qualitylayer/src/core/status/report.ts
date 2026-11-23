// The task this session works on, read from git and the task files: the report `status --json`
// gives the Claude Code mod. Nothing here writes task state. It runs every few seconds in every
// session, so a read makes exactly one git call; everything else is a file read.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { taskSummary } from "../../server/api.ts"
import { cockpitUrl, liveLock } from "../../server/lock.ts"
import { appLinkOpensHere } from "../../server/machines/served.ts"
import { statusOf } from "../../ui/live-status.ts"
import { homeNeedsYou } from "../../ui/model.ts"
import type { Answers } from "../config-values.ts"
import { FLOW_STEPS, flowStepOf, isAutonomousBuildStage } from "../flow.ts"
import { type GateFile, readGate } from "../gate/gate.ts"
import { type Activity, activity } from "../helpers.ts"
import { openCount } from "../items.ts"
import {
  type BuildProgress,
  type ProgressWords,
  progressWords,
  readBuildProgress,
} from "../live/progress.ts"
import { readLimit, readRefusal } from "../live/read.ts"
import { openNeeds, readNeeds } from "../need/need.ts"
import { passRoles, type QualityRow, qualityRowsFor } from "../polish.ts"
import { readRun } from "../review/cross.ts"
import type { AnswerModeInfo } from "../task/answer-mode.ts"
import { taskItems } from "../task/items.ts"
import type { Stage } from "../task/machine.ts"
import { approvalsOf } from "../task/sides.ts"
import type { Task } from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { taskFlow } from "../task-flow.ts"
import { attentionFor, type Checkout, liveTaskFor, probeCheckout } from "./checkout.ts"
import { type DecisionSummary, managerStatus, type WaitingOn } from "./manager.ts"

export { attentionFor, type Checkout, liveTaskFor, probeCheckout }

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

async function pendingGateReport(
  ctx: Ctx,
  task: Task,
  gateFile: GateFile | null,
  now: number,
): Promise<StatusReport["gate"]> {
  if (gateFile?.decision !== "pending") return null
  const lock = appLinkOpensHere(ctx.home) ? await liveLock(ctx) : null
  return {
    target: gateFile.target,
    minutes: Math.round((now - gateFile.opened) / 60_000),
    cockpit: lock !== null ? cockpitUrl(lock, `${task.repoId}~${task.slug}`) : null,
  }
}

function helpersReport(
  running: Activity[],
  role: string | null,
  now: number,
): StatusReport["helpers"] {
  return running.flatMap((row) =>
    row.at !== null && row.line !== null && now - row.at < HELPER_SHOWN_MS
      ? [
          {
            id: row.id,
            role: row.role ?? role,
            state: row.state,
            model: row.model ?? null,
            model_source: row.model ? ("requested" as const) : ("unknown" as const),
            line: row.line,
            minutes: Math.round((now - row.at) / 60_000),
          },
        ]
      : [],
  )
}

async function reviewReport(ctx: Ctx, task: Task): Promise<StatusReport["review"]> {
  const run = (await readRun(ctx, task, "verify")) ?? (await readRun(ctx, task, "plan"))
  if (run === null) return null
  return {
    name: run.name,
    model: run.model,
    state: run.state,
    findings: run.findings ?? null,
    line: run.state === "running" ? (run.line ?? null) : null,
  }
}

function taskSummaryHeader(task: Task, kind: string): StatusReport["task"] {
  return {
    answers: task.answers,
    approvals: approvalsOf(task),
    id: `${task.repoId}~${task.slug}`,
    slug: task.slug,
    title: task.title,
    kind,
    stage: task.stage,
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
  if (task.type === "chat") {
    return {
      task: taskSummaryHeader(task, "Chat"),
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
  }
  const now = ctx.clock.now()
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
  return {
    task: taskSummaryHeader(task, task.type === "bugfix" ? "Bug fix" : "Feature"),
    track: trackOf(task.stage),
    gate: await pendingGateReport(ctx, task, gateFile, now),
    build,
    quality: await qualityRowsFor(
      ctx,
      task,
      passRoles(flow),
      running.map((row) => row.id),
    ),
    helpers: helpersReport(running, await helperRole(ctx, task), now),
    review: await reviewReport(ctx, task),
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
