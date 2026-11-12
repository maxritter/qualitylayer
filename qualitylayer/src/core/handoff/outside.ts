// A task planned in the App and built outside it. The person pastes the build request into their
// own terminal, app or IDE; that session's `build start` takes the build (next/build-lead.ts). This
// module tells such a build from one the App runs, and finishes the App's planning session when the
// outside build picks the task up: it marks the planner's run as handed off, tells a planner whose
// turn has ended (through the App's own message path into its window) that the build is owned
// elsewhere, and leaves closing the session to its host, which stops it at the end of that turn
// (run/idle.ts). Nothing here ever fails the caller: the build goes on whatever this finds.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { AGENT_NAMES, isNativeAgent } from "../agents/ids.ts"
import { folderDoc } from "../docs/names.ts"
import { readGate } from "../gate/gate.ts"
import { liveDir, type ProcessRow } from "../live/record.ts"
import { readBuildLead } from "../next/build-lead.ts"
import type { RunRecord } from "../run/contracts.ts"
import { idleRunBoundary } from "../run/idle.ts"
import { listRuns, readHost, updateRun } from "../run/registry.ts"
import { sendToRun } from "../run/send-message.ts"
import { keyOf, sessionKey } from "../task/binding.ts"
import { readEvents, readSession, type Task } from "../task/store.ts"
import { outsideAgentName, plannerFinishMessage } from "./finish-message.ts"
import { readStart } from "./start.ts"

/** The steps a build session owns: Implement and Verify. */
const BUILD_STEPS = new Set(["implement", "verify"])

/** Someone typed into the planner's window this recently: QualityLayer does not speak over them. */
const TYPED_QUIET_MS = 31_000

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
function taskRuns(task: Pick<Task, "runtimeDir" | "slug" | "repoId">, runs: RunRecord[]) {
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

async function readJson<T>(ctx: Ctx, path: string): Promise<T | null> {
  try {
    return JSON.parse(await ctx.fs.readFile(path)) as T
  } catch {
    return null
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
  // A hook from an App run names that run: such a session is the App's own, with no registry read.
  const hook = await readJson<{ run?: unknown }>(
    ctx,
    join(liveDir(task.runtimeDir), session, "hook.json"),
  )
  if (hook?.run !== undefined) return null
  const mine = taskRuns(task, runs ?? listRuns(ctx.home))
  if (mine.some((run) => run.nativeSession && keyOf(run.nativeSession) === session)) return null
  // The build came back: a build session the App runs for this task is up.
  if (mine.some((run) => !planningRun(run) && live(run))) return null
  const proc = await readJson<ProcessRow>(
    ctx,
    join(liveDir(task.runtimeDir), session, "process.json"),
  )
  const recorded = await readSession(ctx, task)
  return {
    agent: proc?.agent ?? recorded?.agent ?? null,
    session,
    sessionId: proc?.sessionId ?? null,
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

const STEP_WORD: Record<string, string> = {
  plan: "Plan",
  implement: "Implement",
  verify: "Verify",
}

/** One workflow event in the App's words, or null for one the person need not see. */
export function eventWords(event: Record<string, unknown>): string | null {
  const name = event.event
  const target = typeof event.target === "string" ? event.target : ""
  switch (name) {
    case "task_created":
      return "Task started"
    case "plan_drafted":
      return "Plan drafted"
    case "gate_opened":
      return /plan/i.test(target) ? "Plan ready for approval" : "Ready for your review"
    case "gate_approved":
      return "Plan approved"
    case "plan_amended":
      return "Plan amended"
    case "verify_ready":
      return "Ready for your review"
    case "implement_started":
      return "Implement started"
    case "tasks_complete":
      return "Implement done"
    case "verify_result":
      return typeof event.result === "string" ? `Verify ${event.result}` : "Verify ran"
    case "round_started":
      return "Fix round started"
    case "checkpoint_result":
      return "Checkpoint ran"
    case "task_shipped":
      return "Shipped"
  }
  const to = typeof event.to === "string" ? STEP_WORD[event.to] : undefined
  return to !== undefined ? `${to} started` : null
}

/** The task's latest events the person can read, newest first. */
async function recentEvents(ctx: Ctx, task: Pick<Task, "runtimeDir">, count = 4) {
  const rows: { at: number; what: string }[] = []
  for (const event of (await readEvents(ctx, task)).reverse()) {
    const what = eventWords(event)
    if (what === null || typeof event.ts !== "number") continue
    if (rows.some((row) => row.what === what)) continue
    rows.push({ at: event.ts, what })
    if (rows.length === count) break
  }
  return rows
}

const PLANNING_STEPS = new Set(["chat", "plan"])

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
  const hook = await readJson<{ run?: unknown; at?: unknown }>(
    ctx,
    join(liveDir(task.runtimeDir), session, "hook.json"),
  )
  if (hook?.run !== undefined) return null
  const mine = taskRuns(task, runs ?? listRuns(ctx.home))
  if (mine.some((run) => run.nativeSession && keyOf(run.nativeSession) === session)) return null
  if (mine.some((run) => planningRun(run) && live(run))) return null
  const proc = await readJson<ProcessRow>(
    ctx,
    join(liveDir(task.runtimeDir), session, "process.json"),
  )
  const recorded = await readSession(ctx, task)
  return {
    agent: proc?.agent ?? recorded?.agent ?? null,
    session,
    sessionId: proc?.sessionId ?? null,
    since: recorded?.since ?? (typeof hook?.at === "number" ? hook.at : ctx.clock.now()),
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
  return (
    gate?.target === folderDoc("plan") &&
    gate.decision === "pending" &&
    gate.settled !== true &&
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

export { plannerFinishMessage } from "./finish-message.ts"

export type PlannerFinish = { run: string; told: boolean }

/**
 * The outside build picked the task up: every App planning session of the task that still runs is
 * marked handed off, and one whose turn has ended (and that nobody typed into just now) is told so
 * in its window. Its host closes it at the end of its next turn. Idempotent: a marked run is left
 * alone. Never throws.
 */
export async function finishPlannerForOutsideBuild(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "stage" | "repoRoot">,
  send: (run: RunRecord, text: string) => Promise<void> = (run, text) => sendToRun(ctx, run, text),
): Promise<PlannerFinish[]> {
  try {
    const runs = listRuns(ctx.home)
    const build = await outsideBuild(ctx, task, runs)
    if (build === null) return []
    const done: PlannerFinish[] = []
    for (const run of taskRuns(task, runs)) {
      if (!planningRun(run) || run.status !== "running" || run.handedOff) continue
      let marked: RunRecord
      try {
        marked = updateRun(ctx.home, run.id, run.generation, (current) =>
          current.handedOff || current.status !== "running"
            ? null
            : {
                handedOff: {
                  agent: build.agent,
                  session: build.session,
                  at: new Date(ctx.clock.now()).toISOString(),
                  sequence: current.eventSequence ?? 0,
                  told: false,
                },
              },
        )
      } catch {
        continue
      }
      if (!marked.handedOff || marked.handedOff.session !== build.session) continue
      const lastInput = readHost(ctx.home, run.id)?.lastInputAt
      const typing = lastInput !== undefined && ctx.clock.now() - lastInput < TYPED_QUIET_MS
      let told = false
      // A planner in a turn learns it from its next `next` or `wait`; an idle one is told now.
      if (idleRunBoundary(marked) !== undefined && !typing) {
        try {
          await send(marked, plannerFinishMessage(build.agent))
          told = true
          const handedOff = marked.handedOff
          updateRun(ctx.home, run.id, run.generation, { handedOff: { ...handedOff, told: true } })
        } catch {
          // The host is gone or of another generation: nothing to tell, nothing waits on it.
        }
      }
      done.push({ run: run.id, told })
    }
    return done
  } catch {
    return []
  }
}

/**
 * What `next` tells the App's planner once the Plan is approved and the build is a build session's:
 * who builds it and where, never "open the Agent panel" when the build runs (or is to run) outside
 * the App. The instructions are the same in every case: one closing line, then end the turn.
 */
export async function plannerStopWords(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "stage" | "repoRoot">,
): Promise<{ message: string; instructions: string; built_outside?: { agent: string | null } }> {
  const instructions =
    "End this planning turn with one closing line for the person. Do not change the task or continue its build from this planning launch."
  const build = await outsideBuild(ctx, task).catch(() => null)
  // The planner's own session never builds "outside" itself.
  if (build !== null && build.session !== sessionKey(ctx.env))
    return {
      message: `Planning is complete. ${outsideAgentName(build.agent)} builds this task outside the App.`,
      instructions: `${instructions} The build session outside the App owns it now.`,
      built_outside: { agent: build.agent },
    }
  const start = await readStart(ctx, task)
  if (start?.answers === "terminal")
    return {
      message: "Planning is complete. The build runs outside the App.",
      instructions: `${instructions} The person starts the build in their own agent: a terminal, IDE or agent app.`,
    }
  return {
    message: "Planning is complete. Open this task's Agent panel in the App to continue.",
    instructions: `${instructions} The person chooses which session implements it.`,
  }
}

/** A session that is not the task's build lead, and who the lead is. */
export type ForeignLead = {
  /** Why it may not settle the build's gates or answer its questions, in the person's words. */
  message: string
  /** Where the lead runs, as a phrase: "the App (Codex)", "another terminal (Claude Code)". */
  place: string
  where: "app" | "outside" | null
  agent: string | null
}

/**
 * From `build start` on, the session that took the build (next/build-lead.ts) leads it and owns
 * its gates, up to the final approval; a planner whose build was handed off is finished. Null
 * when `key` leads, when the task is not in a build step, when no session took the build, or when
 * the caller has no session key (a person at a plain terminal). Otherwise the refusal naming the
 * lead's place, for `gate decide` and `question answered`.
 */
export async function foreignBuildLead(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "stage" | "repoRoot">,
  key: string | null = sessionKey(ctx.env),
): Promise<ForeignLead | null> {
  if (key === null || !BUILD_STEPS.has(task.stage)) return null
  const writer = await readBuildLead(ctx, task)
  if (writer === null || writer.session === null || writer.session === key) return null
  const place = await builtPlace(ctx, task).catch(() => null)
  const agent = place?.agent ?? null
  const who = agent !== null && isNativeAgent(agent) ? ` (${AGENT_NAMES[agent]})` : ""
  const where =
    place?.where === "app"
      ? `the App${who}`
      : place?.where === "outside"
        ? `another terminal${who}`
        : "another session"
  return {
    message: `This task's build runs in ${where}. Answer there, or review it in the App.`,
    place: where,
    where: place?.where ?? null,
    agent,
  }
}

/** How a session outside the App is woken with a message: Codex takes one through its own queue. */
export type OutsideWaker = (threadId: string, text: string, cwd: string) => "queued" | "waiting"

/**
 * The person answered here a question the outside session asked in its terminal: wake that session
 * with the answer through QualityLayer's message path, so it goes on without waiting for the person
 * to type there. Codex is woken through its own queue; another agent picks the answer up at its next
 * QualityLayer call. Returns how it was told; never throws.
 */
export async function wakeOutsideSession(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "slug" | "repoId" | "stage" | "repoRoot">,
  text: string,
  wake?: OutsideWaker,
): Promise<"queued" | "waiting" | "not-woken"> {
  try {
    const owner = await readJson<{ key?: unknown }>(
      ctx,
      join(liveDir(task.runtimeDir), "owner.json"),
    )
    const key =
      typeof owner?.key === "string" && /^[a-f0-9]{16}$/.test(owner.key) ? owner.key : null
    if (key === null) return "not-woken"
    const hook = await readJson<{ run?: unknown }>(
      ctx,
      join(liveDir(task.runtimeDir), key, "hook.json"),
    )
    // A session the App runs hears its answers through the App's own wait.
    if (hook?.run !== undefined) return "not-woken"
    const proc = await readJson<ProcessRow>(
      ctx,
      join(liveDir(task.runtimeDir), key, "process.json"),
    )
    if (
      proc?.agent !== "codex" ||
      !proc.sessionId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(proc.sessionId)
    )
      return "not-woken"
    const recorded = await readSession(ctx, task)
    const queue = wake ?? (await import("../peers/codex.ts")).codexQueueOrWait
    return queue(proc.sessionId, text, recorded?.checkout ?? task.repoRoot)
  } catch {
    return "not-woken"
  }
}

/** What the outside session is told when the person answered its question in the App. */
export function answeredHereMessage(number: number, choice: string): string {
  return (
    `QualityLayer: the person answered question ${number} in the App: “${choice}”. ` +
    "It is recorded; do not ask it again. Run qualitylayer next and go on."
  )
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
