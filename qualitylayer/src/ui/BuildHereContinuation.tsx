// Approve and build here, kept across pages (12.9): wherever the person is in the App, a kept intent
// is tried again whenever its planner's turn ends or its state changes, on the App's own run stream
// and controls. It renders nothing. A failed start or a stop the App did not make is said once.

import type { RefObject } from "react"
import { useEffect, useRef, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { retainedDrafts } from "./agent-window/conversation/draft-handoff.ts"
import {
  advanceIntent,
  allIntents,
  type BuildHereIntent,
  intentPlanner,
  intentsVersion,
  subscribeIntents,
} from "./build-here-intent.ts"
import { type RunWindow, useOptionalRuns } from "./run-context.tsx"
import { buildRunForTask } from "./runs-api.ts"

type RunsCtx = NonNullable<ReturnType<typeof useOptionalRuns>>

function intentBoundaryKey(planner: RunWindow | undefined, releasing: boolean | undefined): string {
  return [
    planner?.id,
    planner?.generation,
    planner?.status,
    planner?.acceptedStopSequence,
    planner?.attention,
    releasing,
  ].join("|")
}

function hasRetainedDraft(runId: string): boolean {
  const draft = retainedDrafts(runId)?.current
  return !!draft && (draft.text.trim() !== "" || draft.files.length > 0)
}

function advanceTaskIntent(
  intent: BuildHereIntent,
  key: string,
  runs: RunsCtx,
  latest: RefObject<RunWindow[]>,
  tried: RefObject<Map<string, string>>,
): void {
  const conversation = runs.adapter.conversation
    ? (run: RunWindow) => runs.adapter.conversation?.(run) ?? Promise.resolve(undefined)
    : undefined
  void advanceIntent(intent.task, {
    runs: () => latest.current,
    start: (request) => runs.start(request),
    stop: (run) => runs.control(run.id, { action: "stop", generation: run.generation }),
    conversation,
    hasDraft: (run) => hasRetainedDraft(run.id),
    buildRunning: (task) => latest.current.some((run) => buildRunForTask(run, task)),
  }).then(
    (outcome) => {
      if (outcome === "busy" && tried.current.get(intent.task) === key)
        tried.current.delete(intent.task)
      if (outcome === "stopped")
        toast.info("The planning session stopped before it could build here. Choose how to build.")
    },
    (cause) =>
      toast.error(
        `The build could not continue in the planning session: ${cause instanceof Error ? cause.message : String(cause)}. The approval stays; choose where to build.`,
      ),
  )
}

function pruneTriedIntents(tried: Map<string, string>, intents: readonly BuildHereIntent[]): void {
  for (const task of [...tried.keys()]) {
    if (!intents.some((intent) => intent.task === task)) tried.delete(task)
  }
}

export function BuildHereContinuation() {
  const runs = useOptionalRuns()
  // Every change and every finished attempt re-renders, so a boundary that arrived while another
  // attempt ran is evaluated again; an unchanged planner is not tried twice.
  const version = useSyncExternalStore(subscribeIntents, intentsVersion, intentsVersion)
  const latest = useRef(runs?.runs ?? [])
  latest.current = runs?.runs ?? []
  const tried = useRef(new Map<string, string>())
  useEffect(() => {
    void version
    if (runs === null || !runs.loaded) return
    const intents = allIntents()
    for (const intent of intents) {
      const planner = intentPlanner(intent, runs.runs)
      const key = intentBoundaryKey(planner ?? undefined, intent.releasing)
      if (tried.current.get(intent.task) === key) continue
      // Marked only for an attempt that ran: a busy one leaves the boundary to be evaluated again.
      tried.current.set(intent.task, key)
      advanceTaskIntent(intent, key, runs, latest, tried)
    }
    pruneTriedIntents(tried.current, intents)
  }, [runs, version])
  return null
}
