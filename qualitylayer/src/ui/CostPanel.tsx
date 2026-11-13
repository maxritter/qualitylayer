// What a task cost so far, read on this machine from the agents' own transcripts: the total, a bar
// by step, and per step its time, tokens and cost, with the agents each step ran named after their
// work and model. Dollar figures cover known list prices; tokens stay in their own column.

import { ChevronDownIcon, GaugeIcon } from "lucide-react"
import { type Dispatch, Fragment, type SetStateAction, useState } from "react"
import { type CostHelper, type TaskCost, tokenWords, worthALook } from "../core/cost/labels.ts"
import { FLOW_STEPS, type FlowStepId } from "../core/flow.ts"
import { InfoHint } from "./kit/InfoHint.tsx"

export { tokenWords }

const unpricedTokens = (line: { unpriced?: { tokens: number }[] }) =>
  line.unpriced?.reduce((sum, row) => sum + row.tokens, 0) ?? 0
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

const costWords = (line: {
  usd: number | null
  all: number
  unpriced?: { model: string; tokens: number }[]
}) => {
  const unpriced = unpricedTokens(line)
  if (line.usd === null || (line.usd === 0 && unpriced > 0 && unpriced >= line.all)) return "—"
  return `$${line.usd.toFixed(2)}`
}

/** "<1 min", "27 min", "2 h 26 min". */
function timeWords(ms: number): string {
  if (ms < 60_000) return "<1 min"
  const min = Math.round(ms / 60_000)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

/**
 * The step's colour in the bar and beside its name: one neutral ramp from light to dark, so the App's
 * amber (needs you), blue (agent working) and violet (checks) keep their meanings. Only the step
 * that is running now wears blue.
 */
export const STEP_COLOUR: Record<FlowStepId, string> = {
  plan: "color-mix(in oklab, var(--ql-text) 36%, var(--ql-bg))",
  implement: "color-mix(in oklab, var(--ql-text) 64%, var(--ql-bg))",
  verify: "color-mix(in oklab, var(--ql-text) 90%, var(--ql-bg))",
}
const LIVE_COLOUR = "var(--ql-accent)"

const stepLabel = (id: string) => FLOW_STEPS.find((s) => s.id === id)?.label ?? id

// Time, tokens and cost stay on one line whatever the window: the title column gives way instead.
const NUM =
  "whitespace-nowrap py-1.5 pl-3 text-right font-mono tabular-nums @max-[400px]:pl-1.5 @max-[400px]:text-[11px]"
// A title is cut with an ellipsis (its full text is on hover) so every row is one line.
const TITLE = "max-w-0 truncate py-1.5"

function Bar({ cost, live }: { cost: TaskCost; live?: FlowStepId }) {
  const weight = (s: TaskCost["steps"][number]) => s.all
  return (
    <div
      className="flex h-2 gap-px overflow-hidden rounded-full"
      data-testid="cost-bar"
      aria-hidden="true"
    >
      {cost.steps.map((s) => (
        <span
          key={s.step}
          className="h-full min-w-1"
          style={{
            flexGrow: Math.max(weight(s), 0.01),
            background: s.step === live ? LIVE_COLOUR : STEP_COLOUR[s.step],
          }}
        />
      ))}
    </div>
  )
}

function SubRow({
  name,
  ms,
  all,
  usd,
  indent = "pl-5",
}: {
  name: string
  ms?: number
  all: number | null
  usd: string
  indent?: string
}) {
  return (
    <tr className="border-t border-line text-muted-foreground">
      <td className={`${TITLE} ${indent}`} title={name}>
        {name}
      </td>
      <td className={NUM}>{ms !== undefined ? timeWords(ms) : ""}</td>
      <td className={NUM}>{all === null ? "–" : tokenWords(all)}</td>
      <td className={NUM}>{usd}</td>
    </tr>
  )
}

const named = (h: CostHelper) => `${h.label} · ${h.modelLabel}`

/** The agents a step ran that come in numbers, folded into one group each. */
const GROUPS: { name: string; kinds: CostHelper["kind"][] }[] = [
  { name: "Slices", kinds: ["slice"] },
  { name: "Checks", kinds: ["judge"] },
  { name: "Fixes", kinds: ["fix"] },
]
/** A group shows this many agents, the costliest first; the rest wait behind Show all. */
const SHOWN = 5
const byCost = (a: CostHelper, b: CostHelper) => (b.usd ?? -1) - (a.usd ?? -1) || b.all - a.all

/** One group of agents under its header: folded on a click, five costliest shown, the rest on Show all. */
function HelperGroup({
  name,
  helpers,
  folded,
  all,
  onFold,
  onAll,
}: {
  name: string
  helpers: CostHelper[]
  folded: boolean
  all: boolean
  onFold: () => void
  onAll: () => void
}) {
  const sorted = [...helpers].sort(byCost)
  const shown = all ? sorted : sorted.slice(0, SHOWN)
  const tokens = helpers.reduce((sum, h) => sum + h.all, 0)
  const priced = helpers.some((h) => h.usd !== null)
  const usd = helpers.reduce((sum, h) => sum + (h.usd ?? 0), 0)
  const unpriced = helpers.flatMap((h) => h.unpriced ?? [])
  return (
    <>
      <tr className="border-t border-line text-muted-foreground">
        <td className={`${TITLE} pl-5`}>
          <button
            type="button"
            className="flex max-w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-muted-foreground"
            aria-expanded={!folded}
            onClick={onFold}
          >
            <ChevronDownIcon className={`size-3.5 shrink-0 ${folded ? "-rotate-90" : ""}`} />
            <span className="truncate">{`${name} · ${helpers.length}`}</span>
          </button>
        </td>
        <td className={NUM} />
        <td className={NUM}>{tokenWords(tokens)}</td>
        <td className={NUM}>{costWords({ usd: priced ? usd : null, all: tokens, unpriced })}</td>
      </tr>
      {folded
        ? null
        : shown.map((h) => (
            <SubRow
              key={h.id}
              name={named(h)}
              ms={h.ms}
              all={h.all}
              usd={costWords(h)}
              indent="pl-9"
            />
          ))}
      {!folded && sorted.length > SHOWN ? (
        <tr className="border-t border-line">
          <td className="py-1.5 pl-9" colSpan={4}>
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-muted-foreground underline underline-offset-2"
              onClick={onAll}
            >
              {all ? "Show fewer" : `Show all ${sorted.length} · ${sorted.length - SHOWN} more`}
            </button>
          </td>
        </tr>
      ) : null}
    </>
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
  const toggle = (step: FlowStepId) => flip(setOpen, step)
  const worth = worthALook(cost)
  return (
    <div className="@container min-w-0 grid gap-3 text-[13px]" data-testid="cost-panel">
      <div className="grid gap-0.5" data-testid="cost-headline">
        <b className="text-[26px] font-semibold leading-tight tracking-[-0.03em] tabular-nums">
          {costHeadline(cost)}
        </b>
        <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
          {cost.total.nativeCredits?.amount !== undefined
            ? cost.total.estimateUsd !== undefined
              ? "Usage value + list estimate"
              : "AI-credit usage value"
            : "so far"}
          {cost.total.ms > 0 ? ` · ${timeWords(cost.total.ms)}` : ""}
          <InfoHint
            text={
              cost.total.nativeCredits?.amount !== undefined
                ? "Copilot credit value; not an additional charge. Other usage at API prices."
                : "Estimated at list price."
            }
          />
        </span>
      </div>
      {cost.tokenWarning ? (
        <p
          className="m-0 flex items-center gap-1.5 text-[12px] text-muted-foreground"
          data-testid="cost-token-warning"
        >
          <GaugeIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {cost.tokenWarning.text}
        </p>
      ) : null}
      {cost.steps.length === 0 ? (
        <p className="m-0 text-muted-foreground">
          No transcript of this task's sessions is on this machine yet.
        </p>
      ) : (
        <>
          <Bar cost={cost} live={live} />
          <table className="w-full table-fixed border-collapse" data-testid="cost-steps">
            <thead>
              <tr className="text-left text-[12px] font-normal text-dim">
                <th className="w-[40%] pb-1.5 font-normal">Step</th>
                <th className={`${NUM} w-[20%] pb-1.5 font-normal`}>Time</th>
                <th className={`${NUM} w-[16%] pb-1.5 font-normal`}>Tokens</th>
                <th className={`${NUM} w-[24%] pb-1.5 font-normal`}>Cost</th>
              </tr>
            </thead>
            {cost.steps.map((s) => {
              const helpers = cost.helpers.filter((h) => h.step === s.step)
              const checks = cost.checks?.step === s.step ? cost.checks : null
              const expandable = s.session !== null || helpers.length > 0 || checks !== null
              const shown = expandable && open.has(s.step)
              return (
                <Fragment key={s.step}>
                  <tbody>
                    <tr className="border-t border-line font-medium">
                      <td className="py-2">
                        {expandable ? (
                          <button
                            type="button"
                            className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left font-medium text-foreground @max-[400px]:gap-1 @max-[400px]:text-[11px]"
                            aria-expanded={shown}
                            onClick={() => toggle(s.step)}
                          >
                            <span
                              className="size-2 shrink-0 rounded-[2px]"
                              style={{
                                background: s.step === live ? LIVE_COLOUR : STEP_COLOUR[s.step],
                              }}
                            />
                            {stepLabel(s.step)}
                            {helpers.length > 0 ? (
                              <span className="text-[12px] font-normal text-dim">
                                {helpers.length} {helpers.length === 1 ? "helper" : "helpers"}
                              </span>
                            ) : null}
                            <ChevronDownIcon
                              className={`size-3.5 text-dim transition-transform ${shown ? "" : "-rotate-90"}`}
                            />
                          </button>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-[2px]"
                              style={{
                                background: s.step === live ? LIVE_COLOUR : STEP_COLOUR[s.step],
                              }}
                            />
                            {stepLabel(s.step)}
                          </span>
                        )}
                      </td>
                      <td className={NUM}>{timeWords(s.ms)}</td>
                      <td className={NUM}>{tokenWords(s.all)}</td>
                      <td className={NUM}>{costWords(s)}</td>
                    </tr>
                  </tbody>
                  {shown ? (
                    <tbody data-testid={`cost-rows-${s.step}`}>
                      {s.session !== null ? (
                        <SubRow
                          name={`Your session · ${s.session.modelLabel}`}
                          all={s.session.all}
                          usd={costWords(s.session)}
                        />
                      ) : null}
                      {GROUPS.map((group) => {
                        const members = helpers.filter((h) => group.kinds.includes(h.kind))
                        const key = `${s.step}:${group.name}`
                        return members.length === 0 ? null : (
                          <HelperGroup
                            key={key}
                            name={group.name}
                            helpers={members}
                            folded={folded.has(key)}
                            all={listed.has(key)}
                            onFold={() => flip(setFolded, key)}
                            onAll={() => flip(setListed, key)}
                          />
                        )
                      })}
                      {helpers
                        .filter((h) => !GROUPS.some((g) => g.kinds.includes(h.kind)))
                        .map((h) => (
                          <SubRow
                            key={h.id}
                            name={named(h)}
                            ms={h.ms}
                            all={h.all}
                            usd={costWords(h)}
                          />
                        ))}
                      {checks !== null ? (
                        <tr
                          className="border-t border-line text-muted-foreground"
                          data-testid="cost-checks"
                        >
                          <td className="py-1.5 pl-5">
                            {`Project checks · ${checks.runs} full ${checks.runs === 1 ? "run" : "runs"}`}
                          </td>
                          <td className={NUM}>{checks.ms !== null ? timeWords(checks.ms) : ""}</td>
                          <td className={NUM}>–</td>
                          <td className={NUM}>$0</td>
                        </tr>
                      ) : null}
                    </tbody>
                  ) : null}
                </Fragment>
              )
            })}
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
