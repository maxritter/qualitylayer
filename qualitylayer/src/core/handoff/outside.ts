// A task planned in the App and built outside it. The person pastes the build request into their
// own terminal, app or IDE; that session's `build start` takes the build (next/build-lead.ts). This
// module tells such a build from one the App runs, and finishes the App's planning session when the
// outside build picks the task up: it marks the planner's run as handed off, tells a planner whose
// turn has ended (through the App's own message path into its window) that the build is owned
// elsewhere, and leaves closing the session to its host, which stops it at the end of that turn
// (run/idle.ts). Nothing here ever fails the caller: the build goes on whatever this finds.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { folderDoc } from "../docs/names.ts"
import { readGate } from "../gate/gate.ts"
import { liveDir, type ProcessRow } from "../live/record.ts"
import { readBuildLead } from "../next/build-lead.ts"
import type { RunRecord } from "../run/contracts.ts"
import { listRuns } from "../run/registry.ts"
import { keyOf } from "../task/binding.ts"
import { readSession, type Task } from "../task/store.ts"
import { recentEvents } from "./outside-events.ts"

/** The steps a build session owns: Implement and Verify. */
export const BUILD_STEPS = new Set(["implement", "verify"])

const PLANNING_STEPS = new Set(["chat", "plan"])

/** The build of a task, run by a session the App does not run. */
export type OutsideBuild = {
  /** The agent's id (`codex`, `claude-code`, …), or null when nothing named it. */
  agent: string | null
  /** The session's key (never its raw id). */
  session: string
  /** The agent's own session id, for its resume command; null when unknown. */
  sessionId: string | null
  /** When it took the build. */
  since: number
  /** The folder it builds in. */
  folder: string
}

/** The App's runs that belong to this task. */
export function taskRuns(task: Pick<Task, "runtimeDir" | "slug" | "repoId">, runs: RunRecord[]) {
  const id = `${task.repoId}~${task.slug}`
  return runs.filter(
    (run) =>
      run.taskRuntimeDir === task.runtimeDir ||
      run.task === id ||
      (run.purpose.kind === "task" && (run.purpose.task === task.slug || run.purpose.task === id)),
  )
}

/** A run of the App's planning conversation for the task. */
export const planningRun = (run: RunRecord): boolean =>
  run.purpose.kind === "new-task" ||
  (run.purpose.kind === "task" && run.purpose.phase === "planning")

const live = (run: RunRecord) => ["validated", "starting", "running"].includes(run.status)

export async function readJson<T>(ctx: Ctx, path: string): Promise<T | null> {
  try {
    return JSON.parse(await ctx.fs.readFile(path)) as T
  } catch {
    return null
  }
}

async function resolveOutsideSession(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "repoRoot">,
  session: string,
  runs: RunRecord[] | undefined,
  activeAppPredicate: (run: RunRecord) => boolean,
): Promise<{ hookAt?: number; proc: ProcessRow | null } | null> {
  // A hook from an App run names that run: such a session is the App's own, with no registry read.
  const hook = await readJson<{ run?: unknown; at?: unknown }>(
    ctx,
    join(liveDir(task.runtimeDir), session, "hook.json"),
  )
  if (hook?.run !== undefined) return null
  const mine = taskRuns(task, runs ?? listRuns(ctx.home))
  const claimedByApp = mine.some(
    (run) =>
      (run.nativeSession && keyOf(run.nativeSession) === session) ||
      (activeAppPredicate(run) && live(run)),
  )
  if (claimedByApp) return null
  const proc = await readJson<ProcessRow>(
    ctx,
    join(liveDir(task.runtimeDir), session, "process.json"),
  )
  return {
    ...(typeof hook?.at === "number" ? { hookAt: hook.at } : {}),
    proc,
  }
}

/**
 * The task's build when a session outside the App runs it; null before the build, when an App
 * session builds it (it took the build, or a build session runs in the App now), or when no
 * session has taken it.
 */
export async function outsideBuild(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "stage" | "repoRoot">,
  runs?: RunRecord[],
): Promise<OutsideBuild | null> {
  if (!BUILD_STEPS.has(task.stage)) return null
  const writer = await readBuildLead(ctx, task)
  const session = writer?.session ?? null
  if (session === null) return null
  const outside = await resolveOutsideSession(ctx, task, session, runs, (run) => !planningRun(run))
  if (outside === null) return null
  const recorded = await readSession(ctx, task)
  return {
    agent: outside.proc?.agent ?? recorded?.agent ?? null,
    session,
    sessionId: outside.proc?.sessionId ?? null,
    since: writer?.since ?? ctx.clock.now(),
    folder: recorded?.checkout ?? task.repoRoot,
  }
}

/** Where a step's lead runs and which agent it is: the App or a session outside it. */
export type StepPlace = { agent: string | null; where: "app" | "outside"; session: string | null }

/** The task's lead session when it runs outside the App, planning or building; null when the App runs it or none does. */
export type OutsideLead = OutsideBuild & {
  phase: "planning" | "building"
  /** The planner waits on the Plan approval it opened: the App offers *Build in that session*. */
  waiting?: true
  /** The task's latest workflow events, newest first, in the App's words. */
  events: { at: number; what: string }[]
}

/**
 * The task's planning session when a session outside the App plans it (the person started the task
 * in their own terminal, app or IDE): the step's owner, unless the App runs that session or an App
 * planning session for the task is up.
 */
export async function outsidePlanner(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "stage" | "repoRoot">,
  runs?: RunRecord[],
): Promise<OutsideBuild | null> {
  if (!PLANNING_STEPS.has(task.stage)) return null
  const owner = await readJson<{ key?: unknown }>(ctx, join(liveDir(task.runtimeDir), "owner.json"))
  const session =
    typeof owner?.key === "string" && /^[a-f0-9]{16}$/.test(owner.key) ? owner.key : null
  if (session === null) return null
  const outside = await resolveOutsideSession(ctx, task, session, runs, planningRun)
  if (outside === null) return null
  const recorded = await readSession(ctx, task)
  return {
    agent: outside.proc?.agent ?? recorded?.agent ?? null,
    session,
    sessionId: outside.proc?.sessionId ?? null,
    since: recorded?.since ?? outside.hookAt ?? ctx.clock.now(),
    folder: recorded?.checkout ?? task.repoRoot,
  }
}

/** The task's lead when it runs outside the App: its planner before the approval, its build session after. */
export async function outsideLead(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "stage" | "repoRoot">,
): Promise<OutsideLead | null> {
  if (!BUILD_STEPS.has(task.stage) && !PLANNING_STEPS.has(task.stage)) return null
  const runs = listRuns(ctx.home)
  const build = await outsideBuild(ctx, task, runs)
  const lead = build ?? (await outsidePlanner(ctx, task, runs))
  if (lead === null) return null
  return {
    ...lead,
    phase: build !== null ? "building" : "planning",
    events: await recentEvents(ctx, task),
    ...(build === null && (await waitsOnPlan(ctx, task, lead.session)) ? { waiting: true } : {}),
  }
}

/**
 * Whether this planner opened the Plan gate that waits for the person: the App may then offer *Build
 * in that session*. The route it records names this same session.
 */
async function waitsOnPlan(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "stage">,
  session: string,
): Promise<boolean> {
  if (task.stage !== "plan") return false
  const gate = await readGate(ctx, task)
  if (!gate || gate.target !== folderDoc("plan")) return false
  if (gate.decision !== "pending" || gate.settled === true) return false
  return (
    typeof gate.id === "string" &&
    typeof gate.session === "string" &&
    keyOf(gate.session) === session
  )
}

/**
 * Where the task was planned: by an App planning session (the newest one), or by the session that
 * started it outside the App (its startup owner). Null when neither is known.
 */
export async function plannedPlace(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId">,
  runs?: RunRecord[],
): Promise<StepPlace | null> {
  const app = taskRuns(task, runs ?? listRuns(ctx.home))
    .filter(planningRun)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  if (app !== undefined)
    return {
      agent: app.agent,
      where: "app",
      session: app.nativeSession ? keyOf(app.nativeSession) : null,
    }
  const owner = await readJson<{ owner?: unknown }>(
    ctx,
    join(task.runtimeDir, "startup-owner.json"),
  )
  const session =
    typeof owner?.owner === "string" && /^[a-f0-9]{16}$/.test(owner.owner) ? owner.owner : null
  if (session === null) return null
  const proc = await readJson<ProcessRow>(
    ctx,
    join(liveDir(task.runtimeDir), session, "process.json"),
  )
  return { agent: proc?.agent ?? null, where: "outside", session }
}

/**
 * Where the task is built, once a build session took it: outside the App when that session is
 * not the App's, else the App session that holds it. Null before the build or with no build session.
 */
export async function builtPlace(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "stage" | "repoRoot">,
  runs?: RunRecord[],
): Promise<StepPlace | null> {
  if (!BUILD_STEPS.has(task.stage)) return null
  const all = runs ?? listRuns(ctx.home)
  const outside = await outsideBuild(ctx, task, all)
  if (outside !== null) return { agent: outside.agent, where: "outside", session: outside.session }
  const app = taskRuns(task, all)
    .filter((run) => !planningRun(run))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  return app === undefined
    ? null
    : {
        agent: app.agent,
        where: "app",
        session: app.nativeSession ? keyOf(app.nativeSession) : null,
      }
}

export { plannerFinishMessage } from "./finish-message.ts"
export {
  answeredHereMessage,
  finishPlannerForOutsideBuild,
  foreignBuildLead,
  plannerStopWords,
  wakeOutsideSession,
} from "./outside-actions.ts"
