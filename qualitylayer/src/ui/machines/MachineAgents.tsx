import { CheckIcon, TerminalIcon } from "lucide-react"
import { useEffect } from "react"
import { createPortal } from "react-dom"
import type { AgentHealth } from "../../core/agents/health-types.ts"
import { AGENT_NAMES, type NativeAgent } from "../../core/agents/ids.ts"
import {
  type AgentSetupCapability,
  type AgentSetupState,
  usableSetupAgent,
} from "../../core/agents/setup.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { MachineSetupTerminal } from "./MachineSetupTerminal.tsx"
import {
  type MachineHealthApi,
  setupContextOf,
  setupRunning,
  useMachineSetup,
} from "./useMachineSetup.ts"
import "./machine-setup.css"

function accountWord(row: AgentHealth | undefined, enabled: boolean): string {
  if (!enabled) return "Disabled"
  if (row?.status === "not-found") return "Not installed"
  if (row?.status === "failed") return "Needs attention"
  if (row?.status !== "available") return "Not checked"
  if (row.accountCheck?.state === "signed-in")
    return row.accountCheck.plan ?? row.account ?? "Signed in"
  return row.account ?? "Installed"
}

type Setup = ReturnType<typeof useMachineSetup>
function AgentRow({ capability, setup }: { capability: AgentSetupCapability; setup: Setup }) {
  const { agent } = capability
  const health = setup.agents.find((row) => row.agent === agent)
  const run = setup.latest.get(agent)
  const context = run && setupContextOf(run)
  const active = run && setupRunning(run)
  const missing = health?.status === "not-found" || health?.status === "failed"
  const signingOut = health?.accountCheck?.state === "signed-out"
  const operation =
    missing && capability.install
      ? "install"
      : capability.signIn && (signingOut || health?.accountCheck?.state === "unknown")
        ? "sign-in"
        : null
  const busy = setup.starting === agent
  return (
    <div className="q-machine-agent" data-agent={agent}>
      <AgentMark agent={agent} size={16} />
      <b>{AGENT_NAMES[agent]}</b>
      <span className="q-machine-agent-state">
        {busy
          ? "Starting…"
          : active
            ? context?.operation === "install"
              ? "Installing…"
              : "In the terminal"
            : accountWord(health, capability.enabled)}
      </span>
      <span className="q-machine-agent-actions">
        {!capability.enabled ? (
          <a className="q-link" href="#/settings/agents">
            Agents settings
          </a>
        ) : active ? (
          <button type="button" className="q-btn sm" onClick={() => setup.show(run.id)}>
            <TerminalIcon className="size-3.5" />
            Terminal
          </button>
        ) : operation ? (
          <button
            type="button"
            className="q-btn sm"
            disabled={busy || !setup.runs?.support?.canStart}
            onClick={() => void setup.start(agent, operation)}
          >
            {operation === "install"
              ? context?.operation === "install"
                ? "Retry install"
                : "Install"
              : "Sign in"}
          </button>
        ) : missing || signingOut ? (
          <a className="q-link" href={capability.guide} target="_blank" rel="noopener noreferrer">
            Setup guide
          </a>
        ) : run ? (
          <button
            type="button"
            className="q-ibtn"
            aria-label={`${AGENT_NAMES[agent]} setup output`}
            onClick={() => setup.show(run.id)}
          >
            <TerminalIcon className="size-3.5" />
          </button>
        ) : null}
      </span>
      {health?.detail ? (
        <details className="q-machine-agent-detail">
          <summary>Details</summary>
          <p>{health.detail}</p>
        </details>
      ) : null}
    </div>
  )
}

export function MachineAgents({
  state,
  api,
  number = 3,
  onReady,
  terminalRoot,
}: {
  state: AgentSetupState
  api: MachineHealthApi
  number?: number
  onReady: (agent: NativeAgent | null) => void
  terminalRoot: HTMLElement | null
}) {
  const setup = useMachineSetup(api)
  const { selected, runs } = setup
  const ready =
    state.agents.find((capability) => {
      const run = setup.latest.get(capability.agent)
      return (
        capability.enabled &&
        !(run && setupRunning(run)) &&
        usableSetupAgent(setup.agents.find((row) => row.agent === capability.agent))
      )
    })?.agent ?? null
  useEffect(() => onReady(ready), [onReady, ready])
  const rows = state.agents.map((capability) => (
    <AgentRow key={capability.agent} capability={capability} setup={setup} />
  ))
  return (
    <>
      <div className="q-onb-st" data-testid="agents-step">
        <span className={`n ${ready ? "ok" : "you"}`}>
          {ready ? <CheckIcon className="size-3.5" aria-label="Done" /> : number}
        </span>
        <span className="t">Agents</span>
        <span className="r">
          <button
            type="button"
            className="q-link"
            disabled={setup.checking}
            onClick={() => void setup.check()}
          >
            {setup.checking ? "Checking…" : "Check again"}
          </button>
        </span>
        <div className="d q-machine-agent-list">
          {rows.slice(0, 2)}
          {rows.length > 2 ? (
            <details className="q-machine-more">
              <summary>{rows.length - 2} more agents</summary>
              {rows.slice(2)}
            </details>
          ) : null}
        </div>
        {setup.error ? (
          <p role="alert" className="d">
            {setup.error}
          </p>
        ) : null}
        {!setup.runs?.support?.canStart && setup.runs?.support?.reason ? (
          <p className="d q-onb-small">{setup.runs.support.reason}</p>
        ) : null}
      </div>
      {selected && runs && terminalRoot
        ? createPortal(
            <MachineSetupTerminal
              run={selected}
              adapter={runs.adapter}
              machine={state.machine}
              onClose={setup.hide}
              onStop={() =>
                runs.control(selected.id, {
                  action: "stop",
                  generation: selected.generation,
                })
              }
            />,
            terminalRoot,
          )
        : null}
    </>
  )
}
