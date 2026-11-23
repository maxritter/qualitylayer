// The task's three steps as tabs (a person icon marks Plan and
// Verify), with state marks and counts only: the dot says who has the step (done,
// an agent at work, you), a number counts what still needs you in it. The dashed link between
// Plan and Implement is the fresh session the build starts in; it turns amber while the approved
// Plan waits for you to start the build. The row scrolls sideways in a narrow window. A step not
// reached yet still opens: its page is the one sentence of what will happen there.

import { cn } from "cn"
import { Fragment, type KeyboardEvent, type ReactNode, useRef } from "react"
import { type Item, openCount } from "../core/items.ts"
import { WhoMark } from "./kit/WhoMark.tsx"
import { type StageTab, type TabTone, viewedStep } from "./model.ts"
import { ApprovesIcon } from "./shell/approves.tsx"

const MARK: Record<TabTone, "done" | "you" | "agent" | "stop" | "todo"> = {
  done: "done",
  you: "you",
  live: "agent",
  bad: "stop",
  todo: "todo",
}

/** What a tab says of its step while it runs: progress, "fixing 1", "sent". The mark and the count say the rest. */
const SAID = /^(\d+\/\d+|fixing \d+|blocked \d+|checking|sent)$/

function showsTabState(badges: boolean, open: number, tab: StageTab): boolean {
  if (!badges || open !== 0 || tab.added !== 0) return false
  return tab.tone !== "done" && SAID.test(tab.state)
}

function StepTabButton({
  tab,
  selected,
  tabStop,
  starting,
  open,
  tone,
  badges,
  approves,
  onOpen,
}: {
  tab: StageTab
  selected: boolean
  tabStop: boolean
  starting: boolean
  open: number
  tone: TabTone
  badges: boolean
  approves: boolean
  onOpen: (key: string) => void
}) {
  return (
    <Fragment>
      {tab.step === "implement" ? (
        <div
          className={cn("q-gap", starting && "waiting")}
          data-testid="build-gap"
          data-waiting={String(starting)}
          aria-hidden="true"
        />
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        tabIndex={tabStop ? 0 : -1}
        aria-disabled={!tab.enabled || undefined}
        title={tab.title}
        data-tone={tone}
        className="q-tab"
        onClick={() => onOpen(tab.key)}
      >
        <WhoMark who={MARK[tone]} running={tone === "live"} />
        {tab.label}
        {approves ? <ApprovesIcon step={tab.step} /> : null}
        {badges && open > 0 ? (
          <span className="n" data-testid="step-count" title={`${open} need you`}>
            {open}
          </span>
        ) : null}
        {showsTabState(badges, open, tab) ? (
          <span className="t" data-testid="tab-state">
            {tab.state}
          </span>
        ) : null}
        {badges && tab.added > 0 ? (
          <span className="t" data-testid="added-badge">
            {tab.added} added
          </span>
        ) : null}
      </button>
    </Fragment>
  )
}

function moveTabFocus(row: HTMLDivElement | null, key: string): boolean {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"]
  if (!keys.includes(key)) return false
  const buttons = [...(row?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
  const here = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (here === -1 || buttons.length === 0) return false
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? buttons.length - 1
        : (here + (key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
  return true
}

export function StepTabs({
  tabs,
  items,
  needs = null,
  view,
  starting,
  onOpen,
  end,
  badges = true,
  approves = false,
}: {
  tabs: StageTab[]
  items: readonly Item[] | undefined
  /**
   * The build's needs still open, in the step they came up in: each counts as one more thing for
   * the person. The mark turns to you only once the build waits for one.
   */
  needs?: { step: string; count: number; blocking: boolean } | null
  /** The view open now: the tab of its step is the selected one. */
  view: string
  /** The Plan is approved and Implement waits to be started. */
  starting: boolean
  onOpen: (key: string) => void
  /** What closes the row, after the last tab: the switch between a step's two versions. */
  end?: ReactNode
  /** Legacy tab details; the interaction layout keeps its counts in Your turn. */
  badges?: boolean
  /** Mark the steps where the person approves (Plan, Verify) with a person; a task does. */
  approves?: boolean
}) {
  const at = viewedStep(view)
  const row = useRef<HTMLDivElement | null>(null)
  // ← and → move between the steps; Home and End go to the first and the last.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (moveTabFocus(row.current, event.key)) event.preventDefault()
  }
  // One stop in the Tab order: the step in view, or the first step.
  const stop = tabs.find((tab) => tab.step === at) ?? tabs[0]
  // An earlier task has no steps to draw.
  if (tabs.length === 0) return null
  return (
    <div className="q-tabs" data-testid="stage-tabs">
      <div
        ref={row}
        role="tablist"
        aria-label="The task's steps"
        className="flex items-end gap-1"
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => {
          const asked = items !== undefined ? openCount(items, tab.step) : 0
          const need = needs !== null && needs.step === tab.step ? needs : null
          const open = asked + (need?.count ?? 0)
          // Something waits for you in this step: the mark says so, unless the step failed. A
          // need the build goes on without keeps the agent's mark.
          const tone =
            (asked > 0 || need?.blocking === true) && tab.tone !== "bad" ? "you" : tab.tone
          return (
            <StepTabButton
              key={tab.key}
              tab={tab}
              selected={tab.step === at}
              tabStop={tab === stop}
              starting={starting}
              open={open}
              tone={tone}
              badges={badges}
              approves={approves}
              onOpen={onOpen}
            />
          )
        })}
      </div>
      {end}
    </div>
  )
}
