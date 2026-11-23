// What the agents' hooks and every `qualitylayer` call leave for the live status: small files in
// the task's runtime folder, one folder per agent session, each written whole. Nothing here reads
// them back to decide anything (read.ts does, for the App and the band), and nothing here ever
// fails the caller: a hook that throws would stop the agent's tool call.
//
//   live/owner.json                 the session that works on the step (its latest workflow call)
//   live/cli.json                   the latest `qualitylayer` call for the task
//   live/errors.json                a refusal of QualityLayer's own, and how often it came in a row
//   live/<session>/hook.json        the session's latest hook: when, which event, its words, how a turn ended
//   live/<session>/process.json     the agent's process (the hook's parent) and its transcript
//   live/<session>/open/<id>.json   a tool call that started (PreToolUse) and has not finished
//   live/<session>/agents/<id>.json a subagent it started, and when it stopped
//
// A session is known by the key of its id (task/binding.ts), never by the raw id.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { nativePlanReceipt, recordNativePlan } from "../conversation/native-plan.ts"
import { type RepoRef, resolveRepo } from "../paths.ts"
import { recordRunHook } from "../run/bind.ts"
import { readRun } from "../run/registry.ts"
import { isArchived } from "../task/archive.ts"
import { boundSlug, keyOf, sessionKey } from "../task/binding.ts"
import { observedTarget } from "../task/bound-target.ts"
import { loadTask } from "../task/store.ts"
import type { EndKind } from "./liveness.ts"
import { agentProcess, lookupProbe, ownAgentProcess, type ProcessProbe } from "./process-probe.ts"
import { recordCall } from "./record-call.ts"
import { recordHookActivity, syncHookProcess } from "./record-hook-state.ts"
import { recordTodo } from "./todo.ts"
import { toolWords } from "./tool-words.ts"
import { agentOf, ownTranscript } from "./transcript.ts"

export {
  agentProcess,
  lookupProbe,
  ownAgentProcess,
  ownTranscript,
  type ProcessProbe,
  recordCall,
  toolWords,
}

export const LIVE_DIR = "live"

/** The fields of a hook's JSON that the live status reads. Claude Code and Codex share them. */
export type HookPayload = {
  hook_event_name?: unknown
  session_id?: unknown
  cwd?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  tool_input?: unknown
  tool_response?: unknown
  is_error?: unknown
  transcript_path?: unknown
  agent_id?: unknown
  agent_type?: unknown
  notification_type?: unknown
  message?: unknown
  reason?: unknown
  turn_id?: unknown
  permission_mode?: unknown
}

export type HookRow = {
  at: number
  event: string
  agent: string | null
  /** What the hook saw, short: "bun test started", "read client.ts". */
  words: string
  /** Set when this hook ended the turn or the session, or waits on a permission prompt. */
  end?: EndKind
  run?: { id: string; generation: number }
}

export type OpenTool = { at: number; words: string }
export type ProcessRow = {
  pid: number
  agent: string | null
  transcript: string | null
  at: number
  /** Native id for the client's resume command; folder names remain hashed. */
  sessionId?: string | null
}
export type SubagentRow = { id: string; words: string; started: number; stopped: number | null }
export type OwnerRow = { key: string; at: number }
export type CliRow = { at: number; command: string }
/** A refusal of QualityLayer's own: its kind (command and code), its words, and how many in a row. */
export type ErrorRow = {
  kind: string
  lead: string
  words: string
  count: number
  /** How many errors the latest refusal named (one for a refusal without a list). */
  errors?: number
  at: number
  /** The first of the row. */
  since: number
}

export const liveDir = (runtimeDir: string) => join(runtimeDir, LIVE_DIR)

export async function workflowOwnerKey(
  ctx: Ctx,
  task: { runtimeDir: string },
): Promise<string | null> {
  const owner = await readJson<OwnerRow>(ctx, join(liveDir(task.runtimeDir), "owner.json"))
  return owner && /^[a-f0-9]{16}$/.test(owner.key) ? owner.key : null
}
export const sessionDir = (runtimeDir: string, key: string) => join(runtimeDir, LIVE_DIR, key)

const str = (value: unknown): string => (typeof value === "string" ? value : "")

async function activeTask(
  ctx: Ctx,
  repo: RepoRef,
  slug: string,
): Promise<{ repo: RepoRef; slug: string; runtimeDir: string } | null> {
  const task = await loadTask(ctx, repo, slug)
  return task && !(await isArchived(ctx, task))
    ? { repo, slug: task.slug, runtimeDir: task.runtimeDir }
    : null
}

/** The task a session works on in this checkout: only one it is bound to, or the one named. */
export async function boundTask(
  ctx: Ctx,
  key: string | null,
): Promise<{ repo: RepoRef; slug: string; runtimeDir: string } | null> {
  if (key !== null) {
    const target = await observedTarget(ctx, key)
    if (target.kind === "blocked") return null
    if (target.kind === "bound") return activeTask(ctx, target.repo, target.slug)
  }
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return null
  const named = ctx.env.get("QUALITYLAYER_TASK")
  const slug =
    named !== undefined && named !== ""
      ? named
      : key !== null
        ? boundSlug(ctx, repo.data.id, key)
        : null
  return slug === null ? null : activeTask(ctx, repo.data, slug)
}

async function readJson<T>(ctx: Ctx, path: string): Promise<T | null> {
  try {
    return JSON.parse(await ctx.fs.readFile(path)) as T
  } catch {
    return null
  }
}

const write = (ctx: Ctx, path: string, value: unknown) =>
  ctx.fs.atomicWrite(path, `${JSON.stringify(value)}\n`)

function notificationEnd(payload: HookPayload): EndKind | undefined {
  const kind = str(payload.notification_type)
  const message = str(payload.message)
  if (
    kind === "permission_prompt" ||
    (kind === "" && /needs your permission to use/i.test(message))
  ) {
    return "permission"
  }
  if (kind === "idle_prompt" || (kind === "" && /waiting for your input/i.test(message))) {
    return "turn-end"
  }
  return undefined
}

const EVENT_ENDS: Readonly<Record<string, EndKind>> = {
  SessionEnd: "session-end",
  Stop: "turn-end",
  PermissionRequest: "permission",
}

/** How a hook ends the turn, if it does. */
function endOf(event: string, payload: HookPayload): EndKind | undefined {
  if (event === "Notification") return notificationEnd(payload)
  return EVENT_ENDS[event]
}

/**
 * One hook of an agent: what it did, when, and for a tool call whether it is still running. Only
 * for the task the session is bound to (or the one named by QUALITYLAYER_TASK): a session that
 * never ran QualityLayer for a task leaves nothing on it. Never throws.
 */
export async function recordHook(
  ctx: Ctx,
  payload: HookPayload,
  fallbackEvent: string,
  pidOf: () => number | null = ownAgentProcess,
  runRecorded = false,
): Promise<void> {
  try {
    if (!runRecorded) await recordRunHook(ctx, payload, fallbackEvent)
    const event = str(payload.hook_event_name) || fallbackEvent
    const end = endOf(event, payload)
    if (event === "Notification" && end === undefined) return
    const id = str(payload.session_id)
    const runId = ctx.env.get("QUALITYLAYER_RUN")
    const run = runId ? readRun(ctx.home, runId) : null
    const key = id !== "" ? keyOf(id) : sessionKey(ctx.env)
    if (key === null) return
    const task = await boundTask(ctx, key)
    if (task === null) return
    const now = ctx.clock.now()
    const dir = sessionDir(task.runtimeDir, key)
    await ctx.fs.mkdir(dir)
    const agent = agentOf(ctx, payload)
    let observedPid: number | null | undefined
    const processPid = () => {
      if (observedPid === undefined) observedPid = pidOf()
      return observedPid
    }
    if (
      !run &&
      agent === "codex" &&
      nativePlanReceipt(payload, fallbackEvent) &&
      processPid() !== null
    ) {
      await recordNativePlan(ctx, payload, fallbackEvent)
    }
    const words = await recordHookActivity(ctx, { dir, now, event, end, payload })
    // A turn or a session that ended runs no tool any more.
    if (end === "turn-end" || end === "session-end") await ctx.fs.remove(join(dir, "open"))
    await write(ctx, join(dir, "hook.json"), {
      at: now,
      event,
      agent,
      words,
      ...(end !== undefined ? { end } : {}),
      ...(run?.nativeSession === id ? { run: { id: run.id, generation: run.generation } } : {}),
    } satisfies HookRow)
    // A task list the agent reports (todo.ts decides which agents and calls carry one).
    await recordTodo(ctx, dir, now, agent, event, payload)
    await syncHookProcess(ctx, { dir, now, event, agent, id, payload, processPid })
    // A step nobody has claimed yet belongs to the first session that shows a sign of life.
    const ownerPath = join(liveDir(task.runtimeDir), "owner.json")
    if ((await readJson<OwnerRow>(ctx, ownerPath)) === null) {
      await write(ctx, ownerPath, { key, at: now } satisfies OwnerRow)
    }
  } catch {
    // The agent's tool call goes on whatever this finds.
  }
}
