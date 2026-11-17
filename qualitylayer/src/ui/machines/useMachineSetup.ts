import { useEffect, useMemo, useRef, useState } from "react"
import type { NativeAgent } from "../../core/agents/ids.ts"
import type { AgentSetupOperation } from "../../core/agents/setup.ts"
import type { Api } from "../api.ts"
import { type RunWindow, useOptionalRuns } from "../run-context.tsx"
import { useAgentHealth } from "../settings/AgentHealth.tsx"

export type MachineHealthApi = Pick<Api, "agentHealth" | "checkAgents" | "agentSignIns">
export const setupContextOf = (run: RunWindow) =>
  run.purpose.kind === "terminal" && run.purpose.context?.kind === "agent-setup"
    ? run.purpose.context
    : null
export const setupRunning = (run: RunWindow): boolean => !["stopped", "failed"].includes(run.status)

/** Latest operation per agent; old terminal records never keep rechecking accounts on navigation. */
export function latestSetupRuns(runs: readonly RunWindow[]): Map<NativeAgent, RunWindow> {
  const latest = new Map<NativeAgent, RunWindow>()
  for (const run of runs) {
    const context = setupContextOf(run)
    if (!context) continue
    const old = latest.get(context.agent)
    if (!old || old.startedAt < run.startedAt) latest.set(context.agent, run)
  }
  return latest
}

export function useMachineSetup(api: MachineHealthApi) {
  const runs = useOptionalRuns()
  const health = useAgentHealth(api, { checkOnMount: true })
  const latest = useMemo(() => latestSetupRuns(runs?.runs ?? []), [runs?.runs])
  const [visible, setVisible] = useState<string | null>(null)
  const [starting, setStarting] = useState<NativeAgent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const attempts = useRef(new Map<string, string>())
  const observed = useRef(new Map<NativeAgent, string>())
  const selected = runs?.runs.find((run) => run.id === visible)
  const { check } = health
  useEffect(() => {
    for (const [agent, run] of latest) {
      const key = `${run.id}:${run.generation}`
      if (setupRunning(run)) {
        observed.current.set(agent, key)
        continue
      }
      if (observed.current.get(agent) !== key) continue
      observed.current.delete(agent)
      void check(agent)
    }
  }, [latest, check])
  const start = async (agent: NativeAgent, operation: AgentSetupOperation) => {
    if (!runs?.support?.canStart || starting !== null) return
    const existing = latest.get(agent)
    if (existing && setupRunning(existing)) return setVisible(existing.id)
    const key = `${agent}:${operation}`
    let idempotencyKey = attempts.current.get(key)
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID()
      attempts.current.set(key, idempotencyKey)
    }
    setStarting(agent)
    setError(null)
    try {
      const run = await runs.start({
        agent: "other",
        purpose: {
          kind: "terminal",
          shell: true,
          context: { kind: "agent-setup", agent, operation },
        },
        works: "checkout",
        mode: "plain",
        settings: { perm: "own", answers: "terminal" },
        idempotencyKey,
      })
      if (setupRunning(run)) observed.current.set(agent, `${run.id}:${run.generation}`)
      else {
        observed.current.delete(agent)
        await check(agent)
      }
      attempts.current.delete(key)
      setVisible(run.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The setup terminal could not start.")
    } finally {
      setStarting(null)
    }
  }
  return {
    ...health,
    runs,
    latest,
    selected,
    starting,
    error: error ?? health.error ?? null,
    start,
    show: setVisible,
    hide: () => setVisible(null),
  }
}
