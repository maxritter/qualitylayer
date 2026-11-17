import { useCallback, useEffect, useRef, useState } from "react"
import type { AgentHealth } from "../../core/agents/health-types.ts"
import type { NativeAgent } from "../../core/agents/ids.ts"
import type { Api } from "../api.ts"

type HealthApi = Pick<Api, "agentHealth" | "checkAgents"> & Partial<Pick<Api, "agentSignIns">>
type HealthScope = { api: HealthApi | undefined; live: boolean; request: number }
type HealthProbe = { api: HealthApi; agent?: NativeAgent; promise: Promise<AgentHealth[]> }

export function useAgentHealth(api?: HealthApi, { checkOnMount = false } = {}) {
  const [agents, setAgents] = useState<AgentHealth[]>([])
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string>()
  const scope = useRef<HealthScope | null>(null)
  const pending = useRef<HealthProbe | null>(null)
  const check = useCallback(
    async (agent?: NativeAgent) => {
      const owner = scope.current
      const checker = api?.checkAgents
      if (!api || !checker || !owner?.live || owner.api !== api) return
      let probe = pending.current
      if (!probe || probe.api !== api || probe.agent !== agent) {
        probe = {
          api,
          agent,
          promise: Promise.resolve().then(() =>
            agent === undefined ? checker.call(api) : checker.call(api, agent),
          ),
        }
        pending.current = probe
      }
      const request = ++owner.request
      const current = () => scope.current === owner && owner.live && owner.request === request
      setChecking(true)
      setError(undefined)
      try {
        const rows = await probe.promise
        if (current()) setAgents(rows)
        // The check is done with the versions; the sign-ins it started follow, and each row says
        // "Checking sign-in…" until they land. A new check may start meanwhile.
        if (pending.current === probe) pending.current = null
        if (current()) setChecking(false)
        const settled = await api.agentSignIns?.()
        if (settled && current()) setAgents(settled)
      } catch (cause) {
        if (current())
          setError(cause instanceof Error ? cause.message : "Could not check agents. Try again.")
      } finally {
        if (pending.current === probe) pending.current = null
        if (current()) setChecking(false)
      }
    },
    [api],
  )
  useEffect(() => {
    const owner: HealthScope = { api, live: true, request: 0 }
    scope.current = owner
    setAgents([])
    setError(undefined)
    setChecking(false)
    void Promise.resolve()
      .then(() => api?.agentHealth?.())
      .then((rows) => {
        if (rows && scope.current === owner && owner.live && owner.request === 0) setAgents(rows)
      })
      .catch(() => {})
    if (checkOnMount) void check()
    return () => {
      owner.live = false
      if (scope.current === owner) scope.current = null
    }
  }, [api, checkOnMount, check])
  return { agents, checking, error, check }
}
