// What the sidebar's Plan limits block says: for each agent that reports, the window with the least
// left. Pure: the block draws these, the logic suites test them.

import type { AgentLimits, LimitWindow } from "../../core/limits/index.ts"
import { readingId } from "../../core/usage-display.ts"
import { LOW_LEFT, leftIn, resetIn } from "../agent-window/conversation/limit-values.ts"
import { creditsLine, creditWindow } from "../kit/credits-note.ts"

/** The saved quota selection, shared by the sidebar trigger and its quick look. */
export function selectedQuotaLimits(
  limits: readonly AgentLimits[],
  readings: readonly string[],
): readonly AgentLimits[] {
  const selected = new Set(readings)
  if (selected.has("auto")) return limits
  return limits
    .filter((agent) => readings.some((id) => id.startsWith(`${agent.agent}:limit:`)))
    .map((agent) => ({
      ...agent,
      windows: selected.has(readingId(agent.agent, "limit", "closest"))
        ? agent.windows
        : agent.windows.filter((window) =>
            selected.has(readingId(agent.agent, "limit", window.label)),
          ),
    }))
}

/** One agent's tightest window, as the block's face shows it. */
export type LimitFace = {
  agent: string
  name: string
  window: LimitWindow
  /** What is left of it, 0 to 100. */
  left: number
  low: boolean
  resets: string | undefined
  /** The credits line when this used-up window runs on paid credits ("Weekly limit used · running on credits (…)"). */
  credits: string | null
}

/** A window that says how much is used, or says it ran out. */
const known = (window: LimitWindow): boolean => window.reached || window.usedPercent !== null

const isActiveWindow = (window: LimitWindow, now: number | undefined): boolean =>
  now === undefined || window.resetsAt === null || window.resetsAt > now

/** The window of an agent with the least left; none while no window says. */
export function tightestWindow(agent: AgentLimits, now?: number): LimitWindow | undefined {
  let best: LimitWindow | undefined
  for (const window of agent.windows) {
    if (!known(window) || !isActiveWindow(window, now)) continue
    if (best === undefined || leftIn(window) < leftIn(best)) best = window
  }
  return best
}

/** The agents that report, each with its tightest window; none when no agent reports one. */
export function limitFaces(limits: readonly AgentLimits[], now: number): LimitFace[] {
  return limits.flatMap((agent) => {
    const window = agent.state === "reported" ? tightestWindow(agent, now) : undefined
    if (window === undefined) return []
    const left = leftIn(window)
    return [
      {
        agent: agent.agent,
        name: agent.name,
        window,
        left,
        low: left < LOW_LEFT,
        resets: resetIn(window.resetsAt, now),
        credits: creditWindow(agent) === window ? creditsLine(agent) : null,
      },
    ]
  })
}

/** When the oldest of the readings that report was taken; null when none says. */
export function oldestReading(limits: readonly AgentLimits[]): number | null {
  const times = limits.flatMap((agent) =>
    agent.state === "reported" && agent.at !== null ? [agent.at] : [],
  )
  return times.length === 0 ? null : Math.min(...times)
}

/** An agent with a row but no window to show: it has no plan limits, its read failed, or it was never read. */
export type UnknownFace = {
  agent: string
  name: string
  cause: "no-plan" | "failed" | "not-read"
  /** What the strip's tooltip says: "Claude Code · couldn't read limits". */
  title: string
  /** What a screen reader hears of it. */
  words: string
}

/** One agent's place in the strip: its tightest window, or that nothing is known of it. */
export type StripCell = { face: LimitFace } | { unknown: UnknownFace }

const UNKNOWN_WHY = {
  "no-plan": { title: "API key · no plan limits", words: "has no plan limits" },
  failed: { title: "couldn't read limits", words: "unknown" },
  "not-read": { title: "not read yet", words: "unknown" },
} as const

/**
 * The strip's cells in the catalog's order: each reporting agent's tightest window, and for an agent
 * that has a row but no figure a cell that says so instead of a number. An agent with nothing to
 * report has none.
 */
export function stripCells(limits: readonly AgentLimits[], now: number): StripCell[] {
  const faces = new Map(limitFaces(limits, now).map((face) => [face.agent, face]))
  return limits.flatMap((agent): StripCell[] => {
    const face = faces.get(agent.agent)
    if (face !== undefined) return [{ face }]
    if (agent.state !== "unavailable" || agent.cause === null || agent.cause === "unreported")
      return []
    const why = UNKNOWN_WHY[agent.cause]
    return [
      {
        unknown: {
          agent: agent.agent,
          name: agent.name,
          cause: agent.cause,
          title: `${agent.name} · ${why.title}`,
          words: `${agent.name} ${why.words}`,
        },
      },
    ]
  })
}
