// What Settings › Usage draws from one usage answer: the period's headline for plans, for use billed
// by key or gateway, or both; the daily chart's series; the share of each agent; the kinds of token
// and their cost; and the rows of the breakdown by model and by day. Pure: the figures that must add up
// are checked without a page. Dollars belong to agents billed by use only, always as estimates; an
// agent on a plan shows tokens, and its use "at API prices" only when the person asks for that.

import type { AgentUsage, Spend, Usage } from "../../core/cost/usage.ts"
import { tokensIn } from "../../core/cost/usage-spend.ts"
import { changeAgainst, keyedAgents, kindOf, planAgents } from "../usage/facts.ts"

export {
  chartAgents,
  chartSeries,
  type DayRow,
  dayRows,
  type Measure,
  type ModelRow,
  measureOf,
  modelRows,
} from "./usage-view-series.ts"

/** An agent of the page with what it used in the period and in the one before. */
export type Pick = { agent: AgentUsage; now: Spend; before: Spend }

export type UsageView = {
  kind: "plan" | "api" | "mixed"
  /** Agents billed by use, then agents on a plan, each in the catalog's order. */
  keyed: Pick[]
  plan: Pick[]
  /** Both, in the catalog's order. */
  all: Pick[]
  /** The estimate of what agents billed by use cost, and in the period before. */
  cost: number
  costBefore: number
  tokens: number
  tokensBefore: number
  planTokens: number
  planTokensBefore: number
  /** What the plan agents' use would cost at API prices: shown only when asked for. */
  planValue: number
  sessions: number
  /** Models of agents billed by use with tokens but no price, named once each. */
  unpricedModels: string[]
  /** The agents that used something in the period. */
  used: Pick[]
  /** Nothing was used in the period. */
  empty: boolean
}

const sum = (picks: readonly Pick[], f: (pick: Pick) => number): number =>
  picks.reduce((n, pick) => n + f(pick), 0)

export function usageView(usage: Usage): UsageView {
  const before = (agent: AgentUsage): Spend | undefined =>
    usage.previous?.agents.find((row) => row.agent === agent.agent)
  const pick = (agent: AgentUsage): Pick => ({
    agent,
    now: agent,
    before: before(agent) ?? agent,
  })
  const keyed = keyedAgents(usage).map(pick)
  const plan = planAgents(usage).map(pick)
  const all = usage.agents
    .filter(
      (agent) =>
        agent.state === "counted" &&
        (agent.calls > 0 ||
          keyed.some((p) => p.agent === agent) ||
          plan.some((p) => p.agent === agent)),
    )
    .map(pick)
  const unpriced = new Set<string>()
  for (const { agent } of keyed)
    for (const model of agent.models)
      if (!model.priced && tokensIn(model.tokens) > 0) unpriced.add(model.model)
  const used = all.filter((p) => tokensIn(p.now.tokens) > 0)
  // The period before is an empty one, not the same one, when the answer carries none.
  const prior = (p: Pick) => (usage.previous === null ? zero : p.before)
  const tokensOfPick = (p: Pick) => tokensIn(p.now.tokens)
  return {
    kind: kindOf(usage),
    keyed,
    plan,
    all,
    cost: sum(keyed, (p) => p.now.costUsd),
    costBefore: sum(keyed, (p) => prior(p).costUsd),
    tokens: sum(all, tokensOfPick),
    tokensBefore: sum(all, (p) => tokensIn(prior(p).tokens)),
    planTokens: sum(plan, (p) => p.now.accounting?.planTokens ?? tokensOfPick(p)),
    planTokensBefore: sum(
      plan,
      (p) => prior(p).accounting?.planTokens ?? tokensIn(prior(p).tokens),
    ),
    planValue: sum(plan, (p) => p.now.accounting?.planValueUsd ?? p.now.costUsd),
    sessions: sum(all, (p) => p.now.sessions),
    unpricedModels: [...unpriced],
    used,
    empty: used.length === 0,
  }
}

const zero: Spend = {
  calls: 0,
  sessions: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  costUsd: 0,
  costKinds: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  fastUsd: 0,
  unpricedTokens: 0,
  cacheSavedUsd: 0,
}

/** The change against the period before, in percent; null when there is nothing before or nothing now. */
export const changeOf = (view: UsageView, now: number, before: number): number | null =>
  view.empty ? null : changeAgainst(now, before)

/* ── the share column ── */

/** An agent's share of the period: of the cost when only agents billed by use are here, of the tokens otherwise. */
export function shareOfAgent(view: UsageView, pick: Pick): number {
  if (view.kind === "api") return view.cost > 0 ? pick.now.costUsd / view.cost : 0
  return view.tokens > 0 ? tokensIn(pick.now.tokens) / view.tokens : 0
}

/* ── where the tokens went ── */

export type Kinds = {
  tokens: { cacheRead: number; cacheWrite: number; input: number; output: number; all: number }
  /** What the agents billed by use paid for each kind, and for each speed. */
  cost: { cacheRead: number; cacheWrite: number; input: number; output: number }
  fastUsd: number
  /** The estimate of every agent billed by use. */
  costUsd: number
  /** What reading from the cache saved, for agents billed by use. */
  savedUsd: number
}

export function kindsOf(view: UsageView): Kinds {
  const out: Kinds = {
    tokens: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, all: 0 },
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    fastUsd: 0,
    costUsd: 0,
    savedUsd: 0,
  }
  for (const p of view.all) {
    const t = p.now.tokens
    out.tokens.cacheRead += t.cacheRead
    out.tokens.cacheWrite += t.cacheWrite5m + t.cacheWrite1h
    out.tokens.input += t.input
    out.tokens.output += t.output
    out.tokens.all += tokensIn(t)
  }
  for (const p of view.keyed) {
    out.cost.cacheRead += p.now.costKinds.cacheRead
    out.cost.cacheWrite += p.now.costKinds.cacheWrite
    out.cost.input += p.now.costKinds.input
    out.cost.output += p.now.costKinds.output
    out.fastUsd += p.now.fastUsd
    out.costUsd += p.now.costUsd
    out.savedUsd += p.now.cacheSavedUsd
  }
  return out
}
