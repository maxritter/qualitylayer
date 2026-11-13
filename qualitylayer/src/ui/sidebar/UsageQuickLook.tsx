import { CoinsIcon } from "lucide-react"
import { dailyMoney } from "../../core/cost/display.ts"
import type { Usage } from "../../core/cost/usage.ts"
import type { AgentLimits } from "../../core/limits/index.ts"
import { percentage, readingId } from "../../core/usage-display.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { useUsageDisplay } from "../usage/display-context.tsx"
import { usd } from "../usage/format.ts"
import { limitFaces } from "./limits-face.ts"
import "./usage-quick-look.css"

export function UsageQuickLook({
  limits,
  usage,
  now,
}: {
  limits: readonly AgentLimits[]
  usage: Usage | null
  now: number
}) {
  const preferences = useUsageDisplay()
  const selected = new Set(preferences.readings)
  const visibleLimits = selected.has("auto")
    ? limits
    : limits
        .filter((agent) =>
          preferences.readings.some((id) => id.startsWith(`${agent.agent}:limit:`)),
        )
        .map((agent) => ({
          ...agent,
          windows: selected.has(readingId(agent.agent, "limit", "closest"))
            ? agent.windows
            : agent.windows.filter((window) =>
                selected.has(readingId(agent.agent, "limit", window.label)),
              ),
        }))
  const faces = limitFaces(visibleLimits, now)
  const money = dailyMoney(usage, preferences.money, now)
  const unread = visibleLimits.filter(
    (agent) => agent.cause === "failed" || agent.cause === "not-read",
  )
  return (
    <div className="q-usage-quick" data-testid="usage-quick-look">
      {faces.slice(0, 3).map((face) => (
        <div
          className="q-usage-quick-agent"
          key={face.agent}
          title={`${face.name}: ${face.window.label}${face.resets ? `, resets in ${face.resets}` : ""}`}
        >
          <AgentMark agent={face.agent} size={14} />
          <span>{face.name}</span>
          <span className="q-usage-quick-window">
            {face.window.label.replace("This week", "Week").replace("This month", "Month")}
          </span>
          <b>
            {face.credits
              ? "credits"
              : `${percentage(100 - face.left, preferences.percent)} % ${preferences.percent}`}
          </b>
        </div>
      ))}
      {faces.length > 3 ? <p>{faces.length - 3} more quotas in Usage</p> : null}
      {unread.length > 0 ? (
        <p title={unread.map((agent) => `${agent.name}: ${agent.reason}`).join("; ")}>
          {unread.length} {unread.length === 1 ? "quota unavailable" : "quotas unavailable"}
        </p>
      ) : null}
      {money.usd !== null ? (
        <div className="q-usage-quick-total">
          <CoinsIcon size={14} />
          <span>{preferences.money === "value" ? "Today at API prices" : "API spend today"}</span>
          <b>{usd(money.usd)}</b>
        </div>
      ) : null}
    </div>
  )
}
