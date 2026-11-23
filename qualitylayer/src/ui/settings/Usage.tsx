// Settings › Usage: the plan limits each agent on a plan reports now, then what the agents used in the
// last 7 or 30 days or this month, from their own session records (App Model: Settings › Usage). Plans
// show limits and tokens; an agent billed by use (an API key, a gateway) shows estimated dollars; both
// are never summed. Every block says what it is waiting for or why it has nothing: loading, unreadable,
// empty, still counting, or not counted by an agent.

import { HourglassIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { usageForMoney } from "../../core/cost/display.ts"
import type { UsagePeriod } from "../../core/cost/usage.ts"
import type { AgentLimits } from "../../core/limits/index.ts"
import type { Api, Config } from "../api.ts"
import { anyUnread, hasLimitRows, LimitsPanel, UnreportedLimits } from "../kit/LimitsPanel.tsx"
import { isKeyed } from "../usage/facts.ts"
import { SettingRow, SettingsGroup } from "./Rows.tsx"
import { UsageDisplaySettings } from "./UsageDisplay.tsx"
import { UsageHistorySection, UsageNote } from "./UsageHistorySection.tsx"
import { agoText } from "./usage-model.ts"
import { type Measure, usageView } from "./usage-view.ts"
import { usePlanLimits, useUsage } from "./use-readings.ts"
import "../usage/usage.css"
import "./usage.css"

/**
 * When the numbers were read: the oldest reading of the agents that report, and each agent's own in the
 * tooltip. While an agent could not be read it says no time for all: each agent that was read says its own.
 */
function checkedLine(limits: readonly AgentLimits[], now: number) {
  const read = limits.filter((agent) => agent.state === "reported" && agent.at !== null)
  if (read.length === 0 || anyUnread(limits)) return { text: undefined, title: undefined }
  const oldest = Math.min(...read.map((agent) => agent.at ?? now))
  return {
    text: `checked ${agoText(oldest, now)}`,
    title: read.map((agent) => `${agent.name}: ${agoText(agent.at, now)}`).join(" · "),
  }
}

function PlanLimitsBody({
  limits,
  reload,
  status,
  now,
}: {
  limits: readonly AgentLimits[]
  reload: () => void
  status: "loading" | "failed" | "ready"
  now: number
}) {
  if (status === "loading") return <UsageNote>Reading plan limits…</UsageNote>
  if (status === "failed")
    return <UsageNote retry={reload}>Plan limits could not be read.</UsageNote>
  return (
    <>
      <div className="q-us-limits">
        <LimitsPanel limits={limits} now={now} onRetry={reload} />
        <UnreportedLimits limits={limits} />
      </div>
      {hasLimitRows(limits) ? null : <UsageNote>No agent has reported plan limits yet.</UsageNote>}
    </>
  )
}

function PlanLimitsGroup({
  limits,
  reload,
  status,
}: {
  limits: readonly AgentLimits[]
  reload: () => void
  status: "loading" | "failed" | "ready"
}) {
  const now = Date.now()
  const checked = status === "ready" ? checkedLine(limits, now) : null
  return (
    <SettingsGroup
      title="Plan limits"
      testId="plan-limits"
      end={
        <span title={checked?.title}>
          {checked?.text ?? (status === "loading" ? "checking…" : "")}
        </span>
      }
    >
      <p className="q-sg-foot">
        Visible plan readings refresh every five minutes. Copilot depends on its latest local
        session snapshot.
      </p>
      <PlanLimitsBody limits={limits} reload={reload} status={status} now={now} />
    </SettingsGroup>
  )
}

/** The plan limits' one setting, in a group of its own: the Plan limits card only reports state. */
function WhenUsedUpGroup({
  config,
  onChange,
}: {
  config: Config
  onChange: (patch: unknown) => void
}) {
  return (
    <SettingsGroup title="When a limit is used up" testId="limit-used-up">
      <SettingRow
        label="Resume when a limit resets"
        hint="A build stopped by a plan limit continues by itself when the window resets. Cancel resume in the task's agent status stops that."
        testId="resume-after-reset"
        icon={<HourglassIcon className="size-[15px]" />}
        stay
      >
        <Switch
          checked={config.limits.resumeAfterReset}
          aria-label="Resume when a limit resets"
          onCheckedChange={(resumeAfterReset) => onChange({ limits: { resumeAfterReset } })}
        />
      </SettingRow>
    </SettingsGroup>
  )
}

/** The page's lead line: with no agent on a plan there are no plan limits to name. */
export const USAGE_LEAD_BILLED = "What your agents used, and its estimated cost."

function planNamesOf(limits: readonly AgentLimits[]): Map<string, string> {
  return new Map(
    limits.flatMap((agent) =>
      agent.state === "reported" && agent.plan !== null ? [[agent.agent, agent.plan] as const] : [],
    ),
  )
}

export function UsageTab({
  config,
  onChange,
  loadLimits,
  api,
  onLead,
}: {
  config: Config
  onChange: (patch: unknown) => void
  /** Reads every agent's plan limits (the same read the Conversation footer uses). */
  loadLimits: Parameters<typeof usePlanLimits>[0]
  api?: Pick<Api, "usage">
  /** Tells the page the lead line that fits what it holds; null hands it back. */
  onLead?: (lead: string | null) => void
}) {
  const [period, setPeriod] = useState<UsagePeriod>(30)
  const [measure, setMeasure] = useState<Measure | null>(null)
  const limitsReading = usePlanLimits(loadLimits)
  const { reading, reload } = useUsage(api?.usage, period)
  const rawUsage = "data" in reading ? reading.data : null
  const usage = useMemo(
    () => (rawUsage === null ? null : usageForMoney(rawUsage, config.usage.money)),
    [rawUsage, config.usage.money],
  )
  const view = useMemo(() => (usage === null ? null : usageView(usage)), [usage])
  const keyed = useMemo(
    () => new Set(usage?.agents.filter(isKeyed).map((agent) => agent.agent) ?? []),
    [usage],
  )
  const limitsShown = useMemo(
    () =>
      limitsReading.reading.status === "ready"
        ? limitsReading.reading.data.filter((agent) => !keyed.has(agent.agent))
        : [],
    [limitsReading.reading, keyed],
  )
  const plans = useMemo(() => planNamesOf(limitsShown), [limitsShown])
  const onlyBilled = view !== null && view.keyed.length > 0 && view.plan.length === 0
  const showLimits = !(onlyBilled && !hasLimitRows(limitsShown))

  useEffect(() => {
    onLead?.(onlyBilled ? USAGE_LEAD_BILLED : null)
    return () => onLead?.(null)
  }, [onlyBilled, onLead])

  return (
    <div className="q-sgs q-ug" data-testid="usage-page">
      <UsageDisplaySettings
        value={config.usage}
        onChange={(nextUsage) => onChange({ usage: nextUsage })}
        limits={limitsShown}
        usage={rawUsage}
      />
      {showLimits ? (
        <>
          <PlanLimitsGroup
            limits={limitsShown}
            reload={limitsReading.reload}
            status={limitsReading.reading.status}
          />
          <WhenUsedUpGroup config={config} onChange={onChange} />
        </>
      ) : null}
      <UsageHistorySection
        reading={reading}
        usage={usage}
        view={view}
        period={period}
        onPeriod={setPeriod}
        measure={measure}
        onMeasure={setMeasure}
        money={config.usage.money}
        plans={plans}
        onShowValue={(on) => onChange({ usage: { money: on ? "value" : "spend" } })}
        reload={reload}
      />
    </div>
  )
}
