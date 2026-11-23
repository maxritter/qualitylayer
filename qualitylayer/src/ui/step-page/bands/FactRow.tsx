// The header's second line, one grammar on every step: up to two facts (a bold value, a muted label,
// an optional bar and a dim count after it) and a "now" chip for what the agent is doing. A check that
// fails is the agents' to fix, so the header never flags it. A chip with a `target` jumps to it. The counts come from the document
// (its Summary line, the Size line, the slices), never from the agent's own words about itself. A fact
// the document does not state is left out, not drawn as "None".

import { BotIcon, LayersIcon, ListTodoIcon, ScanSearchIcon } from "lucide-react"
import type { ReactNode } from "react"
import { WhoMark } from "../../kit/WhoMark.tsx"
import { jumpTo } from "../jump.ts"

/** The meanings a fact's icon can carry: slices, tasks, a review's verdict, helpers. */
export const FACT_ICONS = {
  slices: LayersIcon,
  tasks: ListTodoIcon,
  review: ScanSearchIcon,
  helpers: BotIcon,
} as const
export type FactIcon = keyof typeof FACT_ICONS

export type Fact = {
  value: ReactNode
  /** What the value counts; empty when the value says it all. */
  label: string
  icon?: FactIcon
  /** The full sentence, as the chip's tooltip and accessible description. */
  tip?: string
  /** A small progress bar after the label: how far a count has come (Implement's tasks). */
  bar?: { done: number; total: number }
  /**
   * One tick per Done means point instead of a bar: proven, in work, still to come. The Verify and
   * Review headers of a task whose Plan lists its Acceptance test by point.
   */
  ticks?: readonly ("done" | "work" | "todo")[]
  /** A dim count after the bar ("6 of 7 slices"); several are each their own quiet span. */
  sub?: string | readonly string[]
  /** `danger` (red) for a count that failed. */
  tone?: "danger"
}

/** "3 proven, 1 in work, 4 to come": the ticks in words for a reader who cannot see them. */
function ticksWords(ticks: readonly ("done" | "work" | "todo")[]): string {
  const count = (kind: "done" | "work" | "todo") => ticks.filter((tick) => tick === kind).length
  return [
    `${count("done")} proven`,
    ...(count("work") > 0 ? [`${count("work")} in work`] : []),
    `${count("todo")} to come`,
  ].join(", ")
}

/** What the agent is doing now: "T18 first start block". */
export type NowChip = { id: string; label: string; target?: string }

/** Two facts and the task in work are one short line a person reads in one look. */
export const FACTS_MAX = 2

export const factsFor = (facts: readonly Fact[] | undefined): Fact[] =>
  (facts ?? []).slice(0, FACTS_MAX)

export const hasFacts = (facts: readonly Fact[] | undefined, now?: NowChip): boolean =>
  factsFor(facts).length > 0 || now !== undefined

function FactBar({ bar }: { bar: NonNullable<Fact["bar"]> }) {
  const width = bar.total > 0 ? Math.round((100 * bar.done) / bar.total) : 0
  return (
    <i className="bd-fbar" role="img" aria-label={`${bar.done} of ${bar.total}`}>
      <i style={{ width: `${width}%` }} />
    </i>
  )
}

function FactTicks({ ticks }: { ticks: NonNullable<Fact["ticks"]> }) {
  return (
    <i className="bd-ticks" role="img" aria-label={ticksWords(ticks)} data-testid="fact-ticks">
      {ticks.map((tick, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the ticks are a fixed row, one per point
        <i key={index} className={tick === "done" ? undefined : tick} />
      ))}
    </i>
  )
}

function FactItem({ fact }: { fact: Fact }) {
  const Icon = fact.icon !== undefined ? FACT_ICONS[fact.icon] : null
  const subs = fact.sub === undefined ? [] : typeof fact.sub === "string" ? [fact.sub] : fact.sub
  return (
    <li className={fact.tone} {...(fact.tip !== undefined ? { title: fact.tip } : {})}>
      {Icon !== null ? <Icon aria-hidden="true" /> : null}
      <b>{fact.value}</b>
      {fact.label !== "" ? <span>{fact.label}</span> : null}
      {fact.bar !== undefined ? <FactBar bar={fact.bar} /> : null}
      {fact.ticks !== undefined ? <FactTicks ticks={fact.ticks} /> : null}
      {subs.map((sub) => (
        <span key={sub} className="bd-fsub">
          {sub}
        </span>
      ))}
    </li>
  )
}

export function FactRow({
  facts,
  now,
}: {
  facts?: readonly Fact[] | undefined
  now?: NowChip | undefined
}) {
  const shown = factsFor(facts)
  if (!hasFacts(facts, now)) return null
  return (
    <ul className="bd-facts" aria-label="Counts" data-testid="fact-row">
      {shown.map((fact) => (
        <FactItem
          key={`${fact.icon ?? ""}${fact.label}${typeof fact.value === "string" ? fact.value : ""}`}
          fact={fact}
        />
      ))}
      {now !== undefined ? (
        <li className="now" data-testid="fact-now">
          <ChipBody
            target={now.target}
            icon={<WhoMark who="agent" running />}
            label={
              <>
                <b>{now.id}</b>
                <span>{now.label}</span>
              </>
            }
          />
        </li>
      ) : null}
    </ul>
  )
}

function ChipBody({
  target,
  icon,
  label,
}: {
  target: string | undefined
  icon: ReactNode
  label: ReactNode
}) {
  return target !== undefined ? (
    <button type="button" className="bd-fjump" onClick={() => jumpTo(target)}>
      {icon}
      {label}
    </button>
  ) : (
    <>
      {icon}
      {label}
    </>
  )
}
