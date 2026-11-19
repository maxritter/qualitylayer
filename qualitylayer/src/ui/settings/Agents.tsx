// Settings › Agents: the eight agents with where each stands, another agent by its program, and the
// shell a plain Terminal opens. What starts a program (a command, arguments, a folder, the shell, a
// default permission mode) can only be changed from the App or a browser it opened. Model choices live
// in Settings › Models, how a session opens in Appearance.

import { SquareTerminalIcon } from "lucide-react"
import { useState } from "react"
import { NATIVE_AGENTS, type NativeAgent } from "../../core/agents/ids.ts"
import { type AgentSettings, validAbsolutePath } from "../../core/config-values.ts"
import type { Api, Config } from "../api.ts"
import { routeHash } from "../hooks.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { checkedWords } from "./About.tsx"
import { useAgentHealth } from "./AgentHealth.tsx"
import { AgentTable } from "./AgentTable.tsx"
import { AnotherAgent } from "./AnotherAgent.tsx"
import { integrationState } from "./agent-facts.tsx"
import { CommitField, type SaveResult } from "./CommitField.tsx"
import { LaunchSheet } from "./LaunchSheet.tsx"
import { SettingRow, SettingsGroup } from "./Rows.tsx"
import { type Reading, useIntegration } from "./useIntegration.ts"

const PATH_PROBLEM = "Use an absolute path, like /bin/zsh, or leave it empty."
const NOT_PERMITTED = "Change this from QualityLayer or a browser it opened."

type Change = (patch: unknown) => SaveResult
/** Copies a line of text, with a few words for the toast that says so. */
type Copy = (text: string, note: string) => unknown
/** What the page reads and does: the last checks, where QualityLayer's part of each agent stands, and Repair. */
type AgentsApi = Pick<Api, "agentHealth" | "checkAgents" | "agentIntegration" | "repairAgent">

/** The group's verdict: "6 ready · 1 out of date". Each exception is counted by its own words, what needs the person first. */
function verdictWords(
  rows: {
    health: Parameters<typeof integrationState>[0]
    integration: Parameters<typeof integrationState>[1]
  }[],
  reading: Reading,
): string {
  const states = rows.map((row) => integrationState(row.health, row.integration, reading))
  const order = ["warn", "unknown", "missing"]
  const others = new Map<string, { kind: string; count: number }>()
  for (const state of states) {
    if (state.kind === "ok") continue
    const words = state.text.replace("…", "").toLowerCase()
    others.set(words, { kind: state.kind, count: (others.get(words)?.count ?? 0) + 1 })
  }
  const ready = states.filter((state) => state.kind === "ok").length
  const exceptions = [...others]
    .sort(([, a], [, b]) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map(([words, { count }]) => `${count} ${words}`)
  return [`${ready} ready`, ...exceptions].join(" · ")
}

function AgentsGroup({
  config,
  api,
  permitted,
  onChange,
  onCopy,
  onModels,
}: {
  config: Config
  api?: AgentsApi
  permitted: boolean
  onChange: Change
  onCopy?: Copy | undefined
  onModels: (agent: NativeAgent) => void
}) {
  const { agents, checking, error, check } = useAgentHealth(api)
  const integration = useIntegration(api)
  const [editing, setEditing] = useState<NativeAgent | null>(null)
  const checkedAt = agents.reduce<number | null>(
    (latest, row) =>
      row.checkedAt !== null && row.checkedAt > (latest ?? 0) ? row.checkedAt : latest,
    null,
  )
  const recheck = async () => {
    await check()
    await integration.reload()
  }
  const rows = NATIVE_AGENTS.map((agent) => ({
    agent,
    health: agents.find((row) => row.agent === agent),
    integration: integration.rows.find((row) => row.agent === agent),
    enabled: config.agents[agent].enabled,
  }))
  return (
    <SettingsGroup
      title="On this computer"
      testId="agent-health"
      end={
        <>
          <span title={checking ? undefined : checkedWords(checkedAt)}>
            {checking ? "checking…" : verdictWords(rows, integration.reading)}
          </span>{" "}
          ·{" "}
          <button
            type="button"
            className="q-link"
            disabled={checking || !permitted || api?.checkAgents === undefined}
            title={permitted ? undefined : NOT_PERMITTED}
            onClick={() => void recheck()}
          >
            Check again
          </button>
        </>
      }
    >
      <AgentTable
        rows={rows}
        permitted={permitted}
        repairing={integration.repairing}
        reading={integration.reading}
        onRetry={() => void integration.reload()}
        onCopy={(text) => onCopy?.(text, "Copied the install command")}
        onUse={(agent, enabled) => onChange({ agents: { [agent]: { enabled } } })}
        onRepair={(agent) => void integration.repair(agent)}
        onEdit={setEditing}
        onModels={onModels}
      />
      {error ? (
        <p role="alert" className="q-sg-foot q-sg-problem">
          {error}
        </p>
      ) : null}
      {integration.problem ? (
        <p role="alert" className="q-sg-foot q-sg-problem">
          {integration.problem}
        </p>
      ) : null}
      {integration.said ? (
        <p role="status" className="q-sg-foot">
          {integration.said}
        </p>
      ) : null}
      {editing !== null ? (
        <LaunchSheet
          agent={editing}
          health={agents.find((row) => row.agent === editing)}
          settings={config.agents[editing] as AgentSettings}
          permission={config.perm}
          efforts={{
            planning: config.planning.defaults[editing].effort,
            implement: config.implement.defaults[editing].effort,
          }}
          permitted={permitted}
          onSave={onChange}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </SettingsGroup>
  )
}

function TerminalShell({
  config,
  permitted,
  onChange,
}: {
  config: Config
  permitted: boolean
  onChange: Change
}) {
  return (
    <SettingsGroup title="Terminal" testId="terminal-shell">
      <SettingRow
        label="Shell"
        icon={<SquareTerminalIcon className="size-[15px]" />}
        hint={permitted ? "What a plain Terminal opens in a task or artifact." : NOT_PERMITTED}
      >
        <CommitField
          label="Terminal shell"
          value={config.terminal.shell.program}
          placeholder="/bin/zsh"
          disabled={!permitted}
          problem={(next) => (validAbsolutePath(next) ? null : PATH_PROBLEM)}
          onCommit={(program) => onChange({ terminal: { shell: { program } } })}
        />
      </SettingRow>
    </SettingsGroup>
  )
}

export function AgentsTab({
  config,
  api,
  onChange,
  onCopy,
}: {
  config: Config
  api?: AgentsApi
  onChange: Change
  onCopy?: Copy | undefined
}) {
  const permitted = useOptionalRuns()?.support?.canConfigure === true
  // A row's model button opens Settings › Models on that agent.
  const openModels = (agent: NativeAgent) => {
    window.location.hash = routeHash({ view: "settings", tab: "models", modelAgent: agent })
  }
  return (
    <div className="q-sgs">
      <AgentsGroup
        config={config}
        api={api}
        permitted={permitted}
        onChange={onChange}
        onCopy={onCopy}
        onModels={openModels}
      />
      <AnotherAgent config={config} permitted={permitted} onChange={onChange} />
      <TerminalShell config={config} permitted={permitted} onChange={onChange} />
    </div>
  )
}
