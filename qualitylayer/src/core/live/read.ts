// The live signals of one task, as the server reads them for the App and the band: the files the
// hooks and the CLI left (record.ts), the transcript's time, the process, and the question's
// heartbeat. The rules that turn them into "working", "quiet" or "stopped" are liveness.ts's.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { acceptedTurnBoundary } from "../run/bind.ts"
import type { ProcessIdentity, RunRecord } from "../run/contracts.ts"
import { identityState, readRun } from "../run/registry.ts"
import { keyOf } from "../task/binding.ts"
import { readSession, type Task } from "../task/store.ts"
import type { EndKind, LiveSignals } from "./liveness.ts"
import { processGonePath, watchProcess } from "./monitor.ts"
import { readBackground, readLimit, readRefusal } from "./read-background.ts"
import {
  QUESTION_HEARTBEAT,
  readCliAndQuestion,
  readHooks,
  readJson,
  readOpenTool,
  readSubagents,
} from "./read-files.ts"
import {
  interruptedIn,
  LIMIT_QUIET_MS,
  limitFact,
  limitStopOf,
  modelWaitingIn,
  observeLimitRechecks,
  observeLimitStops,
  type Probe,
  realProbe,
} from "./read-limit.ts"
import { type HookRow, liveDir, type OwnerRow, type ProcessRow } from "./record.ts"
import { readTodo } from "./todo.ts"

export {
  interruptedIn,
  LIMIT_QUIET_MS,
  limitStopOf,
  observeLimitRechecks,
  observeLimitStops,
  type Probe,
  QUESTION_HEARTBEAT,
  readBackground,
  readLimit,
  readRefusal,
  realProbe,
}

function managedLeadOf(
  run: RunRecord | null,
  hook: HookRow | null,
  owner: string | null,
  runtimeDir: string,
): ProcessIdentity | null {
  if (!run || run.generation !== hook?.run?.generation || !run.nativeSession) return null
  if (keyOf(run.nativeSession) !== owner) return null
  if (run.taskRuntimeDir !== undefined && run.taskRuntimeDir !== runtimeDir) return null
  return run.lead?.knownBy === "lead" ? run.lead : null
}

function processStateOf(
  probe: Probe,
  pid: number | undefined,
  lead: ProcessIdentity | null,
): LiveSignals["process"] {
  if (lead !== null) {
    const state = (probe.identity ?? identityState)(lead)
    return state === "live" ? "alive" : state === "dead" ? "gone" : "unknown"
  }
  return pid === undefined ? "unknown" : probe.alive(pid) ? "alive" : "gone"
}

function isBlockedManagedEnd(
  end: { at: number; kind: EndKind } | null,
  ownHook: HookRow | null,
  run: RunRecord | null,
): boolean {
  if (!ownHook?.run || end === null) return false
  if (end.kind === "permission") return true
  if (end.kind !== "turn-end") return false
  return !run || run.generation !== ownHook.run.generation || !acceptedTurnBoundary(run)
}

function resolveEnd(
  ownHook: HookRow | null,
  run: RunRecord | null,
  transcript: number | null,
  tail: string | null,
): { at: number; kind: EndKind } | null {
  let end: { at: number; kind: EndKind } | null =
    ownHook?.end !== undefined ? { at: ownHook.at, kind: ownHook.end } : null
  // Managed permission waits notify from RunProvider after their keyed delay; task notices
  // must not announce the same wait immediately. A blocked Stop is not a quiet task either.
  if (isBlockedManagedEnd(end, ownHook, run)) end = null
  // Esc leaves no hook behind; the transcript says so.
  const canCheckInterrupt =
    tail !== null && transcript !== null && (end === null || transcript > end.at)
  if (canCheckInterrupt && interruptedIn(tail)) {
    end = { at: transcript, kind: "interrupted" }
  }
  return end
}

function isModelWaiting(input: {
  processState: LiveSignals["process"]
  end: { at: number; kind: EndKind } | null
  limit: unknown
  tool: LiveSignals["tool"]
  tail: string | null
}): boolean {
  if (input.processState === "gone" || input.end !== null || input.limit !== null) return false
  return input.tool === null && input.tail !== null && modelWaitingIn(input.tail)
}

function transcriptTailOf(
  proc: ProcessRow | null,
  probe: Probe,
): { transcript: number | null; tail: string | null } {
  if (proc?.transcript == null) return { transcript: null, tail: null }
  const transcript = probe.mtime(proc.transcript)
  return { transcript, tail: transcript !== null ? probe.tail(proc.transcript, 8192) : null }
}

/** One task's signals, or null when no session ever spoke for it. */
export async function readLive(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  probe: Probe = realProbe,
): Promise<LiveSignals | null> {
  const dir = liveDir(task.runtimeDir)
  const now = ctx.clock.now()
  const session = await readSession(ctx, task)
  const { cli, question, ask } = await readCliAndQuestion(
    ctx,
    dir,
    task.runtimeDir,
    session?.heartbeat ?? null,
    probe,
  )
  const hooks = await readHooks(ctx, dir)
  if (hooks.size === 0 && cli === null && question === null) return null

  // The owner is the session of the latest workflow call; before any, the newest that spoke.
  const owner =
    (await readJson<OwnerRow>(ctx, join(dir, "owner.json")))?.key ??
    [...hooks.entries()].sort((a, b) => b[1].at - a[1].at)[0]?.[0] ??
    null
  const newest = [...hooks.values()].sort((a, b) => b.at - a.at)[0] ?? null
  const ownHook = owner !== null ? (hooks.get(owner) ?? null) : null
  const proc =
    owner !== null ? await readJson<ProcessRow>(ctx, join(dir, owner, "process.json")) : null
  const run = ownHook?.run ? readRun(ctx.home, ownHook.run.id) : null
  const lead = managedLeadOf(run, ownHook, owner, task.runtimeDir)
  const pid = lead?.pid ?? proc?.pid
  const processState = processStateOf(probe, pid, lead)
  const gone =
    owner === null
      ? null
      : await readJson<{ pid: number; at: number }>(ctx, processGonePath(task.runtimeDir, owner))
  if (probe === realProbe && pid !== undefined && owner !== null && processState === "alive") {
    watchProcess(ctx, task.runtimeDir, owner, pid, probe)
  }

  const tool = owner !== null ? await readOpenTool(ctx, dir, owner, now) : null
  const agents = owner !== null ? await readSubagents(ctx, dir, owner) : []
  const todo = owner !== null ? await readTodo(ctx, join(dir, owner)) : null
  const { transcript, tail } = transcriptTailOf(proc, probe)
  let end = resolveEnd(ownHook, run, transcript, tail)

  const agent = ownHook?.agent ?? proc?.agent ?? newest?.agent ?? session?.agent ?? null
  const limit =
    processState === "gone"
      ? null
      : limitStopOf(
          probe,
          proc?.agent ?? ownHook?.agent ?? null,
          proc?.transcript ?? null,
          Math.max(ownHook?.at ?? 0, cli?.at ?? 0, question ?? 0),
          now,
          ownHook?.run?.id ?? null,
        )
  // The turn the limit ended was aborted by the error, not by the person's Esc.
  if (limit !== null && end?.kind === "interrupted") end = null
  const modelWaiting = isModelWaiting({ processState, end, limit, tool, tail })

  return {
    agent,
    session: owner,
    sessionId: proc?.sessionId ?? null,
    hook: newest !== null ? { at: newest.at, event: newest.event, words: newest.words } : null,
    tool,
    ...(modelWaiting ? { modelWaiting: true } : {}),
    transcript,
    cli,
    question,
    ask,
    process: processState,
    stoppedAt: processState === "gone" && gone?.pid === pid ? (gone?.at ?? null) : null,
    end,
    agents,
    ...(todo !== null ? { todo } : {}),
    ...(limit !== null ? { limit: await limitFact(ctx, limit, ownHook?.run?.id ?? null) } : {}),
  }
}
