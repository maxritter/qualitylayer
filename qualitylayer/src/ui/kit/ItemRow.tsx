// One thing that needs a person: the kind line (12 px, dim), what (14 px, medium), why (13 px,
// muted), the thing itself below it (a slot), and the answers of its family: two buttons and an
// optional link. An answer stays here until it is sent: the row reports it up and never calls the
// API. States: open (amber ring), chosen (the picked answer with Undo, the ring stays until it is
// sent), sent (the agent's reply shows when there is one), settled (a filled dot).

import { cn } from "cn"
import { type ReactNode, useState } from "react"
import { answerLabel, type Item, type ItemAnswer } from "../../core/items.ts"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import {
  Chosen,
  ItemChatAnswer,
  ItemOpenOptions,
  ItemReply,
  Members,
  Points,
  resultWord,
  say,
} from "./ItemRowParts.tsx"
import { WhoMark } from "./WhoMark.tsx"

export type RowState = "open" | "chosen" | "sent" | "settled"

/**
 * What the row looks like now: the item's own state, or chosen when an answer is picked here (also
 * on a settled item: Revisit reopens it until it is sent or undone). An item the agent changed
 * since your review is open again, whatever the server called it.
 */
export function rowState(item: Item, answer: ItemAnswer | undefined): RowState {
  const own: RowState =
    item.state === "settled" && item.changedSinceReview === true ? "open" : item.state
  if (own === "sent") return own
  if (answer !== undefined) return "chosen"
  return own === "chosen" ? "chosen" : own
}

type RowProps = {
  item: Item
  /** The answer picked here and not sent yet. */
  answer?: ItemAnswer
  /** The answers picked for the members of a group, by id. */
  childAnswers?: Readonly<Record<string, ItemAnswer>>
  onAnswer: (item: Item, answer: ItemAnswer | null) => void
  /** The thing itself, drawn under the item: a mockup, a diagram, a diff, a screen. */
  media?: ReactNode
  tabIndex?: number
}

function ItemActions({
  item,
  state,
  picked,
  foldable,
  pointsOpen,
  setPointsOpen,
  choosing,
  setChoosing,
  onAnswer,
}: {
  item: Item
  state: RowState
  picked: ItemAnswer | undefined
  foldable: boolean
  pointsOpen: boolean
  setPointsOpen: (fn: (was: boolean) => boolean) => void
  choosing: boolean
  setChoosing: (v: boolean) => void
  onAnswer: (item: Item, answer: ItemAnswer | null) => void
}) {
  const settled = state === "settled"
  const link = item.answers.link
  const result = settled && item.step === "verify" ? resultWord(item) : null
  const linkButton =
    link !== undefined ? (
      <button type="button" className="q-link" onClick={() => onAnswer(item, say(link))}>
        {answerLabel(link, item.family, item.answers.labels)}
      </button>
    ) : null
  return (
    <div className="acts">
      {state === "open" ? (
        <ItemOpenOptions
          item={item}
          choosing={choosing}
          setChoosing={setChoosing}
          onAnswer={onAnswer}
        />
      ) : null}
      {foldable && state !== "sent" ? (
        <button
          type="button"
          className="q-btn quiet sm"
          aria-expanded={pointsOpen}
          onClick={() => setPointsOpen((was) => !was)}
        >
          {pointsOpen ? "Close" : "Open"}
        </button>
      ) : null}
      {state === "open" ? linkButton : null}
      {state === "chosen" && picked !== undefined ? (
        <Chosen item={item} answer={picked} onUndo={() => onAnswer(item, null)} />
      ) : null}
      <ItemChatAnswer item={item} state={state} />
      {state === "sent" && item.answer !== undefined ? (
        <Chosen item={item} answer={item.answer} />
      ) : null}
      {result !== null ? (
        <span className="q-dim rp-word" data-testid="result-word">
          {result}
        </span>
      ) : null}
      {settled ? linkButton : null}
    </div>
  )
}

export function ItemRow({
  item,
  answer,
  childAnswers = {},
  onAnswer,
  media,
  tabIndex = -1,
}: RowProps) {
  const picked = answer ?? (item.state === "chosen" ? item.answer : undefined)
  const state = rowState(item, picked)
  const settled = state === "settled"
  const mark = state === "settled" ? "done" : state === "sent" ? "agent" : "you"
  // The Plan only summarises Done means: its points open in place, beside the answer.
  const foldable = item.kind === "done" && item.step === "plan" && (item.children ?? []).length > 0
  const [pointsOpen, setPointsOpen] = useState(false)
  // Adding a review asks which one: the person picks, and the choice rides as the answer's words.
  const [choosing, setChoosing] = useState(false)
  const showChildren =
    item.children !== undefined && item.children.length > 0 && (!foldable || pointsOpen)
  const asPoints =
    item.kind === "done" && (item.children ?? []).every((c) => c.answers.options.length === 0)
  return (
    <li
      className={cn("q-item", settled && "settled")}
      data-testid="item"
      data-item-id={item.id}
      data-kind={item.kind}
      data-family={item.family}
      data-state={state}
      tabIndex={tabIndex}
    >
      <WhoMark who={mark} />
      <div>
        <div className="kind">
          {item.kindLabel}
          {item.changedSinceReview === true ? (
            <span className="chip">changed since your review</span>
          ) : null}
          {item.updated === true ? <span className="chip updated">updated</span> : null}
        </div>
        <div className="what">
          <InlineMarkdown text={item.what} />
        </div>
      </div>
      <ItemActions
        item={item}
        state={state}
        picked={picked}
        foldable={foldable}
        pointsOpen={pointsOpen}
        setPointsOpen={setPointsOpen}
        choosing={choosing}
        setChoosing={setChoosing}
        onAnswer={onAnswer}
      />
      {item.why !== undefined && !(settled && item.step === "verify") ? (
        <div className="why">
          <InlineMarkdown text={item.why} />
        </div>
      ) : null}
      {media !== undefined ? <div className="full">{media}</div> : null}
      {showChildren ? (
        <div className="full">
          {asPoints ? (
            <Points item={item} />
          ) : (
            <Members item={item} childAnswers={childAnswers} onAnswer={onAnswer} />
          )}
        </div>
      ) : null}
      <ItemReply item={item} state={state} />
    </li>
  )
}
