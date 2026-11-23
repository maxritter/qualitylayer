import { AGENT_NAMES, type NativeAgent } from "../agents/ids.ts"
import type { AgentLimits, LimitWindow } from "../limits/index.ts"
import { type MoneyBasis, percentage, readingId, type UsageDisplay } from "../usage-display.ts"
import { dailyMoney, type MoneyAmount, moneyAmount, usageForMoney } from "./display-money.ts"
import type { Usage } from "./usage.ts"
import { dayKey } from "./usage-days.ts"

export type { MoneyAmount }
export { dailyMoney, moneyAmount, usageForMoney }

export type ReadingOption = {
  id: string
  agent: NativeAgent
  name: string
  kind: "limit" | "cost"
  label: string
  window?: LimitWindow
  money?: MoneyAmount
  basis?: MoneyBasis
  available: boolean
  credits?: boolean
  reason?: string
}

function closest(options: readonly ReadingOption[]): ReadingOption | undefined {
  let best: ReadingOption | undefined
  for (const option of options) {
    if (option.kind !== "limit") continue
    const used = option.window?.reached ? 100 : (option.window?.usedPercent ?? -1)
    const previous = best?.window?.reached ? 100 : (best?.window?.usedPercent ?? -1)
    if (!best || used > previous) best = option
  }
  return best
}

function limitOptionsForAgent(agent: AgentLimits): ReadingOption[] {
  if (agent.state !== "reported") return []
  return agent.windows.map((window) => ({
    id: readingId(agent.agent, "limit", window.label),
    agent: agent.agent,
    name: agent.name,
    kind: "limit",
    label: `${window.label} (%)`,
    window,
    available: window.reached || window.usedPercent !== null,
    credits: agent.credits !== undefined && (window.reached || (window.usedPercent ?? 0) >= 100),
  }))
}

function costOptionForAgent(agent: Usage["agents"][number], now?: number): ReadingOption {
  const day = agent.daily.at(-1)
  const basis: MoneyBasis =
    agent.billing === "key" || agent.billing === "gateway" || (day?.accounting?.spendCalls ?? 0) > 0
      ? "spend"
      : "value"
  const unavailable =
    agent.state === "unavailable" ||
    !day ||
    (now !== undefined && day.day !== dayKey(now)) ||
    (agent.partial && day.calls === 0)
  const money = unavailable
    ? { usd: null, partial: true, reported: false }
    : moneyAmount(day, agent.billing, basis)
  return {
    id: readingId(agent.agent, "cost"),
    agent: agent.agent,
    name: agent.name,
    kind: "cost",
    label: basis === "spend" ? "Daily API spend ($)" : "Daily API-price value ($)",
    money,
    basis,
    available: money.usd !== null,
    reason:
      agent.state === "unavailable"
        ? (agent.reason ?? "Usage not reported")
        : money.usd === null
          ? "No priced usage available"
          : agent.partial,
  }
}

export function readingOptions(
  limits: readonly AgentLimits[],
  usage: Usage | null,
  now?: number,
): ReadingOption[] {
  return [
    ...limits.flatMap(limitOptionsForAgent),
    ...(usage?.agents ?? []).map((agent) => costOptionForAgent(agent, now)),
  ]
}

export function selectedReadings(
  preferences: UsageDisplay,
  options: readonly ReadingOption[],
): ReadingOption[] {
  const chosen = preferences.readings.includes("auto")
    ? [
        ...new Set(
          options.filter((option) => option.kind === "limit").map((option) => option.agent),
        ),
      ].flatMap((agent) => {
        const option = closest(options.filter((option) => option.agent === agent))
        return option ? [option.id] : []
      })
    : preferences.readings
  return chosen.map((id) => {
    const agent = id.split(":")[0] as NativeAgent
    const option =
      options.find((one) => one.id === id) ??
      (id.endsWith(":limit:closest")
        ? closest(options.filter((one) => one.agent === agent))
        : undefined)
    if (option) return option
    const window = id.split(":")[2]
    return {
      id,
      agent,
      name: AGENT_NAMES[agent],
      kind: id.endsWith(":cost") ? "cost" : "limit",
      label: window && window !== "closest" ? decodeURIComponent(window) : "Quota",
      available: false,
    } as ReadingOption
  })
}

export function readingText(reading: ReadingOption, preferences: UsageDisplay): string {
  if (!reading.available) return "?"
  if (reading.kind === "limit" && reading.credits) return "credits"
  if (reading.kind === "cost") {
    const money = reading.money
    if (money?.usd === null || money?.usd === undefined) return "?"
    return `$${money.usd.toFixed(2)}`
  }
  const window = reading.window
  const value = window
    ? percentage(window.reached ? 100 : window.usedPercent, preferences.percent)
    : null
  return value === null ? "?" : `${value} %`
}
