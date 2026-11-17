// The sidebar keeps a quick quota/money summary; full charts and window detail belong to Usage.
// Reads follow native turns and explicit opening/retry, without a polling timer.

import { cn } from "cn"
import { GaugeIcon, KeyRoundIcon, RotateCwIcon } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { AgentLimits } from "../../core/limits/index.ts"
import { listedRun } from "../../core/run/listed-run.ts"
import { percentage } from "../../core/usage-display.ts"
import type { Route } from "../hooks.ts"
import { anyUnread } from "../kit/LimitsPanel.tsx"
import { AgentMark } from "../kit/marks/index.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { agoText } from "../settings/usage-model.ts"
import { useUsageDisplay } from "../usage/display-context.tsx"
import { keyedAgents } from "../usage/facts.ts"
import { usd, usdShort } from "../usage/format.ts"
import { Spark } from "../usage/parts.tsx"
import {
  oldestReading,
  type StripCell,
  selectedQuotaLimits,
  type UnknownFace,
} from "./limits-face.ts"
import { UsageQuickLook } from "./UsageQuickLook.tsx"
import { type Foot, type FootCell, footOf } from "./usage-foot-model.ts"
import { useSidebarLimits } from "./use-sidebar-limits.ts"
import { useSidebarUsage } from "./use-sidebar-usage.ts"
import "./plan-limits.css"
import "../usage/usage.css"

function LimitFace({ cell }: { cell: Extract<StripCell, { face: unknown }> }) {
  const { face } = cell
  const { percent } = useUsageDisplay()
  const value = percentage(100 - face.left, percent)
  const resets = face.resets === undefined ? "" : ` · resets in ${face.resets}`
  return (
    <span
      className={cn("q-limmini", face.low && "low", face.credits !== null && "credit")}
      title={
        face.credits !== null
          ? `${face.name} · ${face.credits}${resets}`
          : `${face.name} · ${face.window.label.toLowerCase()} · ${value} % ${percent}${resets}`
      }
      data-testid="plan-limit-face"
      data-agent={face.agent}
    >
      <AgentMark agent={face.agent} size={12} />
      <span className="q-limmini-bar">
        <i style={{ width: `${value}%` }} />
      </span>
      <span className="q-limmini-n">{face.credits !== null ? "on credits" : `${value} %`}</span>
    </span>
  )
}

/** An agent nothing is known of: its mark and the word, or a key for an API key. No figure, no bar. */
function Unknown({ cell }: { cell: UnknownFace }) {
  return (
    <span
      className="q-limmini unknown"
      title={cell.title}
      data-testid="plan-limit-unknown"
      data-agent={cell.agent}
    >
      <AgentMark agent={cell.agent} size={12} />
      {cell.cause === "no-plan" ? (
        <KeyRoundIcon className="size-3" aria-hidden="true" />
      ) : (
        "unknown"
      )}
    </span>
  )
}

/** An agent billed by use: its estimated cost today, "today" going first when the room is short. */
function CostFace({ cell }: { cell: Extract<FootCell, { kind: "cost" }> }) {
  return (
    <span
      className={cn("q-limmini q-ug-mini", cell.today === 0 && "zero")}
      title={`${cell.name} · ${cell.billing === "gateway" ? "gateway" : "API key"} · ${usd(cell.today)} today, estimate`}
      data-testid="usage-cost-face"
      data-agent={cell.agent}
    >
      <AgentMark agent={cell.agent} size={12} />
      <span className="q-ug-mini-n">{usdShort(cell.today)}</span>
      <span className="q-ug-mini-w">today</span>
    </span>
  )
}

function Cell({ cell }: { cell: FootCell }) {
  if (cell.kind === "cost") return <CostFace cell={cell} />
  return "face" in cell.cell ? <LimitFace cell={cell.cell} /> : <Unknown cell={cell.cell.unknown} />
}

/** What a read that failed says, with a way to read again. */
function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="q-ug-fail" data-testid="usage-failed">
      Couldn't read your agents' records
      <button
        type="button"
        className="q-lim-retry"
        aria-label="Read usage again"
        title="Read again"
        onClick={onRetry}
      >
        <RotateCwIcon className="size-3" aria-hidden="true" />
      </button>
    </p>
  )
}

/** The task rail's face: one ring for the agent nearest its plan limit, filled by what it used, its mark inside. */
function RailRing({ cells }: { cells: readonly FootCell[] }) {
  const faces = cells.flatMap((cell) =>
    cell.kind === "limit" && "face" in cell.cell ? [cell.cell.face] : [],
  )
  const top = [...faces].sort((a, b) => a.left - b.left)[0]
  if (top === undefined) return <GaugeIcon className="size-4" aria-hidden="true" />
  const used = Math.min(100, Math.max(0, 100 - top.left))
  const r = 11.5
  const c = 2 * Math.PI * r
  return (
    <span className={cn("q-rail-ring", top.low && "near")} data-agent={top.agent}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r={r} />
        <circle
          cx="14"
          cy="14"
          r={r}
          className="on"
          strokeDasharray={`${((c * used) / 100).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 14 14)"
        />
      </svg>
      <AgentMark agent={top.agent} size={13} />
    </span>
  )
}

/** The sidebar foot's row: the gauge, the week's cost when billed by use, and at most two agents. */
function FootTrigger({ foot }: { foot: Foot }) {
  const total = foot.week?.total ?? 0
  return (
    <PopoverTrigger
      className={cn("q-limrow", foot.week !== null && "billed")}
      aria-label={`${foot.title}: ${foot.words}`}
      data-testid="usage-foot"
    >
      <GaugeIcon className="q-limrow-ic size-[13px]" aria-hidden="true" />
      {foot.week !== null ? (
        <span className="q-limrow-week">
          <Spark
            values={foot.week.values}
            words={foot.week.words}
            label="Estimated cost, last 7 days"
          />
          <span className="q-ug-week" title={`Last 7 days: ${usd(total)}, estimate`}>
            {usdShort(total)}
          </span>
        </span>
      ) : null}
      <span className={cn("q-limrow-bars", foot.cells.length === 1 && "one")}>
        {foot.cells.map((cell) => (
          <Cell
            key={cell.kind === "cost" ? `cost-${cell.agent}` : `limit-${cellKey(cell.cell)}`}
            cell={cell}
          />
        ))}
      </span>
    </PopoverTrigger>
  )
}

/** The task rail's trigger: the ring alone, its words as the name and the tooltip. */
function RailTrigger({ foot }: { foot: Foot }) {
  const words = `${foot.title}: ${foot.words}`
  return (
    <PopoverTrigger
      className="q-rail-usage"
      aria-label={words}
      title={words}
      data-testid="usage-foot"
    >
      <RailRing cells={foot.cells} />
    </PopoverTrigger>
  )
}

/** Where the popover opens: above the sidebar's foot, beside the task rail. */
const placement = {
  foot: { side: "top", align: "start" },
  rail: { side: "right", align: "end" },
} as const

export function UsageFoot({
  go,
  now,
  rail = false,
}: {
  go: (route: Route) => void
  now: number
  /** The task rail: the ring alone, its popover opening beside the rail. */
  rail?: boolean
}) {
  const preferences = useUsageDisplay()
  const windows = useOptionalRuns()
  const limitsRead = useSidebarLimits(windows?.adapter.limits)
  const usageRead = useSidebarUsage(windows?.adapter.usage)
  const [open, setOpen] = useState(false)
  const { usage } = usageRead
  const limits = selectedQuotaLimits(limitsRead.limits, preferences.readings)
  const foot = footOf(usage, limits, now, preferences.percent)
  if (foot === null) return null
  const keyed = usage === null ? [] : keyedAgents(usage)
  const billed = new Set(keyed.map((agent) => agent.agent))
  const planLimits: readonly AgentLimits[] = limits.filter((agent) => !billed.has(agent.agent))
  const hasPlan = foot.cells.some((cell) => cell.kind === "limit")
  const both = hasPlan && keyed.length > 0
  const running = windows?.runs.filter(listedRun).length ?? 0
  // One time for all only while every agent with a row was read: else each says its own.
  const checked = anyUnread(planLimits) ? undefined : agoText(oldestReading(planLimits), now)
  const counting = usage !== null && !usage.complete
  const leave = (tab: "usage" | "sessions") => () => {
    setOpen(false)
    go({ view: "settings", tab })
  }
  return (
    <Popover
      open={open}
      onOpenChange={(shown) => {
        if (shown) {
          limitsRead.reload()
          usageRead.reload()
        }
        setOpen(shown)
      }}
    >
      {rail ? <RailTrigger foot={foot} /> : <FootTrigger foot={foot} />}
      <PopoverContent
        {...placement[rail ? "rail" : "foot"]}
        sideOffset={8}
        collisionPadding={8}
        className="q-limpop q-ug-pop w-[320px] max-w-[calc(100vw-16px)] gap-0 p-0"
        aria-label={foot.title}
        data-testid="plan-limits-popover"
      >
        <div className="q-limpop-h">
          <b>{foot.title}</b>
          {keyed.length > 0 && !hasPlan ? (
            <span>{usageRead.failed ? "" : counting ? "counting…" : "updated now"}</span>
          ) : both || checked === undefined ? null : (
            <span>checked {checked}</span>
          )}
        </div>
        <UsageQuickLook limits={planLimits} usage={usage} now={now} />
        {usageRead.failed ? <Failed onRetry={usageRead.reload} /> : null}
        <div className="q-limpop-f">
          <button type="button" className="q-link" onClick={leave("usage")}>
            Open Usage
          </button>
          {running > 0 ? (
            <button type="button" className="q-link ml-auto" onClick={leave("sessions")}>
              {running} {running === 1 ? "session" : "sessions"} running
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const cellKey = (cell: StripCell): string => ("face" in cell ? cell.face.agent : cell.unknown.agent)
