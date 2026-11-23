import type { RunAdapter, RunControlRequest, RunStart, RunWindow } from "../run-context.tsx"
import { applyRunControl, buildStartedRun } from "./agent-window-control.ts"
import { attachDemoFiles, readDemoConversation } from "./agent-window-conv.ts"
import {
  buildInitialRuns,
  demoRun,
  type RunDemoMoment,
  runMomentFrom,
} from "./agent-window-runs.ts"
import { syntheticView } from "./agent-window-view.ts"
import {
  demoAnswered,
  demoEarlier,
  demoForgetAnswers,
  demoScene,
  demoTurnChanges,
  demoWorkerConversation,
} from "./conversation.ts"
import { DEMO_TASK_ID } from "./identity.ts"
import { demoLimits } from "./limits.ts"
import { demoUsage, demoUsageFails, demoUsageScenario } from "./usage.ts"

export { demoRun, type RunDemoMoment, runMomentFrom }

export type DemoRunAdapter = RunAdapter & { reset(): void }

const currentSearch = () => (typeof location === "undefined" ? "" : location.search)
const scene = () => demoScene(currentSearch())

async function readDemoUsage(period: Parameters<typeof demoUsage>[0]) {
  const search = currentSearch()
  if (demoUsageFails(search)) throw new Error("The usage could not be read")
  return demoUsage(period, demoUsageScenario(search))
}

/** The demo exercises dock controls with explicit synthetic data and never connects to /api. */
export function createDemoRunAdapter(
  initial?: RunDemoMoment,
  changed: () => void = () => {},
  task = DEMO_TASK_ID,
  allocateTask?: (request: RunStart) => string,
): DemoRunAdapter {
  const sessionSettings = new URLSearchParams(currentSearch()).get("session-settings")
  const settingsReady = sessionSettings === "ready"
  let runs = buildInitialRuns(initial, task, sessionSettings)
  const listeners = new Set<() => void>()
  const windows = new Map<string, Set<(run: RunWindow) => void>>()
  const notify = (run?: RunWindow) => {
    if (run) for (const listener of windows.get(run.id) ?? []) listener(run)
    for (const listener of listeners) listener()
    changed()
  }
  const update = (run: RunWindow) => {
    runs = [...runs.filter((item) => item.id !== run.id), run]
    notify(run)
    return structuredClone(run)
  }

  return {
    list: async () => structuredClone(runs),
    start: async (request: RunStart) => {
      const existing = runs.find((run) => run.idempotencyKey === request.idempotencyKey)
      return existing
        ? structuredClone(existing)
        : update(buildStartedRun(request, task, allocateTask))
    },
    control: async (id: string, request: RunControlRequest) =>
      update(
        applyRunControl(
          runs.find((item) => item.id === id),
          request,
          settingsReady,
        ),
      ),
    conversation: (run, after) => readDemoConversation(run, after, settingsReady),
    conversationEarlier: async (_run, before) => demoEarlier(scene().turns ?? 0, before),
    conversationEvent: async () => undefined,
    turnChanges: async (run) => demoTurnChanges(run, scene()),
    limits: async () => demoLimits(currentSearch()),
    usage: readDemoUsage,
    conversationWorker: async (run, worker, after) => demoWorkerConversation(run, worker, after),
    attachFiles: async (run, draft, files) => attachDemoFiles(runs, run, draft, files),
    answerApproval: async (run) => {
      const found = runs.find((item) => item.id === run.id)
      demoAnswered(run.id)
      if (found) update({ ...found, attention: "clear" })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset() {
      demoForgetAnswers()
      runs = buildInitialRuns(initial, task, sessionSettings)
      notify()
    },
    attach(run, options) {
      return syntheticView(run, options, windows, initial)
    },
  }
}
