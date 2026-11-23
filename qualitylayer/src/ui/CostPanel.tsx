// What a task cost so far, read on this machine from the agents' own transcripts: the total, a bar
// by step, and per step its time, tokens and cost, with the agents each step ran named after their
// work and model. Dollar figures cover known list prices; tokens stay in their own column.

import { type Dispatch, type SetStateAction, useState } from "react"
import { type TaskCost, tokenWords, worthALook } from "../core/cost/labels.ts"
import type { FlowStepId } from "../core/flow.ts"
import {
  CostBar,
  CostStepSection,
  costWords,
  NUM,
  STEP_COLOUR,
  timeWords,
  unpricedTokens,
} from "./cost-panel-parts.tsx"
import { InfoHint } from "./kit/InfoHint.tsx"

export { STEP_COLOUR, tokenWords }

/** The dollars a cost has a figure for: its total, or, with a session's usage not read, what its steps add up to. */
const knownUsd = (cost: TaskCost): number =>
  cost.total.usd ?? cost.steps.reduce((sum, step) => sum + (step.usd ?? 0), 0)

/** The known dollars, or a dash when no recorded usage has a price. */
export function costHeadline(cost: TaskCost): string {
  if (
    cost.total.usd === null &&
    !cost.steps.some(
      (step) => step.usd !== null && (step.usd > 0 || step.all > unpricedTokens(step)),
    )
  )
    return "—"
  return costWords({ ...cost.total, usd: knownUsd(cost) })
}

/** The same known-dollar summary in the task header. */
export function costChip(cost: TaskCost): string {
  return costHeadline(cost)
}

function CostHeadlineSummary({ cost }: { cost: TaskCost }) {
  const hasCredits = cost.total.nativeCredits?.amount !== undefined
  const label = hasCredits
    ? cost.total.estimateUsd !== undefined
      ? "Usage value + list estimate"
      : "AI-credit usage value"
    : "so far"
  const hint = hasCredits
    ? "Copilot credit value; not an additional charge. Other usage at API prices."
    : "Estimated at list price."
  return (
    <div className="grid gap-0.5" data-testid="cost-headline">
      <b className="text-[26px] font-semibold leading-tight tracking-[-0.03em] tabular-nums">
        {costHeadline(cost)}
      </b>
      <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
        {label}
        {cost.total.ms > 0 ? ` · ${timeWords(cost.total.ms)}` : ""}
        <InfoHint text={hint} />
      </span>
    </div>
  )
}

export function CostTable({ cost, live }: { cost: TaskCost; live?: FlowStepId }) {
  const [open, setOpen] = useState<Set<FlowStepId>>(() => new Set())
  // The groups of agents a person folded, and the ones that show every agent.
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [listed, setListed] = useState<Set<string>>(new Set())
  const flip = <T,>(set: Dispatch<SetStateAction<Set<T>>>, value: T) =>
    set((now) => {
      const next = new Set(now)
      if (!next.delete(value)) next.add(value)
      return next
    })
  const worth = worthALook(cost)
  return (
    <div className="@container min-w-0 grid gap-3 text-[13px]" data-testid="cost-panel">
      <CostHeadlineSummary cost={cost} />
      {cost.steps.length === 0 ? (
        <p className="m-0 text-muted-foreground">
          No transcript of this task's sessions is on this machine yet.
        </p>
      ) : (
        <>
          <CostBar cost={cost} live={live} />
          <table className="w-full table-fixed border-collapse" data-testid="cost-steps">
            <thead>
              <tr className="text-left text-[12px] font-normal text-dim">
                <th className="w-[40%] pb-1.5 font-normal">Step</th>
                <th className={`${NUM} w-[20%] pb-1.5 font-normal`}>Time</th>
                <th className={`${NUM} w-[16%] pb-1.5 font-normal`}>Tokens</th>
                <th className={`${NUM} w-[24%] pb-1.5 font-normal`}>Cost</th>
              </tr>
            </thead>
            {cost.steps.map((s) => (
              <CostStepSection
                key={s.step}
                step={s}
                helpers={cost.helpers.filter((h) => h.step === s.step)}
                checks={cost.checks?.step === s.step ? cost.checks : null}
                live={live}
                isOpen={open.has(s.step)}
                folded={folded}
                listed={listed}
                onToggle={(step) => flip(setOpen, step)}
                onFold={(key) => flip(setFolded, key)}
                onList={(key) => flip(setListed, key)}
              />
            ))}
            <tfoot>
              <tr className="border-t border-strong font-semibold" data-testid="cost-total">
                <td className="py-2">Total</td>
                <td className={NUM}>{cost.total.ms > 0 ? timeWords(cost.total.ms) : ""}</td>
                <td className={NUM}>{tokenWords(cost.total.all)}</td>
                <td className={NUM}>{costHeadline(cost)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
      {worth !== null ? (
        <p
          className="m-0 flex items-start gap-2.5 rounded-[10px] border border-dashed border-line px-3 py-2.5"
          data-testid="cost-worth"
        >
          <span
            className="mt-1 size-3 shrink-0 rounded-full border-2 border-review"
            aria-hidden="true"
          />
          <span>
            <b className="font-semibold">Worth a look.</b> {worth.text}
          </span>
        </p>
      ) : null}
      <p className="m-0 text-right text-[12px]">
        <a href="#/settings/usage" className="q-link">
          Usage history
        </a>
      </p>
    </div>
  )
}
