import { SquareIcon, TerminalIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { AGENT_NAMES } from "../../core/agents/ids.ts"
import type { ViewerState } from "../../core/run/protocol.ts"
import { type TerminalControlSender, terminalTheme } from "../agent-window/view.ts"
import type { RunAdapter, RunWindow } from "../run-context.tsx"
import { setupContextOf, setupRunning } from "./useMachineSetup.ts"

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
  const record = useRef(run)
  record.current = run
  const { id, generation } = run
  const [error, setError] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState>()
  const control = useRef<TerminalControlSender | undefined>(undefined)
  const [stopping, setStopping] = useState(false)
  const context = setupContextOf(run)
  useEffect(() => {
    if (!root.current) return
    let current = true
    let mounted = false
    let canType = false
    let focused = false
    setError(null)
    setViewer(undefined)
    const focus = () => {
      if (!current || !mounted || !canType || focused) return
      focused = true
      if (window.innerWidth <= 1100) frame.current?.scrollIntoView({ block: "nearest" })
      view.focus()
    }
    const attached = record.current
    const view = adapter.attach(attached, {
      url: `/api/agent-runs/${encodeURIComponent(id)}/attach`,
      generation,
      watching: false,
      resume: attached.resumeLine,
      phone: window.innerWidth <= 600,
      theme: terminalTheme(root.current),
      onViewer: (state) => {
        if (!current) return
        canType = state.canType
        setViewer(state)
        focus()
      },
      onControl: (sender) => {
        if (current) control.current = sender
      },
    })
    const colors = new MutationObserver(() => {
      if (root.current) view.setTheme(terminalTheme(root.current))
    })
    colors.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })
    const resize = () => view.setPhone?.(window.innerWidth <= 600)
    window.addEventListener("resize", resize)
    void view.mount(root.current).then(
      () => {
        if (!current) return
        mounted = true
        focus()
      },
      (cause) => {
        if (current)
          setError(cause instanceof Error ? cause.message : "The terminal could not open.")
      },
    )
    return () => {
      current = false
      control.current = undefined
      window.removeEventListener("resize", resize)
      colors.disconnect()
      view.dispose()
    }
  }, [adapter, id, generation])
  if (!context) return null
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
      {viewer && !viewer.canType && setupRunning(run) ? (
        <p role="status">
          Watching this terminal.{" "}
          {viewer.canTakeControl ? (
            <button
              type="button"
              className="q-link"
              onClick={() => {
                if (!control.current?.("take-control"))
                  setError("The terminal is not connected. Open it again to take control.")
              }}
            >
              Type here instead
            </button>
          ) : (
            "Type from its controlling window."
          )}
        </p>
      ) : null}
      <div ref={root} className="q-machine-terminal-view" />
      {error ? <p role="alert">{error}</p> : null}
      <footer>
        {setupRunning(run) ? (
          <button
            type="button"
            className="q-btn sm"
            disabled={stopping || !viewer?.canStop}
            onClick={() => void stop()}
          >
            <SquareIcon className="size-3" />
            {stopping
              ? "Stopping…"
              : context.operation === "sign-in"
                ? "Cancel sign-in"
                : "Stop install"}
          </button>
        ) : (
          <span>{run.error ?? "Operation ended"}</span>
        )}
      </footer>
    </aside>
  )
}
