// The small pieces every usage surface is made of: the "estimate" word with its info button, how an
// agent is billed as one quiet word with its icon, the week's sparkline, a stacked column and an
// agent's chart colour. Icons are the App Model's meaning map: billing kinds gauge (plan), key-round
// (API key) and network (gateway); cost coins; tokens binary; sessions cpu; fast zap.

import { cn } from "cn"
import { GaugeIcon, InfoIcon, KeyRoundIcon, type LucideIcon, NetworkIcon } from "lucide-react"
import { type MouseEvent, useState } from "react"
import type { UsageBilling } from "../../core/cost/usage.ts"
import { billingWords } from "./facts.ts"
import "./usage.css"

/** How the number is worked out, said wherever a dollar amount stands. */
export const ESTIMATE_WORDS =
  "Reported dollar costs where available; otherwise estimated from local token counts at list prices. Your bill can differ."
/** What a plan agent's dollars are, when the person asks to see them. */
export const NOT_BILLED_WORDS =
  "What this plan use would cost at API prices, for comparison. Your plan is not billed by use."

/** An agent's colour in a chart: a palette token, one for each agent that has usage. */
export const agentColor = (agent: string): string => `var(--ql-agent-${agent})`

/** The index of the column under the pointer in a plot of `columns` equal columns. */
export function dayAt(event: MouseEvent<HTMLElement>, columns: number): number {
  const box = event.currentTarget.getBoundingClientRect()
  if (box.width <= 0) return 0
  const share = (event.clientX - box.left) / box.width
  return Math.min(columns - 1, Math.max(0, Math.floor(share * columns)))
}

/**
 * "estimate" with an info button: hovering names how it is worked out, clicking says it on its own line
 * underneath (the line is the last child of a wrapping row, so it takes the row's full width).
 */
export function Estimate({ word = "estimate" }: { word?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <span className="q-ug-est">
        {word}
        <button
          type="button"
          className={cn("q-ug-tip", open && "on")}
          title={ESTIMATE_WORDS}
          aria-label="How the estimate is worked out"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <InfoIcon className="size-3" aria-hidden="true" />
        </button>
      </span>
      {open ? (
        <span className="q-ug-est-note" role="note">
          {ESTIMATE_WORDS}
        </span>
      ) : null}
    </>
  )
}

const BILLING_ICON: Record<UsageBilling, LucideIcon> = {
  plan: GaugeIcon,
  unknown: GaugeIcon,
  key: KeyRoundIcon,
  gateway: NetworkIcon,
}

const BILLING_TIP: Record<UsageBilling, string> = {
  plan: "On a plan: limits, not billed by use",
  unknown: "Billing is not reported; dollars are shown only as API-price value",
  key: "Billed by use on an API key",
  gateway: "Billed by use through a gateway (ANTHROPIC_BASE_URL)",
}

/** How an agent is billed, as one quiet word with its icon: the plan's name, API key or Gateway. */
export function Billing({ billing, plan }: { billing: UsageBilling; plan: string | null }) {
  const Icon = BILLING_ICON[billing]
  return (
    <span className="q-ug-bill" title={BILLING_TIP[billing]}>
      <Icon className="size-3" aria-hidden="true" />
      {billingWords({ billing, plan })}
    </span>
  )
}

/** Seven days as seven thin bars, today last and in the text colour. */
export function Spark({
  values,
  words,
  label,
}: {
  values: readonly number[]
  /** What each bar says, for the tooltip and a screen reader. */
  words: readonly string[]
  label: string
}) {
  const top = Math.max(...values, 0) || 1
  return (
    <span
      className="q-ug-spark"
      role="img"
      aria-label={`${label}: ${words.join(", ")}`}
      title={words.join(" · ")}
    >
      {values.map((value, at) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: the bars are a fixed run of days
          key={at}
          className={at === values.length - 1 ? "now" : ""}
          style={{ height: `${Math.max(1, Math.round((value / top) * 12))}px` }}
        />
      ))}
    </span>
  )
}

/** A column split by agent, one colour each; a part under `floor` of the axis draws nothing (its tooltip still names it). */
export function Stack({
  height,
  parts,
}: {
  /** Of the plot, 0 to 100. */
  height: number
  parts: readonly { agent: string; value: number }[]
}) {
  return (
    <span className="q-ug-stack" style={{ height: `${height}%` }}>
      {parts.map((part) => (
        <i key={part.agent} style={{ flexGrow: part.value, background: agentColor(part.agent) }} />
      ))}
    </span>
  )
}
