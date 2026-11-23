import { TerminalIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { TerminalContext } from "../../core/run/contracts.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { runColors } from "../runs-api.ts"
import "./open-terminal.css"

type AttemptRef = { current: { identity: string; key: string } | null }

async function launchTerminalSession({
  runs,
  context,
  attempt,
  mounted,
  onStarted,
}: {
  runs: NonNullable<ReturnType<typeof useOptionalRuns>>
  context: () => Promise<TerminalContext>
  attempt: AttemptRef
  mounted: { current: boolean }
  onStarted?: () => void
}) {
  const scope = await context()
  if (!mounted.current) return
  const identity = JSON.stringify(scope)
  if (attempt.current?.identity !== identity) {
    attempt.current = { identity, key: crypto.randomUUID() }
  }
  const run = await runs.start({
    agent: "other",
    purpose: { kind: "terminal", shell: true, context: scope },
    idempotencyKey: attempt.current.key,
    colors: runColors(),
  })
  if (mounted.current) {
    runs.select(run.id)
    onStarted?.()
  }
}

function useOpenTerminalLauncher({
  runs,
  available,
  disabled,
  context,
  onStarted,
}: {
  runs: ReturnType<typeof useOptionalRuns>
  available: boolean
  disabled: boolean
  context: () => Promise<TerminalContext>
  onStarted?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const starting = useRef(false)
  const attempt = useRef<{ identity: string; key: string } | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const open = useCallback(async () => {
    if (!runs || !available || disabled || starting.current) return
    starting.current = true
    setBusy(true)
    setProblem(undefined)
    try {
      await launchTerminalSession({ runs, context, attempt, mounted, onStarted })
    } catch (cause) {
      if (mounted.current) {
        setProblem(
          cause instanceof Error ? cause.message : "The terminal could not open. Try again.",
        )
      }
    } finally {
      starting.current = false
      if (mounted.current) setBusy(false)
    }
  }, [runs, available, disabled, context, onStarted])
  return { busy, problem, open }
}

export function OpenTerminal({
  context,
  disabled = false,
  onStarted,
  autoStart = false,
}: {
  context: () => Promise<TerminalContext>
  disabled?: boolean
  onStarted?: () => void
  autoStart?: boolean
}) {
  const runs = useOptionalRuns()
  const available = runs?.support?.supported === true && runs.support.canStart === true
  const { busy, problem, open } = useOpenTerminalLauncher({
    runs,
    available,
    disabled,
    context,
    onStarted,
  })
  const attempted = useRef(false)
  useEffect(() => {
    if (autoStart && available && !attempted.current) {
      attempted.current = true
      void open()
    }
  }, [autoStart, available, open])
  return (
    <div className="q-open-terminal">
      {!autoStart || problem ? (
        <button
          type="button"
          className="q-btn"
          disabled={!available || disabled || busy}
          onClick={() => void open()}
        >
          <TerminalIcon size={14} aria-hidden="true" />
          {busy ? "Opening…" : "Open terminal"}
        </button>
      ) : (
        <p role="status">{busy ? "Opening terminal…" : "Project terminal"}</p>
      )}
      <p className="q-lands-note">Start any agent yourself in the project shell.</p>
      {!available ? (
        <p className="q-lands-note">
          {runs?.support?.reason ?? "Open from the App or a browser it opened to start a terminal."}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="q-run-error">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
