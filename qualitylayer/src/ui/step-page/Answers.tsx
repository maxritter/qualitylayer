// The answers of one card where the document states it: the buttons while it is open, the picked
// answer with Undo until it is sent, the answer once given. On the share link only what was
// answered shows; nothing there acts.

import { useBuildAutonomy } from "../interaction/build-autonomy.ts"
import { OutsideDecide } from "../OutsideDecide.tsx"
import { useOutside } from "../outside.ts"
import { given, type StepLive } from "./live.ts"
import type { Choice, ItemCard, Mode } from "./state.ts"

/** Answers that ask the agent to change something open the composer, so the person can say what. */
const SAYS_WHAT = new Set(["change", "fix", "record"])

export function Pin({ n, who }: { n: number; who?: string }) {
  if (n <= 0) return null
  return (
    <span
      className="sp-pin"
      title={`${n} ${n === 1 ? "comment" : "comments"}${who ? ` from ${who}` : ""}`}
    >
      {n}
    </span>
  )
}

function OpenAnswers({
  card,
  outside,
  deferred,
  acts,
  pick,
}: {
  card: ItemCard
  outside: boolean
  deferred: boolean
  acts: StepLive | undefined
  pick: (choice: Choice, from: Element) => void
}) {
  if (outside) return <OutsideDecide labels={card.options.map((choice) => choice.label)} />
  if (deferred) return <span className="sp-wait">Unverified · queued for your review</span>
  if (acts === undefined) return <span className="sp-wait">Waits for an answer</span>
  const link = card.link
  return (
    <span className="sp-acts">
      {card.options.map((choice, index) => (
        <button
          key={choice.kind}
          type="button"
          className={index === 0 ? "q-btn sm" : "q-btn quiet sm"}
          onClick={(event) => pick(choice, event.currentTarget)}
        >
          {choice.label}
        </button>
      ))}
      {link !== undefined ? (
        <button
          type="button"
          className="q-link"
          onClick={(event) => pick(link, event.currentTarget)}
        >
          {link.label}
        </button>
      ) : null}
    </span>
  )
}

function SettledAnswers({
  card,
  acts,
  undo,
  pick,
}: {
  card: ItemCard
  acts: StepLive | undefined
  undo: boolean
  pick: (choice: Choice, from: Element) => void
}) {
  const link = card.link
  const canUndo = acts !== undefined && card.state === "chosen" && undo
  const canChange = acts !== undefined && card.state === "settled" && link !== undefined
  return (
    <span className="sp-acts">
      {card.answer !== undefined ? (
        <span className="q-chosen" data-testid="chosen">
          {card.answer.label}
        </span>
      ) : null}
      {canUndo ? (
        <button type="button" className="q-link" onClick={() => acts.answer(card.id, null)}>
          Undo
        </button>
      ) : null}
      {canChange ? (
        <button
          type="button"
          className="q-link"
          onClick={(event) => pick(link, event.currentTarget)}
        >
          {link.kind === "revisit" ? "Change" : link.label}
        </button>
      ) : null}
    </span>
  )
}

export function Answers({
  card,
  mode,
  live,
  undo = true,
}: {
  card: ItemCard
  mode: Mode
  live: StepLive | undefined
  /** Undo beside a picked answer; Review's settled rows offer Change instead. */
  undo?: boolean
}) {
  const deferred = useBuildAutonomy()
  // The task's agent runs in the terminal: the decision is made there, and this only reads.
  const outside = useOutside() && mode === "live"
  const acts = mode === "live" && !deferred && !outside ? live : undefined
  // A choice that needs words (change, fix, record) opens the quick field under the button.
  const pick = (choice: Choice, from: Element) => {
    if (acts === undefined) return
    acts.answer(card.id, given(choice.kind))
    if (SAYS_WHAT.has(choice.kind)) acts.askAbout?.(card.what, from)
  }
  if (card.state === "open") {
    return <OpenAnswers card={card} outside={outside} deferred={deferred} acts={acts} pick={pick} />
  }
  return <SettledAnswers card={card} acts={acts} undo={undo} pick={pick} />
}

/** The mark at the start of a row: amber while it waits for you, filled once answered. */
export const markOf = (card: Pick<ItemCard, "state">) =>
  card.state === "open" ? "you" : card.state === "sent" ? "agent" : "done"
