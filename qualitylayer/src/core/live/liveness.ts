// Whether the agent of a task is alive, from signals it never has to remember to give: its hooks
// (every tool call, its subagents, the end of a turn or a session, a permission prompt), its
// transcript file growing, its process, every `qualitylayer` call and the heartbeat of a question
// that waits. Pure: the server reads the signals (read.ts), the App and the band apply the rules
// at their own `now`, so the words keep moving between polls.
//
// The rules, as Max set them:
//   - "quiet" needs the process alive (or not known) and no hook, no transcript growth, no
//     QualityLayer call and no question heartbeat for 4 minutes; 15 while a tool call runs (a
//     PreToolUse with no PostToolUse yet). After 20 minutes the quiet turns into your move.
//   - a process that is gone is "stopped", never "quiet".
//   - a busy agent is never shown as stale: any one fresh signal is enough to be "working".

/** No sign of life for this long and the agent is "quiet". */
export const QUIET_MS = 4 * 60_000
/** While a tool call runs (a long test suite, a build), quiet waits this long. */
export const QUIET_TOOL_MS = 15 * 60_000
/** Quiet for this long and it becomes the person's move: look in the agent's window. */
export const LONG_QUIET_MS = 20 * 60_000

/** The transcript grows a beat after the hook that ended the turn: that growth is the end itself. */
const END_GRACE_MS = 5_000

import { AGENT_NAMES, isNativeAgent } from "../agents/ids.ts"

export type SignalSource = "hook" | "transcript" | "cli" | "question"

/** How an agent's turn or session ended, as its last hook (or its transcript) says. */
export type EndKind =
  /** SessionEnd: the session closed. */
  | "session-end"
  /** The person pressed Esc: the transcript says the request was interrupted. */
  | "interrupted"
  /** A permission prompt waits in the agent's window (Notification, PermissionRequest). */
  | "permission"
  /** Stop: the turn is over, the agent waits for the person to type in its window. */
  | "turn-end"

/** Every signal of one task's agent, as the server read it a moment ago. Times are ms epochs. */
export type LiveSignals = {
  /** `claude-code`, `codex` or another agent's id; null before any signal named one. */
  agent: string | null
  /** The key of the session that owns the step (never its raw id); null before one spoke. */
  session?: string | null
  /** Native client id, only for its resume command. */
  sessionId?: string | null
  /** The latest hook of any session of the task: when, which event, and its words. */
  hook: { at: number; event: string; words: string } | null
  /** The oldest tool call still running in the owning session: started, and what it runs. */
  tool: { at: number; words: string } | null
  /** An in-flight model request (e.g. Claude Code `api-request`) with no assistant reply yet. */
  modelWaiting?: boolean
  /** When the owning session's transcript last grew. */
  transcript: number | null
  /** The latest `qualitylayer` call for the task (a command or a `gate wait` heartbeat). */
  cli: { at: number; command: string } | null
  /** The heartbeat a waiting `question ask` writes every 20 s. */
  question: number | null
  /** That `ask` itself: a live waiter keeps a living or unknown owner active. */
  ask?: { at: number; waiting: boolean; alive: boolean } | null
  /** The owning session's process: alive, gone, or not known (no hook ever named it). */
  process: "alive" | "gone" | "unknown"
  /** When the server first observed this owning PID gone; null before that observation. */
  stoppedAt?: number | null
  /** How the owning session's last turn ended, when nothing came after it. */
  end: { at: number; kind: EndKind } | null
  /** The subagents the owning session started, newest last. */
  agents: { id: string; words: string; started: number; stopped: number | null }[]
  /**
   * The task list the owning session reported, only for an agent whose hooks carry one (todo.ts):
   * done, the current item, and what is next. Unset when the agent reports none: never guessed.
   */
  todo?: { items: { text: string; state: "done" | "now" | "next" }[]; at: number }
  /**
   * The owning session stopped on its agent's plan limit (limits/stop.ts), read once the record was
   * quiet: when, when the plan resets (null when the agent did not say) and the window that ran out.
   * Unset when it did not. `resumeAt` is when QualityLayer tells the agent to go on (null when no
   * resume is planned), and `run` the managed run to cancel that on.
   */
  limit?: {
    at: number | null
    resetsAt: number | null
    window: string | null
    resumeAt?: number | null
    run?: string | null
  }
}

/** The last sign of life: when, which kind, and the words the panel shows. */
export type LastSign = { at: number; source: SignalSource; words: string }

export type Liveness =
  | { state: "working"; last: LastSign; toolRunning: boolean }
  | { state: "quiet"; last: LastSign; quietFor: number; long: boolean; toolRunning: boolean }
  | {
      state: "stopped"
      why: "ended" | "interrupted" | "crashed"
      at: number
      last: LastSign | null
    }
  | { state: "permission"; at: number; last: LastSign | null }
  | { state: "turn-end"; at: number; last: LastSign | null }
  /** No signal at all yet: no session ever spoke for this task. */
  | { state: "none" }

/** The agent's name in the App's words. */
export const agentName = (agent: string | null): string =>
  isNativeAgent(agent) ? AGENT_NAMES[agent] : "The agent"

/** The latest sign of life among the signals, with its words. */
export function lastSign(signals: LiveSignals): LastSign | null {
  const name = agentName(signals.agent)
  const candidates: LastSign[] = []
  if (signals.hook !== null)
    candidates.push({
      at: signals.hook.at,
      source: "hook",
      words: signals.hook.words !== "" ? `tool hook: ${signals.hook.words}` : "tool hook",
    })
  if (signals.transcript !== null)
    candidates.push({
      at: signals.transcript,
      source: "transcript",
      words: `${name}'s transcript grew`,
    })
  if (signals.cli !== null)
    candidates.push({
      at: signals.cli.at,
      source: "cli",
      words: `qualitylayer ${signals.cli.command}`.trim(),
    })
  if (signals.question !== null)
    candidates.push({ at: signals.question, source: "question", words: "the question still waits" })
  // The newest wins; on a tie the order above (a hook names what it did) does.
  let best: LastSign | null = null
  for (const one of candidates) if (best === null || one.at > best.at) best = one
  return best
}

function isFreshEnd(signals: LiveSignals, end: NonNullable<LiveSignals["end"]>): boolean {
  // An end counts only when no sign of life came after it. The client writes its transcript a
  // beat after the hook ran, so growth within a few seconds of the end is the end itself.
  const checks: [number | null | undefined, number][] = [
    [signals.hook?.at, 0],
    [signals.cli?.at, 0],
    [signals.question, 0],
    [signals.transcript, END_GRACE_MS],
  ]
  return !checks.some(([at, grace]) => at !== null && at !== undefined && at > end.at + grace)
}

function livenessFromEnd(end: NonNullable<LiveSignals["end"]>, last: LastSign | null): Liveness {
  switch (end.kind) {
    case "session-end":
      return { state: "stopped", why: "ended", at: end.at, last }
    case "interrupted":
      return { state: "stopped", why: "interrupted", at: end.at, last }
    case "permission":
      return { state: "permission", at: end.at, last }
    default:
      return { state: "turn-end", at: end.at, last }
  }
}

function stoppedWhyOf(end: LiveSignals["end"]): "ended" | "interrupted" | "crashed" {
  if (end?.kind === "session-end") return "ended"
  if (end?.kind === "interrupted") return "interrupted"
  return "crashed"
}

/** Where the agent stands at `now`, from its signals. */
export function livenessOf(signals: LiveSignals, now: number): Liveness {
  const last = lastSign(signals)
  const end = signals.end
  // A process that is gone has stopped, however it went: never "quiet".
  if (signals.process === "gone") {
    return {
      state: "stopped",
      why: stoppedWhyOf(end),
      at: signals.stoppedAt ?? end?.at ?? last?.at ?? now,
      last,
    }
  }
  if (end !== null && isFreshEnd(signals, end)) return livenessFromEnd(end, last)
  // A waiter can outlive its agent. Only an owner without stop evidence benefits from it.
  if (signals.ask?.waiting === true && signals.ask.alive && last !== null) {
    return { state: "working", last, toolRunning: true }
  }
  if (last === null) return { state: "none" }
  const toolRunning = signals.tool !== null
  const silent = Math.max(0, now - last.at)
  const threshold = toolRunning || signals.modelWaiting === true ? QUIET_TOOL_MS : QUIET_MS
  return silent < threshold
    ? { state: "working", last, toolRunning }
    : { state: "quiet", last, quietFor: silent, long: silent >= LONG_QUIET_MS, toolRunning }
}

/** "3 s", "40 s", "6 min", "1 h 20 min": how long ago, short. */
export function agoShort(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

/**
 * "3 under way": the open cards of a build the agents work on now, said quietly after the count of
 * tasks done. Nothing when none is (or when an older server reports no count).
 */
export function underWayWords(n: number | undefined): string | null {
  return typeof n === "number" && n > 0 ? `${n} under way` : null
}
