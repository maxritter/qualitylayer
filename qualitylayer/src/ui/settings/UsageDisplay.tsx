import { CalculatorIcon, GaugeIcon, MonitorIcon, SlidersHorizontalIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { readingOptions, readingText, selectedReadings } from "../../core/cost/display.ts"
import type { Usage } from "../../core/cost/usage.ts"
import type { AgentLimits } from "../../core/limits/index.ts"
import type { UsageDisplay } from "../../core/usage-display.ts"
import { InfoHint } from "../kit/InfoHint.tsx"
import { AgentMark } from "../kit/marks/index.ts"
import { SettingRow, SettingsGroup, SettingsMore } from "./Rows.tsx"
import "./usage-display.css"

export function UsageDisplaySettings({
  value,
  onChange,
  limits,
  usage,
}: {
  value: UsageDisplay
  onChange: (patch: Partial<UsageDisplay>) => void
  limits: readonly AgentLimits[]
  usage: Usage | null
}) {
  const options = readingOptions(limits, usage, Date.now())
  const selected = selectedReadings(value, options)
  const agents = [...new Set(options.map((option) => option.agent))]
  const totalMode = !value.total ? "off" : value.money
  const toggle = (id: string) => {
    const ids = selected.map((option) => option.id)
    onChange({ readings: ids.includes(id) ? ids.filter((one) => one !== id) : [...ids, id] })
  }
  return (
    <SettingsGroup title="Usage display" testId="usage-display-settings">
      <SettingRow
        label="Subscription percentages"
        hint="Show used or remaining usage across the App."
        icon={<GaugeIcon className="size-[15px]" />}
      >
        <select
          className="q-usage-select"
          aria-label="Subscription percentages"
          value={value.percent}
          onChange={(event) => onChange({ percent: event.target.value as UsageDisplay["percent"] })}
        >
          <option value="used">Used</option>
          <option value="remaining">Remaining</option>
        </select>
      </SettingRow>
      <SettingRow
        label="Show usage in the menu bar"
        hint="Readings beside the icon on macOS. Click it for usage."
        icon={<MonitorIcon className="size-[15px]" />}
        stay
      >
        <Switch
          checked={value.menuBar}
          aria-label="Show usage in the menu bar"
          onCheckedChange={(menuBar) => onChange({ menuBar })}
        />
      </SettingRow>
      <SettingRow
        label={
          <>
            Daily total{" "}
            <InfoHint
              label="About daily totals"
              text="API spend includes metered usage with known billing. API-price value compares all priced token usage, including subscriptions, at the same rates. Credits are never dollars."
            />
          </>
        }
        hint="Menu-bar total. The money basis also applies to statistics."
        icon={<CalculatorIcon className="size-[15px]" />}
      >
        <select
          className="q-usage-select"
          aria-label="Daily total"
          disabled={!value.menuBar}
          value={totalMode}
          onChange={(event) =>
            onChange({
              total: event.target.value !== "off",
              ...(event.target.value !== "off"
                ? { money: event.target.value as UsageDisplay["money"] }
                : {}),
            })
          }
        >
          <option value="off">Off</option>
          <option value="spend">API spend ($)</option>
          <option value="value">All usage at API prices ($)</option>
        </select>
      </SettingRow>
      <SettingsMore
        summary={
          <>
            <SlidersHorizontalIcon className="size-[15px]" />
            <span title="Quota choices also select what appears in the Usage popup">
              Menu bar readings
            </span>
            <span className="q-usage-selected">{selected.length} selected</span>
          </>
        }
      >
        <fieldset className="q-usage-readings" disabled={!value.menuBar}>
          <legend className="sr-only">Choose menu bar readings</legend>
          {agents.map((agent) => {
            const choices = options.filter((option) => option.agent === agent)
            return (
              <div className="q-usage-agent" key={agent}>
                <div className="q-usage-agent-name">
                  <AgentMark agent={agent} />
                  <b>{choices[0]?.name}</b>
                </div>
                <div className="q-usage-options">
                  {choices.map((choice) => (
                    <label
                      key={choice.id}
                      title={choice.kind === "cost" && choice.available ? undefined : choice.reason}
                    >
                      <input
                        type="checkbox"
                        checked={selected.some((one) => one.id === choice.id)}
                        onChange={() => toggle(choice.id)}
                      />
                      <span>{choice.label}</span>
                      <small>{readingText(choice, value)}</small>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
          {selected
            .filter((option) => !options.some((one) => one.id === option.id))
            .map((option) => (
              <label className="q-usage-missing" key={option.id}>
                <input type="checkbox" checked onChange={() => toggle(option.id)} />
                <AgentMark agent={option.agent} />
                <span>
                  {option.name} · {option.label} · not reported
                </span>
              </label>
            ))}
          {options.length === 0 ? (
            <p className="q-us-note">No usage readings have been reported yet.</p>
          ) : null}
        </fieldset>
      </SettingsMore>
    </SettingsGroup>
  )
}
