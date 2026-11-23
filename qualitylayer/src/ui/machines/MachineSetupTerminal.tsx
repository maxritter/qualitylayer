import { SquareIcon, TerminalIcon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
import { AGENT_NAMES } from "../../core/agents/ids.ts"
import type { RunAdapter, RunWindow } from "../run-context.tsx"
import { setupContextOf, setupRunning } from "./useMachineSetup.ts"
import { useSetupTerminalAttach } from "./useSetupTerminalAttach.ts"

function SetupTerminalWatchNotice({
  viewer,
  running,
  onTakeControl,
}: {
  viewer: ReturnType<typeof useSetupTerminalAttach>["viewer"]
  running: boolean
  onTakeControl: () => void
}) {
  if (!viewer || viewer.canType || !running) return null
  return (
    <p role="status">
      Watching this terminal.{" "}
      {viewer.canTakeControl ? (
        <button type="button" className="q-link" onClick={onTakeControl}>
          Type here instead
        </button>
      ) : (
        "Type from its controlling window."
      )}
    </p>
  )
}

function SetupTerminalFooter({
  running,
  stopping,
  canStop,
  operation,
  error,
  onStop,
}: {
  running: boolean
  stopping: boolean
  canStop: boolean
  operation: "install" | "sign-in"
  error: string | undefined
  onStop: () => void
}) {
  if (!running) {
    return (
      <footer>
        <span>{error ?? "Operation ended"}</span>
      </footer>
    )
  }
  const stopLabel = stopping
    ? "Stopping…"
    : operation === "sign-in"
      ? "Cancel sign-in"
      : "Stop install"
  return (
    <footer>
      <button type="button" className="q-btn sm" disabled={stopping || !canStop} onClick={onStop}>
        <SquareIcon className="size-3" />
        {stopLabel}
      </button>
    </footer>
  )
}

export function MachineSetupTerminal({
  run,
  adapter,
  machine,
  onClose,
  onStop,
}: {
  run: RunWindow
  adapter: RunAdapter
  machine: string
  onClose: () => void
  onStop: () => Promise<unknown>
}) {
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLElement>(null)
  const { error, setError, viewer, control } = useSetupTerminalAttach({
    root,
    frame,
    run,
    adapter,
  })
  const [stopping, setStopping] = useState(false)
  const context = setupContextOf(run)
  if (!context) return null
  const running = setupRunning(run)
  const stop = async () => {
    setStopping(true)
    try {
      await onStop()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The operation could not stop.")
    } finally {
      setStopping(false)
    }
  }
  return (
    <aside
      ref={frame}
      className="q-machine-terminal"
      aria-label={`${AGENT_NAMES[context.agent]} setup on ${machine}`}
      data-testid="machine-setup-terminal"
    >
      <header>
        <TerminalIcon className="size-3.5" />
        <b>{machine}</b>
        <span>
          {context.operation === "install"
            ? "Official installer"
            : `${AGENT_NAMES[context.agent]} sign-in`}
        </span>
        <button
          type="button"
          className="q-ibtn"
          aria-label="Close setup terminal"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </button>
      </header>
      <SetupTerminalWatchNotice
        viewer={viewer}
        running={running}
        onTakeControl={() => {
          if (!control.current?.("take-control")) {
            setError("The terminal is not connected. Open it again to take control.")
          }
        }}
      />
      <div ref={root} className="q-machine-terminal-view" />
      {error ? <p role="alert">{error}</p> : null}
      <SetupTerminalFooter
        running={running}
        stopping={stopping}
        canStop={Boolean(viewer?.canStop)}
        operation={context.operation}
        error={run.error}
        onStop={() => void stop()}
      />
    </aside>
  )
}
