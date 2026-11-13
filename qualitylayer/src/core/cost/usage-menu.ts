import type { AgentLimits } from "../limits/index.ts"
import { percentage, type UsageDisplay } from "../usage-display.ts"
import { dailyMoney, readingOptions, readingText, selectedReadings } from "./display.ts"
import type { Usage } from "./usage.ts"

export type UsageMenuRow = {
  icon: string
  kind: "limit" | "cost"
  name: string
  window: string
  text: string
  percent: number | null
  low: boolean
  ahead: boolean
  credits: boolean
  reset: boolean
  resetsAt: number | null
}
export type UsageMenu = {
  rows: UsageMenuRow[]
  money: { label: string; text: string; note: string; description: string; day: string | null }
  checkedAt: number | null
}

export function limitsAtTime(limits: readonly AgentLimits[], now: number): AgentLimits[] {
  return limits.map((agent) => ({
    ...agent,
    windows: agent.windows.map((window) =>
      window.resetsAt !== null && window.resetsAt <= now
        ? { ...window, usedPercent: null, reached: false }
        : window,
    ),
  }))
}

/** The same selected readings feed both the compact icon and its visual menu. */
export function usageMenu(
  preferences: UsageDisplay,
  limits: readonly AgentLimits[],
  usage: Usage | null,
  now: number,
): UsageMenu {
  const choices = selectedReadings(
    preferences,
    readingOptions(limitsAtTime(limits, now), usage, now),
  )
  const rows: UsageMenuRow[] = choices.flatMap<UsageMenuRow>((reading) => {
    const window = reading.window
    if (reading.kind === "cost")
      return [
        {
          icon: reading.agent,
          kind: "cost",
          name: reading.name,
          window: reading.basis === "value" ? "Today at API prices" : "API spend today",
          text: readingText(reading, preferences),
          percent: null,
          low: false,
          ahead: false,
          credits: false,
          reset: false,
          resetsAt: null,
        },
      ]
    if (!window)
      return [
        {
          icon: reading.agent,
          kind: "limit",
          name: reading.name,
          window: reading.label,
          text: "?",
          percent: null,
          low: false,
          ahead: false,
          credits: false,
          reset: false,
          resetsAt: null,
        },
      ]
    const reset = window.resetsAt !== null && window.resetsAt <= now
    const used = reset ? null : window.reached ? 100 : window.usedPercent
    const credits = !reset && reading.credits === true
    const percent = credits ? null : percentage(used, preferences.percent)
    return [
      {
        icon: reading.agent,
        kind: "limit",
        name: reading.name,
        window: window.label.replace("This week", "Week").replace("This month", "Month"),
        text: reset
          ? "?"
          : credits
            ? "credits"
            : percent === null
              ? "?"
              : `${percent} % ${preferences.percent}`,
        percent,
        low: !credits && used !== null && used > 80,
        ahead:
          !credits &&
          used !== null &&
          used < 100 &&
          window.pacePercent !== null &&
          used > window.pacePercent,
        credits,
        reset,
        resetsAt: window.resetsAt,
      },
    ]
  })
  const money = dailyMoney(usage, preferences.money, now)
  const times = limits.flatMap((limit) =>
    limit.state === "reported" && limit.at !== null ? [limit.at] : [],
  )
  if (usage) times.push(usage.to)
  return {
    rows,
    money: {
      label: `Today · ${preferences.money === "value" ? "API-price value" : "API spend"}`,
      text: money.usd === null ? "?" : `$${money.usd.toFixed(2)}`,
      note: "",
      day: money.day,
      description:
        preferences.money === "value"
          ? "All priced usage at API prices, not a bill"
          : "Metered API spend",
    },
    checkedAt: times.length ? Math.min(...times) : null,
  }
}
