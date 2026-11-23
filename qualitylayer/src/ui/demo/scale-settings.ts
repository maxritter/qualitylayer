// The Settings lists of `?scale=large` (scale.ts): 150 lessons in Memory, 25 running sessions,
// 8 agents with usage, and long model lists for every agent.

import { NATIVE_AGENTS, type NativeAgent } from "../../core/agents/ids.ts"
import type { AgentUsage, Spend, Usage } from "../../core/cost/usage.ts"
import type { SessionRow, SessionState, StopOutcome } from "../../core/run/sessions-view.ts"
import type { Api, TaskDetail } from "../api.ts"
import { largeMemory } from "./scale-memory.ts"
import { LARGE_PROJECTS, type LargeTasks } from "./scale-tasks.ts"
import { demoUsage } from "./usage.ts"

const MB = 1024 * 1024
const MIN = 60_000
const HOUR = 60 * MIN

const AGENT_TASKS = [
  "Replace the nightly reconciliation batch job with an event-driven settlement pipeline",
  "Rotate API keys without downtime",
  "Deliver webhooks reliably through a regional outage",
  "Move jobs to the new queue",
  "Let enterprise administrators export the complete audit trail as signed CSV archives",
  "Add per-organisation rate limits to the public API",
] as const

const sessionStep = (state: SessionState, at: number): string =>
  state === "working" ? "Implement" : (["Plan", "Verify"][at % 2] as string)

const sessionWords = (state: SessionState, at: number): string => {
  if (state === "working") return `Working · slice ${2 + (at % 9)} of ${11 + (at % 20)}`
  return state === "needs-you" ? "Waits for you" : "Idle"
}

const sessionLastTurn = (state: SessionState, at: number, now: number): number => {
  if (state === "idle") return now - (2 + (at % 6)) * HOUR
  if (state === "needs-you") return now - (9 + at) * MIN
  return now - (8 + at * 3) * 1000
}

function buildSessionRow(task: TaskDetail | undefined, at: number, now: number): SessionRow {
  const state: SessionState = at % 5 === 4 ? "idle" : at % 4 === 3 ? "needs-you" : "working"
  const project = LARGE_PROJECTS[at % LARGE_PROJECTS.length]
  return {
    run: `demo-run-${at + 1}`,
    generation: 1,
    agent: NATIVE_AGENTS[at % NATIVE_AGENTS.length] as NativeAgent,
    task: task?.title ?? (AGENT_TASKS[at % AGENT_TASKS.length] as string),
    taskId: at % 3 === 0 ? (task?.id ?? null) : null,
    project: project === undefined ? null : { id: project.id, name: project.name },
    step: sessionStep(state, at),
    state,
    words: sessionWords(state, at),
    idle: state === "idle",
    keptOpen: null,
    lastTurnAt: sessionLastTurn(state, at, now),
    memoryBytes: (180 + ((at * 67) % 520)) * MB,
  }
}

/** 25 running sessions on 7 agents: most work, a few wait for the person, a few sit idle for hours. */
function sessionRows(world: LargeTasks, now: number): SessionRow[] {
  const tasks = world.summaries()
  return Array.from({ length: 25 }, (_, at) =>
    buildSessionRow(tasks[(at * 3) % tasks.length], at, now),
  )
}

const SPEND_KEYS = [
  "calls",
  "sessions",
  "costUsd",
  "fastUsd",
  "unpricedTokens",
  "cacheSavedUsd",
] as const
const TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h"] as const
const KIND_KEYS = ["cacheRead", "cacheWrite", "input", "output"] as const

/** The sum of the figures of several spends, with the numbers a spend holds. */
function sumSpends(spends: Spend[]): Spend {
  const total = JSON.parse(JSON.stringify(spends[0] ?? {})) as Spend
  for (const key of SPEND_KEYS) total[key] = spends.reduce((n, spend) => n + spend[key], 0)
  for (const key of TOKEN_KEYS)
    total.tokens[key] = spends.reduce((n, spend) => n + spend.tokens[key], 0)
  for (const key of KIND_KEYS)
    total.costKinds[key] = spends.reduce((n, spend) => n + spend.costKinds[key], 0)
  return total
}

function fillPreviousPeriod(
  previous: Usage["previous"],
  agents: AgentUsage[],
  counted: AgentUsage[],
): Usage["previous"] {
  if (previous === null) return null
  const filled = agents.map((agent, at) => {
    const known = previous.agents.find((entry) => entry.agent === agent.agent)
    if (known !== undefined && known.calls > 0) return known
    const from = previous.agents.find(
      (entry) => entry.agent === (counted[at % counted.length] as AgentUsage).agent,
    )
    return {
      ...structuredClone(from ?? previous.agents[0] ?? {}),
      agent: agent.agent,
    } as (typeof previous.agents)[number]
  })
  return { ...previous, agents: filled, totals: sumSpends(filled as Spend[]) }
}

/** The agents that are not counted in the demo's usage report as the ones that are, scaled down. */
function everyAgent(usage: Usage): Usage {
  const counted = usage.agents.filter((agent) => agent.state === "counted" && agent.calls > 0)
  if (counted.length === 0) return usage
  const shown: AgentUsage[] = usage.agents.map((agent, at) => {
    if (agent.state === "counted" && agent.calls > 0) return agent
    const from = counted[at % counted.length] as AgentUsage
    return {
      ...structuredClone(from),
      agent: agent.agent,
      name: agent.name,
      billing: agent.billing,
      state: "counted",
      reason: null,
    }
  })
  return {
    ...usage,
    agents: shown,
    totals: sumSpends(shown),
    previous: fillPreviousPeriod(usage.previous, usage.agents, counted),
  }
}

const LONG_MODEL = "openrouter/alibaba-token-plan/qwen3.8-coder-plus-20261001-thinking-extended"

/** Every agent lists 24 models, one with the longest name a gateway gives. */
function longModels(models: { id: string; name: string }[], agent: string) {
  const more = Array.from({ length: 24 - models.length }, (_, at) => ({
    id: `${agent}/provider-${at + 1}/model-${at + 1}-instruct-20261001`,
    name: `${agent}/provider-${at + 1}/model-${at + 1}-instruct-20261001`,
  }))
  const all = [...models, ...more]
  return [...all.slice(0, -1), { id: LONG_MODEL, name: LONG_MODEL }]
}

export function largeSettings(api: Api, world: LargeTasks, now: number): Partial<Api> {
  const rows = sessionRows(world, now)
  let stopped = new Set<string>()
  const view = () => {
    const sessions = rows
      .filter((row) => !stopped.has(row.run))
      .sort((a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0))
    return {
      sessions: structuredClone(sessions),
      totalBytes: sessions.reduce((n, row) => n + (row.memoryBytes ?? 0), 0),
      idleCount: sessions.filter((row) => row.idle).length,
    }
  }
  return {
    ...(api.memory === undefined ? {} : { memory: largeMemory(api.memory) }),
    agentSessions: async () => view(),
    stopIdle: async (): Promise<StopOutcome[]> => {
      const idle = rows.filter((row) => row.idle && !stopped.has(row.run))
      stopped = new Set([...stopped, ...idle.map((row) => row.run)])
      return idle.map((row) => ({ run: row.run, generation: row.generation, stopped: true }))
    },
    usage: async (period) => everyAgent(demoUsage(period, "huge")),
    subagents: async () =>
      (await api.subagents()).map((entry) => {
        const models = longModels(entry.models, entry.agent)
        return {
          ...entry,
          models,
          listed: { models: models.map((model) => model.id), own: entry.models[0]?.id ?? null },
        }
      }),
  }
}
