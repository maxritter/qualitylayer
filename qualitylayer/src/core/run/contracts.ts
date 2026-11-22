import { isNativeAgent, type NativeAgent } from "../agents/ids.ts"
import type { ArtifactAgentBinding } from "../artifact/agent-context.ts"
import type { Attachment } from "../interaction-docs/attachments.ts"
import type { ExtraPlanner } from "../review/planners.ts"
import type { FreshState } from "./fresh-state.ts"
import type { LaunchDiagnostic } from "./launch-diagnostics.ts"
import type { StartupPrompt } from "./startup-prompt.ts"

export const PROTOCOL_VERSION = 1
export const PROTECTED_SETTINGS = [
  "commitTiming",
  "typeFrom",
  "perm",
  "permMode",
  "otherAgent",
  "customEditor",
  "onQuit",
  "terminal",
] as const
/** The keys of `agents.<id>` that start a program, move a folder or set the permission mode, so only the App may change them. */
export const PROTECTED_AGENT_SETTINGS = ["command", "args", "configDir", "permMode"] as const
/** The keys of `updates` that choose which releases the App installs, so only the App may change them. */
export const PROTECTED_UPDATE_SETTINGS = ["channel"] as const
/** The keys of `pullRequests` that let QualityLayer wake an agent on its own (each wake-up is a turn on the person's plan), so only the App may change them. */
const PROTECTED_PULL_REQUEST_SETTINGS = ["watch"] as const
const names = (entry: unknown, keys: readonly string[]): boolean =>
  typeof entry === "object" && entry !== null && keys.some((key) => Object.hasOwn(entry, key))
/**
 * Whether a settings patch names something only the person in the App may change: a protected run
 * setting (permission defaults, who can type, the shell, another agent), an agent's command,
 * extra arguments, folder or default permission mode, the update channel, or whether pull requests are watched. The route refuses such a patch from a browser that may only watch; the command line refuses the narrower `onlyInApp` set.
 */
export function touchesProtectedSettings(patch: Record<string, unknown>): boolean {
  if (PROTECTED_SETTINGS.some((key) => Object.hasOwn(patch, key))) return true
  if (names(patch.planning, ["lastStart"])) return true
  const { agents, updates, pullRequests } = patch
  if (
    names(updates, PROTECTED_UPDATE_SETTINGS) ||
    names(pullRequests, PROTECTED_PULL_REQUEST_SETTINGS)
  )
    return true
  return (
    typeof agents === "object" &&
    agents !== null &&
    Object.values(agents).some((entry) => names(entry, PROTECTED_AGENT_SETTINGS))
  )
}
/**
 * What the command line still refuses (Max, 9 November 2026): the permission mode, the program a
 * session launches and its arguments, and who may type. The other protected settings (when you quit
 * the App, an agent's folder, the update channel, pull-request watching) the person may also set with
 * `qualitylayer settings set`; a browser that may only watch still cannot.
 */
const COMMAND_REFUSED = [
  "typeFrom",
  "perm",
  "permMode",
  "otherAgent",
  "customEditor",
  "terminal",
] as const
const COMMAND_REFUSED_AGENT = ["command", "args", "permMode"] as const

export function onlyInApp(patch: Record<string, unknown>): boolean {
  if (COMMAND_REFUSED.some((key) => Object.hasOwn(patch, key))) return true
  // The last planning start carries its permission level and mode.
  if (names(patch.planning, ["lastStart"])) return true
  const { agents } = patch
  return (
    typeof agents === "object" &&
    agents !== null &&
    Object.values(agents).some((entry) => names(entry, COMMAND_REFUSED_AGENT))
  )
}
export type AgentKind = NativeAgent | "other"
/** A native agent, or `other` for an agent QualityLayer knows only by its command. */
export const isAgentKind = (value: unknown): value is AgentKind =>
  isNativeAgent(value) || value === "other"
export type TerminalContext =
  | { kind: "task"; task: string }
  | { kind: "artifact"; scope: "task" | "project"; id: string; file: string; revision: string }
  | { kind: "agent-setup"; agent: NativeAgent; operation: "install" | "sign-in" }
export type RunPurpose =
  | { kind: "task"; task: string; phase?: "planning" }
  | {
      kind: "new-task"
      request: string
      title?: string
      type?: "feature" | "bugfix" | "chat"
      /**
       * The task starts from the person's own plan: the name of the launch file that holds it (one
       * Markdown or text file; a pasted plan travels as `pasted-plan.md`). The server adopts it when it
       * allocates the task (task/adoption.ts); the other launch files stay context.
       */
      fromPlan?: string
    }
  | {
      kind: "artifact"
      scope: "task" | "project"
      id: string
      file: string
      revision: string
      request: string
    }
  /** A plain session from New terminal: the agent or a login shell, in a known checkout, no task. */
  | { kind: "terminal"; shell?: true; context?: TerminalContext }
export type RunStatus = "validated" | "starting" | "running" | "stopping" | "stopped" | "failed"

export function canRecoverRun(
  run: Pick<RunRecord, "agent" | "purpose" | "settings" | "intent">,
): boolean {
  return (
    run.agent !== "other" &&
    ["task", "new-task", "artifact"].includes(run.purpose.kind) &&
    run.settings?.onQuit !== "stop" &&
    (!run.intent || !["paused", "blocked", "complete"].includes(run.intent.state))
  )
}
export type StartPhase =
  | "validated"
  | "task-created"
  | "branch-made"
  | "launch-written"
  | "host-started"
  | "ready"
export type ProcessIdentity = {
  windowsJob?: string
  pid: number
  pgid?: number
  processStart: string
  pidDomain: string
  knownBy: "lead" | "descendant" | "host" | "inherited"
  parent?: number
  nativeStart?: string
  ownerHash?: string
}
export type CleanupResult = {
  complete: boolean
  remaining: ProcessIdentity[]
  unverified: ProcessIdentity[]
  errors: string[]
  at: string
}
export type TerminalColors = { fg: number; bg: number; cursor: number }
export type LaunchRecord = {
  argv: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  colors: TerminalColors
}
export type RunSettings = {
  answers?: "app" | "terminal"
  /** This run's initial presentation; later window switches remain local to that window. */
  agentView?: "conversation" | "terminal"
  perm: "own" | "fewer" | "bypass"
  /** The agent's permission mode (an id from its `permissionModes`); `perm` is its level. Unset: the level's first mode, or the agent's own setting at `own`. */
  permMode?: string
  typeFrom: "keyPaired" | "anyPaired"
  onQuit: "keep" | "stop"
  windowMode: "fold" | "open"
  model?: string
  effort?: string
  /** Server-derived native subagent default, retained for this run's later generations. */
  subagentModel?: string
  /** Legacy records may contain this field; launches ignore it and keep native speed settings. */
  fastMode?: boolean
}
export type RunEvent = {
  generation: number
  sequence: number
  at: string
  nativeSession: string
  event: string
  turn?: string
  permissionMode?: string
  notificationType?: string
  caller: ProcessIdentity
  lead: boolean
  accepted?: boolean
  interrupted?: boolean
}
export type RunIntent = {
  version: 1
  target: "human-review"
  driver: "hook"
  task: string
  nativeSession: string
  armedAt: string
  state: "active" | "waiting" | "paused" | "blocked" | "complete"
  reason?: string
  attemptedProgress?: string
  waitSince?: string
  continuation?: { generation: number; sequence: number; stage: string }
}
/**
 * The intent stopped nudging because the task's documents did not change since the last nudge. That
 * ends the automatic continuation; it does not say the task failed (a known wait changes no document).
 */
export const INTENT_NO_PROGRESS =
  "Auto-continue paused: the task documents did not change since the last continuation. Send a message to keep going."
/** The same halt as recorded before 12.10; run records written then still carry it. */
const INTENT_NO_PROGRESS_BEFORE =
  "No recorded progress since the last continuation. Inspect the blocker before resuming."
export const isNoProgressHalt = (intent: RunIntent | undefined): boolean =>
  intent?.state === "blocked" &&
  (intent.reason === INTENT_NO_PROGRESS || intent.reason === INTENT_NO_PROGRESS_BEFORE)
/**
 * The words a recorded intent shows. A no-progress halt always reads as today's pause, also on a
 * record written before 12.10, whose own words sent people looking for a blocker that was not there.
 */
export const intentReasonText = (intent: RunIntent | undefined): string | undefined =>
  isNoProgressHalt(intent) ? INTENT_NO_PROGRESS : intent?.reason
/**
 * Why a queued settings change has not been applied yet. A change restarts the native session, so it
 * waits for the turn to end (`turn`), for the subagents running in the session (`subagents`; a
 * restart would end them) and for the session's record to be read to its end (`record`).
 */
export type SettingsWait = "turn" | "subagents" | "record"
export type RunRecord = {
  pendingSettings?: {
    id: string
    generation: number
    nativeSession: string
    requestedAt: string
    requestedStatus: "running" | "stopped" | "failed"
    authorityProof: string
    settings: Partial<Pick<RunSettings, "model" | "effort" | "perm" | "permMode">>
    confirmBypass?: boolean
    /** What the change waits for now; the App shows it beside the requested value. */
    waiting?: SettingsWait
    error?: string
    missing?: ("model" | "effort")[]
  }
  workflowHandoff?: {
    task: string
    nativeSession: string
    generation: number
    type: "feature" | "bugfix"
    status: "pending" | "sent" | "uncertain"
    message?: string
  }
  previousRun?: { id: string; generation: number; nativeSession: string }
  fresh?: FreshState
  id: string
  agent: AgentKind
  cwd: string
  /** Server-recorded checkout before an explicit branch/worktree start; never supplied by a client. */
  sourceCheckout?: string
  purpose: RunPurpose
  /** Server-saved files supplied with this launch; clients cannot choose these paths. */
  launchFiles?: Attachment[]
  /** Durable starter identity and mutation boundary; ambiguous boundaries are never retired. */
  launchOwner?: {
    generation: number
    identity: ProcessIdentity
    phase: "preparing" | "mutating" | "prepared" | "starting-host"
  }
  generation: number
  status: RunStatus
  startedAt: string
  /** The current launch generation's boundary for native mode-change evidence. */
  generationStartedAt?: string
  updatedAt: string
  idempotencyKey: string
  startPhase: StartPhase
  task?: string
  taskRuntimeDir?: string
  /** The App allocated this planning task before native launch. */
  allocatedTask?: true
  artifactBinding?: ArtifactAgentBinding
  nativeSession?: string
  branch?: string
  worktreePath?: string
  binary?: { path: string; version: string }
  settings?: RunSettings
  lead?: ProcessIdentity
  host?: ProcessIdentity
  error?: string
  /** Fixed-enum observations from the latest failed Start, without paths or command output. */
  launchDiagnostic?: LaunchDiagnostic
  launchDiagnosticAt?: string
  cleanup?: CleanupResult
  stoppedAt?: string
  permissionMode?: string
  runEvents?: RunEvent[]
  eventSequence?: number
  lastPrompt?: { generation: number; sequence: number; turn?: string }
  firstPromptAt?: string
  /** The agent waits on its own start-up question (trust this folder, …) in its terminal; see startup-prompt.ts. */
  startupPrompt?: StartupPrompt
  /** A live native permission dialog with no supported reply transport; answer in Terminal. */
  terminalPrompt?: "permission"
  waitSince?: string
  attention?: "waiting" | "attention" | "clear"
  intent?: RunIntent
  guardedRestart?: { sequence: number; valid: boolean }
  /**
   * A planning session whose build a session outside the App picked up (handoff/outside.ts): who took
   * it, when, the run's event sequence then, and whether it was told in its window. Its host closes it
   * at the first turn that ends after that sequence; the App shows it as read-only history.
   */
  handedOff?: { agent: string | null; session: string; at: string; sequence: number; told: boolean }
  /** A pending startup claim may resume; a failed attempt or explicit stop requires Resume. */
  recovery?: { generation: number; state: "pending" | "attempted" | "cancelled"; at: string }
}
export type HostRecord = {
  permissionRestart?: boolean
  windowsJob?: string
  protocol: number
  guardedRestart?: boolean
  /** The host listens again on SIGUSR2 when its socket file was removed. Older hosts would die. */
  socketRevive?: boolean
  run: string
  generation: number
  pid: number
  processStart: string
  pidDomain: string
  socket: string
  tokenHash: string
  ownerHash?: string
  agent: AgentKind
  cwd: string
  startedAt: string
  lead?: ProcessIdentity
  descendants?: ProcessIdentity[]
  status: RunStatus
  exitCode?: number
  stoppedAt?: string
  lastScreen?: string
  /** When anyone last typed into the session (ms); written at most once a second. */
  lastInputAt?: number
  cleanup?: CleanupResult
  error?: string
}
export type RunControl = "interrupt" | "stop" | "move" | "take-control"
/** Browser requests carry choices, never process, recipient or attachment authority. */
export type StartRequest = {
  agent: AgentKind
  purpose: RunPurpose
  cwd?: string
  idempotencyKey: string
  /** Allocate the canonical task before launching its native planning session. */
  allocateTask?: boolean
  /**
   * A feature task's extra planners (agent · model · effort, at most two): kept for the task when
   * this start allocates it, or starts its planning while it has none yet (review/planners.ts).
   */
  planners?: ExtraPlanner[]
  settings?: Partial<RunSettings>
  works?: "checkout" | "branch" | "worktree"
  mode?: "goal" | "plain"
  branch?: string
  worktreePath?: string
  cols?: number
  rows?: number
  colors?: TerminalColors
  confirmBypass?: boolean
  startAnyway?: boolean
  workers?: string
  /**
   * A task's build session continues here in the agent's own conversation from outside the App: the
   * native session id the outside session ran. The start resumes it once nothing else holds it.
   */
  resumeNative?: string
}
export type ControlRequest = {
  action: RunControl | "restart" | "resume" | "send-request" | "configure"
  generation: number
  settings?: Partial<RunSettings>
  mode?: "open" | "continue"
  confirmBypass?: boolean
}
/** List metadata applies to the session; controller state arrives only on its mounted socket. */
export type RunSummary = RunRecord & {
  taskLifecycle?: { stage: string; archived: boolean }
  title: string
  resumeLine: string
  canConfigure: boolean
  /** Why this session's model, effort and permissions cannot be changed from the App now; absent when they can. */
  settingsLocked?: string
  canStart: boolean
  canResume: boolean
  canRestart: boolean
  canChangePermission?: boolean
  /** New server-side fresh transaction; never implies native compact support. */
  canFresh?: boolean
  pendingFresh?: boolean
  acceptedStopSequence?: number
  firstPromptAt?: string
  attention?: "waiting" | "attention" | "clear"
  request?: string
  requestSent?: boolean
  facts: string
  lastScreen?: string
  truncated?: boolean
}

/** A current permission wait, from a native dialog or the existing callback queue projection. */
export function runPermissionWaiting(
  run: Pick<RunRecord, "status" | "terminalPrompt" | "attention" | "waitSince">,
): boolean {
  return (
    (run.status === "running" || run.status === "starting") &&
    (run.terminalPrompt === "permission" ||
      (run.attention === "waiting" && run.waitSince !== undefined))
  )
}
export function isRunPurpose(value: unknown): value is RunPurpose {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  const text = (key: string) => typeof v[key] === "string" && (v[key] as string).length > 0
  return v.kind === "task"
    ? text("task")
    : v.kind === "new-task"
      ? text("request")
      : v.kind === "terminal"
        ? (v.shell === undefined || v.shell === true) &&
          (v.context === undefined || isTerminalContext(v.context))
        : v.kind === "artifact" &&
          ["task", "project"].includes(v.scope as string) &&
          text("id") &&
          text("file") &&
          text("revision") &&
          text("request")
}

export function isTerminalContext(value: unknown): value is TerminalContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (v.kind === "agent-setup")
    return (
      Object.keys(v).every((key) => ["kind", "agent", "operation"].includes(key)) &&
      isNativeAgent(v.agent) &&
      (v.operation === "install" || v.operation === "sign-in")
    )
  const bounded = (key: string) =>
    typeof v[key] === "string" &&
    (v[key] as string).length > 0 &&
    (v[key] as string).length <= 4096 &&
    !(v[key] as string).includes("\0")
  const fields = v.kind === "task" ? ["kind", "task"] : ["kind", "scope", "id", "file", "revision"]
  return (
    Object.keys(v).every((key) => fields.includes(key)) &&
    (v.kind === "task"
      ? bounded("task")
      : v.kind === "artifact" &&
        ["task", "project"].includes(v.scope as string) &&
        bounded("id") &&
        bounded("file") &&
        typeof v.revision === "string" &&
        /^[a-f0-9]{64}$/.test(v.revision))
  )
}
