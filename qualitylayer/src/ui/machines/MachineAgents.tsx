import { CheckIcon } from "lucide-react"
import { useEffect } from "react"
import { createPortal } from "react-dom"
import type { NativeAgent } from "../../core/agents/ids.ts"
import { type AgentSetupState, usableSetupAgent } from "../../core/agents/setup.ts"
import { Disclosure } from "../kit/Fold.tsx"
import { AgentRow } from "./MachineAgentRow.tsx"
import { MachineSetupTerminal } from "./MachineSetupTerminal.tsx"
import { type MachineHealthApi, setupRunning, useMachineSetup } from "./useMachineSetup.ts"
import "./machine-setup.css"

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
            <Disclosure className="q-machine-more" head={`${rows.length - 2} more agents`}>
              {rows.slice(2)}
            </Disclosure>
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
