import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ConversationSnapshot, ConversationWorker } from "../../../core/conversation/types.ts"
import { useNow } from "../../hooks.ts"
import type { RunWindow } from "../../run-context.tsx"
import { ChildFooter, ChildLogBody, ChildNav } from "./ChildConversationParts.tsx"
import { buildBlocks, type Loaded } from "./model.ts"
import { type Pulse, useConversation } from "./useConversation.ts"
import { WorkerTray, workerElapsed } from "./WorkerTray.tsx"

export { WorkerTray, workerElapsed }

/** No input callback exists here: every message must go to the main agent. */
/** Keys belong to the usage popover or to a dialog above the conversation (the command box), not to this panel. */
const yieldsKey = (event: KeyboardEvent): boolean =>
  document.querySelector(".cv-usage[data-open]") !== null ||
  (event.target instanceof Element && event.target.closest('[data-slot="dialog-content"]') !== null)

function trapDialogTab(event: KeyboardEvent, host: HTMLElement | null): void {
  const controls = [...(host?.querySelectorAll<HTMLElement>("button,[tabindex='0']") ?? [])].filter(
    (node) => !node.hasAttribute("disabled") && node.getClientRects().length,
  )
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

function useChildKeys(
  host: RefObject<HTMLElement | null>,
  full: boolean,
  toggleFull: () => void,
  onBack: (message: boolean) => void,
) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (yieldsKey(event)) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        if (full) toggleFull()
        else onBack(false)
      }
      if (full && event.key === "Tab") trapDialogTab(event, host.current)
    }
    document.addEventListener("keydown", key, true)
    return () => document.removeEventListener("keydown", key, true)
  }, [full, host, onBack, toggleFull])
}

function childStateWord(
  unavailableRecord: boolean,
  working: boolean,
  loaded: Loaded | undefined,
): string {
  if (unavailableRecord) return "Unavailable"
  if (working) return "Working"
  if (!loaded) return "Connecting"
  return loaded.state === "idle" ? "Idle" : "Status unavailable"
}

export function ChildConversation({
  worker,
  run,
  on,
  output,
  load,
  running,
  mainWaiting,
  mainWorking,
  onBack,
}: {
  worker: ConversationWorker
  run: RunWindow
  on: boolean
  output?: Pulse
  load?: (after?: string) => Promise<ConversationSnapshot | undefined>
  running: boolean
  mainWaiting: boolean
  mainWorking: boolean
  onBack(message: boolean): void
}) {
  const { loaded, unavailable, failing } = useConversation(load, on, output)
  const working = on && (running || loaded?.state === "working") && run.status === "running"
  const now = useNow(working)
  const elapsed = workerElapsed(worker, working ? now : Date.parse(worker.updatedAt ?? ""))
  const [full, setFull] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLElement>(null)
  const scroll = useRef(0)
  const trigger = useRef<HTMLElement | null>(null)
  const events = loaded?.events ?? []
  const unsupported = events.some((event) => event.kind === "unknown")
  const blocks = useMemo(
    () =>
      buildBlocks(
        events.filter((event) => event.kind !== "unknown"),
        working,
      ),
    [events, working],
  )
  const toggleFull = useCallback(() => {
    scroll.current = log.current?.scrollTop ?? 0
    setFull((value) => !value)
  }, [])
  useEffect(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => trigger.current?.focus({ preventScroll: true })
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: moving the panel into a portal remounts its log, so restore the position on each fullscreen change
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (log.current) log.current.scrollTop = scroll.current
      host.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [full])
  useChildKeys(host, full, toggleFull, onBack)
  const unavailableRecord = unavailable || !load
  const stateWord = childStateWord(unavailableRecord, working, loaded)
  const content = (
    <section
      className="cv-child-panel"
      ref={host}
      aria-label={`${worker.name} subagent conversation`}
    >
      <ChildNav
        runRunning={run.status === "running"}
        mainWaiting={mainWaiting}
        mainWorking={mainWorking}
        full={full}
        onBack={() => onBack(false)}
        onToggleFull={toggleFull}
      />
      <div className="cv-child-task">
        <b>{worker.name}</b>
        {worker.task ? <p>{worker.task}</p> : null}
      </div>
      <div
        className="cv-log"
        ref={log}
        role="log"
        aria-label={`${worker.name} conversation`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users scroll the read-only child transcript
        tabIndex={0}
      >
        <ChildLogBody
          workerName={worker.name}
          unavailableRecord={unavailableRecord}
          loaded={loaded}
          failing={failing}
          unsupported={unsupported}
          blocks={blocks}
          working={working}
          cwd={run.cwd}
          onBack={() => onBack(false)}
        />
      </div>
      <ChildFooter
        worker={worker}
        run={run}
        loaded={loaded}
        working={working}
        stateWord={stateWord}
        elapsed={elapsed}
        full={full}
        onMessageMain={() => onBack(true)}
      />
    </section>
  )
  return full
    ? createPortal(
        <div
          className="cv-child-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${worker.name} conversation, full screen`}
        >
          {content}
        </div>,
        document.body,
      )
    : content
}
