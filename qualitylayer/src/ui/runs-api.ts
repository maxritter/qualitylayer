import { intentReasonText, runPermissionWaiting } from "../core/run/contracts.ts"
import { STARTUP_PROMPT_STATUS } from "../core/run/startup-prompt.ts"
import type { RunWindow } from "./run-context.tsx"

export { createRunAdapter, runsApi } from "./runs-api-adapter.ts"
export { cancelLimitResume, runColors, uploadHandoffAttachments } from "./runs-api-helpers.ts"

export type RunSupport = {
  supported: boolean
  canStart?: boolean
  canConfigure?: boolean
  reason?: string
  appQuitFailure?: { at: number; reason: string; failures: { run: string; message: string }[] }
  /** New terminal's shell choices; only a session that may change them receives these. */
  loginShell?: string
  shells?: string[]
}

export function runTaskId(run: RunWindow): string | undefined {
  return (
    run.task ??
    (run.purpose.kind === "task"
      ? run.purpose.task
      : run.purpose.kind === "terminal" && run.purpose.context?.kind === "task"
        ? run.purpose.context.task
        : undefined)
  )
}

export function taskAgentRuns(runs: readonly RunWindow[], task: string): RunWindow[] {
  return runs
    .filter(
      (run) =>
        runTaskId(run) === task &&
        (run.purpose.kind === "new-task" ||
          (run.purpose.kind === "task" && run.purpose.task === task)),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) ||
        b.generation - a.generation ||
        b.id.localeCompare(a.id),
    )
}

/**
 * The task's live agent that waits on its own start-up question (trust this folder, …). The task
 * page, the Agent tab and the top bar's agent chip read the same one.
 */
export function startupRunFor(runs: readonly RunWindow[], task: string): RunWindow | undefined {
  return runs.find(
    (run) =>
      run.startupPrompt !== undefined &&
      run.agent !== "other" &&
      !["stopped", "failed"].includes(run.status) &&
      runTaskId(run) === task,
  )
}

export function buildRunForTask(run: RunWindow, task: string): boolean {
  if (run.purpose.kind !== "task" || run.purpose.phase === "planning") return false
  if (runTaskId(run) !== task) return false
  return run.status !== "failed" && run.status !== "stopped"
}

export function preferredBuildRun(
  runs: readonly RunWindow[],
  task?: string,
): RunWindow | undefined {
  return runs
    .filter((run) => run.purpose.kind === "task" && buildRunForTask(run, task ?? run.purpose.task))
    .sort(
      (a, b) =>
        (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) ||
        b.generation - a.generation ||
        b.id.localeCompare(a.id),
    )[0]
}

/** Task actions change at build transitions, not when terminal output or timestamps update. */
export function buildRunsVersion(runs: readonly RunWindow[]): string {
  return JSON.stringify(
    runs
      .filter(
        (run) =>
          run.purpose.kind === "task" &&
          (buildRunForTask(run, run.purpose.task) || run.intent !== undefined),
      )
      .map((run) => [
        run.id,
        run.generation,
        runTaskId(run),
        run.status,
        run.firstPromptAt ?? "",
        run.nativeSession ?? "",
        run.intent?.state ?? "",
        run.intent?.reason ?? "",
        run.intent?.task ?? "",
        run.intent?.nativeSession ?? "",
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
}

const SIMPLE_RUN_STATUS: Partial<Record<RunWindow["status"], string>> = {
  stopped: "Stopped",
  stopping: "Stopping",
}

function terminalOrPermissionStatus(run: RunWindow): string | null {
  if (run.status === "failed") return `Failed to start${run.error ? ` · ${run.error}` : ""}`
  const simple = SIMPLE_RUN_STATUS[run.status]
  if (simple) return simple
  if (run.terminalPrompt === "permission") return "Waiting for permission · open Terminal"
  return runPermissionWaiting(run) ? "Waiting for permission · answer in Conversation" : null
}

function activeRunStatusText(run: RunWindow): string {
  const intentReason = intentReasonText(run.intent)
  if (run.intent?.state !== "active" && intentReason) return intentReason
  if (run.startupPrompt) return STARTUP_PROMPT_STATUS[run.startupPrompt]
  if (!run.firstPromptAt && run.agent !== "other") return "Starting · answer here if it asks"
  if (run.attention === "waiting") return "Waits for you in its window"
  return !runTaskId(run) && run.purpose.kind === "new-task"
    ? "Running · task not created yet"
    : run.purpose.kind === "terminal"
      ? "Open in the App"
      : "Running in the App"
}

export function runStatusText(run: RunWindow): string {
  return terminalOrPermissionStatus(run) ?? activeRunStatusText(run)
}

export function parseSourceSupported(value: unknown): RunSupport | undefined {
  if (!value || typeof value !== "object") return undefined
  const source = value as {
    supported?: unknown
    platform?: unknown
    reason?: unknown
    canStart?: unknown
    canConfigure?: unknown
    appQuitFailure?: RunSupport["appQuitFailure"]
    loginShell?: unknown
    shells?: unknown
  }
  if (typeof source.supported !== "boolean" || typeof source.platform !== "string") return undefined
  const reason = typeof source.reason === "string" ? source.reason.trim() : ""
  return {
    supported: source.supported,
    ...(typeof source.canStart === "boolean" ? { canStart: source.canStart } : {}),
    ...(typeof source.canConfigure === "boolean" ? { canConfigure: source.canConfigure } : {}),
    ...(source.appQuitFailure ? { appQuitFailure: source.appQuitFailure } : {}),
    ...(typeof source.loginShell === "string" ? { loginShell: source.loginShell } : {}),
    ...(Array.isArray(source.shells)
      ? { shells: source.shells.filter((shell): shell is string => typeof shell === "string") }
      : {}),
    ...(!source.supported
      ? { reason: reason || "App agent sessions are unavailable on this computer." }
      : {}),
  }
}
