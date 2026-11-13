// The context ring beside the message box and the popover it opens (the footer's usage chip opens the same
// one): the context window, this session's tokens, its turns and model; for an agent billed by use this
// session's estimated cost, for an agent on a plan its limit windows with a tag on one running ahead of an
// even pace. A plan shows no dollar amount.
import { TrendingUpIcon } from "lucide-react"
import { type ReactNode, type RefObject, useRef } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ConversationUsage } from "../../../core/conversation/types.ts"
import type { AgentLimits, LimitWindow } from "../../../core/limits/index.ts"
import { percentage } from "../../../core/usage-display.ts"
import { InfoHint } from "../../kit/InfoHint.tsx"
import { useUsageDisplay } from "../../usage/display-context.tsx"
import { Estimate } from "../../usage/parts.tsx"
import type { SessionUse } from "./footer-usage.ts"
import { LOW_LEFT, leftIn, resetIn } from "./limit-values.ts"
import { contextShare, duration, RECORD_NAME, tokens } from "./model.ts"

/** Where the context sits from "near the limit" on. */
const NEAR = 80

/** The context window's use as a bar, amber near its end. */
function Meter({ share }: { share: number }) {
  return (
    <span className={`cv-meter${share >= NEAR ? " near" : ""}`} aria-hidden="true">
      <i style={{ width: `${share}%` }} />
    </span>
  )
}

/** The share of the context window in use, drawn as a ring; amber near the end. */
function Ring({ share }: { share: number }) {
  return (
    <svg
      className={`cv-ring${share >= NEAR ? " near" : ""}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6" />
      <circle
        className="cv-ring-on"
        cx="8"
        cy="8"
        r="6"
        strokeDasharray={`${((37.7 * share) / 100).toFixed(1)} 37.7`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}

/** One plan window: what is left, with the even-pace marker, and when it resets. */
function LimitRow({ window }: { window: LimitWindow }) {
  const { percent } = useUsageDisplay()
  const left = leftIn(window)
  const amount = percentage(window.reached ? 100 : window.usedPercent, percent)
  const reset = resetIn(window.resetsAt, Date.now())
  const ahead = window.pacePercent !== null && 100 - window.pacePercent > left
  const label = `${amount === null ? "Not read since reset" : `${amount} % ${percent}`}${reset ? `, resets in ${reset}` : ""}${
    ahead ? ", ahead of an even pace" : ""
  }`
  return (
    <div className={`cv-lim${left < LOW_LEFT ? " low" : ""}`}>
      <span>{window.label}</span>
      <span className="cv-lim-track" role="img" aria-label={label}>
        {amount !== null ? <i style={{ width: `${amount}%` }} /> : null}
        {window.pacePercent !== null ? (
          <b style={{ left: `${percentage(window.pacePercent, percent)}%` }} />
        ) : null}
      </span>
      <span className="cv-lim-n">{amount === null ? "—" : `${amount} %`}</span>
      <span className="cv-lim-r">{reset ?? ""}</span>
      {ahead ? (
        <span className="cv-lim-ahead">
          <TrendingUpIcon className="size-3" aria-hidden="true" />
          ahead of pace
        </span>
      ) : null}
    </div>
  )
}

const triggerLabel = (share: number | undefined, used: number | undefined): string =>
  share !== undefined
    ? `Context ${share} percent used · usage details`
    : used !== undefined
      ? `Context ${tokens(used)} tokens · usage details`
      : "Usage details"

/** The words on the ring: the share with its name when there is room, else the tokens. */
function RingWords({ share, used }: { share: number | undefined; used: number | undefined }) {
  if (share !== undefined)
    return (
      <>
        {share} %<span className="cv-wide"> context</span>
      </>
    )
  return used !== undefined ? `${tokens(used)} tokens` : "Usage"
}

function ContextLine({ usage, share }: { usage: ConversationUsage; share: number | undefined }) {
  const used = usage.contextUsed
  if (share !== undefined && used !== undefined && usage.contextWindow)
    return (
      <>
        <Meter share={share} />
        <p className="cv-usage-line">
          <b>{share} %</b> · {tokens(used)} of {tokens(usage.contextWindow)} tokens
          {share >= NEAR ? <span className="cv-near"> · near the limit</span> : null}
        </p>
      </>
    )
  return (
    <p className="cv-usage-line">
      {used !== undefined ? `${tokens(used)} tokens in use` : "Not reported yet"} · the window size
      isn’t known for this model
    </p>
  )
}

/** This session's tokens in pairs: input and output, the cache, then turns and time. */
function SessionGrid({ usage, span }: { usage: ConversationUsage; span: number | undefined }) {
  return (
    <dl className="cv-usage-grid">
      <dt>Input</dt>
      <dd>{tokens(usage.input)}</dd>
      <dt>Output</dt>
      <dd>{tokens(usage.output)}</dd>
      <dt>Cache read</dt>
      <dd>{tokens(usage.cacheRead)}</dd>
      <dt>Cache write</dt>
      <dd>{tokens(usage.cacheWrite)}</dd>
      <dt>Turns</dt>
      <dd>{usage.turns}</dd>
      {span !== undefined ? (
        <>
          <dt>Time</dt>
          <dd>{duration(span)}</dd>
        </>
      ) : null}
    </dl>
  )
}

/** What this session cost, when its agent is billed by use: an estimate, and it says how it is worked out. */
function CostRow({
  use,
  agentName,
  unpriced,
}: {
  use: SessionUse | null
  agentName: string
  unpriced: boolean
}) {
  if (use?.kind === "key")
    return (
      <div className="cv-usage-cost">
        <span>Cost</span>
        <b>{use.word}</b>
        <Estimate />
      </div>
    )
  if (!unpriced) return null
  return (
    <div className="cv-usage-cost">
      <span>Cost</span>
      <small>Not priced · {agentName} reports tokens only</small>
    </div>
  )
}

/** The part of the popover a trigger points at: the context ring, or the chip beside it (plan pacing or cost). */
export type UsageSection = "context" | "usage"

/** The model of the latest call, named apart from the selection when they can differ. */
export type ObservedModel = { name: string; selected: string | undefined; routed: boolean }

/** Which model the selection and the latest call are, in words; nothing is said when they agree. */
function ModelLine({ observed }: { observed: ObservedModel }) {
  return (
    <>
      <h3>Model</h3>
      <p className="cv-usage-line">
        {observed.selected ? `Selected: ${observed.selected} · ` : "Selection not recorded · "}
        last call ran on <b>{observed.name}</b>
        {observed.routed ? " (chosen by Copilot for that call, not by you)" : ""}
      </p>
    </>
  )
}

export function Usage({
  usage,
  agent,
  agentName,
  span,
  limits,
  use = null,
  unpriced = false,
  before,
  anchor,
  aboveChild = false,
  open,
  onOpenChange,
  section = "context",
  onSection,
  observed,
}: {
  usage: ConversationUsage
  agent: keyof typeof RECORD_NAME
  agentName: string
  /** The footer already names the model and effort, so the popover does not repeat them. */
  model?: string | undefined
  /** The section the popover opens on and focuses. */
  section?: UsageSection
  /** The ring was pressed: the popover opens on the context. */
  onSection?(section: UsageSection): void
  /** The latest call's model, when it is worth naming apart from the selection. */
  observed?: ObservedModel | undefined
  /** How long the session ran, when its record has times. */
  span?: number | undefined
  /** The agent's plan limits, when it reports them. */
  limits?: AgentLimits | undefined
  /** What the footer's usage chip says: this session's cost or the tightest plan window. */
  use?: SessionUse | null
  /** The agent has no price for this session and says so; a plan has none to show. */
  unpriced?: boolean
  /** More triggers of the same popover (the footer's chips), drawn before the ring. */
  before?: ReactNode
  /** What the popover lines up with: the footer's whole cluster, not the ring alone. */
  anchor?: RefObject<HTMLElement | null>
  aboveChild?: boolean
  open?: boolean
  onOpenChange?(open: boolean): void
}) {
  const share = contextShare(usage)
  const focusTarget = useRef<HTMLElement | null>(null)
  const focusOn = (name: UsageSection) => (element: HTMLElement | null) => {
    if (name === section) focusTarget.current = element
  }
  const hasLimits =
    use?.kind === "plan" && limits?.state === "reported" && limits.windows.length > 0
  // Where the numbers come from is a tooltip behind an info mark, on the last heading that holds some.
  const source = (
    <InfoHint
      label="Source"
      text={`Read from ${agentName}’s ${RECORD_NAME[agent]}. It updates when the agent saves a message.`}
    />
  )
  return (
    <Popover
      {...(open !== undefined ? { open } : {})}
      onOpenChange={(value) => onOpenChange?.(value)}
    >
      {before}
      <PopoverTrigger
        render={
          <button
            type="button"
            className="cv-ctx"
            aria-label={triggerLabel(share, usage.contextUsed)}
            title="Context window: how much of the model’s memory this conversation fills"
            aria-haspopup="dialog"
            data-testid="context-ring"
            onClick={() => onSection?.("context")}
          />
        }
      >
        {share !== undefined ? <Ring share={share} /> : null}
        <span className="cv-ctx-n">
          <RingWords share={share} used={usage.contextUsed} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        {...(anchor ? { anchor } : {})}
        className={`cv-usage${aboveChild ? " cv-usage-over-child" : ""}`}
        aria-label="Usage and context"
        initialFocus={() => focusTarget.current}
      >
        <h3
          tabIndex={-1}
          ref={focusOn("context")}
          data-target={section === "context" ? "" : undefined}
        >
          Context window
        </h3>
        <ContextLine usage={usage} share={share} />
        {observed ? <ModelLine observed={observed} /> : null}
        <h3
          tabIndex={-1}
          ref={hasLimits ? undefined : focusOn("usage")}
          data-target={section === "usage" && !hasLimits ? "" : undefined}
        >
          This session
          {hasLimits ? null : source}
        </h3>
        <SessionGrid usage={usage} span={span} />
        <CostRow use={use} agentName={agentName} unpriced={unpriced} />
        {hasLimits && limits?.state === "reported" ? (
          <>
            <h3
              className="cv-usage-limits"
              tabIndex={-1}
              ref={focusOn("usage")}
              data-target={section === "usage" ? "" : undefined}
            >
              Plan pacing · {agentName}
              {source}
            </h3>
            <div className="cv-usage-lim">
              {limits.windows.map((window) => (
                <LimitRow key={window.label} window={window} />
              ))}
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
