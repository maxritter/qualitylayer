// A feature's extra planners in New task (Max, 11 November 2026). Each is another agent on this
// computer with its model and effort, the same row as the planner's. Each reads the Plan on its own
// model and challenges it; together they take the place of the Plan's second opinion (review/cross.ts).
// They cost money and nobody needs them by default, so they wait in a closed row in the card's
// normal colours ("Extra planners · None"); opened, a muted line says each is another paid planning run.
// Once one is added the closed row keeps their names and the paid runs in view. The App has token
// prices but no measured size of a planning run, so the cost names the runs, not a dollar figure.

import { ChevronRightIcon, PlusIcon, UsersIcon, WalletIcon, XIcon } from "lucide-react"
import { useId, useState } from "react"
import { AGENT_NAMES, type NativeAgent } from "../../core/agents/ids.ts"
import { knownModels, planModel, usableDefault } from "../../core/agents/model-values.ts"
import type { EffortChoice } from "../../core/config-values.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { ModelPick } from "../ModelPick.tsx"
import { OWN_PICK } from "../settings/Defaults.tsx"
import {
  agentEfforts,
  agentModelChoices,
  availableLaunchAgents,
  type LaunchAgentDiscovery,
  ModelEffortPicks,
} from "./AgentLaunchFields.tsx"
import { modelFamily } from "./model-family.ts"
import "./extra-planners.css"

/** One extra planner as New task holds it; effort "" where the agent's effort is part of its model. */
export type PlannerPick = { agent: NativeAgent; model: string; effort: EffortChoice }

/** The most extra planners a task carries (review/planners.ts EXTRA_PLANNERS). */
export const MAX_EXTRA_PLANNERS = 2

/** `task start --planners` takes each as `agent:model[:effort]`. */
export const plannerSpec = (p: PlannerPick): string =>
  `${p.agent}:${p.model}${p.effort === "" ? "" : `:${p.effort}`}`

/** A planner on an agent starts on its catalog's planning model at high effort, where it has one. */
export function plannerOn(agent: NativeAgent): PlannerPick {
  const model = planModel(agent)
  return {
    agent,
    model: agent === "pi" ? usableDefault(agent, model, knownModels(agent)) : model,
    effort: agentEfforts(agent).length ? "high" : "",
  }
}

const familyOf = (agent: NativeAgent) => {
  const model = planModel(agent)
  return modelFamily({ id: model, name: model }, AGENT_NAMES[agent])
}

/** The next planner offered: an agent here that is not taken, from another model family when one is. */
export function nextPlanner(
  main: NativeAgent | "other",
  taken: readonly NativeAgent[],
  available: readonly NativeAgent[],
): NativeAgent | undefined {
  const free = available.filter((agent) => agent !== main && !taken.includes(agent))
  const seen = [main, ...taken].map((agent) => (agent === "other" ? null : familyOf(agent)))
  return free.find((agent) => !seen.includes(familyOf(agent))) ?? free[0]
}

/** The planners that stay valid beside this main planner: never the same agent, at most two. */
export const keptPlanners = (main: NativeAgent | "other", list: readonly PlannerPick[]) =>
  list.filter((p) => p.agent !== main).slice(0, MAX_EXTRA_PLANNERS)

export function ExtraPlanners({
  main,
  installed,
  value,
  onChange,
  disabled = false,
}: {
  main: NativeAgent | "other"
  installed: LaunchAgentDiscovery | null | undefined
  value: readonly PlannerPick[]
  onChange: (next: PlannerPick[]) => void
  disabled?: boolean
}) {
  const id = useId()
  const list = keptPlanners(main, value)
  const [open, setOpen] = useState(list.length > 0)
  const available = availableLaunchAgents(installed)
  const others = available.filter((agent) => agent !== main)
  const n = list.length
  const runs = n === 1 ? "+1 paid planning run" : `+${n} paid planning runs`
  const next = nextPlanner(
    main,
    list.map((p) => p.agent),
    available,
  )
  const put = (at: number, patch: Partial<PlannerPick>) =>
    onChange(list.map((p, i) => (i === at ? { ...p, ...patch } : p)))
  return (
    <section className="q-xp" data-open={open || undefined} data-testid="extra-planners">
      <button
        type="button"
        className="q-xp-toggle"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => setOpen(!open)}
      >
        <ChevronRightIcon size={13} className="q-xp-chev" aria-hidden="true" />
        <UsersIcon size={13} aria-hidden="true" />
        <span className="q-xp-title">Extra planners</span>
        <span className="q-xp-state">
          {n ? `${list.map((p) => AGENT_NAMES[p.agent]).join(", ")} · ${runs}` : "None"}
        </span>
      </button>
      {open ? (
        <div className="q-xp-body" id={`${id}-body`}>
          <p className="q-xp-line q-xp-cost">
            <WalletIcon size={12} aria-hidden="true" />
            Costs extra: each planner is another paid planning run on its model.
          </p>
          <p className="q-xp-line">
            Each reads the Plan on its own model and challenges it. They take the place of the
            Plan’s second opinion.
          </p>
          {list.map((p, at) => {
            const scope = `Extra planner ${at + 1}`
            const agents = others.filter(
              (agent) => agent === p.agent || !list.some((q) => q.agent === agent),
            )
            return (
              <fieldset
                key={p.agent}
                className="q-agent-launch-fields q-xp-row"
                data-inline
                data-effort={agentEfforts(p.agent).length === 0 ? "in-model" : undefined}
                aria-label={scope}
              >
                <div className="q-model-field q-pick-agent" title="Agent">
                  <ModelPick
                    label={`${scope}: agent`}
                    look="row"
                    value={p.agent}
                    disabled={disabled}
                    options={agents.map((agent) => ({
                      id: agent,
                      name: AGENT_NAMES[agent],
                      icon: <AgentMark agent={agent} size={14} />,
                    }))}
                    onChange={(agent) => put(at, plannerOn(agent as NativeAgent))}
                  />
                </div>
                <ModelEffortPicks
                  agent={p.agent}
                  scope={scope}
                  modelRole="Planner"
                  model={p.model}
                  effort={p.effort}
                  // A planner runs on a model the person names, at a level they name.
                  choices={agentModelChoices(p.agent, p.model, planModel(p.agent)).filter(
                    (o) => o.id !== OWN_PICK,
                  )}
                  efforts={agentEfforts(p.agent).filter((o) => o.id !== OWN_PICK)}
                  custom={undefined}
                  disabled={disabled}
                  onChange={(patch) => put(at, patch)}
                />
                <button
                  type="button"
                  className="q-xp-remove"
                  aria-label={`Remove ${scope.toLowerCase()}`}
                  title={`Remove ${scope.toLowerCase()}`}
                  disabled={disabled}
                  onClick={() => onChange(list.filter((_, i) => i !== at))}
                >
                  <XIcon size={14} aria-hidden="true" />
                </button>
              </fieldset>
            )
          })}
          {n < MAX_EXTRA_PLANNERS && next !== undefined ? (
            <button
              type="button"
              className="q-link q-xp-add"
              disabled={disabled}
              onClick={() => onChange([...list, plannerOn(next)])}
            >
              <PlusIcon size={13} aria-hidden="true" />
              {n ? "Add a third planner" : "Add a planner"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
