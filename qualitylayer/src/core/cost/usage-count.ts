// What the usage count keeps of a transcript and how it adds it up (usage.ts reads the files). A
// file's calls are kept as flat numbers so a large index stays small, and counting walks them once:
// each message id once, inside the period or the period before it, by agent, model and day.

import { AGENT_NAMES, NATIVE_AGENTS, type NativeAgent } from "../agents/ids.ts"
import type { UsageAccounting } from "./accounting.ts"
import { PRICE_NOTE } from "./prices.ts"
import type { UsageBilling } from "./usage-billing.ts"
import { type Indexed, pack, STRIDE, sessionOf, widened } from "./usage-count-pack.ts"
import { type DayWindow, dayIndex, dayKey, type UsagePeriod, usageWindows } from "./usage-days.ts"
import type { Candidate } from "./usage-files.ts"
import { UNCOUNTED_REASON } from "./usage-reason.ts"
import { SOURCES, type Source } from "./usage-sources.ts"
import {
  Acc,
  newPiece,
  type Piece,
  type Spend,
  splitPiece,
  tokensIn,
  type UnitPrice,
  unitPriceOf,
  zeroSpend,
} from "./usage-spend.ts"

export type { Indexed } from "./usage-count-pack.ts"
export type { UsagePeriod } from "./usage-days.ts"
export type { Spend } from "./usage-spend.ts"
export { pack, STRIDE, sessionOf, widened }
export const tokensOf = tokensIn

export type ModelUsage = Spend & {
  model: string
  /** False when no price is confirmed for the model: its tokens count, its cost does not. */
  priced: boolean
}

/** A model's share of one day, as the day's own list names it. */
export type DayModel = {
  model: string
  /** Every token of the model that day. */
  tokens: number
  costUsd: number
  priced: boolean
  sessions: number
  calls?: number
  accounting?: UsageAccounting
}

export type DayUsage = Spend & { day: string; models: DayModel[] }

export type AgentUsage = Spend & {
  agent: NativeAgent
  name: string
  state: "counted" | "unavailable"
  reason: string | null
  partial?: string
  /** How the agent is billed, as far as this computer can tell (usage-billing.ts). */
  billing: UsageBilling
  models: ModelUsage[]
  /** One entry for each day of the period, oldest first, the days with no use included. */
  daily: DayUsage[]
}

export type PreviousUsage = {
  from: number
  to: number
  days: string[]
  totals: Spend
  agents: (Spend & { agent: NativeAgent })[]
}

export type Usage = {
  period: UsagePeriod
  from: number
  to: number
  /** The local days of the period, oldest first (`2026-10-21`). */
  days: string[]
  /** False while files in the range are still unread: ask again for the rest. */
  complete: boolean
  pendingFiles: number
  /** Files over the size cap, never read. */
  skippedFiles: number
  /** Files read but left out of the totals to keep the index small; asking again cannot add them. */
  cappedFiles: number
  agents: AgentUsage[]
  totals: Spend
  /** The period just before this one, as long as it; the figures of a change against it. */
  previous: PreviousUsage | null
  /** Models counted in tokens only, for lack of a confirmed price. */
  unpriced: { agent: NativeAgent; model: string; tokens: number }[]
  note: string
}

export type Wanted = { source: Source; file: Candidate }

/** What is added up for one agent: the whole period, the period before, each model, each day. */
type AgentAcc = {
  total: Acc
  before: Acc
  models: Map<string, Acc>
  days: Acc[]
  dayModels: Map<string, Acc>[]
}

const newAgentAcc = (days: number): AgentAcc => ({
  total: new Acc(),
  before: new Acc(),
  models: new Map(),
  days: Array.from({ length: days }, () => new Acc()),
  dayModels: Array.from({ length: days }, () => new Map()),
})

const accOf = (map: Map<string, Acc>, key: string): Acc => {
  let acc = map.get(key)
  if (acc === undefined) {
    acc = new Acc()
    map.set(key, acc)
  }
  return acc
}

type Counted = { agents: Map<NativeAgent, AgentAcc>; total: Acc; before: Acc }

type CountState = {
  seen: Set<number>
  units: Map<string, UnitPrice | null>
  out: Counted
  piece: Piece
  current: DayWindow
  previous: DayWindow
}

function recordPiece(mine: AgentAcc, out: Counted, piece: Piece, day: number, model: string): void {
  if (day < 0) {
    mine.before.add(piece)
    out.before.add(piece)
    return
  }
  mine.total.add(piece)
  out.total.add(piece)
  accOf(mine.models, model).add(piece)
  mine.days[day]?.add(piece)
  const inDay = mine.dayModels[day]
  if (inDay !== undefined) accOf(inDay, model).add(piece)
}

function countFileCalls(held: Indexed, mine: AgentAcc, session: number, state: CountState): void {
  for (let at = 0; at < held.calls.length; at += STRIDE) {
    const time = held.calls[at + 1] as number
    const day = dayIndex(state.current, time)
    if (day < 0 && dayIndex(state.previous, time) < 0) continue
    const id = held.calls[at] as number
    if (state.seen.has(id)) continue
    state.seen.add(id)
    const model = held.models[held.calls[at + 2] as number] ?? "unknown"
    fill(state.piece, held, at, session, unitOf(state.units, model))
    recordPiece(mine, state.out, state.piece, day, model)
  }
}

/** The calls of every held file in `wanted`, each message id once, added up by agent, model and day. */
function counted(
  files: ReadonlyMap<string, Indexed>,
  wanted: readonly Wanted[],
  current: DayWindow,
  previous: DayWindow,
): Counted {
  const sessions = new Map<string, number>()
  const state: CountState = {
    seen: new Set(),
    units: new Map(),
    out: { agents: new Map(), total: new Acc(), before: new Acc() },
    piece: newPiece(),
    current,
    previous,
  }
  for (const { source, file } of wanted) {
    const held = files.get(file.path)
    if (held === undefined) continue
    const mine = state.out.agents.get(source.agent) ?? newAgentAcc(current.starts.length)
    state.out.agents.set(source.agent, mine)
    const session = sessionNumber(sessions, `${source.agent}:${sessionOf(file.path)}`)
    countFileCalls(held, mine, session, state)
  }
  return state.out
}

const sessionNumber = (sessions: Map<string, number>, key: string): number => {
  let n = sessions.get(key)
  if (n === undefined) {
    n = sessions.size
    sessions.set(key, n)
  }
  return n
}

const unitOf = (units: Map<string, UnitPrice | null>, model: string): UnitPrice | null => {
  if (!units.has(model)) units.set(model, unitPriceOf(model))
  return units.get(model) ?? null
}

/** The call that starts at `at` in a held file, as the accumulators take it. */
function fill(
  piece: Piece,
  held: Indexed,
  at: number,
  session: number,
  unit: UnitPrice | null,
): void {
  const field = (offset: number) => held.calls[at + offset] as number
  piece.session = session
  piece.tokens = {
    input: field(3),
    output: field(4),
    cacheRead: field(5),
    cacheWrite5m: field(6),
    cacheWrite1h: field(7),
  }
  piece.usd = field(8)
  piece.fast = field(9) === 1
  piece.reportedUsd = field(10)
  piece.billing = field(11)
  piece.missingTokens = field(12) === 1
  splitPiece(piece, unit)
}

/** A day of an agent: its sums with the models it used that day, the most used first. */
function dayOf(key: string, acc: Acc, models: Map<string, Acc>): DayUsage {
  return {
    day: key,
    ...acc.spend(),
    models: [...models]
      .map(([model, one]) => {
        const spend = one.spend()
        return {
          model,
          tokens: tokensIn(spend.tokens),
          costUsd: spend.costUsd,
          priced: !one.unpriced,
          sessions: spend.sessions,
          calls: spend.calls,
          ...(spend.accounting ? { accounting: spend.accounting } : {}),
        }
      })
      .sort((a, b) => b.tokens - a.tokens),
  }
}

function agentRow(
  agent: NativeAgent,
  mine: AgentAcc | undefined,
  dayKeys: readonly string[],
): AgentUsage {
  const counts = SOURCES.some((source) => source.agent === agent)
  const models = [...(mine?.models ?? [])]
    .map(([model, acc]): ModelUsage => ({ model, ...acc.spend(), priced: !acc.unpriced }))
    .sort((a, b) => tokensIn(b.tokens) - tokensIn(a.tokens))
  return {
    agent,
    name: AGENT_NAMES[agent],
    state: counts ? "counted" : "unavailable",
    reason: counts ? null : UNCOUNTED_REASON,
    billing: "unknown",
    ...(mine?.total.spend() ?? zeroSpend()),
    models,
    daily: counts
      ? dayKeys.map((key, n) =>
          dayOf(key, mine?.days[n] ?? new Acc(), mine?.dayModels[n] ?? new Map()),
        )
      : [],
  }
}

/** The answer for a period: what the held files say, by agent, model and day, with the period before and the models without a price. */
export function usageOf(
  files: ReadonlyMap<string, Indexed>,
  wanted: readonly Wanted[],
  range: { period: UsagePeriod; now: number },
  left: { pending: number; skipped: number; capped: number },
): Usage {
  const { current, previous } = usageWindows(range.period, range.now)
  const found = counted(files, wanted, current, previous)
  const days = current.starts.map(dayKey)
  const agents = NATIVE_AGENTS.map((agent) => agentRow(agent, found.agents.get(agent), days))
  const unpriced: Usage["unpriced"] = []
  for (const row of agents)
    for (const model of row.models)
      if (!model.priced)
        unpriced.push({ agent: row.agent, model: model.model, tokens: tokensIn(model.tokens) })
  return {
    period: range.period,
    from: current.from,
    to: current.to,
    days,
    complete: left.pending === 0,
    pendingFiles: left.pending,
    skippedFiles: left.skipped,
    cappedFiles: left.capped,
    agents,
    totals: found.total.spend(),
    previous: {
      from: previous.from,
      to: previous.to,
      days: previous.starts.map(dayKey),
      totals: found.before.spend(),
      agents: NATIVE_AGENTS.map((agent) => ({
        agent,
        ...(found.agents.get(agent)?.before.spend() ?? zeroSpend()),
      })),
    },
    unpriced,
    note: PRICE_NOTE,
  }
}
