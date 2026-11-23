// The demo's usage, shaped like the server's answer (core/cost/usage.ts): what the agents used over
// the last 70 days, by agent, model and day, made up from a fixed seed so every figure is the same on
// every run and every page adds up exactly: the days make the period, the models make the agent's
// row, the agents make the headline. The billing situations a person can be in are scenarios
// (`?usage=` in the address, App Model: Prototype controls › Usage); plans only is the default.
//
//   plan        both agents on a plan                      claude-key  Claude Code on an API key, Codex on a plan
//   api         every agent billed by use (a gateway too)  one         only Claude Code, on an API key
//   mixed       Claude Code on a plan, Codex on an API key  empty       API keys, no use yet
//   huge        the mixed case for a heavy team            partial     still counting
//   failed      the read fails

import { AGENT_NAMES, NATIVE_AGENTS, type NativeAgent } from "../../core/agents/ids.ts"
import { PRICE_NOTE } from "../../core/cost/prices.ts"
import type {
  AgentUsage,
  DayModel,
  DayUsage,
  ModelUsage,
  Spend,
  Usage,
  UsagePeriod,
} from "../../core/cost/usage.ts"
import { dayKey, dayStart, usageWindows } from "../../core/cost/usage-days.ts"
import { UNCOUNTED_REASON } from "../../core/cost/usage-reason.ts"
import { sumSpends, tokensIn, zeroSpend } from "../../core/cost/usage-spend.ts"
import {
  buildUsageHistory,
  DAYS,
  type DayFacts,
  demoBilling,
  demoUsageFails,
  demoUsageScenario,
  type History,
  type Mix,
  MS,
  SCENARIOS,
  spendOf,
  sum4,
  USAGE_SCENARIOS,
  type UsageScenario,
} from "./usage-history.ts"

export { demoBilling, demoUsageFails, demoUsageScenario, USAGE_SCENARIOS, type UsageScenario }

function dayUsage(key: string, facts: DayFacts, mix: Mix): DayUsage {
  const models: DayModel[] = [...facts.models]
    .filter(([, m]) => sum4(m.tok) > 0)
    .map(([model, m]) => ({
      model,
      tokens: sum4(m.tok),
      costUsd: m.cost,
      priced: m.priced,
      sessions: Math.round(m.sessions),
    }))
    .sort((a, b) => b.tokens - a.tokens)
  const spends = [...facts.models].map(([model, m]) => spendOf(model, m, mix))
  const total = sumSpends(spends)
  return { day: key, ...total, sessions: facts.sessions, models }
}

/** The history's days between two indexes (`to` included) as the agent's row of the answer. */
function agentUsage(
  agent: NativeAgent,
  h: History | undefined,
  range: [number, number],
  keys: readonly string[],
): AgentUsage {
  const counted = SOURCE_AGENTS.has(agent)
  const base = {
    agent,
    name: AGENT_NAMES[agent],
    state: counted ? ("counted" as const) : ("unavailable" as const),
    reason: counted
      ? null
      : agent === "cursor"
        ? "Provider usage export required"
        : UNCOUNTED_REASON,
    billing: h?.billing ?? ("unknown" as const),
  }
  if (h === undefined)
    return {
      ...base,
      ...zeroSpend(),
      models: [],
      daily: counted ? keys.map((day) => ({ day, ...zeroSpend(), models: [] })) : [],
    }
  const [from, to] = range
  const daily = keys.map((key, n) => dayUsage(key, h.days[from + n] as DayFacts, h.mix))
  const byModel = new Map<string, Spend[]>()
  const modelDays = new Map<string, number>()
  for (let i = from; i <= to; i++)
    for (const [model, m] of (h.days[i] as DayFacts).models) {
      byModel.set(model, [...(byModel.get(model) ?? []), spendOf(model, m, h.mix)])
      modelDays.set(model, (modelDays.get(model) ?? 0) + m.sessions)
    }
  const models: ModelUsage[] = [...byModel]
    .map(([model, spends]) => {
      const total = sumSpends(spends)
      return {
        model,
        ...total,
        sessions: Math.round(modelDays.get(model) ?? 0),
        priced: total.unpricedTokens === 0,
      }
    })
    .filter((m) => tokensIn(m.tokens) > 0)
    .sort((a, b) => tokensIn(b.tokens) - tokensIn(a.tokens))
  const total = sumSpends(daily.map(({ day: _, models: __, ...spend }) => spend))
  return { ...base, ...total, models, daily }
}

const SOURCE_AGENTS = new Set<NativeAgent>([
  "claude-code",
  "codex",
  "pi",
  "opencode",
  "copilot",
  "grok",
  "antigravity",
])

export function demoUsage(
  period: UsagePeriod,
  scenario: UsageScenario = "plan",
  now: number = Date.now(),
): Usage {
  const made = buildUsageHistory(scenario, now)
  const { current, previous } = usageWindows(period, now)
  // The history's last day is today: a window's day n is the history's day (DAYS - 1 - daysAgo).
  const index = (start: number) => DAYS - 1 - Math.round((dayStart(now) - start) / MS)
  const first = index(current.starts[0] as number)
  const keys = current.starts.map(dayKey)
  const before = index(previous.starts[0] as number)
  const agents = NATIVE_AGENTS.map((agent) =>
    agentUsage(agent, made.get(agent), [first, first + keys.length - 1], keys),
  )
  const prevKeys = previous.starts.map(dayKey)
  const earlier = NATIVE_AGENTS.map((agent) => {
    const row = agentUsage(agent, made.get(agent), [before, before + prevKeys.length - 1], prevKeys)
    const { models: _m, daily: _d, ...spend } = { ...row }
    return { agent, ...pickSpend(spend) }
  })
  return {
    period,
    from: current.from,
    to: current.to,
    days: keys,
    complete: (SCENARIOS[scenario].pending ?? 0) === 0,
    pendingFiles: SCENARIOS[scenario].pending ?? 0,
    skippedFiles: 0,
    cappedFiles: 0,
    agents,
    totals: sumSpends(agents.map(pickSpend)),
    previous: {
      from: previous.from,
      to: previous.to,
      days: prevKeys,
      totals: sumSpends(earlier.map(pickSpend)),
      agents: earlier,
    },
    unpriced: agents.flatMap((agent) =>
      agent.models
        .filter((model) => !model.priced)
        .map((model) => ({
          agent: agent.agent,
          model: model.model,
          tokens: tokensIn(model.tokens),
        })),
    ),
    note: PRICE_NOTE,
  }
}

/** The numbers of a row that make a Spend, without its names. */
function pickSpend(row: Spend): Spend {
  return {
    calls: row.calls,
    sessions: row.sessions,
    tokens: row.tokens,
    costUsd: row.costUsd,
    costKinds: row.costKinds,
    fastUsd: row.fastUsd,
    unpricedTokens: row.unpricedTokens,
    cacheSavedUsd: row.cacheSavedUsd,
  }
}
