import { realpathSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"
import { type Ctx, err, type Result } from "../../ctx.ts"
import { sessionVariables } from "../agents/detect.ts"
import { readArtifactAgentContext } from "../artifact/agent-context.ts"
import { recordNativePlan } from "../conversation/native-plan.ts"
import { currentBranch } from "../git/repo.ts"
import { RUN_BRIEF_FILES_KEPT, RUN_BRIEF_MAX_BYTES, RUN_BRIEFS_MAX_BYTES } from "../home-caps.ts"
import { resolveRepo } from "../paths.ts"
import { canonicalPath } from "../platform.ts"
import { isArchived } from "../task/archive.ts"
import { sessionKey } from "../task/binding.ts"
import { parseStart } from "../task/intake.ts"
import { loadTask, readmeFrontmatter, type Task } from "../task/store.ts"
import { isNoProgressHalt, type RunEvent, type RunRecord } from "./contracts.ts"
import { decideIntent, INTENT_HELPER_WAIT, intentFacts } from "./intent.ts"
import { AGENT_CAPABILITIES } from "./launch-spec.ts"
import { leadCaller } from "./lead-process.ts"
import { refreshRunLeases } from "./lease.ts"
import { recordNativeSession } from "./native-sessions.ts"
import { processIdentity, readRun, runDir, updateRun } from "./registry.ts"

type Payload = {
  cwd?: unknown
  hook_event_name?: unknown
  session_id?: unknown
  turn_id?: unknown
  permission_mode?: unknown
  notification_type?: unknown
  message?: unknown
  reason?: unknown
  source?: unknown
  agent_pid?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  tool_input?: unknown
  tool_response?: unknown
  is_error?: unknown
}
const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 256) : "")
const EVENTS_KEPT = 64
const EVENT_BYTES = 16 * 1024
export function retainEvents(rows: RunEvent[]): RunEvent[] {
  const kept = rows.slice(-EVENTS_KEPT)
  while (kept.length > 1 && Buffer.byteLength(JSON.stringify(kept)) > EVENT_BYTES) kept.shift()
  return kept
}

function managed(ctx: Ctx): RunRecord | null {
  const id = ctx.env.get("QUALITYLAYER_RUN")
  return id ? readRun(ctx.home, id) : null
}

/** The native read grant contains generated Markdown only, never tokens or other runs' inputs. */
export async function runBriefsDirectory(ctx: Ctx, id: string): Promise<string> {
  const root = runDir(ctx.home, id)
  const expectedRoot = join(canonicalPath(realpathSync(ctx.home)), "runs", id)
  await ctx.fs.mkdir(root)
  if (relative(expectedRoot, canonicalPath(realpathSync(root))) !== "")
    throw new Error("Run inputs directory must not redirect outside its generated input scope")
  const dir = join(root, "briefs")
  await ctx.fs.mkdir(dir)
  const actual = canonicalPath(realpathSync(dir))
  if (relative(join(expectedRoot, "briefs"), actual) !== "")
    throw new Error("Run briefs directory must not redirect outside its generated input scope")
  return actual
}

export async function taskBriefsDirectory(ctx: Ctx, task: { runtimeDir: string }): Promise<string> {
  const withinHome = relative(ctx.home, task.runtimeDir)
  if (isAbsolute(withinHome) || withinHome.split(/[\\/]/).includes(".."))
    throw new Error("Task inputs must stay in this QualityLayer home")
  const expectedRuntime = join(canonicalPath(realpathSync(ctx.home)), withinHome)
  await ctx.fs.mkdir(task.runtimeDir)
  if (relative(expectedRuntime, canonicalPath(realpathSync(task.runtimeDir))) !== "")
    throw new Error("Task runtime directory must not redirect outside its generated input scope")
  const expected = join(expectedRuntime, "briefs")
  await ctx.fs.mkdir(join(task.runtimeDir, "briefs"))
  const actual = canonicalPath(realpathSync(join(task.runtimeDir, "briefs")))
  if (relative(expected, actual) !== "")
    throw new Error("Task briefs directory must not redirect outside its generated input scope")
  return actual
}

export async function checkGeneratedBrief(ctx: Ctx, file: string): Promise<void> {
  if (!ctx.managedBriefsDir) return
  const name = relative(ctx.managedBriefsDir, file)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.md$/.test(name))
    throw new Error("Generated input must stay in this run's briefs directory")
  const entry = await ctx.fs.lstat?.(file)
  if (entry && entry.kind !== "file") throw new Error("Generated input must not redirect")
}

/** Refuse growth before the cap; active lead and helper inputs must never be pruned underneath them. */
export async function writeGeneratedBrief(ctx: Ctx, file: string, body: string): Promise<void> {
  if (!ctx.managedBriefsDir) return ctx.fs.atomicWrite(file, body)
  const dir = ctx.managedBriefsDir
  await ctx.fs.mkdir(dir)
  await ctx.fs.withLock(join(dir, ".inputs.lock"), async () => {
    await checkGeneratedBrief(ctx, file)
    const bytes = Buffer.byteLength(body)
    if (bytes > RUN_BRIEF_MAX_BYTES)
      throw new Error(
        `Generated Markdown exceeds ${RUN_BRIEF_MAX_BYTES} bytes; shorten this input before retrying`,
      )
    const names = (await ctx.fs.readdir(dir)).filter((name) => name.endsWith(".md"))
    const replacing = names.includes(relative(dir, file))
    if (names.length + (replacing ? 0 : 1) > RUN_BRIEF_FILES_KEPT)
      throw new Error(
        `This run reached ${RUN_BRIEF_FILES_KEPT} generated Markdown files; keep its inputs and start a fresh App session`,
      )
    let total = bytes
    for (const name of names) {
      const path = join(dir, name)
      await checkGeneratedBrief(ctx, path)
      if (path !== file)
        total += (await ctx.fs.stat?.(path))?.size ?? Buffer.byteLength(await ctx.fs.readFile(path))
    }
    if (total > RUN_BRIEFS_MAX_BYTES)
      throw new Error(
        `This run reached ${RUN_BRIEFS_MAX_BYTES} generated Markdown bytes; keep its inputs and start a fresh App session`,
      )
    await ctx.fs.atomicWrite(file, body)
  })
}

/** A native start witness is checked at both ends of the bounded parent walk. */
function fromLead(ctx: Ctx, run: RunRecord, pid: number): boolean {
  return leadCaller(ctx.home, run, pid) !== null
}

/** The session this command runs in, as the run's own agent names it to the commands it runs. */
function ownSession(ctx: Ctx, run: RunRecord): string {
  if (run.agent === "other") return ""
  for (const name of sessionVariables(run.agent)) {
    const value = ctx.env.get(name)?.trim()
    if (value) return value
  }
  return ""
}

/** A native resume may rotate its conversation id inside the same proven live lead process. */
async function resumeNativeSession(ctx: Ctx, payload: Payload, callerPid: number): Promise<void> {
  const initial = managed(ctx)
  const session = text(payload.session_id)
  if (
    initial?.purpose.kind !== "task" ||
    payload.hook_event_name !== "SessionStart" ||
    payload.source !== "resume" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(session) ||
    !initial.nativeSession ||
    initial.nativeSession === session
  )
    return
  await ctx.fs.withLock(join(runDir(ctx.home, initial.id), ".bind.lock"), async () => {
    const current = managed(ctx)
    if (
      !current ||
      current.generation !== initial.generation ||
      !current.lead ||
      !["starting", "running"].includes(current.status) ||
      !leadCaller(ctx.home, current, callerPid)?.direct ||
      typeof payload.cwd !== "string" ||
      realpathSync(payload.cwd) !== realpathSync(current.cwd)
    )
      return
    const repo = await resolveRepo(ctx)
    const expected = current.task ?? (current.purpose.kind === "task" ? current.purpose.task : "")
    const task = repo.ok ? await loadTask(ctx, repo.data, expected.split("~").at(-1) ?? "") : null
    if (
      !task ||
      !["implement", "verify"].includes(task.stage) ||
      task.runtimeDir !== current.taskRuntimeDir ||
      (expected !== task.slug && expected !== `${task.repoId}~${task.slug}`)
    )
      return
    await refreshRunLeases(
      ctx,
      current,
      {
        nativeSession: session,
        ...(current.intent ? { intent: { ...current.intent, nativeSession: session } } : {}),
        lastPrompt: undefined,
        runEvents: [],
        guardedRestart: undefined,
      },
      { previousSession: current.nativeSession ?? "", lead: current.lead },
    )
  })
}

/** Presentation only: a copied run marker does not identify the terminal of this task. */
export function inManagedTaskTerminal(
  ctx: Ctx,
  task: Pick<Task, "repoId" | "slug" | "repoRoot">,
): boolean {
  const run = managed(ctx)
  if (!run) return false
  const expected = run.task ?? (run.purpose.kind === "task" ? run.purpose.task : undefined)
  const sameTask =
    expected === `${task.repoId}~${task.slug}` ||
    (expected === task.slug && canonicalPath(run.cwd) === canonicalPath(task.repoRoot))
  return !!(
    sameTask &&
    run.nativeSession &&
    ownSession(ctx, run) === run.nativeSession &&
    fromLead(ctx, run, process.pid)
  )
}

/** Run metadata never depends on finding a repository or a bound task. */
export async function recordRunHook(
  ctx: Ctx,
  payload: Payload,
  fallbackEvent: string,
  callerPid = process.pid,
): Promise<RunEvent | null> {
  await recordNativeSession(ctx, payload, fallbackEvent, callerPid)
  await resumeNativeSession(ctx, payload, callerPid)
  const run = managed(ctx)
  if (!run) return null
  let recorded: RunEvent | null = null
  let nativePlanProducer = false
  let capturedSession: string | undefined
  let leadCheckout: string | undefined
  updateRun(ctx.home, run.id, run.generation, (current) => {
    const authority = leadCaller(ctx.home, current, callerPid)
    if (!authority) return {}
    const caller = processIdentity(callerPid, "descendant")
    if (!caller) return {}
    const session = text(payload.session_id)
    const event = text(payload.hook_event_name) || fallbackEvent
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(session) || !event) return {}
    let nativeSession = current.nativeSession
    if (
      !nativeSession &&
      current.agent !== "other" &&
      AGENT_CAPABILITIES[current.agent].sessionId === "discovered" &&
      authority.direct
    )
      nativeSession = session
    const lead = nativeSession === session
    if (nativeSession !== current.nativeSession) capturedSession = nativeSession
    if (
      lead &&
      (event === "SessionStart" || (event === "UserPromptSubmit" && payload.cwd !== current.cwd)) &&
      authority.direct &&
      typeof payload.cwd === "string" &&
      isAbsolute(payload.cwd)
    )
      leadCheckout = payload.cwd
    const shutdown =
      event === "SessionEnd" && lead && current.status === "stopping" && authority.direct
    const at = new Date(ctx.clock.now()).toISOString()
    const before = (current.runEvents ?? []).filter((row) => row.generation === current.generation)
    const row: RunEvent = {
      generation: current.generation,
      sequence: (current.eventSequence ?? 0) + 1,
      at,
      nativeSession: session,
      event,
      caller,
      lead,
      ...(text(payload.turn_id) ? { turn: text(payload.turn_id) } : {}),
      ...(text(payload.permission_mode) ? { permissionMode: text(payload.permission_mode) } : {}),
      ...(event === "Notification" && text(payload.notification_type)
        ? { notificationType: text(payload.notification_type) }
        : {}),
      ...(event === "Stop" ? { accepted: false } : {}),
    }
    const waiting =
      lead &&
      (event === "PermissionRequest" ||
        ((current.agent === "claude-code" || current.agent === "copilot") &&
          event === "Notification" &&
          payload.notification_type === "permission_prompt"))
    const interrupted = payload.reason === "interrupted" || payload.reason === "user_interrupt"
    if (interrupted) row.interrupted = true
    let intent = current.intent
    if (lead && intent) {
      intent = { ...intent, nativeSession: intent.nativeSession || nativeSession || "" }
      if (intent.state !== "complete") {
        if (interrupted)
          intent = {
            ...intent,
            state: "paused",
            reason: "Interrupted by you. Resume explicitly to continue.",
          }
        else if (intent.state !== "paused") {
          if (waiting)
            intent = { ...intent, state: "waiting", reason: "Permission required in the agent." }
          else if (
            event === "UserPromptSubmit" &&
            isNoProgressHalt(intent) &&
            intent.task ===
              (current.task ??
                (current.purpose.kind === "task" ? current.purpose.task : undefined)) &&
            intent.nativeSession === nativeSession
          )
            intent = { ...intent, state: "active", reason: undefined }
          else if (
            ((event === "PreToolUse" || event === "PostToolUse") &&
              (intent.reason === "Permission required in the agent." ||
                intent.reason === INTENT_HELPER_WAIT)) ||
            (nativeSession && intent.reason === "Waiting for native lead binding.")
          )
            intent = { ...intent, state: "active", reason: undefined }
        }
      }
    }
    recorded = row
    nativePlanProducer = current.agent === "codex"
    return {
      runEvents: retainEvents([...before, row]),
      eventSequence: row.sequence,
      ...(current.guardedRestart &&
      !shutdown &&
      !(
        informationalRunEvent(row) &&
        acceptedStopEvent(current)?.sequence === current.guardedRestart.sequence
      )
        ? { guardedRestart: { ...current.guardedRestart, valid: false } }
        : {}),
      ...(lead && event === "UserPromptSubmit"
        ? {
            lastPrompt: {
              generation: current.generation,
              sequence: row.sequence,
              ...(row.turn ? { turn: row.turn } : {}),
            },
          }
        : {}),
      ...(lead && row.permissionMode ? { permissionMode: row.permissionMode } : {}),
      ...(lead && event === "UserPromptSubmit" && !current.firstPromptAt
        ? { firstPromptAt: at }
        : {}),
      ...(waiting
        ? { waitSince: current.waitSince ?? at }
        : lead &&
            [
              "UserPromptSubmit",
              "PreToolUse",
              "PostToolUse",
              "PostToolUseFailure",
              "Stop",
              "SessionEnd",
            ].includes(event)
          ? { waitSince: undefined }
          : {}),
      ...(lead && intent ? { intent } : {}),
    }
  })
  if (nativePlanProducer) await recordNativePlan(ctx, payload, fallbackEvent)
  if (capturedSession || leadCheckout) {
    const claim: Partial<Pick<RunRecord, "nativeSession" | "cwd" | "branch">> = capturedSession
      ? { nativeSession: capturedSession }
      : {}
    if (leadCheckout) {
      const actual = realpathSync(leadCheckout)
      const [originalCommon, actualCommon, root] = await Promise.all([
        ctx.git.commonDir(run.cwd),
        ctx.git.commonDir(actual),
        ctx.git.topLevel(actual),
      ])
      if (
        !originalCommon ||
        !actualCommon ||
        !root ||
        realpathSync(originalCommon) !== realpathSync(actualCommon)
      )
        throw new Error("The native checkout is not a worktree of this run's original repository")
      claim.cwd = realpathSync(root)
      claim.branch = (await currentBranch(ctx, claim.cwd)) ?? undefined
    }
    await refreshRunLeases(ctx, run, claim)
  }
  return recorded
}

/** The Stop remains pending until QualityLayer's own hook has decided whether to block it. */
export async function settleRunStop(
  ctx: Ctx,
  event: RunEvent | null,
  blocked: boolean,
): Promise<void> {
  const run = managed(ctx)
  if (!run || !event || event.event !== "Stop" || !event.lead) return
  if (run.generation !== event.generation) return
  updateRun(ctx.home, run.id, event.generation, (current) => ({
    runEvents: (current.runEvents ?? []).map((row) =>
      row.generation === event.generation && row.sequence === event.sequence
        ? { ...row, accepted: !blocked && !row.interrupted }
        : row,
    ),
  }))
}

/** A lead Stop records boundaries; the native harness owns whether another turn runs. */
export async function continueRunIntent(
  ctx: Ctx,
  event: RunEvent | null,
  task: Task,
  waiting = false,
  stopped = false,
): Promise<boolean | null> {
  const run = managed(ctx)
  if (!run?.intent || !event?.lead || event.event !== "Stop") return null
  if (
    event.generation !== run.generation ||
    event.nativeSession !== run.nativeSession ||
    !run.lastPrompt ||
    run.lastPrompt.generation !== run.generation ||
    run.lastPrompt.sequence >= event.sequence ||
    (run.lastPrompt.turn && event.turn && run.lastPrompt.turn !== event.turn) ||
    !fromLead(ctx, run, process.pid)
  )
    return null
  const facts = await intentFacts(ctx, task, run, waiting)
  if (stopped && facts.boundary === "none") {
    facts.boundary = "wait"
    facts.reason = "QualityLayer returned a stop. Follow its recorded boundary before resuming."
  }
  facts.interrupted = event.interrupted
  updateRun(ctx.home, run.id, run.generation, (current) => {
    const last = current.runEvents?.at(-1)
    if (
      !current.intent ||
      last?.sequence !== event.sequence ||
      last.generation !== event.generation
    )
      return null
    const result = decideIntent(current.intent, facts)
    if (result.action === "continue") return null
    if (
      result.intent.state === "waiting" &&
      result.intent.reason === INTENT_HELPER_WAIT &&
      (current.intent.state !== "waiting" || current.intent.reason !== INTENT_HELPER_WAIT)
    )
      result.intent.waitSince = new Date(ctx.clock.now()).toISOString()
    return { intent: result.intent }
  })
  return facts.boundary === "human" && !stopped && !waiting ? null : false
}

const informationalRunEvent = (row: RunEvent): boolean =>
  !row.interrupted &&
  (row.event === "SubagentStop" ||
    (row.event === "Notification" && row.notificationType === "idle_prompt"))

/** The actual boundary event survives only known, uninterrupted lifecycle notices. */
export function inputBoundaryEvent(
  run: Pick<RunRecord, "generation" | "runEvents">,
): RunEvent | undefined {
  const rows = run.runEvents ?? []
  for (let at = rows.length - 1; at >= 0; at--) {
    const row = rows[at]
    if (!row || row.generation !== run.generation || row.interrupted) return undefined
    if (!informationalRunEvent(row)) return row
  }
  return undefined
}

export function acceptedStopEvent(run: RunRecord): RunEvent | undefined {
  const last = inputBoundaryEvent(run)
  if (
    !last?.lead ||
    last.event !== "Stop" ||
    last.accepted !== true ||
    !Number.isFinite(Date.parse(last.at)) ||
    !run.nativeSession ||
    last.nativeSession !== run.nativeSession
  )
    return undefined
  const prompt = run.lastPrompt
  return prompt &&
    prompt.generation === run.generation &&
    prompt.sequence < last.sequence &&
    (!prompt.turn || !last.turn || prompt.turn === last.turn)
    ? last
    : undefined
}

export function acceptedTurnBoundary(run: RunRecord): boolean {
  return acceptedStopEvent(run) !== undefined
}

export function acceptedStopSequence(run: RunRecord): number | undefined {
  return run.status === "running" ? acceptedStopEvent(run)?.sequence : undefined
}

/** A current native tool dialog, not a completed turn or a QualityLayer approval. */
export function permissionChangeBoundary(run: RunRecord): boolean {
  const last = run.runEvents?.at(-1)
  return (
    run.status === "running" &&
    run.terminalPrompt === "permission" &&
    !!run.firstPromptAt &&
    !!run.nativeSession &&
    !!last &&
    last.generation === run.generation &&
    last.nativeSession === run.nativeSession &&
    last.sequence > 0
  )
}

/** Host-side reservation shares the event writer's record lock, immediately before Stop. */
export function reserveRunRestart(
  ctx: Pick<Ctx, "home">,
  id: string,
  generation: number,
  sequence: number,
  permissionSession?: string,
): void {
  updateRun(ctx.home, id, generation, (current) => {
    if (
      current.status !== "running" ||
      !(permissionSession
        ? permissionChangeBoundary(current) && current.nativeSession === permissionSession
        : acceptedTurnBoundary(current)) ||
      (permissionSession
        ? current.runEvents?.at(-1)?.sequence
        : acceptedStopEvent(current)?.sequence) !== sequence
    )
      throw new Error("The turn changed before Restart. Stop and Resume here instead.")
    return { status: "stopping", guardedRestart: { sequence, valid: true } }
  })
}

/** Nobody has prompted or typed into the run's current generation, as its record shows. */
export const untouchedRun = (run: RunRecord): boolean =>
  run.lastPrompt?.generation !== run.generation &&
  !(run.runEvents ?? []).some(
    (e) =>
      e.generation === run.generation &&
      (e.event === "TerminalInput" || e.event === "UserPromptSubmit"),
  )

/**
 * Host-side reservation of a stop that must not end a session someone has taken over, under the
 * record lock the input handling writes through: refused when the generation was prompted or typed
 * into. `sequence` is the event the stop was asked for at; it becomes the restart's boundary.
 */
export function reserveGuardedStop(
  ctx: Pick<Ctx, "home">,
  id: string,
  generation: number,
  sequence: number,
): void {
  updateRun(ctx.home, id, generation, (current) => {
    if (current.status !== "running" || !untouchedRun(current))
      throw new Error("The session was taken over before it was stopped")
    return { status: "stopping", guardedRestart: { sequence, valid: true } }
  })
}

export function runAttention(run: RunRecord, now = Date.now()): "waiting" | "attention" | "clear" {
  if (run.status !== "running" && run.status !== "starting") return "clear"
  if (run.terminalPrompt) return "waiting"
  if (run.waitSince && now - Date.parse(run.waitSince) >= 3000) return "waiting"
  return run.agent === "other" && run.attention === "attention" ? "attention" : "clear"
}

/** Interrupt is input, never proof of an accepted end of turn. */
export function invalidateRunBoundary(
  ctx: Pick<Ctx, "home">,
  id: string,
  generation: number,
  interrupted = false,
  inputAt?: number,
): void {
  const run = readRun(ctx.home, id)
  if (!run || run.generation !== generation) return
  if (!run.lead) return
  updateRun(ctx.home, id, generation, (current) => {
    const caller = current.host ?? current.lead
    if (!caller) return null
    if (inputAt !== undefined) {
      const input = current.runEvents?.findLast(
        (row) => row.generation === generation && row.event === "TerminalInput",
      )
      if (!input || Date.parse(input.at) >= inputAt) return null
      return {
        runEvents: current.runEvents?.map((row) =>
          row === input ? { ...row, at: new Date(inputAt).toISOString() } : row,
        ),
      }
    }
    // The host refreshes the input time at its bounded write cadence, not for every keystroke.
    const last = current.runEvents?.at(-1)
    if (
      last?.event === "TerminalInput" &&
      last.generation === generation &&
      current.terminalPrompt !== "permission" &&
      current.guardedRestart?.valid !== true
    )
      return interrupted && current.waitSince ? { waitSince: undefined } : null
    const row: RunEvent = {
      generation,
      sequence: (current.eventSequence ?? 0) + 1,
      at: new Date().toISOString(),
      nativeSession: current.nativeSession ?? "",
      event: "TerminalInput",
      caller,
      lead: false,
    }
    return {
      runEvents: retainEvents([...(current.runEvents ?? []), row]),
      eventSequence: row.sequence,
      // Escape/Interrupt cancels a native prompt; it never accepts the turn or answers a gate.
      ...(interrupted ? { waitSince: undefined } : {}),
      ...(current.guardedRestart
        ? { guardedRestart: { ...current.guardedRestart, valid: false } }
        : {}),
    }
  })
}

/** OSC may cross PTY chunks; cap its retained prefix without treating its terminator as BEL. */
export class AttentionSignals {
  private state: "text" | "escape" | "osc" | "osc-escape" = "text"
  private prefix = ""
  push(bytes: Uint8Array): boolean {
    let attention = false
    const finish = () => {
      if (this.prefix.startsWith("9;") || this.prefix.startsWith("777;notify;")) attention = true
      this.prefix = ""
      this.state = "text"
    }
    for (const byte of bytes) {
      if (this.state === "text") {
        if (byte === 7) attention = true
        else if (byte === 27) this.state = "escape"
        else if (byte === 157) {
          this.state = "osc"
          this.prefix = ""
        }
      } else if (this.state === "escape") {
        this.state = byte === 93 ? "osc" : "text"
        this.prefix = ""
      } else if (this.state === "osc") {
        if (byte === 7 || byte === 156) finish()
        else if (byte === 27) this.state = "osc-escape"
        else if (this.prefix.length < 256) this.prefix += String.fromCharCode(byte)
      } else if (byte === 92) finish()
      else this.state = "osc"
    }
    return attention
  }
}

/** Read-only role projection for commands outside next; environment markers alone grant no role. */
export async function managedPlanningContext(ctx: Ctx, task: Task): Promise<Ctx> {
  if (ctx.managedBuildEntry || ctx.managedRunPhase === "planning") return ctx
  const run = managed(ctx)
  const expected = run?.task ?? (run?.purpose.kind === "task" ? run.purpose.task : undefined)
  if (
    !run ||
    run.purpose.kind === "artifact" ||
    run.status !== "running" ||
    !run.nativeSession ||
    ownSession(ctx, run) !== run.nativeSession ||
    !fromLead(ctx, run, process.pid) ||
    (expected !== task.slug && expected !== `${task.repoId}~${task.slug}`)
  )
    return ctx
  let planning =
    (run.purpose.kind === "task" && run.purpose.phase === "planning") ||
    (run.purpose.kind === "new-task" && run.allocatedTask === true)
  if (run.purpose.kind === "terminal" && task.stage === "plan")
    planning = (await readmeFrontmatter(ctx, task)).startup_owner === sessionKey(ctx.env)
  const latest = readRun(ctx.home, run.id)
  if (
    !planning ||
    latest?.status !== "running" ||
    latest?.generation !== run.generation ||
    latest.nativeSession !== run.nativeSession
  )
    return ctx
  return { ...ctx, managedRunPurpose: run.purpose.kind, managedRunPhase: "planning" }
}

/** Validate before `next` creates, selects or advances anything; serialize first binding per run. */
export async function withManagedRunNext<T extends { task?: unknown }>(
  ctx: Ctx,
  args: string[],
  action: (ctx: Ctx) => Promise<Result<T>>,
): Promise<Result<T>> {
  if (!ctx.env.get("QUALITYLAYER_RUN")) return action(ctx)
  const run = managed(ctx)
  if (!run) return err({ code: "bad_args", message: "The managed run is missing." })
  if (run.purpose.kind === "artifact")
    return err({
      code: "bad_args",
      message:
        "This agent is bound to an artifact. Start a task explicitly from the App to enter the workflow.",
    })
  return ctx.fs.withLock(join(runDir(ctx.home, run.id), ".bind.lock"), async () => {
    const current = readRun(ctx.home, run.id)
    if (current?.purpose.kind === "artifact")
      return err({ code: "bad_args", message: "An artifact agent cannot enter the task workflow." })
    if (
      !current ||
      current.generation !== run.generation ||
      !fromLead(ctx, current, process.pid) ||
      !current.nativeSession ||
      ownSession(ctx, current) !== current.nativeSession
    )
      return err({
        code: "bad_args",
        message:
          "Only this run's lead native session can bind its task. If the native process changed, use Stop then Resume on this task in the App to establish a verified generation; keep QUALITYLAYER_RUN intact.",
      })
    const expected =
      current.task ?? (current.purpose.kind === "task" ? current.purpose.task : undefined)
    if (expected) {
      const repo = await resolveRepo(ctx)
      const slug = expected.split("~").at(-1) ?? expected
      const checkout = current.sourceCheckout ?? current.cwd
      const registered = repo.ok
        ? await ctx.fs
            .readFile(join(ctx.home, "projects", repo.data.id, "project.json"))
            .then((text) => JSON.parse(text) as { paths?: unknown })
            .catch(() => null)
        : null
      const sameCheckout = (() => {
        try {
          return (
            repo.ok &&
            canonicalPath(realpathSync(repo.data.root)) === canonicalPath(realpathSync(current.cwd))
          )
        } catch {
          return false
        }
      })()
      const ownCheckout =
        repo.ok &&
        sameCheckout &&
        (!expected.includes("~") || expected.split("~")[0] === repo.data.id) &&
        Array.isArray(registered?.paths) &&
        registered.paths.some(
          (path) => typeof path === "string" && canonicalPath(path) === canonicalPath(checkout),
        ) &&
        (await ctx.fs.exists(checkout)) &&
        (await ctx.fs.exists(current.cwd))
      if (!repo.ok || !ownCheckout)
        return err({
          code: "no_task",
          message: `The owning checkout for bound task ${slug} is unavailable or unverified. Stop this run until that checkout is restored; do not create or select another task.`,
        })
      const bound = await loadTask(ctx, repo.data, slug)
      if (!bound)
        return err({
          code: "no_task",
          message: `Bound task ${slug} is no longer available in its owning checkout. It may have been removed. Stop this run; restore the task in the App or start a new task.`,
        })
      if (await isArchived(ctx, bound))
        return err({
          code: "no_task",
          message: `Bound task ${slug} is archived. Stop this run; restore the task in the App before resuming.`,
        })
    }
    let terminalPlanner = false
    if (current.purpose.kind === "terminal" && expected && !args.includes("--implement")) {
      const repo = await resolveRepo(ctx)
      const task = repo.ok
        ? await loadTask(ctx, repo.data, expected.split("~").at(-1) ?? expected)
        : null
      if (
        task &&
        task.stage === "plan" &&
        (expected === task.slug || expected === `${task.repoId}~${task.slug}`)
      ) {
        const frontmatter = await readmeFrontmatter(ctx, task)
        terminalPlanner = frontmatter.startup_owner === sessionKey(ctx.env)
      }
    }
    const planningOnly =
      (current.purpose.kind === "task" && current.purpose.phase === "planning") ||
      (current.purpose.kind === "new-task" && current.allocatedTask === true) ||
      terminalPlanner
    if (planningOnly && args.includes("--implement"))
      return err({
        code: "bad_args",
        message:
          "This run is for planning. Start the approved build from this task's Agent panel in the App.",
      })
    const selected = ctx.env.get("QUALITYLAYER_TASK")
    const selectedAt = args.indexOf("--task")
    const explicitTask = ctx.invocationTask ?? (selectedAt >= 0 ? args[selectedAt + 1] : undefined)
    if (expected && selected && selected !== expected && selected !== expected.split("~").at(-1))
      return err({ code: "bad_args", message: "This run is already bound to another task." })
    if (
      expected &&
      explicitTask !== undefined &&
      explicitTask !== expected &&
      explicitTask !== expected.split("~").at(-1)
    )
      return err({ code: "bad_args", message: "This run is already bound to another task." })
    if (expected && parseStart(args.join(" ").replace(/^[/$](?:qualitylayer|ql)\s*/i, "")))
      return err({
        code: "bad_args",
        message: "This run is already bound to a task; start another run for a new task.",
      })
    let managedBriefsDir: string | undefined
    if (current.purpose.kind === "new-task")
      managedBriefsDir = await runBriefsDirectory(ctx, current.id)
    else if (current.purpose.kind === "task" && expected) {
      const repo = await resolveRepo(ctx)
      const task = repo.ok
        ? await loadTask(ctx, repo.data, expected.split("~").at(-1) ?? expected)
        : null
      if (!task)
        return err({ code: "bad_args", message: "The run's bound task could not be found." })
      if (expected !== task.slug && expected !== `${task.repoId}~${task.slug}`)
        return err({
          code: "bad_args",
          message: "The generated inputs must belong to this run's task.",
        })
      managedBriefsDir = await taskBriefsDirectory(ctx, task)
    }
    const boundCtx: Ctx = {
      ...ctx,
      managedRunPurpose: current.purpose.kind,
      managedRunPhase: planningOnly ? "planning" : undefined,
      managedBuildEntry:
        !planningOnly && !!expected && (explicitTask !== undefined || args.includes("--implement")),
      managedBriefsDir,
      env: {
        get: (name: string) =>
          name === "QUALITYLAYER_TASK" && expected ? expected.split("~").at(-1) : ctx.env.get(name),
        cwd: () => ctx.env.cwd(),
      },
    }
    const selectedRepo = selectedAt >= 0 && !expected ? await resolveRepo(ctx) : null
    const selectedTask = selectedRepo?.ok
      ? await loadTask(ctx, selectedRepo.data, args[selectedAt + 1] ?? "")
      : null
    await refreshRunLeases(
      ctx,
      current,
      selectedTask
        ? {
            task: `${selectedTask.repoId}~${selectedTask.slug}`,
            taskRuntimeDir: selectedTask.runtimeDir,
          }
        : {},
    )
    const result = await action(boundCtx)
    if (!result.ok) return result
    if (typeof result.data.task !== "string") return result
    const after = readRun(ctx.home, run.id)
    if (!after || after.generation !== current.generation)
      return err({ code: "bad_args", message: "The run generation changed before it could bind." })
    const repo = await resolveRepo(ctx)
    const task = repo.ok
      ? await loadTask(ctx, repo.data, result.data.task.split("~").at(-1) ?? result.data.task)
      : null
    if (!task)
      return err({ code: "bad_args", message: "The created task could not be bound to this run." })
    if (after.task && after.task !== task.slug && after.task !== `${task.repoId}~${task.slug}`)
      return err({ code: "bad_args", message: "This run is already bound to another task." })
    await refreshRunLeases(ctx, current, {
      task: after.task ?? `${task.repoId}~${task.slug}`,
      taskRuntimeDir: task.runtimeDir,
    })
    return result
  })
}

/** Deliver fresh feedback only at an accepted prompt from this run's native lead. */
export async function managedArtifactPrompt(
  ctx: Ctx,
  event: RunEvent | null,
): Promise<string | null> {
  const run = managed(ctx)
  if (
    !event?.lead ||
    !run ||
    run.purpose.kind !== "artifact" ||
    !run.artifactBinding ||
    event.event !== "UserPromptSubmit" ||
    event.accepted === false ||
    run.generation !== event.generation ||
    run.nativeSession !== event.nativeSession ||
    run.eventSequence !== event.sequence ||
    !fromLead(ctx, run, process.pid)
  )
    return null
  const context = await readArtifactAgentContext(ctx, run.artifactBinding, run.purpose.request)
  return context.ok
    ? context.data.prompt
    : `Artifact context unavailable: ${context.error.message}. Refresh this artifact in the App before editing.`
}
