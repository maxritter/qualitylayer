import type { AgentLimits } from "../limits/index.ts"
import type { UsageDisplay } from "../usage-display.ts"
import { dailyMoney, readingOptions, readingText, selectedReadings } from "./display.ts"
import type { Usage } from "./usage.ts"
import { limitsAtTime, type UsageMenu, usageMenu } from "./usage-menu.ts"

type UsageTrayItem = { icon: string; text: string; description: string }
export type UsageSnapshot = {
  enabled: boolean
  items: UsageTrayItem[]
  details: string[]
  checkedAt: number | null
  partial: boolean
  menu: UsageMenu | null
}

export function usageSnapshot(
  preferences: UsageDisplay,
  limits: readonly AgentLimits[],
  usage: Usage | null,
  now: number,
  includeMenu = false,
): UsageSnapshot {
  const menu =
    preferences.menuBar || includeMenu ? usageMenu(preferences, limits, usage, now) : null
  if (!preferences.menuBar)
    return {
      enabled: false,
      items: [],
      details: [],
      checkedAt: menu?.checkedAt ?? null,
      partial: false,
      menu,
    }
  const shown = limitsAtTime(limits, now)
  const choices = selectedReadings(preferences, readingOptions(shown, usage, now))
  const items = choices.map((choice): UsageTrayItem => {
    const text = readingText(choice, preferences)
    const reset = choice.window?.resetsAt
    const description = `${choice.name} · ${choice.label} · ${text}${choice.kind === "limit" && text !== "credits" ? ` ${preferences.percent}` : ""}${reset !== undefined && reset !== null ? ` · resets ${new Date(reset).toLocaleString()}` : ""}`
    return { icon: choice.agent, text, description }
  })
  const money = dailyMoney(usage, preferences.money, now)
  const totalText = money.usd === null ? "?" : `$${money.usd.toFixed(2)}`
  const totalDescription = `Today · ${preferences.money === "value" ? "all priced usage at API prices, not a bill" : "API spend"} · ${totalText}`
  if (preferences.total)
    items.unshift({ icon: "coins", text: totalText, description: totalDescription })
  const times = shown.flatMap((agent) =>
    agent.state === "reported" && agent.at !== null ? [agent.at] : [],
  )
  if (usage) times.push(usage.to)
  return {
    enabled: true,
    items,
    details: [
      ...choices.map((_, index) => items[index + (preferences.total ? 1 : 0)]!.description),
      ...(preferences.total ? [totalDescription] : []),
    ],
    checkedAt: times.length ? Math.min(...times) : null,
    partial: preferences.total && money.partial,
    menu,
  }
}
