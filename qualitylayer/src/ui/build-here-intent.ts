// Approve and build here while the planner is still in its turn (12.9): the person's one click is
// kept in this App's memory with the start it asked for, so the same conversation continues as the
// build at its next safe turn boundary, whichever page is open. Nothing is written to the task, the
// gate or the run, and nothing survives a reload: the Plan then offers the same action again.
// The start itself is the existing run start under one idempotency key, so a repeated attempt never
// starts twice.

import type { ConversationSnapshot } from "../core/conversation/types.ts"
import { releaseActivePlanner } from "./build-here-intent-helpers.ts"
import type { RunStart, RunWindow } from "./run-context.tsx"

/**
 * The requested same-session build: which conversation, for which task, the start it asked for, and
 * whether the App has begun ending the planning run itself (a stop it did not begin is not its own).
 */
export type BuildHereIntent = {
  task: string
  nativeSession: string
  agent: string
  request: RunStart
  releasing?: true
}

/** What the App does with an intent now. */
export type Continuation = "start" | "wait" | "disarm" | "stopped"

const intents = new Map<string, BuildHereIntent>()
const listeners = new Set<() => void>()
let version = 0
const changed = () => {
  version++
  for (const listener of listeners) listener()
}
/** Grows on every change and every finished attempt: readers re-evaluate the live runs then. */
export const intentsVersion = () => version

export const readIntent = (task: string): BuildHereIntent | null => intents.get(task) ?? null
export const allIntents = (): BuildHereIntent[] => [...intents.values()]

export function writeIntent(intent: BuildHereIntent): void {
  intents.set(intent.task, intent)
  changed()
}

export function clearIntent(task: string): void {
  if (intents.delete(task)) changed()
}

/** Re-render on any intent change (useSyncExternalStore's subscribe). */
export function subscribeIntents(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Whether the kept intent starts now, waits for the next turn boundary, or is over. It is over once
 * any build of the task runs (this one started, or another session took it), when the task left the
 * approved Plan and the build's start, when the person asked for changes, or when the conversation is gone
 * or replaced. A planner that stopped without the App's own release (the person's Stop, an idle
 * close, a failure) is `stopped`, never resumed on its own. Until the App has listed its runs, it
 * waits. `stage` and `decision` are known where the task is open; elsewhere the server's own start
 * check refuses a task that is no longer approved.
 */
type ContinuationFacts = {
  task: string
  stage?: string
  decision?: string | undefined
  buildRunning: boolean
  runsLoaded: boolean
  planner: { nativeSession?: string | undefined; status: string } | null
}

function isDisarmedBeforePlanner(
  intent: BuildHereIntent | null,
  facts: ContinuationFacts,
): boolean {
  if (intent === null || intent.task !== facts.task || facts.buildRunning) return true
  if (facts.stage !== undefined && !["plan", "implement"].includes(facts.stage)) return true
  return facts.decision === "changes"
}

export function continuation(
  intent: BuildHereIntent | null,
  facts: ContinuationFacts,
): Continuation {
  if (intent === null || isDisarmedBeforePlanner(intent, facts)) return "disarm"
  if (!facts.runsLoaded) return "wait"
  if (facts.planner === null || facts.planner.nativeSession !== intent.nativeSession)
    return "disarm"
  const ended = facts.planner.status === "stopped" || facts.planner.status === "failed"
  return ended && intent.releasing !== true ? "stopped" : "start"
}

function isIntentPlannerRun(run: RunWindow, intent: BuildHereIntent): boolean {
  if (run.nativeSession !== intent.nativeSession) return false
  if (run.purpose.kind === "new-task") return run.task === intent.task
  return (
    run.purpose.kind === "task" &&
    run.purpose.phase === "planning" &&
    run.purpose.task === intent.task
  )
}

/** This task's App planning run of the intent's conversation, among the App's runs. */
export function intentPlanner(intent: BuildHereIntent, runs: readonly RunWindow[]) {
  return runs.find((run) => isIntentPlannerRun(run, intent)) ?? null
}

/** What one attempt needs from the App: its live run stream and controls, and the planner's draft. */
export type IntentDeps = {
  /** The App's runs as they are now (read again after every await). */
  runs(): readonly RunWindow[]
  start(request: RunStart): Promise<unknown>
  stop(run: RunWindow): Promise<RunWindow | undefined>
  conversation?(run: RunWindow): Promise<ConversationSnapshot | undefined>
  /** Whether the person has unsent words or files for this run (the App's retained drafts). */
  hasDraft(run: RunWindow): boolean
  buildRunning(task: string): boolean
}

/**
 * The model and effort the person chose in the planner's session settings that it has not taken yet:
 * a change waits for a turn end, and the release's own stop withdraws it, so the build starts with it.
 * A change that failed keeps the planner's own; permissions stay as the request names them.
 */
function withChosenSettings(request: RunStart, run: RunWindow | null): RunStart {
  const pending = run?.pendingSettings
  if (!pending || pending.error) return request
  const { model, effort } = pending.settings
  if (model === undefined && effort === undefined) return request
  return {
    ...request,
    settings: {
      ...request.settings,
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    },
  }
}

const inFlight = new Set<string>()

type AdvanceOutcome = "started" | "wait" | "disarm" | "stopped" | "busy"

async function executeStartIntent(
  task: string,
  intent: BuildHereIntent,
  planner: RunWindow,
  deps: IntentDeps,
): Promise<AdvanceOutcome> {
  let live: BuildHereIntent = intent
  const stillLive = () => readIntent(task) === live
  let chosen: RunWindow | null = planner
  if (planner.status !== "stopped" && planner.status !== "failed") {
    const release = await releaseActivePlanner({
      intent,
      planner,
      deps,
      latest: () => intentPlanner(intent, deps.runs()),
      stillLive,
      onMarkReleasing: (marked, run) => {
        writeIntent(marked)
        live = marked
        chosen = run
      },
    })
    if (release !== "released") return release
  }
  if (!stillLive()) return "disarm"
  try {
    await deps.start(withChosenSettings(intent.request, chosen))
  } finally {
    if (stillLive()) clearIntent(task)
  }
  return "started"
}

export async function advanceIntent(
  task: string,
  deps: IntentDeps,
  facts: { stage?: string; decision?: string } = {},
): Promise<AdvanceOutcome> {
  const intent = readIntent(task)
  if (intent === null) return "disarm"
  if (inFlight.has(task)) return "busy"
  const planner = intentPlanner(intent, deps.runs())
  const next = continuation(intent, {
    task,
    ...facts,
    buildRunning: deps.buildRunning(task),
    runsLoaded: true,
    planner,
  })
  if (next === "disarm" || next === "stopped") {
    clearIntent(task)
    return next
  }
  if (next !== "start" || planner === null) return "wait"
  inFlight.add(task)
  try {
    return await executeStartIntent(task, intent, planner, deps)
  } finally {
    inFlight.delete(task)
    changed()
  }
}
