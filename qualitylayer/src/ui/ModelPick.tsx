// A model (or any one choice of a few) picked in place: the name on a small button, and a menu with
// a short note beside each option, groups set apart by a line, and an optional footer. On a node of
// the Implement start it is the bold `node` look; in a row of Settings or New task the quieter `row`
// look; the `pill` look is a compact pill for a bar. Every menu has one shape, as the App Model's
// select: an icon or agent mark, the name, then the note ("Default" for the one the App starts
// with) and the check on the right. A model menu of an agent that takes its own ids ends in a
// "Add a model…" entry that opens a provider/model field (`custom`).

import { Select } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react"
import { Fragment, type ReactNode, type Ref, useId, useRef, useState } from "react"
import { CutText } from "@/components/ui/cut-text"
import { OVERLAY_COLLISION } from "@/components/ui/placement"
import type { StepAgent } from "../core/agents/model-values.ts"
import { ADD_MODEL_LABEL, AddModelField } from "./AddModelField.tsx"

/** The note that marks the option the App starts with; it is the only marker of a default. */
export const DEFAULT_NOTE = "Default"

export type PickOption = {
  id: string
  name: string
  /** Exact native model ID when its display name differs. */
  technicalId?: string
  /** A short note beside the name: "Default", "costs more". */
  note?: string
  /** Set apart from the options above it by a line. */
  apart?: boolean
  /** The option's meaning as an icon before its name, in the list and on the button. */
  icon?: ReactNode
  /** What the icon says when it is a mark with a meaning of its own (a model the agent reports); read and shown on hover. */
  iconLabel?: string
  /** Listed but not offered; its note says why. */
  disabled?: boolean
  /** What the option does, a quiet second line under the name; the button shows only the name. */
  hint?: string
  /** The family it belongs to ("Claude", "GPT"): a quiet heading opens each group in the menu. */
  group?: string
}

/**
 * One option: it is named by its own words, so a note beside it ("Default") is not part of its name.
 * A hint is described by, never part of, the name: it sits outside the item text the button reads.
 */
function PickItem({ option, lead }: { option: PickOption; lead: boolean }) {
  const text = useId()
  const hint = useId()
  const name = (
    <Select.ItemText id={text} className="q-start-mi-name">
      <CutText>{option.name}</CutText>
    </Select.ItemText>
  )
  return (
    <Select.Item
      value={option.id}
      className="q-start-mi"
      title={option.technicalId}
      aria-labelledby={text}
      aria-describedby={option.hint !== undefined ? hint : undefined}
      data-hinted={option.hint !== undefined || undefined}
      disabled={option.disabled === true}
    >
      {option.icon !== undefined ? (
        <span
          className="q-start-mi-icon"
          {...(option.iconLabel !== undefined
            ? { role: "img", "aria-label": option.iconLabel, title: option.iconLabel }
            : { "aria-hidden": true })}
        >
          {option.icon}
        </span>
      ) : lead ? (
        // A menu where some rows carry a mark keeps the names of the others in line with theirs.
        <span className="q-start-mi-icon" aria-hidden="true" />
      ) : null}
      {option.hint !== undefined ? (
        <span className="q-start-mi-text">
          {name}
          <span id={hint} className="q-start-mi-hint">
            {option.hint}
          </span>
        </span>
      ) : (
        name
      )}
      <span className="q-start-mi-end">
        {option.note !== undefined ? <span className="q-start-mi-note">{option.note}</span> : null}
        <span className="q-start-mi-mark" aria-hidden="true">
          <Select.ItemIndicator>
            <CheckIcon className="size-3.5" />
          </Select.ItemIndicator>
        </span>
      </span>
    </Select.Item>
  )
}

/** The entry that opens the custom field; no model id is shaped like it, so it never stands for a model. */
const CUSTOM_ENTRY = "add a model"

/** The agent's options, then the one chosen when it is none of them, then the Add a model entry. */
function withCustom(options: PickOption[], value: string): PickOption[] {
  const chosen =
    value !== "" && !options.some((o) => o.id === value) ? [{ id: value, name: value }] : []
  return [
    ...options,
    ...chosen,
    {
      id: CUSTOM_ENTRY,
      name: ADD_MODEL_LABEL,
      icon: <PlusIcon className="size-3.5" />,
      apart: true,
    },
  ]
}

const TRIGGER_CLASS = {
  node: "q-start-pick",
  row: "q-dpick",
  setting: "q-dpick",
  pill: "q-dpick q-pick-pill",
} as const

type PickProps = {
  /** The accessible name: "Orchestrator model". */
  label: string
  value: string
  options: PickOption[]
  onChange: (id: string) => void
  /** An explicit pick of the current value, when that choice carries separate intent. */
  onReselect?: (id: string) => void
  footer?: ReactNode
  /** Drawn quieter: the value is an absence, as No subagents is. */
  dim?: boolean
  /** setting: quiet, a dot when not the default; pill: a compact pill for a bar. */
  look?: keyof typeof TRIGGER_CLASS
  disabled?: boolean
  placeholder?: string
}

function PlainPick({
  label,
  value,
  options,
  onChange,
  onReselect,
  footer,
  dim = false,
  look = "node",
  disabled = false,
  placeholder,
  triggerRef,
}: PickProps & { triggerRef?: Ref<HTMLButtonElement> }) {
  const row = look === "row" || look === "setting"
  const picked = options.find((o) => o.id === value)
  const lead = options.some((o) => o.icon !== undefined)
  const changed =
    look === "setting" &&
    options.some((o) => o.note === DEFAULT_NOTE) &&
    picked?.note !== DEFAULT_NOTE
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => {
        if (next === null) return
        if (next === value) onReselect?.(next)
        else onChange(next)
      }}
      disabled={disabled}
    >
      <Select.Trigger
        ref={triggerRef}
        className={TRIGGER_CLASS[look]}
        data-dim={dim}
        data-changed={changed || undefined}
        aria-label={changed ? `${label} (changed from default)` : label}
        // A pill, and a row whose long model name is cut, name their whole value on hover.
        title={
          picked?.technicalId ??
          (look === "pill" || look === "row" ? `${label}: ${picked?.name ?? value}` : undefined)
        }
      >
        {picked?.icon !== undefined ? (
          <span className="q-pick-icon" aria-hidden="true">
            {picked.icon}
          </span>
        ) : null}
        <span className="v">
          <Select.Value placeholder={placeholder}>
            {picked?.name ?? (value || placeholder)}
          </Select.Value>
        </span>
        <Select.Icon render={<ChevronDownIcon className="q-start-pick-chev" aria-hidden="true" />}>
          {null}
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          data-slot="select-positioner"
          alignItemWithTrigger={false}
          collisionPadding={10}
          collisionAvoidance={OVERLAY_COLLISION}
          align={row ? "end" : "start"}
          sideOffset={6}
          className="isolate z-(--ql-z-overlay)"
        >
          <Select.Popup className="q-start-menu" data-look={look}>
            <Select.List>
              {options.map((o, at) => {
                const before = options[at - 1]
                // A grouped menu: a heading opens each family; an ungrouped row after a group is set apart.
                const heads = o.group !== undefined && o.group !== before?.group
                const leaves = o.group === undefined && before?.group !== undefined && !o.apart
                return (
                  <Fragment key={o.id}>
                    {o.apart === true || leaves ? (
                      <Select.Separator className="q-start-msep" />
                    ) : null}
                    {heads ? (
                      <div className="q-start-mgroup" role="presentation">
                        {o.group}
                      </div>
                    ) : null}
                    <PickItem option={o} lead={lead} />
                  </Fragment>
                )
              })}
              {footer !== undefined ? (
                <>
                  <Select.Separator className="q-start-msep" />
                  <div className="q-start-mfoot">{footer}</div>
                </>
              ) : null}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

/** A menu whose last entry, Add a model…, opens the field that takes a model id of the agent's own. */
function CustomModelPick({ agent, ...props }: PickProps & { agent: StepAgent }) {
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [typing, setTyping] = useState(false)
  const { value, options, onChange } = props
  return (
    <>
      <PlainPick
        {...props}
        options={withCustom(options, value)}
        triggerRef={trigger}
        onChange={(id) => (id === CUSTOM_ENTRY ? setTyping(true) : onChange(id))}
      />
      <AddModelField
        agent={agent}
        anchor={trigger}
        open={typing}
        onUse={(id) => {
          setTyping(false)
          onChange(id)
        }}
        onClose={() => setTyping(false)}
      />
    </>
  )
}

export function ModelPick({
  custom,
  ...props
}: PickProps & {
  /** A model menu of this agent also takes any model id the agent accepts, typed as provider/model. */
  custom?: StepAgent
}) {
  return custom === undefined ? (
    <PlainPick {...props} />
  ) : (
    <CustomModelPick agent={custom} {...props} />
  )
}
