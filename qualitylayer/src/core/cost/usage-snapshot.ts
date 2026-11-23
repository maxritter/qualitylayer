import type { AgentLimits } from "../limits/index.ts"
import type { UsageDisplay } from "../usage-display.ts"
import {
  dailyMoney,
  type ReadingOption,
  readingOptions,
  readingText,
  selectedReadings,
} from "./display.ts"
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

function trayItemForChoice(choice: ReadingOption, preferences: UsageDisplay): UsageTrayItem {
  const text = readingText(choice, preferences)
  const suffix = choice.kind === "limit" && text !== "credits" ? ` ${preferences.percent}` : ""
  const reset = choice.window?.resetsAt
  const resetPart =
    reset !== undefined && reset !== null ? ` · resets ${new Date(reset).toLocaleString()}` : ""
  const description = `${choice.name} · ${choice.label} · ${text}${suffix}${resetPart}`
  return { icon: choice.agent, text, description }
}

function oldestCheckedAt(shown: readonly AgentLimits[], usage: Usage | null): number | null {
  const times = shown.flatMap((agent) =>
    agent.state === "reported" && agent.at !== null ? [agent.at] : [],
  )
  if (usage) times.push(usage.to)
  return times.length ? Math.min(...times) : null
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
  const choiceItems = choices.map((choice) => trayItemForChoice(choice, preferences))
  const money = dailyMoney(usage, preferences.money, now)
  const totalText = money.usd === null ? "?" : `$${money.usd.toFixed(2)}`
  const totalLabel =
    preferences.money === "value" ? "all priced usage at API prices, not a bill" : "API spend"
  const totalDescription = `Today · ${totalLabel} · ${totalText}`
  const items = preferences.total
    ? [{ icon: "coins", text: totalText, description: totalDescription }, ...choiceItems]
    : choiceItems
  return {
    enabled: true,
    items,
    details: [
      ...choiceItems.map((item) => item.description),
      ...(preferences.total ? [totalDescription] : []),
    ],
    checkedAt: oldestCheckedAt(shown, usage),
    partial: preferences.total && money.partial,
    menu,
  }
}
