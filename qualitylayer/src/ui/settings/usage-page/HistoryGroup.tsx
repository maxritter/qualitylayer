// "What your agents used": the headline with its period, the daily chart, and the agents with their
// share. Plans only show tokens, use billed by key or gateway shows estimated dollars, both show the
// two side by side and never summed. The toggle at the foot adds a plan's use at API prices, marked "not
// billed", for comparison only; it is off until the person turns it on.

import {
  BinaryIcon,
  CalendarDaysIcon,
  CalendarIcon,
  CalendarRangeIcon,
  CoinsIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Switch } from "@/components/ui/switch"
import type { Usage, UsagePeriod } from "../../../core/cost/usage.ts"
import { tokensIn } from "../../../core/cost/usage-spend.ts"
import { joinNames } from "../../kit/LimitsPanel.tsx"
import { AgentMark } from "../../kit/marks/index.ts"
import { useUsageDisplay } from "../../usage/display-context.tsx"
import { agentColor } from "../../usage/parts.tsx"
import { Choice, SettingRow, SettingsGroup } from "../Rows.tsx"
import { clause, uncountedGroups } from "../usage-model.ts"
import { chartAgents, type Measure, measureOf, type UsageView } from "../usage-view.ts"
import { AgentsTable } from "./AgentsTable.tsx"
import { DailyChart } from "./DailyChart.tsx"
import { Hero } from "./Hero.tsx"

/** Each period leads with its calendar mark (the meaning map: 7 days, 30 days, this month). */
const PERIODS: { id: `${UsagePeriod}`; name: string; icon: ReactNode }[] = [
  { id: "7", name: "7 days", icon: <CalendarDaysIcon className="size-[13px]" /> },
  { id: "30", name: "30 days", icon: <CalendarRangeIcon className="size-[13px]" /> },
  { id: "month", name: "This month", icon: <CalendarIcon className="size-[13px]" /> },
]

/** The period's switch: 7 days, 30 days or this month. It stays while a period is being read. */
export function PeriodChoice({
  period,
  onPeriod,
}: {
  period: UsagePeriod
  onPeriod: (period: UsagePeriod) => void
}) {
  return (
    <Choice
      label="Period"
      value={`${period}` as `${UsagePeriod}`}
      options={PERIODS}
      onChange={(id) => onPeriod(id === "month" ? "month" : (Number(id) as UsagePeriod))}
      testId="usage-range"
    />
  )
}

export const periodWords = (period: UsagePeriod): string =>
  period === "month" ? "This month" : `Last ${period} days`

/** A tiny share draws too thin to see in a chart: its key says so, and the tooltip still lists it. */
const TINY = 0.02

export function HistoryGroup({
  usage,
  view,
  period,
  onPeriod,
  measure,
  onMeasure,
  showValue,
  onShowValue,
  plans,
  counting,
}: {
  usage: Usage
  view: UsageView
  period: UsagePeriod
  onPeriod: (period: UsagePeriod) => void
  measure: Measure | null
  onMeasure: (measure: Measure) => void
  showValue: boolean
  onShowValue: (on: boolean) => void
  plans: ReadonlyMap<string, string>
  /** What the header says while files are still unread, or while the answer waits. */
  counting: { files: number; retry?: () => void } | null
}) {
  const preferences = useUsageDisplay()
  const shown = preferences.money === "value" ? (measure ?? "cost") : measureOf(view, measure)
  const agents =
    preferences.money === "value" && shown === "cost"
      ? view.all.map((pick) => pick.agent)
      : chartAgents(view, shown)
  const showCost = view.keyed.length > 0 || showValue
  const unpriced =
    preferences.money === "value"
      ? [
          ...new Set(
            view.all.flatMap((pick) =>
              pick.agent.models
                .filter((model) => !model.priced && tokensIn(model.tokens) > 0)
                .map((model) => model.model),
            ),
          ),
        ]
      : view.unpricedModels
  const amountOf = (agent: (typeof agents)[number]) =>
    shown === "cost" ? agent.costUsd : tokensIn(agent.tokens)
  const whole = agents.reduce((n, agent) => n + amountOf(agent), 0)
  const uncounted = uncountedGroups(usage).filter(
    ({ reason }) =>
      !["Session records hold no token counts", "Its usage is not counted"].includes(reason),
  )
  return (
    <SettingsGroup
      title="What your agents used"
      testId="usage-history"
      end={
        counting !== null ? (
          counting.retry !== undefined ? (
            <span className="q-ug-counting" role="status">
              Couldn't finish reading usage.{" "}
              <button type="button" className="q-link" onClick={counting.retry}>
                Try again
              </button>
            </span>
          ) : null
        ) : (
          "updated now"
        )
      }
    >
      <div className="q-ug-top">
        <Hero view={view} usage={usage} showValue={showValue} />
        <PeriodChoice period={period} onPeriod={onPeriod} />
      </div>
      {unpriced.length > 0 ? (
        <p className="q-ug-np-row" data-testid="usage-unpriced">
          <span
            className="q-ug-np-line"
            title={`Pricing is unavailable for some usage from these models; those tokens are excluded: ${unpriced.join(", ")}`}
          >
            {unpriced.length} unpriced {unpriced.length === 1 ? "model" : "models"}
          </span>
        </p>
      ) : null}
      <div className="q-ug-ch-head">
        {/* An agent under 2 % of the chart's total draws too thin to see: its key says so, the tooltip still lists it. */}
        <span className="q-ug-legend">
          {agents.length > 1 ? (
            agents.map((agent) => {
              const share = whole > 0 ? amountOf(agent) / whole : 0
              return (
                <span
                  key={agent.agent}
                  className={share < TINY ? "q-ug-key tiny" : "q-ug-key"}
                  title={
                    share < TINY
                      ? `${agent.name} is under 2 % here, too thin to see; hover a day to read it`
                      : undefined
                  }
                >
                  <i style={{ background: agentColor(agent.agent) }} />
                  {/* The swatch and the agent's own mark; the name is its tooltip and accessible name. */}
                  <span
                    className="q-ug-key-mark"
                    role="img"
                    aria-label={agent.name}
                    title={share < TINY ? undefined : agent.name}
                  >
                    <AgentMark agent={agent.agent} size={13} />
                  </span>
                </span>
              )
            })
          ) : (
            <span className="dim">
              {shown === "cost" ? "Cost per day" : "Tokens per day"}
              {agents.length === 1 ? ` · ${agents[0]?.name}` : ""}
            </span>
          )}
        </span>
        {view.kind !== "plan" || preferences.money === "value" ? (
          <Choice
            label="Chart shows"
            value={shown}
            options={[
              {
                id: "cost",
                name: "Cost",
                icon: <CoinsIcon className="size-3.5" aria-hidden="true" />,
              },
              {
                id: "tokens",
                name: "Tokens",
                icon: <BinaryIcon className="size-3.5" aria-hidden="true" />,
              },
            ]}
            onChange={onMeasure}
            testId="usage-measure"
          />
        ) : null}
      </div>
      {preferences.money !== "value" && view.kind === "mixed" && shown === "cost" ? (
        <p className="q-ug-ch-note">
          Only agents billed by use. {joinNames(view.plan.map((p) => p.agent.name))} on a plan{" "}
          {view.plan.length > 1 ? "are" : "is"} not billed by use.
        </p>
      ) : null}
      <DailyChart usage={usage} agents={agents} measure={shown} />
      {view.used.length > 0 ? (
        <AgentsTable view={view} showCost={showCost} showValue={showValue} plans={plans} />
      ) : (
        <p className="q-ug-empty" data-testid="usage-empty">
          No sessions in {period === "month" ? "this month" : `the last ${period} days`}. Usage
          appears here after an agent's first session.
        </p>
      )}
      {uncounted.map(({ reason, names, agents: listed }) => (
        <p key={reason} className="q-ug-quiet" data-testid="usage-uncounted">
          <span className="q-ug-quiet-m">
            {listed.map((agent, at) => (
              <AgentMark key={agent} agent={agent} size={13} title={names[at] ?? agent} />
            ))}
          </span>
          {`${joinNames(names)}: no usage counted; ${clause(reason)}.`}
        </p>
      ))}
      {view.plan.length > 0 ? (
        <SettingRow
          label="Show plan use at API prices"
          hint="For comparison only. Your plan is not billed by use."
          testId="usage-value"
          stay
          icon={<CoinsIcon className="size-[15px]" aria-hidden="true" />}
        >
          <Switch
            checked={showValue}
            aria-label="Show plan use at API prices"
            onCheckedChange={onShowValue}
          />
        </SettingRow>
      ) : null}
    </SettingsGroup>
  )
}
