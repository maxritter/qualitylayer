import { livenessOf } from "../live/liveness.ts"
import { shellStatus } from "./shell-status.ts"
import { runningHelpers, type StatusInput, workEnded } from "./status-helpers.ts"

export { asksInChat, type LiveRow, type LiveRowState, liveRow, TURN_HOLD_MS } from "./live-row.ts"
export { SHELL_GUIDANCE_MS, shellStatus } from "./shell-status.ts"
export {
  agentIdOf,
  autonomousTask,
  backgroundAgents,
  doingNow,
  doingWords,
  limitWords,
  openNeeds,
  runningHelpers,
  stoppedResume,
} from "./status-helpers.ts"

/** A waiting lead that still writes: its tools fire and its transcript grows within this window. */
export const SHELL_WRITING_MS = 60_000

/**
 * The lead waits on the person in the background (a `wait` while it goes on with other work) and its
 * own hooks or transcript moved a moment ago: it works meanwhile. A question it waits on in
 * the foreground, an ended turn and a permission prompt are not work.
 */
function writesMeanwhile(task: StatusInput, now: number): boolean {
  const signals = task.live?.signals ?? null
  if (signals === null) return false
  if (signals.ask?.alive === true && signals.ask.waiting) return false
  const live = livenessOf(signals, now)
  if (live.state !== "working" && live.state !== "quiet") return false
  const moved = Math.max(signals.hook?.at ?? 0, signals.transcript ?? 0)
  return moved > 0 && now - moved < SHELL_WRITING_MS
}

/**
 * The one answer to "does an agent work on this task now", for the sidebar's Running group, Home's
 * Running list, its calm line and the spending card's count. The lead agent working or quiet, or a
 * helper of it at work while the lead waits on the person. A closed task, a stopped agent and an open pull request (GitHub's, not an agent's)
 * are not at work.
 */
export function agentAtWork(task: StatusInput, now = Date.now()): boolean {
  // No session and no signal ever: no agent is attached, whatever the default state says.
  if ((task.session ?? null) === null && (task.live?.signals ?? null) === null)
    return task.helpers.some((h) => h.state === "running")
  const status = shellStatus(task, now)
  if (status.state === "working" || status.state === "quiet") return true
  if (status.state === "stopped" || task.archived || workEnded(task)) return false
  return runningHelpers(task, now).length > 0 || writesMeanwhile(task, now)
}
