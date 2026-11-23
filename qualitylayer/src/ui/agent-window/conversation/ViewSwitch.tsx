// The two ways to draw an agent's window, in the tab row beside the session menu: Conversation reads the
// session as messages and tool calls, Terminal is the agent's own window. Only the drawing changes.
import { BotMessageSquareIcon, SquareTerminalIcon } from "lucide-react"
import { useRef } from "react"
import type { AgentView } from "../../../core/config-values.ts"
import {
  moveSidebarTab,
  optionTabId,
  optionTitle,
  useCompactSwitch,
} from "./view-switch-helpers.ts"

const OPTIONS = [
  { id: "conversation", label: "Conversation", Icon: BotMessageSquareIcon },
  { id: "terminal", label: "Terminal", Icon: SquareTerminalIcon },
] as const

function arrowStep(key: string): number {
  if (key === "ArrowRight" || key === "ArrowDown") return 1
  if (key === "ArrowLeft" || key === "ArrowUp") return -1
  return 0
}

type OptionButtonProps = {
  option: (typeof OPTIONS)[number]
  value: AgentView
  active: boolean
  tabs: boolean
  compact: boolean
  tabId: string
  plainShell: boolean
  conversationAvailable: boolean
  terminalAvailable: boolean
  buttonRef: (node: HTMLButtonElement | null) => void
  onSelect: (id: AgentView) => void
  onArrowKey: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}

function ViewOptionButton(props: OptionButtonProps) {
  const { option, value, active, tabs, compact, tabId, plainShell } = props
  const { id, label, Icon } = option
  const shellOff = plainShell && (id === "conversation" || active)
  const unavailable =
    id === "conversation" ? !props.conversationAvailable : !props.terminalAvailable
  const off = shellOff || unavailable
  const selected = active && value === id
  const roleProps = tabs
    ? { role: "tab" as const, "aria-selected": selected }
    : { role: "radio" as const, "aria-checked": value === id }
  return (
    <button
      ref={props.buttonRef}
      type="button"
      {...roleProps}
      id={optionTabId(tabs, id, tabId)}
      aria-controls={tabs ? "terminal-right-panel" : undefined}
      aria-disabled={off || undefined}
      aria-label={tabs || compact ? label : undefined}
      title={optionTitle({ id, label, off, shellOff, tabs, compact })}
      tabIndex={selected ? 0 : -1}
      className={selected ? "on" : undefined}
      onKeyDown={props.onArrowKey}
      onClick={() => {
        if (!off) props.onSelect(id)
      }}
    >
      <Icon size={13} aria-hidden="true" />
      {compact ? null : <span className={tabs ? "rs-tab-label" : undefined}>{label}</span>}
    </button>
  )
}

export function ViewSwitch({
  value,
  onChange,
  conversationAvailable,
  terminalAvailable = true,
  plainShell = false,
  tabs = false,
  active = true,
  tabId = "rs-tab-terminal",
}: {
  value: AgentView
  onChange(next: AgentView): void
  /** Another agent has only the terminal. */
  conversationAvailable: boolean
  terminalAvailable?: boolean
  /** A plain terminal shows: the switch only redraws the agent, so both views are off while it does. */
  plainShell?: boolean
  tabs?: boolean
  active?: boolean
  tabId?: string
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const host = useRef<HTMLSpanElement>(null)
  const compact = useCompactSwitch(host, tabs)
  const move = (event: React.KeyboardEvent, from: number) => {
    const step = arrowStep(event.key)
    if (step === 0) return
    event.preventDefault()
    // Two options, so an arrow goes to the other one, unless that is the unavailable Conversation.
    const to = (from + step + OPTIONS.length) % OPTIONS.length
    const next = OPTIONS[to]
    if (!next || (next.id === "conversation" && !conversationAvailable)) return
    onChange(next.id)
    buttons.current[to]?.focus()
  }
  return (
    <span
      ref={host}
      className={tabs ? "rs-agent-view-tabs" : "cv-switch"}
      {...(tabs ? {} : { role: "radiogroup", "aria-label": "Show the agent as" })}
    >
      {OPTIONS.map((option, index) => (
        <ViewOptionButton
          key={option.id}
          option={option}
          value={value}
          active={active}
          tabs={tabs}
          compact={compact}
          tabId={tabId}
          plainShell={plainShell}
          conversationAvailable={conversationAvailable}
          terminalAvailable={terminalAvailable}
          buttonRef={(node) => {
            buttons.current[index] = node
          }}
          onSelect={onChange}
          onArrowKey={(event) => {
            if (tabs) moveSidebarTab(event)
            else move(event, index)
          }}
        />
      ))}
    </span>
  )
}
