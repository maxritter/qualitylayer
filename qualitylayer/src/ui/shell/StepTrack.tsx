// The task's three steps, Plan, Implement and Verify: each step's ring (StepMark.tsx StepRing; Max,
// 11 November 2026, D · Progress ring) and its name. In the task header (App Model:
// steps-in-header.html) the track stands right after the title: three rings with their names on one
// line, joined by a short rule, the step in view on a quiet ground. It never moves; when the header is
// short of room the names of the other steps give way to their rings first. The shell's one-row bar
// keeps the strip under it instead: the rings above their names, joined by a rail that darkens behind
// finished steps.

import { CodeXmlIcon, NetworkIcon, ShieldCheckIcon } from "lucide-react"
import { type KeyboardEvent, useLayoutEffect, useRef } from "react"
import type { FlowStepId } from "../../core/flow.ts"
import type { StageTab } from "../model.ts"
import { StepRing } from "../sidebar/StepMark.tsx"
import { ApprovesIcon } from "./approves.tsx"
import "./step-track.css"

const STEP_ICON = {
  plan: NetworkIcon,
  implement: CodeXmlIcon,
  verify: ShieldCheckIcon,
} satisfies Record<FlowStepId, typeof NetworkIcon>

/** The step's icon, for a step page's title and its read-only shared host (the track draws rings). */
export function StepGlyph({ step, className }: { step: FlowStepId; className?: string }) {
  const Icon = STEP_ICON[step]
  return <Icon className={className} aria-hidden="true" />
}

const TONE_WHO: Record<string, string> = {
  you: "you",
  live: "agent",
  done: "done",
  bad: "stop",
}

const TONE_FILL: Record<string, number> = {
  done: 1,
  todo: 0,
}

function nextFocusIndex(key: string, current: number, total: number) {
  if (key === "Home") return 0
  if (key === "End") return total - 1
  const delta = key === "ArrowRight" ? 1 : -1
  return (current + delta + total) % total
}

function handleStepTrackKeyDown(event: KeyboardEvent<HTMLElement>, nav: HTMLElement | null) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  const buttons = [...(nav?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (current < 0 || buttons.length === 0) return
  const next = nextFocusIndex(event.key, current, buttons.length)
  event.preventDefault()
  buttons[next]?.focus()
  buttons[next]?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
}

function scrollCurrentStepIntoView(nav: HTMLElement | null) {
  const current = nav?.querySelector<HTMLElement>('[aria-current="step"]')
  if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return
  const box = nav.getBoundingClientRect()
  const at = current.getBoundingClientRect()
  if (at.left >= box.left && at.right <= box.right) return
  nav.scrollLeft += at.left - box.left - (box.width - at.width) / 2
}

function StepTabButton({
  tab,
  step,
  approves,
  progress,
  look,
  onOpen,
}: {
  tab: StageTab
  step: FlowStepId | null
  approves: boolean
  progress: boolean
  look: "header" | "strip"
  onOpen: (key: string) => void
}) {
  // A step's own ring: empty before it is reached, half filled while it runs, checked once done.
  const fill = TONE_FILL[tab.tone] ?? 0.5
  const note =
    tab.note !== undefined ? (
      <small className="ir-step-note">{tab.note}</small>
    ) : progress && tab.state !== "" ? (
      <small className="ir-step-state">{tab.state}</small>
    ) : null
  return (
    <button
      type="button"
      className="q-tab"
      data-tone={tab.tone}
      data-step={tab.step}
      aria-current={tab.step === step ? "step" : undefined}
      title={[tab.title, progress ? tab.state : null].filter(Boolean).join(" · ")}
      onClick={() => onOpen(tab.key)}
    >
      <span
        className="ir-step-symbol"
        aria-hidden="true"
        data-step={tab.step}
        data-who={TONE_WHO[tab.tone] ?? "todo"}
      >
        <StepRing fill={fill} size={look === "header" ? 14 : 16} />
      </span>
      <span className="ir-track-label">
        {tab.label}
        {note}
      </span>
      {approves ? <ApprovesIcon step={tab.step} /> : null}
    </button>
  )
}

export function StepTrack({
  tabs,
  step,
  onOpen,
  approves = false,
  progress = false,
  starting = false,
  look = "strip",
}: {
  tabs: StageTab[]
  /** The step in view. */
  step: FlowStepId | null
  onOpen: (key: string) => void
  /** Mark the approval steps with a person; only a task does. */
  approves?: boolean
  /** Say each step's progress beside its name ("6/11"): a teammate's header has no gate row to say it. */
  progress?: boolean
  /** The Plan is approved and the build waits to be started: the handoff after Plan turns amber. */
  starting?: boolean
  /** In the task header after the title, or the strip under the shell's one-row bar. */
  look?: "header" | "strip"
}) {
  // A row narrower than its steps scrolls sideways: the step in view is brought into it, so the
  // person sees where they are (Verify on a phone sits past the right edge otherwise).
  const row = useRef<HTMLElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step or a new set of steps moves the current one
  useLayoutEffect(() => scrollCurrentStepIntoView(row.current), [step, tabs.length])
  // An earlier task has no steps to draw.
  if (tabs.length === 0) return null
  return (
    <nav
      ref={row}
      className="ir-inline-steps"
      aria-label="The task’s steps"
      data-look={look}
      data-steps={tabs.length}
      data-waiting={starting}
      onKeyDown={(event) => handleStepTrackKeyDown(event, row.current)}
    >
      {tabs.map((tab) => (
        <StepTabButton
          key={tab.key}
          tab={tab}
          step={step}
          approves={approves}
          progress={progress}
          look={look}
          onOpen={onOpen}
        />
      ))}
    </nav>
  )
}
