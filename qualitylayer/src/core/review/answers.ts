// Every question on a line of the change gets an answer. The session waiting at the final review
// answers first: `gate wait` takes a question within a second and the session knows why the change
// looks as it does, so no new agent is spent. Whether a session really waits cannot always be told,
// so a small worker keeps the deadline: a question no session took within SESSION_PICK_MS, or took
// and then went quiet on for SESSION_QUIET_MS, goes to one fresh read-only helper, all such questions
// in one run. A session visibly at work keeps its question. A question neither answered says why,
// and Ask again sends it round once more.

import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Reviewer } from "../agents/binary.ts"
import { isNativeAgent, readOnlyEnforced } from "../agents/ids.ts"
import { modelName } from "../agents/model-values.ts"
import { otherReviewers } from "../agents/reviewer-pick.ts"
import { type AgentReach, pickDeadline } from "../comment-handling.ts"
import { readConfig } from "../config.ts"
import { DEFAULT_CONFIG, SESSION_MODEL } from "../config-values.ts"
import {
  type Comment,
  claimForHelper,
  helperOpen,
  openDocComment,
  openReviewQuestion,
  readComments,
} from "../gate/comments.ts"
import { lastSign, livenessOf } from "../live/liveness.ts"
import { readLive } from "../live/read.ts"
import { nativeCommand } from "../platform.ts"
import { pidAlive, selfCommand } from "../self.ts"
import { readSession, type Task } from "../task/store.ts"
import { answersIn, runHelper } from "./answers-helper.ts"
import { installedAgents, reviewWorkerEnv } from "./cross.ts"
import { reviewerContext } from "./vendors.ts"

export { answersIn }

/** A waiting session's `gate wait` takes a question within a second; one not taken by then has none. */
export const SESSION_PICK_MS = 15_000
/**
 * A session that took a question keeps it while it visibly works on it (a hook, its transcript, a
 * command): only once it has been quiet this long does the helper take it, so a hard question is
 * never answered twice on the person's subscription.
 */
export const SESSION_QUIET_MS = 60_000
/** However busy the session looks, a question it has held this long goes to the helper. */
export const SESSION_MAX_MS = 10 * 60_000
/** The worker looks again this often, and gives up waiting after this long with nothing to do. */
const POLL_MS = 2_000
const IDLE_EXIT_MS = 5_000
/** A heartbeat of a waiting session is younger than this: `wait` writes one every 15 s. */
const WAITING_FRESH_MS = 45_000

/** The worker of one task: kept in its runtime folder so the App shows who answers and how far. */
export type AnswerRun = {
  pid: number
  started: number
  /** The helper running now, if one does: who, on which model, and its latest step. */
  helper?: { name: string; model: string; started: number; line?: string; at?: number }
}

const runPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "answers.json")

export async function readAnswerRun(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<AnswerRun | null> {
  try {
    return JSON.parse(await ctx.fs.readFile(runPath(task))) as AnswerRun
  } catch {
    return null
  }
}

/** The task's worker while its process lives; null when none runs. */
export async function liveAnswerRun(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<AnswerRun | null> {
  const run = await readAnswerRun(ctx, task)
  return run !== null && pidAlive(run.pid) ? run : null
}

async function writeAnswerRun(ctx: Ctx, task: Pick<Task, "runtimeDir">, run: AnswerRun | null) {
  if (run === null) await ctx.fs.remove(runPath(task)).catch(() => {})
  else await ctx.fs.writeFile(runPath(task), `${JSON.stringify(run)}\n`)
}

/** A session of this task is in `gate wait` now: it says it waits, its heartbeat is fresh, it lives. */
export async function sessionWaiting(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<boolean> {
  const session = await readSession(ctx, task)
  if (session === null || session.state !== "waiting") return false
  if (ctx.clock.now() - session.heartbeat > WAITING_FRESH_MS) return false
  const live = await readLive(ctx, task).catch(() => null)
  return live?.process !== "gone"
}

/** When the task's session last showed a sign of life (a hook, its transcript, a command); null if never. */
async function lastSignAt(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<number | null> {
  const live = await readLive(ctx, task).catch(() => null)
  return live === null ? null : (lastSign(live)?.at ?? null)
}

/**
 * The comments due to the helper now: none the session may still take, or is still visibly
 * answering. A question on the change with no session waiting is due at once; a comment on a
 * document waits for the session as long as its reach says (90 s while the agent works, 20 s when
 * its turn ended, 15 s in `gate wait`), or goes now when the person asked for a helper.
 */
export function dueForHelper(
  c: Comment,
  now: number,
  waiting: boolean,
  lastSign: number | null = null,
  reach: AgentReach = waiting ? "waiting" : "idle",
): boolean {
  const document = openDocComment(c)
  if ((!document && !openReviewQuestion(c)) || c.answeredBy === "helper") return false
  if (document && c.helperNow !== undefined) return true
  if (c.answeredBy === "session" || (document && c.delivered === true)) {
    const held = now - (c.pickedAt ?? c.created)
    const quietSince = Math.max(c.pickedAt ?? c.created, lastSign ?? 0)
    return held >= SESSION_MAX_MS || now - quietSince >= SESSION_QUIET_MS
  }
  return document
    ? now - c.created >= pickDeadline(reach)
    : !waiting || now - c.created >= SESSION_PICK_MS
}

/** Whether the agent can read a comment soon: waiting in `gate wait`, at work, or neither. */
export async function reachOf(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  waiting: boolean,
): Promise<AgentReach> {
  if (waiting) return "waiting"
  const live = await readLive(ctx, task).catch(() => null)
  if (live === null) return "unknown"
  const state = livenessOf(live, ctx.clock.now()).state
  return state === "working" ? "busy" : state === "none" ? "unknown" : "idle"
}

/** Start the task's worker unless one already runs; it ends by itself once every question is settled. */
export async function startAnswering(
  ctx: Ctx,
  task: Task,
  /** The worker's command: a task's by default; a project's artifacts name their own holder. */
  command_: string[] = ["review", "answer", "--task", task.slug],
): Promise<void> {
  if ((await liveAnswerRun(ctx, task)) !== null) return
  const [command, ...args] = selfCommand(command_)
  const [program, ...parameters] = nativeCommand(command as string, args)
  await ctx.fs.mkdir(task.runtimeDir)
  const log = join(task.runtimeDir, "answers-startup.log")
  await ctx.fs.writeFile(log, "", { mode: 0o600 })
  const stderr = openSync(log, "a")
  try {
    const admitted = await installedAgents(ctx)
    const agent = (await helperFor(ctx, task))?.by
    const child = spawn(program as string, parameters, {
      cwd: task.repoRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stderr, stderr],
      env: agent !== undefined ? await reviewWorkerEnv(ctx, admitted, { by: agent }) : process.env,
    })
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve)
      child.once("error", reject)
    })
    child.unref()
    if (child.pid !== undefined)
      await writeAnswerRun(ctx, task, { pid: child.pid, started: ctx.clock.now() })
  } finally {
    closeSync(stderr)
  }
}

/** The helper: the working agent's own vendor on its helpers' model, else any installed agent. */
export async function helperFor(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<{ by: Reviewer; model: string; name: string } | null> {
  const installed = await installedAgents(ctx)
  const working = (await readSession(ctx, task))?.agent
  // A working agent whose read-only review is only detected does not answer: an enforced one does.
  const by =
    working !== undefined &&
    isNativeAgent(working) &&
    installed.includes(working) &&
    readOnlyEnforced(working)
      ? working
      : otherReviewers(
          "",
          installed,
          await reviewerContext(ctx, working ?? "unknown", task, "helpers"),
        )[0]
  if (by === undefined) return null
  const configured = (await readConfig(ctx)).models[by].helpers
  const model = configured === SESSION_MODEL ? DEFAULT_CONFIG.models[by].helpers : configured
  return { by, model, name: modelName(by, model) }
}

/**
 * The worker (`review answer`): wait out the session's deadlines, hand what is due to a helper,
 * and end once no question waits.
 */
export async function runAnswers(
  ctx: Ctx,
  task: Task,
  /** Answers claimed questions and settles each; tests pass one that starts no agent. */
  helper: (ctx: Ctx, task: Task, run: AnswerRun, questions: Comment[]) => Promise<void> = runHelper,
): Promise<{ answered: number }> {
  const run: AnswerRun = { pid: process.pid, started: ctx.clock.now() }
  await writeAnswerRun(ctx, task, run)
  let handed = 0
  let idleSince = ctx.clock.now()
  try {
    // One worker runs per task: a question a helper took and never settled was left by one that died.
    const orphans = (await readComments(ctx, task)).filter(
      (c) => helperOpen(c) && c.answeredBy === "helper",
    )
    if (orphans.length > 0) {
      handed += orphans.length
      await helper(ctx, task, run, orphans)
    }
    for (;;) {
      const now = ctx.clock.now()
      const waiting = await sessionWaiting(ctx, task)
      const sign = await lastSignAt(ctx, task)
      const reach = await reachOf(ctx, task, waiting)
      const due = await claimForHelper(ctx, task, (c) => dueForHelper(c, now, waiting, sign, reach))
      if (due.length > 0) {
        handed += due.length
        await helper(ctx, task, run, due)
        idleSince = ctx.clock.now()
        continue
      }
      const open = (await readComments(ctx, task)).some(
        (c) => helperOpen(c) && c.answeredBy !== "helper",
      )
      if (open) idleSince = ctx.clock.now()
      else if (ctx.clock.now() - idleSince >= IDLE_EXIT_MS) break
      await ctx.clock.sleep(POLL_MS)
    }
  } finally {
    const last = await readAnswerRun(ctx, task)
    if (last?.pid === process.pid) await writeAnswerRun(ctx, task, null)
  }
  return { answered: handed }
}
