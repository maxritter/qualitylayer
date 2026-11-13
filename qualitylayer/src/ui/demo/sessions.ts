import { DEMO_TASK_ID } from "./identity.ts"
// The demo's running sessions for Settings › Sessions: four different agents on four tasks, one of them idle
// for hours. Stop idle ends the idle one and keeps its conversation, as the real one does.

import type { SessionRow, SessionsView, StopOutcome } from "../../core/run/sessions-view.ts"
import { MIN } from "./story.ts"

const MB = 1024 * 1024
const HOUR = 60 * MIN

type Seed = Omit<SessionRow, "lastTurnAt" | "run" | "generation"> & { turnAgo: number | null }

const SEEDS: Seed[] = [
  {
    agent: "claude-code",
    task: "Usage-based billing",
    taskId: DEMO_TASK_ID,
    project: { id: "platform", name: "acme/platform" },
    step: "Implement",
    state: "working",
    words: "Working · slice 6 of 11",
    idle: false,
    keptOpen: null,
    memoryBytes: 310 * MB,
    turnAgo: 8_000,
  },
  {
    agent: "grok",
    task: "Rotate API keys without downtime",
    taskId: null,
    project: { id: "web", name: "acme/web" },
    step: "Verify",
    state: "idle",
    words: "Idle",
    idle: true,
    keptOpen: null,
    memoryBytes: 486 * MB,
    turnAgo: 5 * HOUR,
  },
  {
    agent: "antigravity",
    task: "Deliver webhooks reliably",
    taskId: null,
    project: { id: "pay", name: "acme/payments" },
    step: "Plan",
    state: "needs-you",
    words: "Waits for you",
    idle: false,
    keptOpen: null,
    memoryBytes: 274 * MB,
    turnAgo: 12 * MIN,
  },
  {
    agent: "codex",
    task: "Move jobs to the new queue",
    taskId: null,
    project: { id: "cli", name: "tools/cli" },
    step: "Implement",
    state: "working",
    words: "Working · slice 4 of 9",
    idle: false,
    keptOpen: null,
    memoryBytes: 402 * MB,
    turnAgo: 20_000,
  },
]

/** A run of the demo's run list, as far as a session names it. */
type DemoRun = { id: string; task?: string }

export type DemoSessions = {
  /** The sessions; a row whose task has a run in the demo's run list carries that run's id. */
  view(runs?: readonly DemoRun[]): SessionsView
  stopIdle(): StopOutcome[]
  reset(): void
}

export function createDemoSessions(now: () => number = Date.now): DemoSessions {
  let stopped = new Set<number>()
  let known: readonly DemoRun[] = []
  const runOf = (seed: Seed, at: number, runs: readonly DemoRun[]): string =>
    (seed.taskId === null ? undefined : runs.find((run) => run.task === seed.taskId)?.id) ??
    `demo-run-${at + 1}`
  const rows = (runs: readonly DemoRun[]): { row: SessionRow; at: number }[] =>
    SEEDS.flatMap((seed, at) =>
      stopped.has(at)
        ? []
        : [
            {
              at,
              row: {
                ...seed,
                run: runOf(seed, at, runs),
                generation: 1,
                lastTurnAt: seed.turnAgo === null ? null : now() - seed.turnAgo,
              },
            },
          ],
    )
  return {
    view(runs = []) {
      known = runs
      const sessions = rows(runs)
        .map(({ row }) => row)
        .sort((a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0))
      return {
        sessions,
        totalBytes: sessions.reduce((sum, row) => sum + (row.memoryBytes ?? 0), 0),
        idleCount: sessions.filter((row) => row.idle).length,
      }
    },
    stopIdle() {
      const idle = rows(known).filter(({ row }) => row.idle)
      for (const { at } of idle) stopped.add(at)
      return idle.map(({ row }) => ({ run: row.run, generation: row.generation, stopped: true }))
    },
    reset() {
      stopped = new Set()
    },
  }
}
