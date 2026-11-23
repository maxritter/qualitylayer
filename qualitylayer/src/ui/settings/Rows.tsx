// The pieces every Settings tab is built from: a group with its header bar, rows of a label with its
// one-line why on the left and the control on the right, a fold for the rarer rows, and a segmented
// choice. One column, so nothing depends on cards of equal height (App Model, Settings › Workflow).

import { ChevronRightIcon } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react"
import type { StepAgent } from "../../core/agents/model-values.ts"
import { DEFAULT_NOTE, ModelPick, type PickOption } from "../ModelPick.tsx"

/** A picker in the quiet settings look: no "Default" label on the button, a dot when changed from it. */
export function Pick(props: {
  label: string
  value: string
  options: PickOption[]
  onChange: (id: string) => void
  onReselect?: (id: string) => void
  dim?: boolean
  disabled?: boolean
  /** The agent whose model menu also takes a typed provider/model id. */
  custom?: StepAgent
}) {
  return (
    <ModelPick
      look="setting"
      custom={props.custom}
      label={props.label}
      value={props.value}
      options={props.options}
      onChange={props.onChange}
      onReselect={props.onReselect}
      dim={props.dim ?? false}
      disabled={props.disabled ?? false}
    />
  )
}

export function SettingsGroup({
  title,
  end,
  testId,
  children,
  ...data
}: {
  /** Every group has a header: what the group is about. */
  title: ReactNode
  /** The group's status, on the right of its header: "All recommended", "3 of 5 seats". */
  end?: ReactNode
  testId?: string
  children: ReactNode
} & { [key: `data-${string}`]: string | boolean | undefined }) {
  const id = useId()
  return (
    <section className="q-sg" data-testid={testId} aria-labelledby={id} {...data}>
      <div className="q-sg-h">
        <h2 id={id}>{title}</h2>
        {end !== undefined ? <span className="q-sg-end">{end}</span> : null}
      </div>
      {children}
    </section>
  )
}

/** The one option Tab stops on: the chosen one, or the first when none is chosen. */
const tabStop = <T extends string>(options: { id: T }[], value: T | null): T | undefined =>
  (options.find((option) => option.id === value) ?? options[0])?.id

/** A meaning's icon before a label: decoration, the label beside it says the same in words. */
function Glyph({ icon, className }: { icon: ReactNode | undefined; className: string }) {
  return icon === undefined ? null : (
    <span className={className} aria-hidden="true">
      {icon}
    </span>
  )
}

export function SettingRow({
  label,
  hint,
  below,
  testId,
  children,
  stay = false,
  icon,
  waiting = false,
  title,
}: {
  label: ReactNode
  hint?: ReactNode
  /** What stands under the hint, in the label column: a list of who does what. */
  below?: ReactNode
  testId?: string
  children?: ReactNode
  /** The control stays on the right at phone width too: a switch. */
  stay?: boolean
  /** The row's meaning as a 15 px icon before its label (DESIGN.md › Icons); the hint lines up under the label. */
  icon?: ReactNode
  /** The row cannot be used yet and says why in its hint: its label reads in the muted colour. */
  waiting?: boolean
  /** The row's tooltip: a sentence the row does not need on screen (DESIGN.md › Hints). */
  title?: string
}) {
  return (
    <div
      className={["q-sr", stay ? "stay" : "", waiting ? "waiting" : ""].filter(Boolean).join(" ")}
      data-testid={testId}
      title={title}
    >
      <div className="q-sr-l">
        <span className="q-sr-n">
          <Glyph className="q-sr-i" icon={icon} />
          {label}
        </span>
        {hint !== undefined && hint !== null ? <span className="q-sr-d">{hint}</span> : null}
        {below}
      </div>
      {children !== undefined ? <div className="q-sr-c">{children}</div> : null}
    </div>
  )
}

/** The rarer rows of a group, folded under one line. */
export function SettingsMore({
  summary,
  children,
  open,
}: {
  summary: ReactNode
  children: ReactNode
  /** The fold starts open (Automations' deliveries while one is failing); the person can still close it. */
  open?: boolean
}) {
  return (
    <details className="q-sg-more" open={open}>
      <summary>
        <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        {summary}
      </summary>
      {children}
    </details>
  )
}

type ChoiceOption<T extends string> = {
  id: T
  name: string
  recommended?: boolean
  icon?: ReactNode
  disabled?: boolean
  why?: string
  /** What the option means, as its hover title. */
  hint?: string
  /** A font family to draw this option in (Settings › Appearance › Font shows each face). */
  font?: string
}

const CHOICE_STEPS: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

function nextChoiceIndex<T extends string>(
  options: ChoiceOption<T>[],
  from: number,
  key: string,
): number | null {
  const can = (i: number) => options[i]?.disabled !== true
  if (key === "Home") return options.findIndex((_, i) => can(i))
  if (key === "End") return options.findLastIndex((_, i) => can(i))
  const step = CHOICE_STEPS[key]
  if (step === undefined) return null
  const count = options.length
  for (let n = 1; n <= count; n++) {
    const i = (((from + step * n) % count) + count) % count
    if (can(i)) return i
  }
  return null
}

function choiceTitle<T extends string>(option: ChoiceOption<T>): string | undefined {
  if (option.disabled) return option.why
  return option.hint ?? (option.recommended ? DEFAULT_NOTE : undefined)
}

/**
 * A few options of which one is on, saved at once: a radio group whose arrow keys move and pick,
 * with Tab stopping on the chosen one only.
 */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  harness = false,
}: {
  label: string
  /** Null: nothing is chosen yet, so no option is on. */
  value: T | null
  /** A `disabled` option stays visible and is never picked; `why` is its reason for the hover title. */
  options: ChoiceOption<T>[]
  onChange: (value: T) => void
  testId?: string
  harness?: boolean
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const stop = tabStop(options, value)
  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const at = nextChoiceIndex(options, from, event.key)
    if (at === null || at < 0) return
    event.preventDefault()
    const next = options[at]
    if (next === undefined) return
    buttons.current[at]?.focus()
    onChange(next.id)
  }
  return (
    <div
      className={harness ? "q-choice q-harness-choices" : "q-choice"}
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
    >
      {options.map((option, at) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented radio group; the arrow keys pick and save at once
        <button
          key={option.id}
          ref={(node) => {
            buttons.current[at] = node
          }}
          type="button"
          role="radio"
          data-secondary={(harness && (option.id === "other" || option.id === "auto")) || undefined}
          aria-checked={value === option.id}
          aria-disabled={option.disabled || undefined}
          title={choiceTitle(option)}
          tabIndex={stop === option.id ? 0 : -1}
          style={option.font === undefined ? undefined : { fontFamily: option.font }}
          onClick={() => {
            if (option.disabled !== true) onChange(option.id)
          }}
          onKeyDown={(event) => move(event, at)}
        >
          <Glyph className="q-choice-i" icon={option.icon} />
          {option.name}
          {option.recommended ? (
            <small className="q-choice-recommended" aria-hidden="true">
              {DEFAULT_NOTE}
            </small>
          ) : null}
        </button>
      ))}
    </div>
  )
}

/** "All recommended" or "2 changed · Reset to recommended", said once at the top of a group. */
export function Recommended({ changed, onReset }: { changed: number; onReset: () => void }) {
  return changed === 0 ? (
    <span className="q-sg-rec" data-testid="all-recommended">
      All recommended
    </span>
  ) : (
    <span className="q-sg-rec" data-testid="changed-from-recommended">
      {changed} changed ·{" "}
      <button type="button" className="q-link" onClick={onReset}>
        Reset to recommended
      </button>
    </span>
  )
}
