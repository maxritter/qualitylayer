// Whether an agent's session stopped on a plan limit, read from the end of its own session record.
// Claude Code writes the refusal as a last message with `error: "rate_limit"` and the reset time in
// `quotaLimits`. Codex records the turn's end (`task_complete`, or `turn_aborted`) with the error
// `usage_limit_exceeded`, whose message names the reset time; it keeps its live `error` event out of
// the record (codex-rs/rollout/src/policy.rs), but older records may hold one. Otherwise the last
// `rate_limits` it recorded shows the used-up window. Copilot's stop is read from its allowance
// snapshot. A person who typed afterwards, or an agent that worked on, leaves rows behind the stop:
// then it is no stop any more.

import type { NativeAgent } from "../agents/ids.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"
import { claudeRefusal } from "./claude.ts"
import { copilotReading } from "./copilot-record.ts"
import { codexMessageReset, codexStop } from "./stop-codex.ts"
import { windowLabel } from "./window.ts"

export { codexMessageReset }

export type LimitStop = {
  /** The record row that says it: the same row is the same stop. */
  key: string
  /** When the plan resets (epoch milliseconds); null when the record does not say. */
  resetsAt: number | null
  /** The window that ran out, named by its length; null when not told. */
  window: string | null
  /** When it happened (epoch milliseconds). */
  at: number | null
}

type Json = Record<string, unknown>
const record = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null

function parse(line: string): Json | null {
  try {
    return record(JSON.parse(line))
  } catch {
    return null
  }
}

const timeOf = (value: unknown): number | null => {
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN
  return Number.isNaN(at) ? null : at
}

/** The last message row decides: the refusal itself is a stop, anything after a message is not. */
function claudeStop(lines: readonly string[]): LimitStop | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const row = parse(lines[index] as string)
    if (row === null || row.isSidechain === true) continue
    if (row.type !== "assistant" && row.type !== "user") continue
    const refusal = claudeRefusal(row)
    return refusal === null
      ? null
      : {
          key: refusal.key,
          resetsAt: refusal.resetsAt,
          window: refusal.minutes === null ? null : windowLabel(refusal.minutes),
          at: refusal.at,
        }
  }
  return null
}

/**
 * Copilot records no refusal row we know of, only the allowance snapshot of each model call. A stop
 * is a prompt that got no answer (the last user or assistant message is the user's) after a call
 * whose snapshot says the allowance is used up and does not run on past its end.
 */
function copilotStop(lines: readonly string[]): LimitStop | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const row = parse(lines[index] as string)
    if (row?.type === "assistant.message") return null
    if (row?.type !== "user.message") continue
    // Time zero: a snapshot is read as it stood when written, not as the clock has moved since.
    const window = copilotReading(lines.slice(0, index), 0)?.windows.find((w) => w.reached)
    if (window === undefined) return null
    return {
      key: `${String(row.id ?? row.timestamp)}`,
      resetsAt: window.resetsAt,
      window: window.label,
      at: timeOf(row.timestamp),
    }
  }
  return null
}

const BY_AGENT: Partial<Record<NativeAgent, (lines: readonly string[]) => LimitStop | null>> = {
  codex: codexStop,
  copilot: copilotStop,
}

/** The plan-limit stop at the end of the record's last lines; null when the agent is not stopped on one. */
export function detectLimitStop(agent: NativeAgent, lines: readonly string[]): LimitStop | null {
  const source = AGENT_CAPABILITIES[agent].limits
  if (source === null) return null
  if (source === "usage-command") return claudeStop(lines)
  return BY_AGENT[agent]?.(lines) ?? null
}
