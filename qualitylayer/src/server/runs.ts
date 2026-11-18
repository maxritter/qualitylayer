import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import type { ServerWebSocket } from "bun"
import { checkedAgentBinary } from "../core/agents/binary.ts"
import { AGENT_NAMES, isNativeAgent } from "../core/agents/ids.ts"
import { MODEL_LIST_WAIT_MS, readModelListWithin } from "../core/agents/model-list.ts"
import { AGENT_OWN } from "../core/agents/model-values.ts"
import { readConfig } from "../core/config.ts"
import {
  pendingRunApproval,
  stopViewing,
  VIEW_LEASE_MS,
  VIEW_MAX_MS,
} from "../core/conversation/approvals.ts"
import {
  CodexPickerAdapter,
  qualifiedCodexPickerVersion,
  validPickerSelection,
} from "../core/conversation/codex-picker.ts"
import { cleanPickerAnswers, decidePicker, listPickers } from "../core/conversation/pickers.ts"
import { nativeRun, readConversation } from "../core/conversation/service.ts"
import { parseDoc } from "../core/docs/frontmatter.ts"
import { folderDoc } from "../core/docs/names.ts"
import { settle } from "../core/gate/gate.ts"
import { approvalCurrent } from "../core/gate/revision.ts"
import { createBranch, suggestedBranch } from "../core/git/branch.ts"
import { currentBranch } from "../core/git/repo.ts"
import { recordStart } from "../core/handoff/start.ts"
import { agentEntry } from "../core/install/where.ts"
import type { Incoming } from "../core/interaction-docs/attachments.ts"
import { readLive } from "../core/live/read.ts"
import { canonicalPath, nativeCommand } from "../core/platform.ts"
import { type ExtraPlanner, readPlanners, writePlanners } from "../core/review/planners.ts"
import { installedAgents } from "../core/review/vendors.ts"
import { reconcileAbandonedStarts } from "../core/run/abandoned.ts"
import { agentEnvironment } from "../core/run/agent-env.ts"
import {
  acceptedStopSequence,
  acceptedTurnBoundary,
  permissionChangeBoundary,
  runAttention,
  runBriefsDirectory,
  taskBriefsDirectory,
} from "../core/run/bind.ts"
import {
  isNoProgressHalt,
  PROTECTED_SETTINGS,
  type RunRecord,
  type RunSettings,
  type RunSummary,
  type StartRequest,
} from "../core/run/contracts.ts"
import {
  controlRun,
  nativeSessionFile,
  type ResumePreparation,
  stopRunAtBoundary,
  validateControl,
} from "../core/run/control.ts"
import {
  NativeSettingsUnknownError,
  observedNativeSettings,
  reportedNativePermission,
} from "../core/run/effective-native-settings.ts"
import { freshConversation } from "../core/run/fresh.ts"
import { armIntent, INTENT_HELPER_WAIT, intentFacts, intentWaitStatus } from "../core/run/intent.ts"
import { launchDiagnostic } from "../core/run/launch-diagnostics.ts"
import { launchSpec, permissionDescription, resumeLine } from "../core/run/launch-spec.ts"
import { acquireRunLeases, runTaskLeaseKey } from "../core/run/lease.ts"
import {
  planningStartOf,
  readPlanningStart,
  rememberPlanningStart,
  writePlanningStart,
} from "../core/run/planning-start.ts"
import {
  encodeFrame,
  FrameDecoder,
  type HostFrame,
  isAgentRunsRoute,
  LIMITS,
  type ServerFrame,
  validateViewerState,
} from "../core/run/protocol.ts"
import { recoverInterruptedRuns } from "../core/run/recovery.ts"
import {
  connectHost,
  createRun,
  type HostConnection,
  identityState,
  listRuns,
  readHost,
  readLaunch,
  readRun,
  runDir,
  setLaunchPhase,
  startHost,
  updateRun,
  writeLaunch,
} from "../core/run/registry.ts"
import { applyQueuedSettings, queueSettings, settingsLock } from "../core/run/settings-intent.ts"
import { connectOrRevive, settleDeadHost } from "../core/run/settle.ts"
import { allocatePlanningTask } from "../core/run/start-task.ts"
import { windowsRunCapability } from "../core/run/windows.ts"
import {
  copyApprovedTaskToWorktree,
  nativeWorktree,
  validateNativeWorktree,
} from "../core/run/worktree.ts"
import { readPullRequestRecord } from "../core/ship/pr-record.ts"
import { NotResumed } from "../core/ship/pr-wake.ts"
import { isArchived } from "../core/task/archive.ts"
import {
  listTasks,
  loadTask,
  patchReadme,
  readSession,
  type Task,
  taskTitle,
} from "../core/task/store.ts"
import { VERSION } from "../core/version.ts"
import type { Ctx } from "../ctx.ts"
import { listProjects, locate } from "./api.ts"
import { refreshArtifactAgentContext } from "./artifact-agent.ts"
import { handoffChatWorkflow } from "./chat-workflow-handoff.ts"
import {
  approvalResponse,
  approvalRoute,
  conversationClosedId,
  conversationClosedResponse,
  conversationResponse,
  conversationRunId,
} from "./conversation.ts"
import { conversationCatalogId, conversationCatalogResponse } from "./conversation-catalog.ts"
import { prepareFreshConversation } from "./conversation-fresh.ts"
import { type GuardConfig, hasKeyHeader, refuse, sessionAuthority } from "./guard.ts"
import {
  NativeQuestionFileError,
  type NativeQuestionPacket,
  readNativeQuestionPacket,
  withNativeQuestionFiles,
} from "./native-question-files.ts"
import { pickerHost, pickerRequest, pickerRunId } from "./pickers.ts"
import { keepLaunchFiles, readLaunchBody } from "./run-launch-files.ts"
import { launchHooksFor, prepareStartProcess, readyLaunchHooks } from "./run-launch-process.ts"
import {
  agentArgs,
  assertEnabled,
  availableShells,
  chosenSession,
  loginShell,
  prepareStartSettings,
  settingsOf,
} from "./run-launch-settings.ts"
import { messageFilesResponse, messageFilesRunId } from "./run-message-files.ts"
import { purposeContext } from "./run-purpose-context.ts"
import { readRunBody as body, parseRunStart, parseSettings } from "./run-start-request.ts"
import { turnChangesResponse, turnChangesRunId } from "./turn-changes.ts"

export { availableShells, loginShell, parseRunStart, settingsOf }

export type AgentSocketData = {
  run: string
  session: string
  generation: number
  watching: boolean
  phone: boolean
}
type Attachment = {
  pickerProof?: { value: string; generation: number }
  ws: ServerWebSocket<AgentSocketData>
  host?: HostConnection
  decoder: FrameDecoder
  timer?: ReturnType<typeof setTimeout>
  unsubscribe: () => void
  replaying: boolean
  upTo: number
  epoch: number
  closed: boolean
  retrying: boolean
  recovered: boolean
  ended: boolean
  freshing?: boolean
  controllerAtAttach?: ServerWebSocket<AgentSocketData>
  messages: Promise<void>
  inboundBytes: number
}
const refusal = (status: number, message: string) =>
  new Response(message, { status, headers: { "cache-control": "no-store" } })
export function attachRunId(path: string) {
  return /^\/api\/agent-runs\/([a-f0-9-]+)\/attach$/.exec(path)?.[1]
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } })
/** Extra planners run only for a feature task, on agents this computer can start. */
async function assertPlannersRun(ctx: Ctx, planners: readonly ExtraPlanner[], task?: Task) {
  if (task !== undefined && task.type !== "feature")
    throw new Error(
      `Extra planners are for feature tasks, not a ${task.type === "bugfix" ? "bug fix" : "Chat"}`,
    )
  const installed = await installedAgents(ctx)
  const missing = planners.find((p) => !installed.includes(p.agent))
  if (missing !== undefined)
    throw new Error(
      `${AGENT_NAMES[missing.agent]} is not set up on this computer, so it cannot plan here`,
    )
}

function stableChoices(input: StartRequest, cwd: string) {
  const { startAnyway: _confirmation, ...choices } = input
  return JSON.stringify({ ...choices, cwd }, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  )
}
async function startSource(ctx: Ctx, run: RunRecord, input: StartRequest, saved?: string) {
  if (saved && Buffer.byteLength(saved) > LIMITS.frameBytes)
    throw new Error("Recorded start choices exceed their bound")
  const original = saved ? (JSON.parse(saved) as StartRequest) : undefined
  const recorded = run.sourceCheckout ?? original?.cwd
  if (typeof recorded !== "string" || !isAbsolute(recorded))
    throw new Error("This start has no verified original checkout; inspect its kept session")
  const source = canonicalPath(realpathSync(recorded))
  if (original?.cwd && canonicalPath(realpathSync(resolve(original.cwd))) !== source)
    throw new Error("The recorded start request belongs to another original checkout")
  if (original && stableChoices(original, source) !== stableChoices(input, source))
    throw new Error("This idempotency key belongs to different start choices")
  const incoming = input.cwd ? canonicalPath(realpathSync(resolve(input.cwd))) : source
  if (incoming !== source && incoming !== run.cwd)
    throw new Error("This idempotency key belongs to another checkout")
  if (run.worktreePath || run.cwd !== source) {
    if (
      run.cwd === source ||
      run.worktreePath !== run.cwd ||
      !run.branch ||
      run.startPhase === "validated"
    )
      throw new Error("This start has no verified kept workspace")
    await validateNativeWorktree(ctx, source, run.id, run.branch, run.cwd)
  }
  return source
}
async function terminalInCheckout(ctx: Ctx, task: Task, cwd: string) {
  for (const candidate of await listTasks(ctx, {
    root: task.repoRoot,
    id: task.repoId,
    commonDir: "",
  })) {
    const session = await readSession(ctx, candidate)
    if (session?.checkout) {
      try {
        if (realpathSync(session.checkout) !== cwd) continue
      } catch {
        continue
      }
    }
    const live = await readLive(ctx, candidate)
    if (live?.process === "alive") return true
  }
  return false
}

function requestState(ctx: Ctx, run: string): { sent?: boolean } {
  try {
    return JSON.parse(readFileSync(join(runDir(ctx.home, run), "request-state.json"), "utf8"))
  } catch {
    return {}
  }
}
/** How long a start waits for its host to answer before the person's reply goes out without it. */
const HOST_REPLY_GRACE_MS = 750
async function readyHost(ctx: Ctx, id: string, deadline: number) {
  let last: unknown
  while (Date.now() < deadline) {
    try {
      return await connectHost(ctx.home, id, Math.min(500, Math.max(1, deadline - Date.now())))
    } catch (cause) {
      last = cause
      const run = readRun(ctx.home, id)
      if (run?.status === "failed" && run.error) throw new Error(run.error)
      await Bun.sleep(Math.min(25, Math.max(1, deadline - Date.now())))
    }
  }
  throw new Error(`Agent host did not become ready within 10 seconds: ${String(last)}`)
}
export async function refreshRunIntentWait(ctx: Ctx, run: RunRecord): Promise<RunRecord> {
  const intent = run.intent
  if (!intent) return run
  const waiting = intent.state === "waiting" && intent.reason === INTENT_HELPER_WAIT
  const blocked = isNoProgressHalt(intent)
  if (!waiting && !blocked) return run
  const processState = run.lead ? identityState(run.lead) : "dead"
  const taskId = run.task ?? (run.purpose.kind === "task" ? run.purpose.task : undefined)
  let next = intent
  if (
    processState === "live" &&
    taskId !== undefined &&
    taskId === intent.task &&
    run.nativeSession === intent.nativeSession
  ) {
    const found = await locate(ctx, taskId)
    if (found.ok && found.data.task.runtimeDir === run.taskRuntimeDir) {
      const facts = await intentFacts(ctx, found.data.task, run)
      if (facts.boundary === "wait" && facts.reason === INTENT_HELPER_WAIT) {
        if (waiting) return run
        next = {
          ...intent,
          state: "waiting",
          reason: INTENT_HELPER_WAIT,
          waitSince: new Date(ctx.clock.now()).toISOString(),
        }
      }
    }
  }
  if (next === intent) {
    if (blocked) return run
    next = (await intentWaitStatus(ctx, run, processState)) ?? intent
  }
  if (next === intent) return run
  try {
    return updateRun(ctx.home, run.id, run.generation, (current) => {
      const currentIntent = current.intent
      if (
        !currentIntent ||
        current.nativeSession !== run.nativeSession ||
        current.eventSequence !== run.eventSequence ||
        currentIntent.state !== intent.state ||
        currentIntent.reason !== intent.reason ||
        currentIntent.waitSince !== intent.waitSince ||
        current.lead?.nativeStart !== run.lead?.nativeStart
      )
        return null
      return { intent: next }
    })
  } catch (cause) {
    const current = readRun(ctx.home, run.id)
    if (current && current.generation !== run.generation) return current
    throw cause
  }
}

export async function summarizeRun(
  ctx: Ctx,
  run: RunRecord,
  canStart: boolean,
  keyPaired: boolean,
): Promise<RunSummary> {
  const callback = await pendingRunApproval(ctx, run)
  const host = readHost(ctx.home, run.id)
  const taskId =
    run.task ??
    (run.purpose.kind === "task"
      ? run.purpose.task
      : run.purpose.kind === "terminal" && run.purpose.context?.kind === "task"
        ? run.purpose.context.task
        : undefined)
  const task = taskId ? await locate(ctx, taskId) : undefined
  let removedTask = false
  if (taskId && task && !task.ok && task.error.code === "no_task") {
    const project = (await listProjects(ctx)).find((item) => item.id === taskId.split("~")[0])
    // Inspect the run's own registered checkout. Old worktree paths may be offline without
    // making this task uncertain; an offline owning checkout still keeps its recovery entry.
    const checkout = run.sourceCheckout ?? run.cwd
    removedTask =
      !!project?.paths.some((path) => canonicalPath(path) === canonicalPath(checkout)) &&
      (await ctx.fs.exists(checkout)) &&
      (await ctx.fs.exists(run.cwd))
  }
  const launched = task?.ok
    ? {
        ...(run.settings ?? settingsOf(await readConfig(ctx), run)),
        answers: task.data.task.answers,
      }
    : run.settings
  const observed =
    run.agent === "copilot" ? observedNativeSettings(ctx, run) : reportedNativePermission(run)
  const settings =
    launched && observed.perm !== undefined
      ? { ...launched, perm: observed.perm, permMode: observed.permMode }
      : launched
  const settingsLocked = settingsLock(run, host)
  let line = ""
  if (run.nativeSession && run.agent !== "other") {
    try {
      line = resumeLine(run.agent, run.nativeSession)
    } catch {
      /* an unknown native id cannot be resumed */
    }
  }
  const title =
    run.purpose.kind === "new-task"
      ? taskTitle(run.purpose.request, run.purpose.title)
      : run.purpose.kind === "task"
        ? run.purpose.task
        : run.purpose.kind === "terminal"
          ? run.purpose.shell
            ? basename(run.binary?.path ?? "shell")
            : basename(run.cwd)
          : run.purpose.kind === "artifact"
            ? (run.artifactBinding?.title ?? run.purpose.file)
            : "Draft an answer"
  const spec = launchSpec({
    agent: run.agent,
    launchFiles: run.launchFiles,
    toolsFolder: dirname(agentEntry(ctx)),
    answers: settings?.answers,
    artifactPrompt: run.purpose.kind === "artifact" ? run.purpose.request : undefined,
    purpose:
      run.purpose.kind === "task"
        ? { kind: "task", task: run.purpose.task.split("~").at(-1) ?? run.purpose.task }
        : run.purpose,
  })
  const summary: RunSummary = {
    ...run,
    ...(callback ? { waitSince: callback.createdAt, terminalPrompt: undefined } : {}),
    ...(observed.permMode ? { permissionMode: observed.permMode } : {}),
    settings,
    ...(task?.ok
      ? {
          taskLifecycle: {
            stage: task.data.task.stage,
            archived: await isArchived(ctx, task.data.task),
          },
        }
      : removedTask
        ? { taskLifecycle: { stage: "deleted", archived: true } }
        : {}),
    title,
    resumeLine: line,
    canConfigure: keyPaired,
    ...(settingsLocked ? { settingsLocked } : {}),
    canFresh:
      keyPaired &&
      canStart &&
      ["claude-code", "codex", "pi"].includes(run.agent) &&
      host?.guardedRestart === true &&
      (run.status === "running" ||
        (run.fresh?.generation === run.generation && run.fresh.state !== "started")),
    pendingFresh:
      run.previousRun !== undefined &&
      (() => {
        const predecessor = run.previousRun
        if (!predecessor) return false
        const source = readRun(ctx.home, predecessor.id)
        return (
          !source ||
          source.generation !== predecessor.generation ||
          source.nativeSession !== predecessor.nativeSession ||
          source.fresh?.state !== "started" ||
          source.fresh.destination !== run.id
        )
      })(),
    acceptedStopSequence: acceptedStopSequence(run),
    canStart,
    canResume:
      canStart &&
      ["stopped", "failed"].includes(run.status) &&
      (!run.cleanup || run.cleanup.complete) &&
      ![run.lead, run.host].some((identity) => identity && identityState(identity) !== "dead") &&
      !!nativeSessionFile(ctx, run),
    canRestart:
      canStart &&
      run.agent !== "other" &&
      run.status === "running" &&
      host?.guardedRestart === true &&
      acceptedTurnBoundary(run),
    canChangePermission:
      canStart &&
      keyPaired &&
      run.agent !== "other" &&
      host?.permissionRestart === true &&
      host.guardedRestart === true &&
      permissionChangeBoundary(run),
    attention: callback ? "waiting" : runAttention(run),
    request: run.agent === "other" && spec.prompt ? spec.prompt : undefined,
    requestSent:
      run.agent === "other" && spec.prompt ? requestState(ctx, run.id).sent === true : undefined,
    facts: [
      run.settings?.model && `model ${run.settings.model}`,
      run.settings?.effort && `effort ${run.settings.effort}`,
      permissionDescription(run.agent, settings?.perm, settings?.permMode),
      run.permissionMode ? `agent permission mode ${run.permissionMode}` : "agent settings unknown",
      run.branch ? `branch ${run.branch}` : "this checkout",
      run.cwd,
      run.nativeSession && `session ${run.nativeSession}`,
    ]
      .filter(Boolean)
      .join(" · "),
    ...(host?.lastScreen !== undefined ? { lastScreen: host.lastScreen } : {}),
  }
  const ending = readRun(ctx.home, run.id)
  if (
    callback &&
    (ending?.generation !== run.generation ||
      ending.nativeSession !== run.nativeSession ||
      (ending.status !== "running" && ending.status !== "starting"))
  )
    return {
      ...summary,
      attention: runAttention(run),
      waitSince: run.waitSince,
      terminalPrompt: run.terminalPrompt,
    }
  return summary
}

export class RunAttachments {
  private settingsApplying = new Map<string, Promise<RunRecord>>()

  private applySettings(run: RunRecord): Promise<RunRecord> {
    if (!run.pendingSettings || run.pendingSettings.error) return Promise.resolve(run)
    const held = this.settingsApplying.get(run.id)
    if (held) return held
    const result = applyQueuedSettings(this.ctx, run, {
      authorized: (proof) => this.guard.sessions?.proofAuthority(proof)?.keyPaired === true,
      prepareResume: (current, input) => this.prepareResume(current, input),
    }).finally(() => {
      this.settingsApplying.delete(run.id)
      const current = readRun(this.ctx.home, run.id)
      if (current?.pendingSettings && current.pendingSettings.id !== run.pendingSettings?.id)
        void this.applySettings(current).catch(() => {})
    })
    this.settingsApplying.set(run.id, result)
    return result
  }

  async processSettingsChange(path: string): Promise<void> {
    const id = relative(join(this.ctx.home, "runs"), path).split(/[\\/]/)[0]
    if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return
    const run = readRun(this.ctx.home, id)
    if (run?.pendingSettings) await this.applySettings(run)
  }
  private pickerAdapter = new CodexPickerAdapter()
  private claudePickers = new Map<
    string,
    {
      generation: number
      session: string
      callId: string
      supportingContext?: string
      answersKey?: string
    }
  >()
  private attachments = new Map<ServerWebSocket<AgentSocketData>, Attachment>()
  private controllers = new Map<string, ServerWebSocket<AgentSocketData>>()
  // Per run, the browsers that may answer and read its Conversation view, and when each last did.
  private leases = new Map<string, Map<string, number>>()
  private startupRecovery?: Promise<void>
  constructor(
    private ctx: Ctx,
    private guard: GuardConfig,
  ) {}
  get size() {
    return this.attachments.size
  }
  prepare(request: Request): AgentSocketData | Response {
    const url = new URL(request.url)
    const denied = refuse(request, this.guard, true)
    if (denied) return refusal(denied.status, denied.reason)
    if (request.headers.get("origin") !== `http://${request.headers.get("host")}`)
      return refusal(403, "missing or foreign origin")
    if (url.search || request.headers.has("x-qualitylayer-token"))
      return refusal(403, "terminal attach requires a session cookie")
    const session = sessionAuthority(request, this.guard)
    if (!session) return refusal(401, "terminal attach requires a session cookie")
    const id = attachRunId(url.pathname)
    const run = id === undefined ? null : readRun(this.ctx.home, id)
    if (!run) return refusal(404, "agent run not found")
    if (!readHost(this.ctx.home, run.id)) return refusal(409, "agent host unavailable")
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((part) => part.trim())
    return {
      run: run.id,
      session: session.id,
      generation: run.generation,
      watching: protocols.includes("qualitylayer-watch-v1"),
      phone: protocols.includes("qualitylayer-phone-v1"),
    }
  }
  private async pickerResponse(
    request: Request,
    picker: string,
    authority: NonNullable<ReturnType<typeof sessionAuthority>>,
    canStart: boolean,
  ): Promise<Response> {
    const proof = request.headers.get("x-qualitylayer-picker-proof")
    const controller = this.controllers.get(picker)
    const attachment = controller && this.attachments.get(controller)
    const currentAuthority = () =>
      !request.signal.aborted &&
      !!controller &&
      !!attachment &&
      !!proof &&
      attachment.pickerProof?.value === proof &&
      attachment.pickerProof.generation === controller?.data.generation &&
      readRun(this.ctx.home, picker)?.generation === attachment.pickerProof.generation &&
      !attachment.closed &&
      !attachment.replaying &&
      this.controllers.get(picker) === controller &&
      controller.data.session === authority.id &&
      !!this.guard.sessions?.authority(authority.id)
    if (!canStart || !currentAuthority())
      return refusal(403, "Only the current controller can answer this picker")
    let input: ReturnType<typeof pickerRequest>
    let packet: NativeQuestionPacket = { value: null }
    try {
      packet = await readNativeQuestionPacket(request, body)
      input = pickerRequest(packet.value)
    } catch (cause) {
      if (request.headers.get("content-type")?.startsWith("multipart/form-data"))
        return refusal(
          400,
          cause instanceof Error
            ? cause.message
            : "Could not read the attached answer. Your draft is kept.",
        )
      input = null
    }
    if (!input) return refusal(400, "Send a bounded picker answer as JSON")
    const run = readRun(this.ctx.home, picker)
    if (
      run?.status !== "running" ||
      run.generation !== input.generation ||
      controller?.data.generation !== input.generation ||
      attachment?.host?.ready.generation !== input.generation
    )
      return refusal(409, "The native session generation changed")
    const allowed = async () =>
      currentAuthority() &&
      !!attachment &&
      (await this.capable(attachment)) &&
      readRun(this.ctx.home, picker)?.generation === input.generation &&
      readRun(this.ctx.home, picker)?.nativeSession === run.nativeSession &&
      (await taskWritable())
    const taskId =
      run.task ??
      (run.purpose.kind === "task"
        ? run.purpose.task
        : run.purpose.kind === "terminal" && run.purpose.context?.kind === "task"
          ? run.purpose.context.task
          : undefined)
    const taskWritable = async () => {
      if (!taskId) return true
      const found = await locate(this.ctx, taskId)
      return (
        found.ok &&
        found.data.task.stage !== "abandoned" &&
        !(await isArchived(this.ctx, found.data.task))
      )
    }
    if (!(await allowed())) return refusal(403, "This task cannot accept an answer.")
    const uploadTask = packet.upload && taskId ? await locate(this.ctx, taskId) : undefined
    const uploadAuthority = () =>
      currentAuthority() &&
      (!taskId ||
        (uploadTask?.ok === true &&
          uploadTask.data.task.stage !== "abandoned" &&
          !existsSync(join(uploadTask.data.task.runtimeDir, "archived.json"))))
    if (run.agent === "claude-code") {
      return this.pickerAdapter.serial(picker, async () => {
        if (!(await allowed())) return refusal(403, "Control was revoked")
        const session = run.nativeSession
        if (!session) return refusal(409, "This question has no native session")
        const pending = await listPickers(this.ctx, session)
        const pendingCall = pending.find((call) => call.callId === input.callId)
        if (!pendingCall) {
          this.claudePickers.delete(picker)
          return refusal(409, "This question is no longer waiting")
        }
        if (!(await allowed())) return refusal(403, "Control was revoked")
        const prior = this.claudePickers.get(picker)

        if (
          !packet.upload &&
          prior?.session === session &&
          prior.generation === run.generation &&
          prior.callId === input.callId
        )
          return json({ status: "submitted" })
        if (this.claudePickers.size >= 200 && !prior) {
          for (const [id, saved] of this.claudePickers) {
            const current = readRun(this.ctx.home, id)
            if (
              current?.status !== "running" ||
              current.generation !== saved.generation ||
              current.nativeSession !== saved.session ||
              !(await listPickers(this.ctx, saved.session)).some(
                (call) => call.callId === saved.callId,
              )
            )
              this.claudePickers.delete(id)
          }
        }
        if (this.claudePickers.size >= 200 && !prior)
          return refusal(409, "Too many pending question sessions")
        if (packet.upload) {
          const clean = cleanPickerAnswers(pendingCall, input.answers)
          if (!clean)
            return refusal(400, "Answer the current question batch before attaching files.")
          const answersKey = JSON.stringify(clean)
          let decisionWritten = false
          try {
            const result = await withNativeQuestionFiles(
              this.ctx,
              picker,
              input.generation,
              packet,
              uploadAuthority,
              async (supportingContext) => {
                if (!(await allowed()))
                  return {
                    status: "refused",
                    message: "Control was revoked. Your draft is kept.",
                  }
                if (
                  prior?.session === session &&
                  prior.generation === run.generation &&
                  prior.callId === input.callId
                )
                  return prior.supportingContext === supportingContext &&
                    prior.answersKey === answersKey
                    ? { status: "submitted" }
                    : {
                        status: "refused",
                        message:
                          "This question already has a different submitted answer. Your files are kept.",
                      }
                const decided = await decidePicker(
                  this.ctx,
                  session,
                  input.callId,
                  clean,
                  allowed,
                  {
                    additionalContext: supportingContext,
                    onWritten: () => {
                      decisionWritten = true
                    },
                  },
                )
                if (decided)
                  this.claudePickers.set(picker, {
                    generation: run.generation,
                    session,
                    callId: input.callId,
                    supportingContext,
                    answersKey,
                  })
                return decided
                  ? { status: "submitted" }
                  : {
                      status: "refused",
                      message: "This question is no longer waiting. Your files are kept.",
                    }
              },
              () => decisionWritten,
            )
            return json(result)
          } catch (cause) {
            return refusal(
              cause instanceof NativeQuestionFileError ? cause.status : 400,
              cause instanceof Error
                ? cause.message
                : "Could not attach files. Your draft is kept.",
            )
          }
        }
        const decided = await decidePicker(this.ctx, session, input.callId, input.answers, allowed)
        if (decided)
          this.claudePickers.set(picker, {
            generation: run.generation,
            session,
            callId: input.callId,
          })
        return decided
          ? json({ status: "submitted" })
          : refusal(409, "This question is no longer waiting")
      })
    }
    if (run.agent !== "codex") return refusal(409, "Answer this agent in the terminal")
    if (!qualifiedCodexPickerVersion(run.binary?.version))
      return json({
        status: "refused",
        message: "This Codex version is not qualified; answer in the terminal",
      })
    try {
      return json(
        await this.pickerAdapter.submitWithHost(
          picker,
          input,
          async () => {
            if (!(await allowed())) throw new Error("Control was revoked")
            return pickerHost(this.ctx, run, input.callId, allowed, currentAuthority)
          },
          packet.upload
            ? async (submit, host) => {
                const state = await host.read()
                const prior = this.pickerAdapter.submitted(picker, input.callId, state.identity)
                const question = state.question?.questions[prior.length]
                const retry = prior.some((answer) => answer.questionId === input.questionId)
                if (
                  !(await allowed()) ||
                  (!retry &&
                    (state.question?.id !== input.callId ||
                      question?.id !== input.questionId ||
                      !validPickerSelection(question, input.picks)))
                )
                  return {
                    status: "refused",
                    message: "This question changed. Your files are kept.",
                  }
                return withNativeQuestionFiles(
                  this.ctx,
                  picker,
                  input.generation,
                  packet,
                  uploadAuthority,
                  submit,
                  () =>
                    this.pickerAdapter
                      .submitted(picker, input.callId, state.identity)
                      .some((answer) => answer.questionId === input.questionId),
                )
              }
            : undefined,
        ),
      )
    } catch (cause) {
      return json({
        status: "refused",
        message:
          cause instanceof NativeQuestionFileError
            ? cause.message
            : "The native screen is unavailable; answer in the terminal",
      })
    }
  }
  async route(request: Request) {
    const path = new URL(request.url).pathname
    if (!isAgentRunsRoute(path)) return refusal(404, "not found")
    const denied = refuse(request, this.guard, true)
    if (denied) return refusal(denied.status, denied.reason)
    if (attachRunId(path) !== undefined && request.method === "GET") {
      const data = this.prepare(request)
      return data instanceof Response ? data : refusal(426, "WebSocket upgrade required")
    }
    const authority = sessionAuthority(request, this.guard)
    const config = await readConfig(this.ctx)
    const canStart = authority !== null && (authority.keyPaired || config.typeFrom === "anyPaired")
    if (path === "/api/agent-runs" && request.method === "GET") {
      if (authority?.keyPaired) {
        this.startupRecovery ??= recoverInterruptedRuns(this.ctx, {
          prepareResume: (run, input) => this.prepareResume(run, input),
        }).catch(() => {
          // Per-run failures stay on their records; an unavailable startup lock is retried next startup.
        })
      }
      const task = new URL(request.url).searchParams.get("task")
      let appQuitFailure:
        | { at: number; reason: string; failures: { run: string; message: string }[] }
        | undefined
      if (authority?.keyPaired) {
        try {
          const file = join(this.ctx.home, "app-quit-failure.json")
          if (statSync(file).size <= 64 * 1024) {
            const saved = JSON.parse(readFileSync(file, "utf8")) as typeof appQuitFailure
            if (
              saved &&
              Number.isFinite(saved.at) &&
              saved.reason === "app-quit" &&
              Array.isArray(saved.failures) &&
              saved.failures.length <= 128 &&
              saved.failures.every(
                (failure) => typeof failure.run === "string" && typeof failure.message === "string",
              )
            )
              appQuitFailure = saved
          }
        } catch {
          /* No recorded quit failure. */
        }
      }
      return json({
        ...(appQuitFailure ? { appQuitFailure } : {}),
        supported:
          process.platform === "win32"
            ? windowsRunCapability().supported
            : process.platform === "darwin" || process.platform === "linux",
        platform: process.platform,
        canStart,
        canConfigure: authority?.keyPaired === true,
        // Only a session that may change New terminal's shell needs this computer's list.
        ...(authority?.keyPaired
          ? { loginShell: loginShell(this.ctx), shells: availableShells() }
          : {}),
        runs: await Promise.all(
          listRuns(this.ctx.home)
            .filter(
              (run) =>
                task === null ||
                run.task === task ||
                (run.purpose.kind === "task" && run.purpose.task === task),
            )
            .map(async (run) =>
              summarizeRun(
                this.ctx,
                await this.applySettings(await refreshRunIntentWait(this.ctx, run)),
                canStart,
                authority?.keyPaired === true,
              ),
            ),
        ),
      })
    }
    // The CLI's key header alone starts planning for a task (`task start --plan`); no browser pairs.
    // Any other start from the key alone is what it always was: refused below.
    if (
      !authority &&
      path === "/api/agent-runs" &&
      request.method === "POST" &&
      hasKeyHeader(request, this.guard)
    ) {
      const planning = await this.startPlanningByKey(request)
      if (planning !== null) return planning
    }
    if (!authority) return refusal(401, "Agent controls require a paired browser session")
    const picker = pickerRunId(path)
    if (picker && request.method === "POST")
      return this.pickerResponse(request, picker, authority, canStart)
    const upload = messageFilesRunId(path)
    if (upload && request.method === "POST")
      return messageFilesResponse(this.ctx, request, upload, () => {
        const controller = this.controllers.get(upload)
        const attachment = controller && this.attachments.get(controller)
        const current = this.guard.sessions?.authority(authority.id)
        return (
          canStart &&
          !!current &&
          !!controller &&
          !!attachment &&
          !attachment.closed &&
          !attachment.replaying &&
          controller.data.session === authority.id &&
          controller.data.generation === readRun(this.ctx.home, upload)?.generation
        )
      })
    const catalog = conversationCatalogId(path)
    if (catalog && request.method === "GET")
      return conversationCatalogResponse(this.ctx, request, catalog, {
        keyPaired: authority.keyPaired,
        current: () => this.guard.sessions?.authority(authority.id)?.keyPaired === true,
        canConfigure: canStart,
      })
    const watched = conversationRunId(path)
    if (watched && request.method === "GET") {
      const controller = this.controllers.get(watched)
      const attachment = controller && this.attachments.get(controller)
      const proof = request.headers.get("x-qualitylayer-picker-proof")
      return conversationResponse(this.ctx, request, watched, {
        canAnswer: canStart,
        canPick:
          canStart &&
          !!proof &&
          attachment?.pickerProof?.value === proof &&
          attachment.pickerProof.generation === controller?.data.generation &&
          attachment.pickerProof.generation === readRun(this.ctx.home, watched)?.generation &&
          !attachment.closed &&
          !attachment.replaying &&
          controller?.data.session === authority.id,
        submitted: (callId) => {
          const run = readRun(this.ctx.home, watched)
          return this.pickerAdapter.submitted(
            watched,
            callId,
            `${run?.nativeSession}:${run?.generation}`,
          )
        },
        viewing: () => this.lease(watched, authority.id),
      })
    }
    const changed = turnChangesRunId(path)
    if (changed && request.method === "GET") return turnChangesResponse(this.ctx, request, changed)
    const closed = conversationClosedId(path)
    if (closed && request.method === "POST")
      return conversationClosedResponse(this.ctx, closed, {
        canAnswer: canStart,
        closed: () => this.release(closed, authority.id),
      })
    const approval = approvalRoute(path)
    if (approval && request.method === "POST") {
      if (!canStart)
        return refusal(403, "Answering for the agent requires a browser that may type to it")
      return approvalResponse(this.ctx, request, approval)
    }
    try {
      if (path === "/api/agent-runs" && request.method === "POST") {
        if (process.platform === "win32" && !windowsRunCapability().supported)
          return refusal(409, `Windows terminal is unavailable: ${windowsRunCapability().reason}`)
        if (!canStart)
          return refusal(
            403,
            "This browser can watch and stop; start from the App or a browser it opened",
          )
        const upload = await readLaunchBody(request, body)
        const input = parseRunStart(upload.input)
        if (
          upload.files.length &&
          (input.agent === "other" ||
            !["new-task", "task", "artifact"].includes(input.purpose.kind))
        )
          return refusal(400, "Attachments require a native task or artifact launch")
        const planFile = input.purpose.kind === "new-task" ? input.purpose.fromPlan : undefined
        if (planFile !== undefined && !upload.files.some((file) => file.name === planFile))
          return refusal(400, "Attach the plan the task starts from")
        if (
          input.settings &&
          PROTECTED_SETTINGS.some((key) => key in (input.settings ?? {})) &&
          !authority.keyPaired
        )
          return refusal(
            403,
            "Only the App and browsers it opened can override protected run settings",
          )
        // Answered once the run and its host are recorded (or the start ends or is refused first).
        const run = await new Promise<RunRecord>((resolve, reject) => {
          void this.start(input, authority.id, resolve, upload.files).then(resolve, reject)
        })
        return json(await summarizeRun(this.ctx, run, canStart, authority.keyPaired))
      }
      const id = /^\/api\/agent-runs\/([a-f0-9-]+)\/control$/.exec(path)?.[1]
      if (id && request.method === "POST") {
        const run = readRun(this.ctx.home, id)
        if (!run) return refusal(404, "Agent run not found")
        const input = validateControl(await body(request))
        if (input.generation !== run.generation) return refusal(409, "stale run generation")
        if (input.action === "take-control")
          return refusal(
            409,
            "Take control must use the mounted terminal's socket; a cookie cannot identify a tab",
          )
        if (input.action !== "stop" && !canStart)
          return refusal(403, "This browser can watch and stop this run")
        if (input.settings && !authority.keyPaired)
          return refusal(403, "Only the App and browsers it opened can change run settings")
        parseSettings(input.settings)
        if (input.action === "configure") {
          const proof = this.guard.sessions?.authorityProof(authority.id)
          if (!authority.keyPaired || !proof)
            return refusal(403, "This browser cannot change settings")
          const queued = await queueSettings(this.ctx, run, input, proof)
          const changed = await this.applySettings(queued)
          if (changed.pendingSettings?.error)
            return json(
              {
                error: changed.pendingSettings.error,
                ...(changed.pendingSettings.missing
                  ? { code: "native_settings_unknown", fields: changed.pendingSettings.missing }
                  : {}),
              },
              409,
            )
          if (changed.status === "failed" && changed.error)
            return json({ error: changed.error }, 409)
          return json(await summarizeRun(this.ctx, changed, canStart, true))
        }
        const changed =
          input.action === "send-request"
            ? await this.sendRequest(run)
            : await controlRun(this.ctx, run, input, {
                prepareResume: (current, choice) => this.prepareResume(current, choice),
              })
        return json(await summarizeRun(this.ctx, changed, canStart, authority.keyPaired))
      }
    } catch (cause) {
      if (cause instanceof NativeSettingsUnknownError)
        return json({ error: cause.message, code: cause.code, fields: cause.fields }, 409)
      return json({ error: cause instanceof Error ? cause.message : String(cause) }, 409)
    }
    return refusal(404, "agent run route not available")
  }

  /**
   * `task start --plan`: the CLI's key header starts planning for an existing task, as the App's
   * start does. The key is no paired browser, so it starts nothing else, sends no files and
   * overrides no protected setting; null for any other request, which stays refused.
   */
  private async startPlanningByKey(request: Request): Promise<Response | null> {
    let input: StartRequest
    try {
      const upload = await readLaunchBody(request, body)
      input = parseRunStart(upload.input)
      if (upload.files.length > 0) return null
    } catch {
      return null
    }
    if (
      input.purpose.kind !== "task" ||
      input.purpose.phase !== "planning" ||
      PROTECTED_SETTINGS.some((key) => key in (input.settings ?? {}))
    )
      return null
    if (process.platform === "win32" && !windowsRunCapability().supported)
      return refusal(409, `Windows terminal is unavailable: ${windowsRunCapability().reason}`)
    try {
      const run = await new Promise<RunRecord>((resolve, reject) => {
        void this.start(input, null, resolve).then(resolve, reject)
      })
      return json(await summarizeRun(this.ctx, run, true, false))
    } catch (cause) {
      return json({ error: cause instanceof Error ? cause.message : String(cause) }, 409)
    }
  }

  /**
   * Resume a stopped run's own native session in a detached host, as Resume does but without the
   * prompt that continues its stage: the same session id, nobody attached, ready for a message.
   */
  resumeDetached(run: RunRecord): Promise<RunRecord> {
    return controlRun(
      this.ctx,
      run,
      { action: "resume", generation: run.generation, mode: "open" },
      { prepareResume: (current, choice) => this.prepareResume(current, choice, true) },
    )
  }

  /**
   * A person may resume the session of a shipped task, landing or landed (an abandoned or archived
   * task is refused). `forWake`: the pull request wake-up resumes it only while its pull request is
   * still open, and never switches the checkout's branch to do it.
   */
  private async prepareResume(
    run: RunRecord,
    input: import("../core/run/contracts.ts").ControlRequest,
    forWake = false,
  ): Promise<ResumePreparation> {
    if (run.agent === "other" || !run.nativeSession)
      throw new Error("This agent has no qualified native session to resume")
    if (
      run.intent &&
      (run.intent.driver !== "hook" || run.intent.nativeSession !== run.nativeSession)
    )
      throw new Error("The saved continuation intent does not match this native task session.")
    const config = await readConfig(this.ctx)
    const settings = { ...run.settings, ...input.settings, fastMode: undefined }
    const previous = readLaunch(this.ctx.home, run.id)
    let purpose = run.purpose
    let stage: string | undefined
    let taskBriefsDir: string | undefined
    const runBriefsDir =
      run.purpose.kind === "new-task" ? await runBriefsDirectory(this.ctx, run.id) : undefined
    if (run.task || run.purpose.kind === "task") {
      const found = await locate(this.ctx, run.task ?? (run.purpose as { task: string }).task)
      if (!found.ok) throw new Error(found.error.message)
      if (run.intent && run.intent.task !== `${found.data.task.repoId}~${found.data.task.slug}`)
        throw new Error("The saved continuation intent belongs to another task.")
      if (await isArchived(this.ctx, found.data.task))
        throw new Error("Restore this archived task before resuming its agent")
      settings.answers = input.settings?.answers ?? found.data.task.answers
      stage = found.data.task.stage
      // An approved task keeps talking, landing or landed; only an abandoned one has ended.
      if (stage === "abandoned") throw new Error("This task has ended; start a new task instead")
      if (forWake && (await readPullRequestRecord(this.ctx, found.data.task))?.state !== "open")
        throw new NotResumed("Its pull request is no longer open; not resumed")
      if (
        input.settings?.answers !== undefined &&
        found.data.task.answers !== input.settings.answers
      )
        await patchReadme(
          this.ctx,
          found.data.task,
          { answers: input.settings.answers, approvals: null },
          "run_resume",
        )
      const planning =
        run.purpose.kind === "new-task" ||
        (run.purpose.kind === "task" && run.purpose.phase === "planning")
      purpose = {
        kind: "task",
        task: found.data.task.slug,
        ...(planning ? { phase: "planning" } : {}),
      }
      if (planning && stage !== "plan") stage = "plan"
      if (!runBriefsDir) taskBriefsDir = await taskBriefsDirectory(this.ctx, found.data.task)
    }
    if (run.branch) {
      if ("dropCaches" in this.ctx.git && typeof this.ctx.git.dropCaches === "function")
        this.ctx.git.dropCaches()
      const now = await currentBranch(this.ctx, run.cwd)
      if (now !== run.branch && forWake)
        throw new NotResumed(
          `The checkout is on ${now ?? "no branch"}, not the task's branch; not resumed`,
        )
      // After the approval the branch is expected to move on (merged, switched, deleted): the person's
      // Resume continues the conversation where the checkout is now.
      if (now !== run.branch && stage !== "shipped")
        throw new Error(
          `This checkout is no longer on the recorded branch ${run.branch}; switch to it explicitly before resuming`,
        )
    }
    const env = await agentEnvironment(this.ctx, run.id)
    env.PWD = run.cwd
    env.QUALITYLAYER_AGENT = run.agent
    const binary = await checkedAgentBinary(this.ctx, run.agent, { env, timeoutMs: 3000 })
    // The restart prepares the next generation while this one's agent may still run: its own folder.
    const nextGeneration = run.generation + 1
    const hooks = launchHooksFor(
      this.ctx,
      { id: run.id, generation: nextGeneration, agent: run.agent },
      binary.version,
      settings,
      true,
    )
    const spec = launchSpec({
      agent: run.agent,
      launchFiles: run.launchFiles,
      toolsFolder: dirname(agentEntry(this.ctx)),
      answers: settings.answers,
      artifactPrompt:
        run.purpose.kind === "artifact" && run.artifactBinding
          ? await refreshArtifactAgentContext(
              this.ctx,
              run.artifactBinding,
              run.purpose.request,
            ).then((result) => {
              if (!result.ok) throw new Error(result.error.message)
              return result.data.prompt
            })
          : undefined,
      purpose,
      stage,
      taskBriefsDir,
      runBriefsDir,
      managed: true,
      session: run.nativeSession,
      resume: true,
      continue: input.mode === "continue" || (input.action === "resume" && input.mode !== "open"),
      perm: settings.perm,
      permMode: settings.permMode,
      model: settings.model,
      effort: settings.effort,
      subagentModel: settings.subagentModel,
      works: "checkout",
      mode: "plain",
      otherAgent: config.otherAgent,
      agentArgs: agentArgs(run.agent, config),
      hooks,
    })
    readyLaunchHooks(this.ctx, run.id, nextGeneration, hooks, env)
    return {
      binary,
      launch: {
        argv: nativeCommand(binary.path, spec.args),
        cwd: run.cwd,
        env: { ...env, ...spec.env },
        cols: previous.cols,
        rows: previous.rows,
        colors: previous.colors,
      },
    }
  }

  async startChatWorkflow(request: Request, id: string, value: unknown) {
    const denied = refuse(request, this.guard, true)
    if (denied) return refusal(denied.status, denied.reason)
    const input = value as {
      type?: unknown
      retry?: unknown
      /** Start the Plan from the Chat's saved plan instead of from the request alone. */
      fromSavedPlan?: unknown
      native?: { run?: unknown; generation?: unknown; nativeSession?: unknown }
    } | null
    const native = input?.native
    const proof = request.headers.get("x-qualitylayer-picker-proof")
    if (
      !input ||
      !["feature", "bugfix"].includes(String(input.type)) ||
      !native ||
      typeof native.run !== "string" ||
      !/^[a-f0-9-]{1,128}$/.test(native.run) ||
      !Number.isSafeInteger(native.generation) ||
      typeof native.nativeSession !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(native.nativeSession) ||
      !proof ||
      !/^[a-f0-9]{64}$/.test(proof)
    )
      return refusal(400, "A bounded current native window is required to start the Plan")
    const authority = sessionAuthority(request, this.guard)
    const controller = this.controllers.get(native.run)
    const attachment = controller && this.attachments.get(controller)
    const current = () =>
      !!authority &&
      !!controller &&
      !!attachment &&
      !!this.current(attachment) &&
      this.controllers.get(native.run as string) === controller &&
      controller.data.session === authority.id &&
      controller.data.generation === native.generation &&
      attachment.pickerProof?.value === proof &&
      attachment.pickerProof.generation === native.generation &&
      !attachment.closed &&
      !attachment.replaying
    if (!current())
      return refusal(403, "Only the current replay-complete controller can start the Plan")
    try {
      const result = await handoffChatWorkflow(
        this.ctx,
        id,
        input.type as "feature" | "bugfix",
        {
          run: native.run,
          generation: native.generation as number,
          nativeSession: native.nativeSession,
          proof,
        },
        input.retry === true,
        {
          current,
          capable: async () => current() && !!attachment && (await this.capable(attachment)),
        },
        undefined,
        input.fromSavedPlan === true,
      )
      return json(result)
    } catch (cause) {
      return refusal(
        409,
        cause instanceof Error ? cause.message : "The Plan request could not be sent",
      )
    }
  }

  private async sendRequest(run: RunRecord) {
    if (run.agent !== "other") throw new Error("Only another agent needs an explicit Send request")
    return this.ctx.fs.withLock(join(runDir(this.ctx.home, run.id), "request.lock"), async () => {
      const current = readRun(this.ctx.home, run.id)
      if (!current || current.generation !== run.generation || current.status !== "running")
        throw new Error("The run is no longer running in this generation")
      if (requestState(this.ctx, run.id).sent) throw new Error("This request was already sent")
      const spec = launchSpec({
        agent: run.agent,
        launchFiles: run.launchFiles,
        toolsFolder: dirname(agentEntry(this.ctx)),
        answers: run.settings?.answers,
        artifactPrompt:
          run.purpose.kind === "artifact" && run.artifactBinding
            ? await refreshArtifactAgentContext(
                this.ctx,
                run.artifactBinding,
                run.purpose.request,
              ).then((result) => {
                if (!result.ok) throw new Error(result.error.message)
                return result.data.prompt
              })
            : undefined,
        purpose:
          run.purpose.kind === "task"
            ? { kind: "task", task: run.purpose.task.split("~").at(-1) ?? run.purpose.task }
            : run.purpose,
      })
      const bytes = Buffer.from(`${spec.prompt}\r`)
      if (bytes.length > LIMITS.inputBytes)
        throw new Error("The request exceeds one bounded input frame")
      const host = await connectOrRevive(this.ctx.home, run.id)
      try {
        if (
          host.ready.generation !== run.generation ||
          readRun(this.ctx.home, run.id)?.generation !== run.generation
        )
          throw new Error("stale run generation")
        // Persist first: a lost HTTP reply must never paste the request a second time.
        await this.ctx.fs.atomicWrite(
          join(runDir(this.ctx.home, run.id), "request-state.json"),
          JSON.stringify({ sent: true, generation: run.generation, at: new Date().toISOString() }),
        )
        host.send({ type: "input", data: bytes })
      } finally {
        host.close()
      }
      return current
    })
  }

  private freshAttachment(attachment: Attachment) {
    const run = readRun(this.ctx.home, attachment.ws.data.run)
    return (
      !!run &&
      run.generation === attachment.ws.data.generation &&
      (attachment.freshing === true ||
        (run.fresh?.generation === run.generation && run.fresh.state !== "started"))
    )
  }
  private freshReady(destination: RunRecord, source: RunRecord) {
    const current = readRun(this.ctx.home, destination.id)
    const host = readHost(this.ctx.home, destination.id)
    return (
      !!current &&
      current.generation === destination.generation &&
      current.status === "running" &&
      current.startPhase === "ready" &&
      !!current.nativeSession &&
      current.nativeSession !== source.nativeSession &&
      !!current.lead &&
      identityState(current.lead) === "live" &&
      host?.generation === current.generation &&
      host.status === "running" &&
      identityState({
        pid: host.pid,
        processStart: host.processStart,
        pidDomain: host.pidDomain,
        knownBy: "host",
      }) === "live" &&
      current.runEvents?.some(
        (event) =>
          event.generation === current.generation &&
          event.nativeSession === current.nativeSession &&
          event.lead &&
          ["SessionStart", "UserPromptSubmit"].includes(event.event),
      ) === true &&
      !!nativeSessionFile(this.ctx, current)
    )
  }
  private async startFresh(attachment: Attachment, frame: Extract<ServerFrame, { type: "fresh" }>) {
    const ws = attachment.ws
    const authorized = () =>
      !attachment.closed &&
      this.current(attachment)?.keyPaired === true &&
      this.controllers.get(ws.data.run) === ws &&
      readRun(this.ctx.home, ws.data.run)?.generation === ws.data.generation
    if (!authorized() || frame.generation !== ws.data.generation)
      throw new Error(
        "This exact window must control the current conversation before starting fresh.",
      )
    const source = readRun(this.ctx.home, ws.data.run)
    if (
      !source ||
      !["claude-code", "codex", "pi"].includes(source.agent) ||
      readHost(this.ctx.home, source.id)?.guardedRestart !== true
    )
      throw new Error("Start fresh in Terminal for this session. Its current conversation is kept.")
    const prepare = async (current: RunRecord, key: string) => {
      const prepared = await prepareFreshConversation(this.ctx, current, key)
      const context = await purposeContext(this.ctx, prepared.request, await readConfig(this.ctx))
      if (
        context.cwd !== source.cwd ||
        context.works !== "checkout" ||
        ("planGate" in context && context.planGate)
      )
        throw new Error("A fresh conversation cannot change this checkout or advance a Plan gate.")
      return prepared
    }
    attachment.freshing = true
    try {
      return await freshConversation(this.ctx, source.id, source.generation, frame.sequence, {
        authorized,
        childrenIdle: async (current) => {
          if (!nativeRun(current)) return false
          const snapshot = readConversation(this.ctx, current)
          return (
            snapshot.source !== "none" &&
            snapshot.state === "idle" &&
            !snapshot.hasMore &&
            !snapshot.workersIncomplete &&
            !snapshot.workers?.length
          )
        },
        prepare,
        unchanged: async (prepared) => {
          const current = readRun(this.ctx.home, source.id)
          if (
            !current ||
            current.generation !== source.generation ||
            current.nativeSession !== source.nativeSession
          )
            return false
          const again = await prepare(current, prepared.request.idempotencyKey)
          return (
            again.context === prepared.context &&
            stableChoices(again.request, source.cwd) === stableChoices(prepared.request, source.cwd)
          )
        },
        stop: (current) => stopRunAtBoundary(this.ctx, current),
        allocate: async (prepared) =>
          createRun(this.ctx.home, {
            agent: prepared.request.agent,
            cwd: source.cwd,
            sourceCheckout: source.cwd,
            purpose: prepared.request.purpose,
            idempotencyKey: prepared.request.idempotencyKey,
            settings: prepared.request.settings as RunSettings,
            ...(prepared.artifactBinding ? { artifactBinding: prepared.artifactBinding } : {}),
            ...chosenSession(source.agent),
            previousRun: {
              id: source.id,
              generation: source.generation,
              nativeSession: source.nativeSession as string,
            },
          }),
        start: async (destination, prepared) => {
          let current = readRun(this.ctx.home, destination.id)
          if (!current || current.previousRun?.id !== source.id)
            throw new Error("The new conversation identity changed.")
          if (current.status === "stopped" || current.status === "failed") {
            if (current.cleanup?.complete !== true)
              current = await controlRun(this.ctx, current, {
                action: "stop",
                generation: current.generation,
              })
            if (current.cleanup?.complete !== true)
              throw new Error(
                "The kept new conversation has unverified cleanup. Inspect it before retrying.",
              )
            if (nativeSessionFile(this.ctx, current))
              current = await controlRun(
                this.ctx,
                current,
                { action: "resume", generation: current.generation, mode: "continue" },
                { prepareResume: (run, choice) => this.prepareResume(run, choice) },
              )
            else {
              if (current.firstPromptAt || current.lead || current.runEvents?.length)
                throw new Error(
                  "The kept new native history is unavailable. Inspect it before retrying.",
                )
              current = updateRun(this.ctx.home, current.id, current.generation, {
                status: "validated",
                startPhase: "validated",
                cleanup: undefined,
                host: undefined,
                lead: undefined,
                error: undefined,
              })
            }
          }
          if (current.status !== "running")
            current = await this.start(prepared.request, ws.data.session, undefined, prepared.files)
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline) {
            const next = readRun(this.ctx.home, current.id)
            if (next && this.freshReady(next, source)) return next
            if (!next || next.status === "failed" || next.status === "stopped") break
            await Bun.sleep(25)
          }
          throw new Error(
            "The new conversation has not confirmed its native binding. Its output and history are kept; inspect or retry explicitly.",
          )
        },
        ready: async (destination) => this.freshReady(destination, source),
        failed: async (destination) => {
          const current = readRun(this.ctx.home, destination.id)
          if (current && !this.freshReady(current, source))
            await controlRun(this.ctx, current, { action: "stop", generation: current.generation })
        },
      })
    } finally {
      attachment.freshing = false
      await this.refreshCapabilities()
    }
  }

  private async start(
    input: StartRequest,
    /** The browser session that starts it; null when the key header itself did (planning for a task). */
    session: string | null,
    recorded?: (run: RunRecord) => void,
    files: Incoming[] = [],
  ): Promise<RunRecord> {
    const existing = listRuns(this.ctx.home).find(
      (run) => run.idempotencyKey === input.idempotencyKey,
    )
    if (
      existing &&
      (existing.agent !== input.agent ||
        JSON.stringify(existing.purpose) !== JSON.stringify(input.purpose))
    )
      throw new Error("This idempotency key belongs to different start choices")
    let config = await readConfig(this.ctx)
    assertEnabled(input.agent, config)
    if (!existing && input.agent === "pi" && input.purpose.kind !== "terminal") {
      await readModelListWithin(this.ctx, "pi", MODEL_LIST_WAIT_MS)
      config = await readConfig(this.ctx)
      assertEnabled(input.agent, config)
    }
    const initialContext = existing ? undefined : await purposeContext(this.ctx, input, config)
    if (!existing && input.planners !== undefined)
      await assertPlannersRun(this.ctx, input.planners, initialContext?.task)
    const planned = initialContext?.task
      ? await readPlanningStart(this.ctx, initialContext.task)
      : null
    const settings = await prepareStartSettings(this.ctx, config, input, {
      planned,
      task: initialContext?.task,
      existing,
    })
    if (
      input.branch !== undefined &&
      (typeof input.branch !== "string" ||
        (initialContext && !["branch", "worktree"].includes(initialContext.works)))
    )
      throw new Error("A branch name belongs only to a task's new branch choice")
    const abandoned = await reconcileAbandonedStarts(this.ctx)
    const blockedStart = existing && abandoned.blocked.find((entry) => entry.run === existing.id)
    if (blockedStart) throw new Error(blockedStart.reason)
    let run: RunRecord
    if (existing) run = existing
    else {
      if (!initialContext) throw new Error("The initial workspace was not validated")
      run = createRun(this.ctx.home, {
        agent: input.agent,
        purpose: input.purpose,
        cwd: initialContext.cwd,
        sourceCheckout: initialContext.cwd,
        idempotencyKey: input.idempotencyKey,
        settings,
        ...(initialContext.artifact || initialContext.terminalArtifactBinding
          ? {
              artifactBinding:
                initialContext.artifact?.binding ?? initialContext.terminalArtifactBinding,
            }
          : {}),
        ...(input.resumeNative !== undefined
          ? { nativeSession: input.resumeNative }
          : chosenSession(input.agent)),
      })
    }
    return this.ctx.fs.withLock(join(runDir(this.ctx.home, run.id), "start.lock"), async () => {
      let current = readRun(this.ctx.home, run.id) as RunRecord
      if (!current || current.generation !== run.generation) throw new Error("stale run generation")
      const who = session === null ? null : this.guard.sessions?.authority(session)
      const nowConfig = await readConfig(this.ctx)
      if (session !== null && (!who || (!who.keyPaired && nowConfig.typeFrom !== "anyPaired")))
        throw new Error("This browser's start authority changed")
      const requestFile = join(runDir(this.ctx.home, run.id), "start-request.json")
      const saved = (await this.ctx.fs.exists(requestFile))
        ? await this.ctx.fs.readFile(requestFile)
        : undefined
      const sourceCheckout = await startSource(this.ctx, current, input, saved)
      if (
        !saved &&
        (current.status !== "validated" ||
          current.startPhase !== "validated" ||
          current.cwd !== sourceCheckout)
      )
        throw new Error("This run has no verified original start request; inspect its kept session")
      const freshContext =
        initialContext ??
        (!saved
          ? await purposeContext(this.ctx, { ...input, cwd: sourceCheckout }, config, current)
          : undefined)
      if (!saved) await this.ctx.fs.atomicWrite(requestFile, stableChoices(input, sourceCheckout))
      if (!current.sourceCheckout)
        current = updateRun(this.ctx.home, current.id, current.generation, { sourceCheckout })
      if (!["running", "stopped", "stopping"].includes(current.status))
        current = setLaunchPhase(this.ctx.home, current.id, current.generation, "preparing")
      const launchFiles = await keepLaunchFiles(this.ctx, current, files)
      if (launchFiles.length)
        current = updateRun(this.ctx.home, current.id, current.generation, { launchFiles })
      if (["running", "stopped", "stopping"].includes(current.status)) return current
      if (current.host && identityState(current.host) !== "dead") {
        const connected = await readyHost(this.ctx, current.id, Date.now() + 10_000)
        connected.close()
        return updateRun(this.ctx.home, current.id, current.generation, {
          status: "running",
          startPhase: "ready",
          launchDiagnostic: undefined,
          launchDiagnosticAt: undefined,
        })
      }
      const context =
        freshContext ??
        (await purposeContext(this.ctx, { ...input, cwd: sourceCheckout }, config, current))
      const keptWorkspace =
        !!current.worktreePath &&
        current.worktreePath === current.cwd &&
        current.startPhase !== "validated"
      if (keptWorkspace) {
        if (context.works !== "worktree") throw new Error("The recorded start uses a worktree")
        if (context.task) {
          if (context.planGate)
            throw new Error(
              "This kept workspace belongs to an earlier Plan; start from the current approval",
            )
          const planName = folderDoc("plan")
          const rebound = await loadTask(
            this.ctx,
            { root: current.cwd, id: context.task.repoId, commonDir: "" },
            context.task.slug,
            true,
          )
          const sourcePlan = parseDoc(
            await this.ctx.fs.readFile(join(context.task.dir, planName)),
          ).frontmatter
          const keptPlan = rebound
            ? parseDoc(await this.ctx.fs.readFile(join(rebound.dir, planName))).frontmatter
            : null
          if (
            !rebound ||
            rebound.runtimeDir !== current.taskRuntimeDir ||
            sourcePlan?.review_basis !== keptPlan?.review_basis ||
            !(await approvalCurrent(this.ctx, context.task, planName)) ||
            !(await approvalCurrent(this.ctx, rebound, planName))
          )
            throw new Error("The kept workspace does not hold this run's current approved task")
          context.task = rebound
        }
        context.cwd = current.cwd
      }
      const diagnostic = isNativeAgent(current.agent)
        ? launchDiagnostic(current.agent, VERSION)
        : null
      try {
        const deadline = Date.now() + 10_000
        if (input.purpose.kind === "new-task" && context.works === "worktree") {
          setLaunchPhase(this.ctx.home, current.id, current.generation, "mutating")
          const worktree = await nativeWorktree(
            this.ctx,
            sourceCheckout,
            current.id,
            input.purpose.request,
            { branch: input.branch, worktreePath: input.worktreePath },
          )
          setLaunchPhase(this.ctx.home, current.id, current.generation, "prepared")
          context.cwd = worktree.cwd
          current = updateRun(this.ctx.home, current.id, current.generation, {
            cwd: worktree.cwd,
            branch: worktree.branch,
            worktreePath: worktree.cwd,
            startPhase: "branch-made",
          })
        }
        const planningTask =
          input.purpose.kind === "task" && input.purpose.phase !== "planning"
            ? input.purpose.task
            : undefined
        const hasPlanner =
          planningTask &&
          listRuns(this.ctx.home).some(
            (run) =>
              (run.purpose.kind === "new-task" && run.task === planningTask) ||
              (run.purpose.kind === "task" &&
                run.purpose.phase === "planning" &&
                run.purpose.task === planningTask),
          )
        const planName = context.task ? folderDoc("plan") : undefined
        const approvedPlanningHandoff = !!(
          hasPlanner &&
          context.task &&
          planName &&
          (context.planGate ||
            (parseDoc(await this.ctx.fs.readFile(join(context.task.dir, planName))).frontmatter
              ?.approved === true &&
              (await approvalCurrent(this.ctx, context.task, planName))))
        )
        await acquireRunLeases(
          this.ctx,
          current,
          {
            checkout: current.artifactBinding?.root ?? context.cwd,
            branch: context.works === "branch" && !current.branch,
            ...(runTaskLeaseKey(current) ? { task: runTaskLeaseKey(current) } : {}),
            ...(current.nativeSession ? { session: current.nativeSession } : {}),
          },
          { approvedPlanningHandoff, startAnyway: input.startAnyway },
        )
        if (context.task && context.planGate) {
          const applied = await settle(this.ctx, context.task, context.planGate, { app: true })
          if (!applied.ok) throw new Error(applied.error.message)
          if (applied.data.decision !== "approved")
            throw new Error("The Plan must be approved before starting its build")
          const reloaded = await purposeContext(this.ctx, input, nowConfig)
          if (!reloaded.task || reloaded.task.stage === "plan")
            throw new Error("The approved Plan did not advance to its build")
          context.task = reloaded.task
        }
        if (context.task && context.works === "worktree") {
          if (keptWorkspace && !current.branch)
            throw new Error("The kept worktree has no recorded branch")
          if (!keptWorkspace)
            setLaunchPhase(this.ctx.home, current.id, current.generation, "mutating")
          const workspace =
            keptWorkspace && current.branch
              ? { cwd: current.cwd, branch: current.branch }
              : await nativeWorktree(this.ctx, sourceCheckout, current.id, context.task.title, {
                  branch: input.branch,
                  worktreePath: input.worktreePath,
                })
          if (!keptWorkspace)
            setLaunchPhase(this.ctx.home, current.id, current.generation, "prepared")
          if (!keptWorkspace)
            context.task = await copyApprovedTaskToWorktree(this.ctx, context.task, workspace.cwd)
          context.cwd = workspace.cwd
          current = updateRun(this.ctx.home, current.id, current.generation, {
            cwd: workspace.cwd,
            branch: workspace.branch,
            worktreePath: workspace.cwd,
            task: input.purpose.kind === "task" ? input.purpose.task : current.task,
            taskRuntimeDir: context.task.runtimeDir,
            startPhase: "branch-made",
          })
          await acquireRunLeases(
            this.ctx,
            current,
            {
              checkout: workspace.cwd,
              task: runTaskLeaseKey(current),
              ...(current.nativeSession ? { session: current.nativeSession } : {}),
            },
            { approvedPlanningHandoff, startAnyway: input.startAnyway },
          )
        }
        if (context.works === "branch" && !context.task) {
          if (!input.branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(input.branch))
            throw new Error("Choose a valid new branch name")
          const valid = await this.ctx.git.run(context.cwd, [
            "check-ref-format",
            "--branch",
            input.branch,
          ])
          if (valid.code !== 0 || valid.stdout.trim() !== input.branch)
            throw new Error("Choose a valid literal new branch name")
          if (!current.branch) {
            setLaunchPhase(this.ctx.home, current.id, current.generation, "mutating")
            const made = await this.ctx.git.run(context.cwd, [
              "switch",
              "--quiet",
              "-c",
              input.branch,
            ])
            setLaunchPhase(this.ctx.home, current.id, current.generation, "prepared")
            if (made.code !== 0)
              throw new Error(`Could not create the branch: ${made.stderr.trim()}`)
            current = updateRun(this.ctx.home, current.id, current.generation, {
              branch: input.branch,
              startPhase: "branch-made",
            })
          } else {
            if ("dropCaches" in this.ctx.git && typeof this.ctx.git.dropCaches === "function")
              this.ctx.git.dropCaches()
            if ((await currentBranch(this.ctx, context.cwd)) !== current.branch)
              throw new Error("This checkout is no longer on the recorded launch branch")
          }
        }
        if (context.works === "branch" && context.task) {
          if ((await terminalInCheckout(this.ctx, context.task, context.cwd)) && !input.startAnyway)
            throw new Error(
              "A terminal session is working in this checkout. Choose Start anyway before changing its branch.",
            )
          if (input.startAnyway)
            await this.ctx.fs.atomicWrite(
              join(runDir(this.ctx.home, current.id), "start-anyway.json"),
              JSON.stringify({ generation: current.generation, at: new Date().toISOString() }),
            )
          if (!current.branch) {
            setLaunchPhase(this.ctx.home, current.id, current.generation, "mutating")
            const made = await createBranch(
              this.ctx,
              context.task,
              input.branch || suggestedBranch(context.task),
            )
            setLaunchPhase(this.ctx.home, current.id, current.generation, "prepared")
            if (!made.ok) throw new Error(made.error.message)
            current = updateRun(this.ctx.home, run.id, run.generation, {
              branch: made.data.branch,
              startPhase: "branch-made",
            })
          } else {
            // A start transaction cannot use the server's brief HEAD-stamp cache after an external switch.
            if ("dropCaches" in this.ctx.git && typeof this.ctx.git.dropCaches === "function")
              this.ctx.git.dropCaches()
            if ((await currentBranch(this.ctx, context.cwd)) !== current.branch)
              throw new Error(
                `This checkout is no longer on the recorded branch ${current.branch}; switch to it explicitly before retrying`,
              )
          }
        }
        if (input.allocateTask && current.purpose.kind === "new-task") {
          context.task = await allocatePlanningTask(this.ctx, current, context.cwd)
          current = updateRun(this.ctx.home, current.id, current.generation, {
            status: "starting",
            startPhase: "task-created",
            allocatedTask: true,
          })
          recorded?.(current)
        }
        // The extra planners the start chose; a task that already has its own keeps them.
        if (
          input.planners !== undefined &&
          context.task &&
          (await readPlanners(this.ctx, context.task)).length === 0
        )
          await writePlanners(this.ctx, context.task, input.planners)
        if (
          context.task &&
          current.settings?.answers &&
          context.task.answers !== current.settings.answers
        ) {
          await patchReadme(
            this.ctx,
            context.task,
            { answers: current.settings.answers, approvals: null },
            "run_start",
          )
          const { approvals: _split, ...followed } = context.task
          context.task = { ...followed, answers: current.settings.answers }
        }
        const prepared = await prepareStartProcess(this.ctx, {
          input,
          run: current,
          context,
          config: nowConfig,
          deadline,
          diagnostic,
        })
        current = prepared.run
        const { env, binary, hooks, spec } = prepared
        if (
          context.task &&
          context.task.stage === "implement" &&
          !(input.purpose.kind === "task" && input.purpose.phase === "planning")
        )
          await this.recordTaskStart(context.task, current, spec.prompt.startsWith("/goal"))
        readyLaunchHooks(this.ctx, current.id, current.generation, hooks, env)
        const launch = {
          argv: nativeCommand(binary.path, spec.args),
          cwd: context.cwd,
          env: { ...env, ...spec.env },
          cols: input.cols ?? 80,
          rows: input.rows ?? 24,
          colors: input.colors ?? { fg: 0x1c1917, bg: 0xfafaf9, cursor: 0x1c1917 },
        }
        current = updateRun(this.ctx.home, current.id, current.generation, () => {
          writeLaunch(this.ctx.home, current.id, launch)
          return {
            binary,
            status: "starting",
            startPhase: "launch-written",
            ...(context.task &&
            current.purpose.kind === "task" &&
            current.purpose.phase !== "planning" &&
            current.agent !== "other"
              ? {
                  intent: armIntent(
                    `${context.task.repoId}~${context.task.slug}`,
                    current.nativeSession ?? "",
                    new Date(this.ctx.clock.now()).toISOString(),
                  ),
                }
              : {}),
            ...(context.task
              ? {
                  task: input.purpose.kind === "task" ? input.purpose.task : current.task,
                  taskRuntimeDir: context.task.runtimeDir,
                }
              : {}),
          }
        })
        await startHost(this.ctx.home, current.id)
        // The run and its host are recorded. A host that answers at once ends the start as it always
        // did; one that does not (an agent starting slowly on a busy machine) no longer holds the
        // person's reply: it is answered after `HOST_REPLY_GRACE_MS` with the run "starting", the
        // wait goes on, and the run's status ("running", or "failed" with its error) says how it ended.
        const hostAnswered = readyHost(this.ctx, current.id, deadline).then(
          (connection) => ({ connection }),
          (cause: unknown) => ({ cause }),
        )
        let grace: ReturnType<typeof setTimeout> | undefined
        const slow = await Promise.race([
          hostAnswered,
          new Promise<"slow">((resolve) => {
            grace = setTimeout(() => resolve("slow"), HOST_REPLY_GRACE_MS)
          }),
        ])
        clearTimeout(grace)
        if (slow === "slow") recorded?.(readRun(this.ctx.home, current.id) ?? current)
        const answered = await hostAnswered
        if ("cause" in answered) throw answered.cause
        answered.connection.close()
        const ready = updateRun(this.ctx.home, current.id, current.generation, {
          status: "running",
          startPhase: "ready",
          error: undefined,
          launchDiagnostic: undefined,
          launchDiagnosticAt: undefined,
        })
        const remembered = planningStartOf(ready, input)
        if (remembered) {
          if (context.task) await writePlanningStart(this.ctx, context.task, remembered)
          await rememberPlanningStart(this.ctx, remembered)
        }
        return ready
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        const latest = readRun(this.ctx.home, current.id)
        if (latest?.status === "running")
          throw new Error(
            `The agent started, but its planning setup could not be remembered: ${message}`,
          )
        if (latest?.generation === run.generation)
          current = updateRun(this.ctx.home, current.id, run.generation, {
            status: "failed",
            error: message,
            launchDiagnostic: diagnostic?.failed(current.startPhase),
            launchDiagnosticAt: diagnostic
              ? new Date(this.ctx.clock.now()).toISOString()
              : undefined,
          })
        throw new Error(
          `${message}${current.branch ? ` The branch ${current.branch} was kept.` : ""} (run ${current.id}, phase ${current.startPhase})`,
        )
      }
    })
  }
  private async recordTaskStart(task: Task, run: RunRecord, goal: boolean) {
    const agent = run.agent
    const recorded = await recordStart(this.ctx, task, {
      agent,
      orchestrator: run.settings?.model ?? "session",
      workers: agent === "other" ? "session" : (run.settings?.subagentModel ?? AGENT_OWN),
      effort: run.settings?.effort ?? "high",
      goal,
      where: "new",
    })
    if (!recorded.ok) throw new Error(recorded.error.message)
  }
  private current(attachment: Attachment) {
    const authority = this.guard.sessions?.authority(attachment.ws.data.session)
    if (!authority) {
      this.end(attachment, 1008, "session expired or revoked")
      return null
    }
    return authority
  }
  private async capable(attachment: Attachment) {
    const authority = this.current(attachment)
    if (!authority) return false
    const config = await readConfig(this.ctx)
    return authority.keyPaired || config.typeFrom === "anyPaired"
  }
  async open(ws: ServerWebSocket<AgentSocketData>) {
    const attachment: Attachment = {
      ws,
      decoder: new FrameDecoder("server"),
      unsubscribe: () => {},
      replaying: true,
      upTo: 0,
      epoch: 0,
      closed: false,
      retrying: false,
      recovered: false,
      ended: false,
      messages: Promise.resolve(),
      inboundBytes: 0,
    }
    this.attachments.set(ws, attachment)
    const authority = this.current(attachment)
    if (!authority) return
    attachment.timer = setTimeout(
      () => this.end(attachment, 1008, "session expired"),
      Math.min(2_147_483_647, Math.max(0, authority.expiresAt - this.ctx.clock.now())),
    )
    // A 30-day remembered session exceeds setTimeout's limit; re-arm at its bounded deadline.
    if (authority.expiresAt - this.ctx.clock.now() > 2_147_483_647) {
      clearTimeout(attachment.timer)
      const deadline = () => {
        if (attachment.closed) return
        const held = this.current(attachment)
        if (held)
          attachment.timer = setTimeout(
            deadline,
            Math.min(2_147_483_647, Math.max(0, held.expiresAt - this.ctx.clock.now())),
          )
      }
      attachment.timer = setTimeout(deadline, 2_147_483_647)
    }
    attachment.unsubscribe =
      this.guard.sessions?.subscribe(() => {
        if (this.current(attachment)) void this.refreshCapabilities()
      }) ?? (() => {})
    if (!ws.data.watching && !this.controllers.has(ws.data.run) && (await this.capable(attachment)))
      this.controllers.set(ws.data.run, ws)
    await this.refreshCapabilities()
    attachment.controllerAtAttach = this.controllers.get(ws.data.run)
    await this.attach(attachment)
  }
  async refreshCapabilities() {
    const config = await readConfig(this.ctx)
    for (const attachment of this.attachments.values()) {
      const authority = this.current(attachment)
      if (!authority) continue
      const canTakeControl = authority.keyPaired || config.typeFrom === "anyPaired"
      const controller = this.controllers.get(attachment.ws.data.run) === attachment.ws
      const currentRun = readRun(this.ctx.home, attachment.ws.data.run)
      const canType =
        canTakeControl && controller && currentRun?.status === "running" && !attachment.freshing
      const canPick =
        canType && !attachment.replaying && currentRun.generation === attachment.ws.data.generation
      if (!canPick) attachment.pickerProof = undefined
      else if (attachment.pickerProof?.generation !== currentRun.generation)
        attachment.pickerProof = {
          value: randomBytes(32).toString("hex"),
          generation: currentRun.generation,
        }
      const state = validateViewerState({
        type: "viewer-state",
        generation: attachment.ws.data.generation,
        controller,
        canType,
        canStop: true,
        canResize: canType && !attachment.ws.data.phone,
        canTakeControl,
        ...(attachment.pickerProof ? { pickerProof: attachment.pickerProof.value } : {}),
      })
      const text = JSON.stringify(state)
      if (
        attachment.ws.getBufferedAmount() + Buffer.byteLength(text) > LIMITS.attachmentBytes ||
        attachment.ws.send(text) === 0
      )
        this.end(attachment, 1013, "terminal backlog full")
    }
  }
  private sameLiveHost(attachment: Attachment, expected: HostConnection["ready"]) {
    const run = readRun(this.ctx.home, attachment.ws.data.run)
    const host = readHost(this.ctx.home, attachment.ws.data.run)
    return !!(
      !attachment.ended &&
      expected.run === attachment.ws.data.run &&
      expected.generation === attachment.ws.data.generation &&
      run?.status === "running" &&
      run.generation === attachment.ws.data.generation &&
      host?.status === "running" &&
      host.run === expected.run &&
      host.generation === attachment.ws.data.generation &&
      host.pid === expected.pid &&
      host.processStart === expected.processStart &&
      this.controllers.get(attachment.ws.data.run) === attachment.controllerAtAttach &&
      identityState({
        pid: host.pid,
        processStart: host.processStart,
        pidDomain: host.pidDomain,
        knownBy: "host",
      }) === "live"
    )
  }
  private recover(attachment: Attachment, host: HostConnection) {
    // A capped host can close before its queued resync reaches the paused bridge.
    if (
      attachment.closed ||
      attachment.retrying ||
      attachment.recovered ||
      attachment.host !== host ||
      !this.current(attachment) ||
      !this.sameLiveHost(attachment, host.ready)
    )
      return false
    attachment.recovered = true
    attachment.retrying = true
    host.close()
    void this.attach(attachment, host.ready).finally(() => {
      attachment.retrying = false
    })
    return true
  }
  private async attach(attachment: Attachment, expected?: HostConnection["ready"]) {
    if (attachment.closed || !this.current(attachment)) return
    attachment.host?.close()
    try {
      if (expected && !this.sameLiveHost(attachment, expected))
        throw new Error("The agent changed before output recovery")
      const host = await connectOrRevive(this.ctx.home, attachment.ws.data.run)
      if (attachment.closed || !this.current(attachment)) {
        host.close()
        return
      }
      if (
        host.ready.generation !== attachment.ws.data.generation ||
        readRun(this.ctx.home, attachment.ws.data.run)?.generation !==
          attachment.ws.data.generation ||
        (expected &&
          (host.ready.pid !== expected.pid ||
            host.ready.processStart !== expected.processStart ||
            !this.sameLiveHost(attachment, expected)))
      ) {
        host.close()
        throw new Error("The agent changed while its window was connecting")
      }
      attachment.host = host
      attachment.replaying = true
      attachment.epoch = 0
      host.onFrame((frame) => {
        if (attachment.host !== host) return
        this.output(attachment, frame)
        // The host counts what it sent this window beyond what it acknowledged: acknowledged as it
        // is forwarded, and held back while the browser has a backlog (then `drain` acknowledges).
        if (attachment.ws.getBufferedAmount() < LIMITS.attachmentBytes / 4) host.ack(32 * 1024)
      })
      host.socket.once("close", () => {
        if (attachment.host === host && this.freshAttachment(attachment)) {
          attachment.host = undefined
          void this.refreshCapabilities()
          return
        }
        if (
          attachment.host === host &&
          !attachment.retrying &&
          !attachment.closed &&
          !this.recover(attachment, host)
        )
          this.end(attachment, 1011, "agent host disconnected")
      })
      host.send({ type: "attach", generation: attachment.ws.data.generation })
      host.ack()
    } catch (error) {
      let failure = error
      try {
        // A window on a host that died with its machine shows the ended run and Resume.
        const run = await settleDeadHost(
          this.ctx.home,
          attachment.ws.data.run,
          attachment.ws.data.generation,
        )
        if (
          !existsSync(join(runDir(this.ctx.home, attachment.ws.data.run), "token")) &&
          run?.generation === attachment.ws.data.generation &&
          (run.status === "stopped" || run.status === "failed")
        ) {
          const launch = readLaunch(this.ctx.home, run.id)
          this.send(attachment, {
            type: "status",
            status: run.status,
            cols: launch.cols,
            rows: launch.rows,
          })
          if (this.freshAttachment(attachment)) {
            await this.refreshCapabilities()
            return
          }
          this.end(attachment, 1000, "agent session ended")
          return
        }
      } catch (cause) {
        failure = cause
      }
      this.send(attachment, { type: "error", code: "attach_failed", message: String(failure) })
      this.end(attachment, 1011, "agent host unavailable")
    }
  }
  private send(attachment: Attachment, frame: HostFrame) {
    if (attachment.closed || !this.current(attachment)) return false
    const bytes = encodeFrame(frame)
    if (attachment.ws.getBufferedAmount() + bytes.length > LIMITS.attachmentBytes) {
      this.end(attachment, 1013, "slow terminal; reconnect for replay")
      return false
    }
    const sent = attachment.ws.send(bytes)
    if (sent === 0) {
      this.end(attachment, 1013, "terminal backlog full")
      return false
    }
    if (sent === -1) attachment.host?.socket.pause()
    return true
  }
  private output(attachment: Attachment, frame: HostFrame) {
    if (!this.current(attachment) || attachment.closed || frame.type === "fresh-result") return
    if (frame.type === "resync") {
      if (attachment.retrying) return
      if (!attachment.host || !this.recover(attachment, attachment.host))
        this.end(attachment, 1011, "agent host disconnected")
      return
    }
    if (
      frame.type === "exit" ||
      (frame.type === "status" && ["stopping", "stopped", "failed"].includes(frame.status))
    )
      attachment.ended = true
    if (frame.type === "replay-begin") {
      attachment.pickerProof = undefined
      attachment.epoch = frame.epoch
      attachment.upTo = frame.upTo
      attachment.replaying = true
    }
    if (
      (frame.type === "replay-chunk" || frame.type === "replay-end") &&
      frame.epoch !== attachment.epoch
    ) {
      this.end(attachment, 1002, "replay epoch mismatch")
      return
    }
    if (frame.type === "replay-end") attachment.replaying = false
    if (frame.type === "output") {
      if (attachment.replaying) {
        this.end(attachment, 1002, "live output before replay")
        return
      }
      if (frame.seq <= attachment.upTo) return
      attachment.upTo = frame.seq
    }
    this.send(attachment, frame)
    if (frame.type === "replay-end" || frame.type === "replay-begin")
      void this.refreshCapabilities()
  }
  message(ws: ServerWebSocket<AgentSocketData>, message: string | Buffer) {
    const attachment = this.attachments.get(ws)
    if (!attachment) return
    const size = typeof message === "string" ? Buffer.byteLength(message) : message.length
    if (attachment.inboundBytes + size > LIMITS.inboundBytes) {
      this.end(attachment, 1009, "input backlog full")
      return
    }
    attachment.inboundBytes += size
    attachment.messages = attachment.messages
      .then(() => this.receive(ws, message))
      .finally(() => {
        attachment.inboundBytes -= size
      })
  }
  private async receive(ws: ServerWebSocket<AgentSocketData>, message: string | Buffer) {
    const attachment = this.attachments.get(ws)
    if (!attachment || !this.current(attachment)) return
    try {
      if (typeof message === "string" || message.length > LIMITS.inboundBytes)
        throw new Error("invalid terminal frame")
      for (const raw of attachment.decoder.push(message)) {
        const frame = raw as ServerFrame
        if (frame.type === "restart")
          throw new Error(
            "Restart uses the guarded HTTP transaction, never a browser terminal frame",
          )
        if (!["input", "resize", "control", "fresh"].includes(frame.type))
          throw new Error("invalid browser direction")
        const run = readRun(this.ctx.home, ws.data.run)
        if (
          !run ||
          run.generation !== ws.data.generation ||
          ((frame.type === "control" || frame.type === "fresh") &&
            frame.generation !== run.generation)
        ) {
          this.send(attachment, {
            type: "error",
            code: "stale_generation",
            message: "This run has changed; open its window again.",
          })
          continue
        }
        if (frame.type === "control" && frame.action === "stop") {
          attachment.host?.send(frame)
          continue
        }
        if (!(await this.capable(attachment))) {
          await this.refreshCapabilities()
          this.send(attachment, {
            type: "error",
            code: "watch_only",
            message: "This browser can watch and stop this run.",
          })
          continue
        }
        if (frame.type === "control" && frame.action === "take-control") {
          ws.data.watching = false
          const previous = this.controllers.get(ws.data.run)
          const before = previous && this.attachments.get(previous)
          if (before) before.pickerProof = undefined
          attachment.pickerProof = undefined
          this.controllers.set(ws.data.run, ws)
          await this.refreshCapabilities()
          continue
        }
        if (this.controllers.get(ws.data.run) !== ws) {
          this.send(attachment, {
            type: "error",
            code: "watch_only",
            message: "Another window controls this run.",
          })
          continue
        }
        if (frame.type === "fresh") {
          try {
            const destination = await this.startFresh(attachment, frame)
            this.send(attachment, {
              type: "fresh-result",
              request: frame.request,
              generation: frame.generation,
              status: "started",
              run: destination.id,
              nextGeneration: destination.generation,
            })
            this.end(attachment, 1000, "Fresh conversation started")
            return
          } catch (cause) {
            const message =
              cause instanceof Error
                ? cause.message
                : "The fresh conversation could not start. Your previous history is kept."
            this.send(attachment, {
              type: "fresh-result",
              request: frame.request,
              generation: frame.generation,
              status: "failed",
              message: message.slice(0, 2048),
            })
          }
          continue
        }
        if (run.status !== "running") {
          this.send(attachment, {
            type: "error",
            code: "session_ended",
            message: "This native session is stopped. Resume it or retry fresh explicitly.",
          })
          continue
        }
        if (frame.type === "resize" && ws.data.phone) continue
        if (frame.type === "control" && frame.action === "move") {
          this.send(attachment, {
            type: "error",
            code: "unavailable",
            message: "Move is not available yet.",
          })
          continue
        }
        if (frame.type === "input" && !frame.data.length) continue
        if (!this.current(attachment)) return
        const host = attachment.host
        if (!host || host.socket.writableLength + encodeFrame(frame).length > LIMITS.inboundBytes) {
          this.end(attachment, 1009, "input backlog full")
          return
        }
        if (frame.type === "input") {
          await this.pickerAdapter.serial(run.id, async () => {
            if (
              !(await this.capable(attachment)) ||
              this.controllers.get(run.id) !== ws ||
              readRun(this.ctx.home, run.id)?.generation !== ws.data.generation ||
              attachment.closed
            )
              return
            host.send(frame)
          })
        } else host.send(frame)
      }
    } catch {
      this.end(attachment, 1002, "terminal protocol error")
    }
  }
  drain(ws: ServerWebSocket<AgentSocketData>) {
    const host = this.attachments.get(ws)?.host
    host?.socket.resume()
    host?.ack()
  }
  private end(attachment: Attachment, code: number, reason: string) {
    if (attachment.closed) return
    attachment.closed = true
    attachment.pickerProof = undefined
    attachment.ws.close(code, reason)
    this.close(attachment.ws)
  }
  close(ws: ServerWebSocket<AgentSocketData>) {
    const attachment = this.attachments.get(ws)
    if (!attachment) return
    attachment.closed = true
    clearTimeout(attachment.timer)
    attachment.unsubscribe()
    attachment.host?.close()
    this.attachments.delete(ws)
    if (this.controllers.get(ws.data.run) === ws) this.controllers.delete(ws.data.run)
    // The last window of the browser that holds the view's lease going away (the App closed or crashed)
    // ends the lease; a waiting permission prompt is then left to the agent's own dialog.
    const { run, session } = ws.data
    if (
      this.leases.get(run)?.has(session) &&
      !this.attached(run, session) &&
      this.release(run, session)
    )
      void this.endViewing(run)
  }
  private attached(run: string, reader: string) {
    return [...this.attachments.keys()].some(
      (ws) => ws.data.run === run && ws.data.session === reader,
    )
  }
  /**
   * A browser that may answer read the view. Its reads are the only renewal of the lease (see approvals.ts);
   * this only remembers who read, so that the last of them closing can end it. No timer renews anything.
   */
  private lease(run: string, reader: string) {
    const readers = this.leases.get(run) ?? new Map<string, number>()
    const now = this.ctx.clock.now()
    // A reader that never closed is forgotten with the marker it left.
    for (const [other, at] of readers) if (now - at > VIEW_MAX_MS) readers.delete(other)
    readers.set(reader, now)
    this.leases.set(run, readers)
  }
  /** One holder lets go; true when no other holder read the view lately. */
  private release(run: string, reader: string) {
    const readers = this.leases.get(run)
    readers?.delete(reader)
    if (readers?.size === 0) this.leases.delete(run)
    const now = this.ctx.clock.now()
    return ![...(readers ?? [])].some(([, at]) => now - at <= VIEW_LEASE_MS)
  }
  private async endViewing(id: string) {
    try {
      const run = readRun(this.ctx.home, id)
      if (run && nativeRun(run) && run.nativeSession)
        await stopViewing(this.ctx, run.agent, run.nativeSession)
    } catch {
      // The view is not seen as open once its marker is old anyway.
    }
  }
  dispose() {
    this.claudePickers.clear()
    for (const run of this.controllers.keys()) this.pickerAdapter.forget(run)
    for (const id of this.leases.keys()) void this.endViewing(id)
    this.leases.clear()
    for (const attachment of this.attachments.values()) this.end(attachment, 1001, "server closing")
  }
}
