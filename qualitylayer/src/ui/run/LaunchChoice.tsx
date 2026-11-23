import { AppWindowIcon, SquareTerminalIcon } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react"
import { Disclosure } from "../kit/Fold.tsx"
import { DEFAULT_NOTE } from "../ModelPick.tsx"
import "./launch-choice.css"

export type LaunchDestination = "app" | "existing" | "terminal"

const DESTINATIONS = [
  {
    value: "app" as const,
    label: "In the App",
    title: "Recommended: run the agent beside your task.",
  },
  {
    value: "terminal" as const,
    label: "In my own agent",
    title: "Your terminal, IDE or agent app: Claude Code, Codex, T3 Code, Orca…",
  },
]

function LaunchDestinationsFieldset({
  id,
  value,
  disabled,
  terminalOnly,
  onChange,
}: {
  id: string
  value: LaunchDestination
  disabled: boolean
  terminalOnly: boolean
  onChange: (value: LaunchDestination) => void
}) {
  return (
    <fieldset className="q-launch-destinations" disabled={disabled}>
      <legend>Where agents run</legend>
      <div>
        {DESTINATIONS.map((item) => {
          const isApp = item.value === "app"
          return (
            <label key={item.value} title={item.title}>
              <input
                type="radio"
                name={id}
                value={item.value}
                checked={value === item.value || (isApp && value === "existing")}
                disabled={terminalOnly && isApp}
                onChange={() => onChange(item.value)}
              />
              {item.label}
              {isApp && !terminalOnly ? (
                <small className="q-launch-default" aria-hidden="true">
                  {DEFAULT_NOTE}
                </small>
              ) : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function LaunchSettingsPanel({
  panelId,
  panelLabel,
  children,
}: {
  panelId?: string
  panelLabel?: string
  children: ReactNode
}) {
  if (!panelId) return <div className="q-launch-settings">{children}</div>
  return (
    <div className="q-launch-settings" id={panelId} role="tabpanel" aria-labelledby={panelLabel}>
      {children}
    </div>
  )
}

function LaunchSettingsBody({
  id,
  value,
  summary,
  options,
  open,
  canConfigure,
  disabled,
  onOpen,
}: {
  id: string
  value: LaunchDestination
  summary?: ReactNode
  options?: ReactNode
  open: boolean
  canConfigure: boolean
  disabled: boolean
  onOpen?: (open: boolean) => void
}) {
  if (value === "existing") return null
  return (
    <>
      {summary ? (
        <div className="q-launch-defaults">
          <span>{summary}</span>
          {options && onOpen ? (
            <button
              type="button"
              className="q-link"
              aria-expanded={open}
              aria-controls={`${id}-options`}
              disabled={!canConfigure || disabled}
              onClick={() => onOpen(!open)}
            >
              Options
            </button>
          ) : null}
        </div>
      ) : null}
      {open && canConfigure ? (
        <div id={`${id}-options`} className="q-launch-options">
          {options}
        </div>
      ) : null}
    </>
  )
}

export function LaunchChoice({
  value,
  onChange,
  supported,
  existing = false,
  terminalOnly = false,
  disabled = false,
  agent,
  summary,
  options,
  open = false,
  onOpen,
  canConfigure = true,
  panelId,
  panelLabel,
}: {
  value: LaunchDestination
  onChange: (value: LaunchDestination) => void
  supported: boolean
  existing?: boolean
  terminalOnly?: boolean
  disabled?: boolean
  agent?: ReactNode
  summary?: ReactNode
  options?: ReactNode
  open?: boolean
  onOpen?: (open: boolean) => void
  canConfigure?: boolean
  panelId?: string
  panelLabel?: string
}) {
  const id = useId()
  const showExisting = supported && existing && !terminalOnly && value !== "terminal"
  const settings = (
    <LaunchSettingsBody
      id={id}
      value={value}
      summary={summary}
      options={options}
      open={open}
      canConfigure={canConfigure}
      disabled={disabled}
      onOpen={onOpen}
    />
  )
  return (
    <div className="q-launch-choice" data-testid="launch-choice">
      {agent}
      {supported ? (
        <LaunchDestinationsFieldset
          id={id}
          value={value}
          disabled={disabled}
          terminalOnly={terminalOnly}
          onChange={onChange}
        />
      ) : null}
      {terminalOnly ? (
        <p className="q-lands-note">Use your own agent: your terminal, IDE or agent app.</p>
      ) : null}
      {showExisting ? (
        <Disclosure
          className="q-launch-existing"
          open={value === "existing" || undefined}
          head="Continue an existing App session"
        >
          <label>
            <input
              type="checkbox"
              checked={value === "existing"}
              disabled={disabled}
              onChange={(event) => onChange(event.target.checked ? "existing" : "app")}
            />
            Use its conversation and settings
          </label>
          <p className="q-lands-note">
            Your unsent input stays untouched. Copy and send the command when the session is ready.
          </p>
        </Disclosure>
      ) : null}
      <LaunchSettingsPanel panelId={panelId} panelLabel={panelLabel}>
        {settings}
      </LaunchSettingsPanel>
    </div>
  )
}

const WHERE_CARDS = [
  {
    value: "app",
    title: "In the App",
    icon: AppWindowIcon,
    tag: DEFAULT_NOTE,
    line: "The agent runs beside your task. Questions and feedback happen here.",
  },
  {
    value: "terminal",
    title: "In my own agent",
    icon: SquareTerminalIcon,
    tag: undefined,
    line: "Your terminal, IDE or agent app: Claude Code, Codex, T3 Code, Orca… Questions and feedback happen there.",
  },
] as const

const ARROW_STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

function LaunchWhereCard({
  card,
  id,
  on,
  unavailable,
  reason,
  quiet,
  line,
  inputRef,
  onSelect,
  onKeyDown,
}: {
  card: (typeof WHERE_CARDS)[number]
  id: string
  on: boolean
  unavailable: boolean
  reason: boolean
  quiet: boolean
  line: string
  inputRef: (node: HTMLInputElement | null) => void
  onSelect: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  const hideLine = quiet && !reason
  return (
    <label
      className="q-launch-where-card"
      data-on={on || undefined}
      data-off={unavailable || undefined}
      data-quiet={hideLine ? "true" : undefined}
      title={quiet ? line : undefined}
    >
      <input
        ref={inputRef}
        type="radio"
        name={id}
        value={card.value}
        checked={on}
        disabled={unavailable}
        tabIndex={on ? 0 : -1}
        aria-labelledby={`${id}-${card.value}-title`}
        aria-describedby={`${id}-${card.value}-line`}
        onChange={onSelect}
        onKeyDown={onKeyDown}
      />
      <span className="q-launch-where-dot" aria-hidden="true" />
      <span className="q-launch-where-text">
        <b>
          <card.icon className="q-launch-where-ic" size={14} aria-hidden="true" />
          <span id={`${id}-${card.value}-title`}>{card.title}</span>
          {card.tag !== undefined && !reason ? (
            <small className="q-launch-default">{card.tag}</small>
          ) : null}
        </b>
        <small id={`${id}-${card.value}-line`} className={hideLine ? "sr-only" : undefined}>
          {line}
        </small>
      </span>
    </label>
  )
}

/**
 * Where the agent runs, as two cards. In the App a native agent works beside the task and every
 * question and comment happens in the App; outside, any coding agent gets one prompt and asks where it
 * runs. When the App cannot run agents (`appOff` is the reason) the first card is off and says why.
 * Arrow keys move between the cards, as in any radio group.
 */
export function LaunchWhere({
  value,
  onChange,
  appOff = null,
  disabled = false,
  scope = "Launch",
  descriptions,
  quiet = false,
}: {
  value: "app" | "terminal"
  onChange: (value: "app" | "terminal") => void
  /** Why the App cannot run agents here, or null. */
  appOff?: string | null
  disabled?: boolean
  scope?: string
  descriptions?: Partial<Record<"app" | "terminal", string>>
  /** The card is titled by its words alone; its sentence is the tooltip and the accessible description. */
  quiet?: boolean
}) {
  const id = useId()
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const off = (at: number) => disabled || (WHERE_CARDS[at]?.value === "app" && appOff !== null)
  const move = (event: KeyboardEvent<HTMLInputElement>, at: number) => {
    const step = ARROW_STEPS[event.key] ?? 0
    if (step === 0) return
    event.preventDefault()
    const to = (at + step + WHERE_CARDS.length) % WHERE_CARDS.length
    const next = WHERE_CARDS[to]
    if (!next || off(to)) return
    onChange(next.value)
    refs.current[to]?.focus()
  }
  return (
    <div className="q-launch-where" role="radiogroup" aria-label={`${scope}: where the agent runs`}>
      {WHERE_CARDS.map((card, at) => {
        const reason = card.value === "app" && appOff !== null
        const line = reason ? appOff : (descriptions?.[card.value] ?? card.line)
        return (
          <LaunchWhereCard
            key={card.value}
            card={card}
            id={id}
            on={value === card.value}
            unavailable={off(at)}
            reason={reason}
            quiet={quiet}
            line={line}
            inputRef={(node) => {
              refs.current[at] = node
            }}
            onSelect={() => onChange(card.value)}
            onKeyDown={(event) => move(event, at)}
          />
        )
      })}
    </div>
  )
}
