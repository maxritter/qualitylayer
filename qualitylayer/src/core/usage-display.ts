import { isNativeAgent } from "./agents/ids.ts"

export type PercentageMode = "used" | "remaining"
export type MoneyBasis = "spend" | "value"
export type UsageDisplay = {
  percent: PercentageMode
  menuBar: boolean
  total: boolean
  money: MoneyBasis
  /** `auto` follows agents reporting quotas; an empty list deliberately shows no individual figures. */
  readings: string[]
}

export const DEFAULT_USAGE_DISPLAY: UsageDisplay = {
  percent: "used",
  menuBar: true,
  total: false,
  money: "spend",
  readings: ["auto"],
}

export function readingId(agent: string, kind: "cost" | "limit", window?: string): string {
  return kind === "cost"
    ? `${agent}:cost`
    : `${agent}:limit:${encodeURIComponent(window ?? "closest")}`
}

function validLimitWindow(window: string | undefined): boolean {
  if (!window) return false
  try {
    const decoded = decodeURIComponent(window)
    return (
      decoded.length <= 160 &&
      [...decoded].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    )
  } catch {
    return false
  }
}

export function validReading(id: unknown): id is string {
  if (id === "auto") return true
  if (typeof id !== "string" || id.length > 256) return false
  const [agent, kind, window, ...extra] = id.split(":")
  if (!isNativeAgent(agent) || extra.length > 0) return false
  if (kind === "cost") return window === undefined
  return kind === "limit" && validLimitWindow(window)
}

function isLimitReading(id: string, agent?: string): boolean {
  if (!validReading(id)) return false
  const [readingAgent, kind] = id.split(":")
  return kind === "limit" && (agent === undefined || readingAgent === agent)
}

/** The saved selector also applies before a source has reported its first quota. */
export function selectsQuota(preferences: UsageDisplay, agent?: string): boolean {
  return (
    preferences.readings.includes("auto") ||
    preferences.readings.some((id) => isLimitReading(id, agent))
  )
}

export function usageDisplayOf(value: Partial<UsageDisplay> | undefined): UsageDisplay {
  return {
    percent: value?.percent === "remaining" ? "remaining" : "used",
    menuBar: value?.menuBar !== false,
    total: value?.total === true,
    money: value?.money === "value" ? "value" : "spend",
    readings: Array.isArray(value?.readings)
      ? [...new Set(value.readings.filter(validReading))].slice(0, 32)
      : [...DEFAULT_USAGE_DISPLAY.readings],
  }
}

/** Input remains the canonical used percentage; a reset without a reading stays unknown. */
export function percentage(used: number | null, mode: PercentageMode): number | null {
  if (used === null || !Number.isFinite(used)) return null
  const value = Math.max(0, Math.min(100, Math.round(used)))
  return mode === "used" ? value : 100 - value
}
