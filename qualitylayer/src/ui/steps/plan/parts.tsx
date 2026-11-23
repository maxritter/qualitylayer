// The parts the Plan of a task draws over its document: the line that says who reviewed the Plan and
// a Your call inline under the decision it belongs to. Each draws from the text QualityLayer or the
// agent wrote; none invents a word.

import { AGENT_NAMES } from "../../../core/agents/ids.ts"
import { parseRoute, routeHash } from "../../hooks.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { AgentMark } from "../../kit/marks/AgentMark.tsx"
import { WhoMark } from "../../kit/WhoMark.tsx"
import { OutsideDecide } from "../../OutsideDecide.tsx"
import { useOutside } from "../../outside.ts"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import type { PartProps } from "../../step-page/PlanningParts.tsx"
import type { ItemCard } from "../../step-page/state.ts"
import { type Backing, type ReviewView, reviewOf, slugOf } from "./plan-model.ts"

/** Open a document of the task in the Reader, at one heading. */
function readIn(file: string, heading: string): void {
  const route = parseRoute(window.location.hash)
  if (route.view !== "task") return
  window.location.hash = routeHash({
    view: "task",
    id: route.id,
    doc: file,
    at: slugOf(heading),
  })
}

/** The agent a reviewer's name belongs to ("Codex" is `codex`), for its mark. */
const agentOf = (name: string): string | null =>
  (Object.entries(AGENT_NAMES).find(([, shown]) => shown === name)?.[0] ?? null) as string | null

const COUNT_WORDS = ["", "", "Both", "All three"]

/** "Codex, Grok and Pi back it": what the row of marks says when the names are not written out. */
const backedBy = (names: readonly string[]): string =>
  `${names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`} back it`

/**
 * Who backs a panel's finding, before the planner's answer: every reviewer as marks and "All three",
 * or the backers by name, each objector with its reason, and a reviewer whose answer could not be
 * read. All in the muted colour: none of it is a warning.
 */
function BackingLine({ backing, answer }: { backing: Backing; answer: string }) {
  const everyone = backing.kind === "all"
  return (
    <span className="pl-back" data-testid="finding-backing" data-backing={backing.kind}>
      {everyone ? (
        <span className="who" title={backedBy(backing.backers)}>
          {backing.backers.map((name) => (
            <AgentMark key={name} agent={agentOf(name)} size={12} />
          ))}
          {COUNT_WORDS[backing.backers.length] ?? `All ${backing.backers.length}`} ·
        </span>
      ) : (
        backing.backers.map((name, i) => (
          <span className="who" key={name}>
            <AgentMark agent={agentOf(name)} size={12} />
            {name}
            {backing.secondRound === true ? ", second round" : ""}
            {i === backing.backers.length - 1 ? " ·" : ","}
          </span>
        ))
      )}
      {backing.objections.map((o) => (
        <span className="who no" key={o.name}>
          <AgentMark agent={agentOf(o.name)} size={12} />
          {o.name} disagrees{o.reason !== "" ? `: ${o.reason}` : ""} ·
        </span>
      ))}
      {backing.silent.map((name) => (
        <span className="who no" key={name}>
          <AgentMark agent={agentOf(name)} size={12} />
          {name} gave no readable answer ·
        </span>
      ))}
      <span className="a">{answer}</span>
    </span>
  )
}

/** Who read the Plan, how it ended, and each finding with the planner's answer. */
export function ReviewBlock({ review }: { review: ReviewView }) {
  // A panel's tally needs no "4 findings:" before it: the verdict beside it says the count.
  const summary =
    review.panel !== undefined
      ? review.summary.replace(/\b\d+ findings?: /, "").replace(/\.\s*$/, "")
      : review.summary
  return (
    <div className="pl-review" id="pl-reviewed" data-testid="reviewed-by">
      <div className="pl-review-h">
        <WhoMark who="check" />
        <span className="k">Reviewed by</span>
        <span className="v">
          {review.panel !== undefined ? (
            <>
              <b>Review panel</b>
              <span className="pl-panel" data-testid="review-panel">
                {review.panel.map((name) => (
                  <span key={name}>
                    <AgentMark agent={agentOf(name)} size={13} />
                    {name}
                  </span>
                ))}
              </span>
            </>
          ) : (
            <b>
              <InlineMarkdown text={review.label} />
            </b>
          )}
          {summary !== "" ? <span className="s"> · {summary}</span> : null}
        </span>
        <button type="button" className="q-link" onClick={() => readIn("reviews/plan.md", "")}>
          Read review
        </button>
      </div>
      {review.findings.length > 0 ? (
        <Disclosure
          className="pl-findings"
          head="Each finding and what the planner did"
          chevronClassName="pl-chev"
        >
          <ul>
            {review.findings.map((f) => (
              <li key={f.what} data-testid="finding">
                <InlineMarkdown text={f.what} />
                {f.backing !== undefined ? (
                  <BackingLine backing={f.backing} answer={f.answer} />
                ) : (
                  <span className="a"> · {f.answer}</span>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  )
}

/** The Reviews part QualityLayer writes between its markers. */
export function ReviewedBy({ marker }: PartProps) {
  const review = reviewOf(marker.fallback)
  return review === null ? null : <ReviewBlock review={review} />
}

const LETTERS = ["A", "B"] as const

function pickedIndex(card: ItemCard, recommended: number): number | null {
  if (card.answer === undefined) return null
  const letter = card.answer.note
    ?.trim()
    .match(/^([AB])\b/i)?.[1]
    ?.toUpperCase()
  if (letter === "A") return 0
  if (letter === "B") return 1
  return card.answer.kind === "change" ? 1 : recommended
}

function CallFooter({
  outside,
  open,
  picked,
  card,
  acts,
}: {
  outside: boolean
  open: boolean
  picked: number | null
  card: ItemCard
  acts: PartProps["live"]
}) {
  return (
    <>
      {outside && open ? (
        <div className="pl-call-f">
          <OutsideDecide labels={[]} />
        </div>
      ) : null}
      {picked !== null && acts !== undefined ? (
        <div className="pl-call-f">
          <span>
            You chose {LETTERS[picked]}.
            {card.answer?.kind === "change"
              ? ` Send changes: the planner folds ${LETTERS[picked]} into the Plan.`
              : ""}
          </span>
          <button type="button" className="q-link" onClick={() => acts.answer(card.id, null)}>
            Undo
          </button>
        </div>
      ) : null}
    </>
  )
}

/**
 * A Your call: a choice that only showed up once the design was drawn. Two options and the one the
 * agent recommends. Agreement accepts that recommendation; either letter can be an explicit
 * choice. Picking the alternative asks the planner to change the Plan.
 */
export function YourCall({
  card,
  mode,
  live,
}: {
  card: ItemCard
  mode: PartProps["mode"]
  live: PartProps["live"]
}) {
  // The agent runs in the terminal: the call is made there, and the card only reads.
  const outside = useOutside() && mode === "live"
  const call = card.call
  if (call === undefined) return null
  const picked = pickedIndex(card, call.recommended)
  const open = card.state === "open"
  const acts = mode === "live" && !outside ? live : undefined
  return (
    <div
      className="pl-call"
      id={card.target}
      tabIndex={-1}
      data-testid="your-call"
      data-state={open ? "open" : "answered"}
    >
      <div className="pl-call-h">
        <WhoMark who={open ? "you" : "done"} />
        <span className="kd">Your call</span>
        <span className="k">it showed up only once the design was drawn</span>
      </div>
      <fieldset className="pl-opts">
        <legend className="sr-only">{`Your call: ${card.what}`}</legend>
        {LETTERS.map((letter, index) => (
          <button
            key={letter}
            type="button"
            className="pl-opt"
            data-letter={letter}
            aria-pressed={picked === index}
            disabled={acts === undefined}
            onClick={() =>
              acts?.answer(card.id, {
                kind: index === call.recommended ? "agree" : "change",
                note: letter,
                at: Date.now(),
              })
            }
          >
            <span className="n">{letter}</span>
            <span className="l">
              <InlineMarkdown text={call.options[index] ?? ""} />
            </span>
            {call.recommended === index && picked === null ? (
              <span className="rec">recommended</span>
            ) : null}
          </button>
        ))}
      </fieldset>
      <CallFooter outside={outside} open={open} picked={picked} card={card} acts={acts} />
    </div>
  )
}
