// Settings › Usage's daily chart: stacked columns per day, one colour per agent, on a clean axis. Hover
// or the arrow keys (Home and End jump, Escape lets go) read a day out in a tooltip with each agent's
// share of it. A part under 1.3 % of the axis draws nothing; the tooltip and the By day breakdown
// still name it.

import { cn } from "cn"
import { type KeyboardEvent, useState } from "react"
import type { AgentUsage, Usage } from "../../../core/cost/usage.ts"
import { dayLabel, dayLong, tok, usd, usdAxis, weekdayWord } from "../../usage/format.ts"
import { agentColor, dayAt, Stack } from "../../usage/parts.tsx"
import { chartSeries, type Measure } from "../usage-view.ts"

function handleChartKeyDown(
  event: KeyboardEvent,
  dayCount: number,
  setAt: (updater: (current: number | null) => number | null) => void,
): void {
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault()
    setAt(() => (event.key === "Home" ? 0 : dayCount - 1))
    return
  }
  if (event.key === "Escape") {
    setAt(() => null)
    return
  }
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
  if (step === 0) return
  event.preventDefault()
  setAt((v) => Math.min(dayCount - 1, Math.max(0, (v ?? dayCount) + step)))
}

function ChartTooltip({
  at,
  days,
  today,
  agents,
  values,
  totals,
  money,
}: {
  at: number
  days: string[]
  today: string
  agents: readonly AgentUsage[]
  values: number[][]
  totals: number[]
  money: boolean
}) {
  const tipLeft = ((at + 0.5) / days.length) * 100
  const align = tipLeft > 70 ? "left" : tipLeft < 30 ? "right" : ""
  const formatVal = (n: number) => (money ? usd(n) : tok(n))
  return (
    <div className={cn("q-ug-ch-tip", align)} style={{ left: `${tipLeft}%` }} role="status">
      <b>{dayLong(days[at] ?? "", today)}</b>
      {agents.map((agent, a) => (
        <span key={agent.agent} className="q-ug-key">
          <i style={{ background: agentColor(agent.agent) }} />
          <span>{agent.name}</span>
          <span className="v">{formatVal(values[a]?.[at] ?? 0)}</span>
        </span>
      ))}
      {agents.length > 1 ? (
        <span className="q-ug-key total">
          <span>Total</span>
          <span className="v">{formatVal(totals[at] ?? 0)}</span>
        </span>
      ) : null}
    </div>
  )
}

function ChartXAxis({ days, today }: { days: string[]; today: string }) {
  const every = days.length <= 7 ? 1 : 7
  const labelOf = (day: string, d: number) => {
    if ((days.length - 1 - d) % every !== 0) return ""
    return days.length <= 7 ? weekdayWord(day, today) : dayLabel(day)
  }
  return (
    <div className="q-ug-ch-x" aria-hidden="true">
      {days.map((day, d) => (
        <span key={day}>{labelOf(day, d)}</span>
      ))}
    </div>
  )
}

export function DailyChart({
  usage,
  agents,
  measure,
}: {
  usage: Usage
  agents: readonly AgentUsage[]
  measure: Measure
}) {
  const [at, setAt] = useState<number | null>(null)
  const { days, values, totals, top, empty } = chartSeries(usage, agents, measure)
  const today = days.at(-1) ?? ""
  const money = measure === "cost"
  const fmt = money ? usd : (n: number) => `${tok(n)} tokens`
  const axis = money ? usdAxis : tok
  const ariaLabel = `${money ? "Estimated cost" : "Tokens"} per day, ${dayLabel(days[0] ?? "")} to ${dayLabel(today)}. Highest ${fmt(Math.max(...totals))}. Use the arrow keys to read each day; the By day breakdown below lists every value.`

  return (
    <div className="q-ug-ch" data-testid="usage-chart">
      <div className="q-ug-ch-y" aria-hidden="true">
        {[top, top / 2, 0].map((value, j) => (
          <span key={value}>{empty && j < 2 ? "" : axis(value)}</span>
        ))}
      </div>
      <div className="q-ug-ch-body">
        <div
          className="q-ug-ch-plot"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is read day by day with the arrow keys
          tabIndex={0}
          role="img"
          aria-label={ariaLabel}
          onKeyDown={(event) => handleChartKeyDown(event, days.length, setAt)}
          onBlur={() => setAt(null)}
          onMouseMove={(event) => setAt(dayAt(event, days.length))}
          onMouseLeave={() => setAt(null)}
        >
          <i className="q-ug-grid" style={{ bottom: "50%" }} />
          <i className="q-ug-grid" style={{ bottom: "100%" }} />
          <i className="q-ug-grid base" style={{ bottom: 0 }} />
          {days.map((day, d) => (
            <span key={day} className={cn("q-ug-col", at === d ? "on" : at !== null && "off")}>
              <Stack
                height={((totals[d] ?? 0) / top) * 100}
                parts={agents
                  .map((agent, a) => ({ agent: agent.agent, value: values[a]?.[d] ?? 0 }))
                  .filter((part) => part.value >= top * 0.013)}
              />
            </span>
          ))}
          {empty ? <span className="q-ug-ch-empty">No use in this period</span> : null}
          {at !== null && !empty ? (
            <ChartTooltip
              at={at}
              days={days}
              today={today}
              agents={agents}
              values={values}
              totals={totals}
              money={money}
            />
          ) : null}
        </div>
        <ChartXAxis days={days} today={today} />
      </div>
    </div>
  )
}
