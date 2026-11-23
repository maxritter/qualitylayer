import { livenessOf } from "../../core/live/liveness.ts"
import type { AgentState, AgentStatus } from "../../interaction/contracts.ts"
import type { TaskAgentControls } from "../agent-window/task-controls.ts"

export type ChatChipState = { state: AgentState; words: string }

type WindowControls = Pick<TaskAgentControls, "status" | "attention" | "interruptRequested">

const WINDOW_STATUS_STATE: Partial<Record<TaskAgentControls["status"], ChatChipState>> = {
  failed: { state: "stopped", words: "Could not start" },
  stopped: { state: "stopped", words: "Stopped" },
  stopping: { state: "working", words: "Stopping…" },
  starting: { state: "working", words: "Starting" },
  validated: { state: "working", words: "Starting" },
}

function windowChipState(window: WindowControls | undefined): ChatChipState | null {
  if (!window) return null
  if (window.interruptRequested) return { state: "working", words: "Interrupting…" }
  const mapped = WINDOW_STATUS_STATE[window.status]
  if (mapped) return mapped
  return window.attention === "waiting" ? { state: "waits-for-you", words: "Needs you" } : null
}

function shellChipState(shell: Pick<AgentStatus, "state" | "signals">, now: number): ChatChipState {
  const life = shell.signals ? livenessOf(shell.signals, now) : null
  if (shell.state === "stopped") return { state: "stopped", words: "Stopped" }
  if (shell.state === "waits-for-you" || life?.state === "permission")
    return { state: "waits-for-you", words: "Needs you" }
  if (shell.state === "step-done" || life?.state === "turn-end")
    return { state: "step-done", words: "Your turn" }
  return shell.state === "quiet"
    ? { state: "quiet", words: "Quiet" }
    : { state: "working", words: "Working" }
}

/**
 * What the Chat's agent chip says. The task's own snapshot is the base; the mounted window, which
 * holds the live session, speaks over it for the moments it alone knows (starting, stopping, an
 * interrupt on its way, a question that waits).
 */
export function chatChipState(
  shell: Pick<AgentStatus, "state" | "signals">,
  window: WindowControls | undefined,
  now: number,
): ChatChipState {
  const fromWindow = windowChipState(window)
  if (fromWindow) return fromWindow
  // No App session and no signal from the agent: nothing is known, so no state word is guessed.
  if (!window && !shell.signals && shell.state === "working") return { state: "quiet", words: "" }
  return shellChipState(shell, now)
}
