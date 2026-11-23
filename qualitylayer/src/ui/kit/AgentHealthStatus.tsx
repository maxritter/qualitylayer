// The agents in Setup: one row each with its mark and name, then where it stands (its account, "Out of
// date", "Not installed") and the one action that fits: Repair, or Install… with the vendor's page or
// command. The row opens its setup help. Seven agents; none is hidden.

import { TriangleAlertIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AGENT_SETUP, type AgentHealth, SIGNING_IN } from "../../core/agents/health-types.ts"
import { AGENT_DISPLAY_ORDER, AGENT_NAMES, type NativeAgent } from "../../core/agents/ids.ts"
import type { IntegrationHealth } from "../../core/install/integration.ts"
import { integrationState } from "../settings/agent-facts.tsx"
import type { Reading } from "../settings/useIntegration.ts"
import { InstallAction } from "./InstallAction.tsx"
import { AgentMark } from "./marks/index.ts"

/** The sign-in line for an available agent; when the check could not tell, what it rests on. */
function accountDetail(health: AgentHealth): string {
  if (health.accountCheck?.state === "unknown" && health.accountTitle)
    return `${health.account}: ${health.accountTitle}.`
  return health.account ?? "Sign-in not checked."
}

/** The account as the row says it: the plan alone when there is one ("Claude Max"), else the line. */
function accountLine(health: AgentHealth): string | null {
  const check = health.accountCheck
  if (health.account === SIGNING_IN) return SIGNING_IN
  if (check?.state === "signed-in" && check.plan !== undefined && check.providers === undefined)
    return check.plan
  return health.account ?? null
}

type Standing = {
  /** The row's name for the state: "Available", "Out of date", "Not installed". */
  status: string
  /** What the row says beside the name; null for an agent that is not installed. */
  line: string | null
  warn: boolean
  missing: boolean
  outOfDate: boolean
}

/** The word for where one agent stands, from the version check and QualityLayer's own part of it. */
function statusWord(
  health: AgentHealth | undefined,
  checking: boolean,
  outOfDate: boolean,
): string {
  if (checking) return "Checking…"
  const words: Record<AgentHealth["status"], string> = {
    "not-found": "Not installed",
    failed: "Needs attention",
    available: outOfDate ? "Out of date" : "Available",
    "not-checked": "Not checked",
  }
  return words[health?.status ?? "not-checked"]
}

function standing(
  health: AgentHealth | undefined,
  checking: boolean,
  outOfDate: boolean,
): Standing {
  const status = statusWord(health, checking, outOfDate)
  const known = status === "Available" && health !== undefined ? accountLine(health) : null
  return {
    status,
    line: status === "Not installed" ? null : (known ?? status),
    warn: status === "Needs attention" || status === "Out of date",
    missing: status === "Not installed",
    outOfDate: status === "Out of date",
  }
}

type AgentRowsProps = {
  agents: readonly AgentHealth[]
  checking?: boolean
  /** Where QualityLayer's own part of each agent stands; an agent with no row there is never "out of date". */
  integration?: readonly IntegrationHealth[]
  reading?: Reading
  repairing?: NativeAgent | null
  onRepair?: (agent: NativeAgent) => void
  /** Puts an install command on the clipboard. */
  onCopy?: (text: string) => unknown
}

function RowHelp({
  agent,
  health,
  status,
  note,
}: {
  agent: NativeAgent
  health: AgentHealth | undefined
  status: Standing
  note: string | null
}) {
  const found = health?.status === "available"
  const detail = found
    ? `${health.version}. ${accountDetail(health)}`
    : health?.detail || "Check the executable and version. No model request is made."
  return (
    <PopoverContent
      align="end"
      collisionPadding={16}
      className="w-80 max-w-[min(calc(100vw-32px),var(--available-width))] p-4 text-sm leading-relaxed"
    >
      <p className="font-medium">
        {AGENT_NAMES[agent]} · {status.status}
      </p>
      <p className="mt-2 break-words">{detail}</p>
      {note !== null ? <p className="mt-2 break-words">{note}</p> : null}
      {health?.path ? (
        <p className="mt-2 break-all font-mono text-muted-foreground">{health.path}</p>
      ) : null}
      {!found ? (
        <p className="mt-2">
          Install or repair the agent, check its PATH or QualityLayer executable override, then
          check again.
        </p>
      ) : null}
      <a
        className="q-link mt-2 inline-block"
        href={AGENT_SETUP[agent]}
        target="_blank"
        rel="noreferrer"
      >
        Installation and help
      </a>
    </PopoverContent>
  )
}

/** The state of one agent as the row computes it: the words for the tile, and the line an exception gets. */
function rowOf(props: AgentRowsProps, agent: NativeAgent, health: AgentHealth | undefined) {
  const mine = props.integration?.find((row) => row.agent === agent)
  const state = integrationState(health, mine, props.reading ?? "reading")
  const status = standing(health, props.checking === true, state.repairable)
  return { state, status }
}

function exceptionPhrase(status: Standing): string {
  if (status.missing) return "is not installed"
  return status.outOfDate ? "is out of date" : "needs attention"
}

function AgentExceptionLine({
  agent,
  name,
  status,
  repairing,
  onRepair,
  onCopy,
}: {
  agent: NativeAgent
  name: string
  status: Standing
  repairing?: NativeAgent | null
  onRepair?: (agent: NativeAgent) => void
  onCopy?: (text: string) => unknown
}) {
  return (
    <p className="q-onb-agent-ex" data-warn={status.warn || undefined}>
      {status.warn ? <TriangleAlertIcon className="size-3.5" aria-hidden="true" /> : null}
      <span>
        {name} {exceptionPhrase(status)}
      </span>
      {status.missing ? <InstallAction agent={agent} onCopy={onCopy ?? (() => undefined)} /> : null}
      {status.outOfDate && onRepair !== undefined ? (
        <button
          type="button"
          className="q-link"
          disabled={repairing === agent}
          aria-label={`Repair ${name}`}
          onClick={() => onRepair(agent)}
        >
          {repairing === agent ? "Repairing…" : "Repair"}
        </button>
      ) : null}
    </p>
  )
}

/**
 * One agent: a tile with its brand mark alone, an amber dot while it needs the person, dimmed while it is
 * not installed. Its name and where it stands are the tile's accessible name, tooltip and screen-reader
 * text; the tile opens its setup help. Words come only for an exception, in a line under the row of tiles
 * with the one action that fits: Repair, or Install….
 */
function AgentRow({
  agent,
  checking,
  health,
  integration,
  reading,
  repairing,
  onRepair,
  onCopy,
}: AgentRowsProps & { agent: NativeAgent; health: AgentHealth | undefined }) {
  const name = AGENT_NAMES[agent]
  const { state, status } = rowOf({ agents: [], checking, integration, reading }, agent, health)
  const known = health?.status === "available" ? accountLine(health) : null
  const label = `${name}: ${status.status}${known !== null && !status.outOfDate ? `, ${health?.account ?? known}` : ""}. Setup help`
  const exception = checking !== true && (status.missing || status.warn)
  return (
    <div
      className="q-onb-agent"
      data-missing={status.missing || undefined}
      data-warn={status.warn || undefined}
    >
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="q-onb-agent-status"
              title={`${name} · ${status.line === null ? status.status : (health?.account ?? status.line)}`}
              aria-label={label}
              data-agent={agent}
              data-version={health?.version ?? undefined}
            />
          }
        >
          <AgentMark agent={agent} size={18} />
          {status.warn ? <i className="q-onb-agent-dot" aria-hidden="true" /> : null}
          <span className="sr-only">
            <b className="q-onb-agent-name">{name}</b>{" "}
            <span className="q-onb-agent-line">{status.line ?? status.status}</span>
          </span>
        </PopoverTrigger>
        <RowHelp agent={agent} health={health} status={status} note={state.detail} />
      </Popover>
      {exception ? (
        <AgentExceptionLine
          agent={agent}
          name={name}
          status={status}
          repairing={repairing}
          onRepair={onRepair}
          onCopy={onCopy}
        />
      ) : null}
    </div>
  )
}

export function AgentHealthStatuses(props: AgentRowsProps) {
  return (
    <div className="q-onb-agents">
      {AGENT_DISPLAY_ORDER.map((agent) => (
        <AgentRow
          key={agent}
          {...props}
          agent={agent}
          health={props.agents.find((row) => row.agent === agent)}
        />
      ))}
    </div>
  )
}
