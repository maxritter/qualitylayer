// What Settings › Sessions shows and does: the agents running on this computer with the memory of
// each one's process tree, and Stop idle now. Every stop uses core/run/idle.ts's own checks: an
// open turn, a question, an approval, a hold, a need or a helper keeps a session. The session's
// transcript is never touched, so Continue resumes it. The deadline of `sessions.idleStop` is
// idle-deadline.ts and stops through here. Separate from the 15-minute rule of a detached host
// (idle.ts) and from crash recovery.
//
// Nothing here runs on a timer. Memory is read when the page asks: one process-table read, kept a
// few seconds.

import type { Ctx } from "../../ctx.ts"
import { runAttention } from "./bind.ts"
import type { AgentKind, RunRecord } from "./contracts.ts"
import { nativeSessionFile } from "./control.ts"
import {
  idlePending,
  idleRunBlocked,
  idleRunBoundary,
  idleStateStamp,
  reserveIdleStop,
} from "./idle.ts"
import { releaseRunLeases } from "./lease.ts"
import { listedRun } from "./listed-run.ts"
import {
  MemoryTable,
  type ProcessMemory,
  parsePsMemory,
  processMemory,
  treeBytes,
} from "./process-memory.ts"
import { type connectHost, listRuns, readHost, readRun } from "./registry.ts"
import { connectOrRevive } from "./settle.ts"

export { MemoryTable, type ProcessMemory, parsePsMemory, processMemory, treeBytes }

export type SessionState = "working" | "needs-you" | "idle"
const STATE_WORDS: Record<SessionState, string> = {
  working: "Working",
  "needs-you": "Waits for you",
  idle: "Idle",
}

export type SessionRow = {
  run: string
  generation: number
  agent: AgentKind
  /** The task's title; for a session without a task, what it is for. */
  task: string
  taskId: string | null
  project: { id: string; name: string } | null
  /** The task's workflow step as the page names it ("Verify"); null for a session without a task or a chat. */
  step: string | null
  state: SessionState
  words: string
  /** Idle with nothing open: Stop idle now would stop it. */
  idle: boolean
  /** Why a settled session is not stopped though nothing waits on it; null for every other session. */
  keptOpen: string | null
  /** When the agent last finished a turn; null before its first. */
  lastTurnAt: number | null
  /** RSS of the host's process tree in bytes; null when the host is not in the process table. */
  memoryBytes: number | null
}

export type SessionsView = {
  sessions: SessionRow[]
  totalBytes: number
  idleCount: number
}

function lastTurnAt(run: RunRecord): number | null {
  const stop = (run.runEvents ?? [])
    .filter((row) => row.generation === run.generation && row.event === "Stop")
    .at(-1)
  const at = Date.parse(stop?.at ?? run.firstPromptAt ?? "")
  return Number.isFinite(at) ? at : null
}

/** Why a settled session with nothing waiting on it is still not stopped, in a sentence for a tooltip. */
function keptOpenReason(ctx: Ctx, run: RunRecord): string {
  return nativeSessionFile(ctx, run) === null
    ? "Its conversation record is not on this computer, so a stopped session could not be resumed."
    : "A file of its task could not be read, so it is kept open to be safe."
}

type Verdict = { state: SessionState; idle: boolean; keptOpen?: string }

/** A session whose turn has settled: idle and stoppable, waiting on a person, on a helper, or kept open. */
async function settledVerdict(ctx: Ctx, run: RunRecord): Promise<Verdict> {
  if (!(await idleRunBlocked(ctx, run))) return { state: "idle", idle: true }
  const pending = await idlePending(ctx, run)
  if (pending.human) return { state: "needs-you", idle: false }
  if (pending.helper) return { state: "working", idle: false }
  return { state: "idle", idle: false, keptOpen: keptOpenReason(ctx, run) }
}

/**
 * What a session is doing in words the page shows, and whether Stop idle now would stop it: only a
 * settled turn with nothing open is idle. A session whose state cannot be read counts as working.
 */
export async function sessionVerdict(ctx: Ctx, run: RunRecord): Promise<Verdict> {
  if (idleRunBoundary(run) === undefined)
    return {
      state: runAttention(run, ctx.clock.now()) === "clear" ? "working" : "needs-you",
      idle: false,
    }
  return settledVerdict(ctx, run).catch(() => ({ state: "working", idle: false }))
}

/** Where a build stands: the slice it is on (1-based) of how many. */
export type SliceProgress = { at: number; of: number }

export type SessionDescriber = (run: RunRecord) => Promise<
  Pick<SessionRow, "task" | "taskId" | "project" | "step"> & {
    /** Read only for a working session: the progress costs a look at the task's Plan and reports. */
    slice?: () => Promise<SliceProgress | null>
  }
>

/** "Working · slice 6 of 11" when the build's place is known; a progress that cannot be read says only the state. */
async function workingWords(
  words: string,
  slice: (() => Promise<SliceProgress | null>) | undefined,
) {
  const at = await slice?.().catch(() => null)
  return at === null || at === undefined ? words : `${words} · slice ${at.at} of ${at.of}`
}

/** The running sessions, newest activity first, with their memory read now (or a few seconds ago). */
export async function sessionsView(
  ctx: Ctx,
  describe: SessionDescriber,
  memory: MemoryTable = processMemory,
): Promise<SessionsView> {
  const running = listRuns(ctx.home).filter(listedRun)
  const table = running.length > 0 ? memory.rows(ctx.clock.now()) : null
  const sessions = await Promise.all(
    running.map(async (run): Promise<SessionRow> => {
      const [verdict, { slice, ...what }] = await Promise.all([
        sessionVerdict(ctx, run),
        describe(run),
      ])
      const words = verdict.keptOpen === undefined ? STATE_WORDS[verdict.state] : "Idle · kept open"
      return {
        run: run.id,
        generation: run.generation,
        agent: run.agent,
        ...what,
        state: verdict.state,
        words: verdict.state === "working" ? await workingWords(words, slice) : words,
        idle: verdict.idle,
        keptOpen: verdict.keptOpen ?? null,
        lastTurnAt: lastTurnAt(run),
        memoryBytes: table && run.host ? treeBytes(table, run.host.pid) : null,
      }
    }),
  )
  sessions.sort((a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0))
  return {
    sessions,
    totalBytes: sessions.reduce((sum, row) => sum + (row.memoryBytes ?? 0), 0),
    idleCount: sessions.filter((row) => row.idle).length,
  }
}

export type StopOutcome = { run: string; generation: number; stopped: boolean; reason?: string }

/** What a stop is made at: the settled turn's sequence and the task files as they stood. */
async function idleCandidate(
  ctx: Ctx,
  run: RunRecord,
): Promise<{ sequence: number; stamp: string } | null> {
  const sequence = idleRunBoundary(run)
  if (sequence === undefined) return null
  try {
    const stamp = idleStateStamp(run)
    return (await idleRunBlocked(ctx, run)) ? null : { sequence, stamp }
  } catch {
    // A state that cannot be read is never permission to stop.
    return null
  }
}

/** How long a stop waits for the host to end the agent's processes. */
const STOP_WAIT_MS = 10_000

export async function awaitStopped(ctx: Ctx, run: RunRecord): Promise<void> {
  await awaitStopOrRefusal(ctx, run, () => false)
}

/** Waits for the host to finish ending the run: true once it has, false as soon as `refused` says the host would not. */
export async function awaitStopOrRefusal(
  ctx: Ctx,
  run: RunRecord,
  refused: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + STOP_WAIT_MS
  while (Date.now() < deadline) {
    if (refused()) return false
    const current = readRun(ctx.home, run.id)
    if (current?.status === "stopped" && readHost(ctx.home, run.id)?.cleanup?.complete) {
      await releaseRunLeases(ctx, run.id, run.generation)
      return true
    }
    await Bun.sleep(25)
  }
  throw new Error("Still ending its processes")
}

/**
 * Stop `run` if it is idle now, with nothing open. The record is reserved at the settled turn
 * first, under the record's own lock, so anything typed or started since is refused; the host then
 * ends the agent's processes and keeps the transcript. Null when the session is not idle.
 */
export async function stopIfIdle(ctx: Ctx, run: RunRecord): Promise<StopOutcome | null> {
  const candidate = await idleCandidate(ctx, run)
  if (candidate === null) return null
  const outcome = { run: run.id, generation: run.generation }
  let connection: Awaited<ReturnType<typeof connectHost>>
  try {
    connection = await connectOrRevive(ctx.home, run.id)
  } catch {
    return { ...outcome, stopped: false, reason: "Its host does not answer" }
  }
  try {
    try {
      reserveIdleStop(ctx.home, run.id, run.generation, candidate.sequence, candidate.stamp)
    } catch {
      return { ...outcome, stopped: false, reason: "It changed before it was stopped" }
    }
    connection.send({ type: "control", action: "stop", generation: run.generation })
    await awaitStopped(ctx, run)
    return { ...outcome, stopped: true }
  } catch (cause) {
    return { ...outcome, stopped: false, reason: cause instanceof Error ? cause.message : "Failed" }
  } finally {
    connection.close()
  }
}

/** Stop every idle session now. Sessions that are not idle are left alone and not reported. */
export async function stopIdleNow(ctx: Ctx): Promise<StopOutcome[]> {
  const outcomes = await Promise.all(
    listRuns(ctx.home)
      .filter(listedRun)
      .map((run) => stopIfIdle(ctx, run)),
  )
  return outcomes.filter((outcome) => outcome !== null)
}
