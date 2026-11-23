// The Needs you card (a neutral hairline; amber stays on its ring): only what needs a person, in the plan's order, each item with its two answers.
// Settled items fold into one line ("Approved by you at 13:27 · 5 items settled") that opens on
// click. Answers are kept by the page and reported up; this card never calls the API.
// Keyboard: ↑ and ↓ move between the items (↓ on a page nothing has focus on enters the first one),
// Enter on an item picks its first answer.

import { type ReactNode, useRef, useState } from "react"
import {
  answeredInChat,
  type Item,
  type ItemAnswer,
  mainAction,
  openCount,
  orderItems,
} from "../../core/items.ts"
import { ItemRow, rowState } from "./ItemRow.tsx"
import {
  AnsweredInChatSection,
  handleNeedsKeyDown,
  needsSummaryLine,
  SettledItemsSection,
  useGlobalArrowFocus,
} from "./NeedsYouParts.tsx"
import { WhoMark } from "./WhoMark.tsx"

type Props = {
  items: readonly Item[]
  /** The answers picked here and not sent yet, by item id (a member of a group too). */
  answers: Readonly<Record<string, ItemAnswer>>
  onAnswer: (item: Item, answer: ItemAnswer | null) => void
  /** The thing itself under an item: a mockup, a diagram, a diff, a screen. */
  renderMedia?: (item: Item) => ReactNode
  /** What the card says when nothing is open and nothing was settled either. */
  empty: string
  /** The one line the settled items fold into; the default counts them. */
  settledLine?: string
  /** After "N open": "you can also give feedback anywhere in the Plan". */
  side?: string
  /** Settled items stay in the card with what was decided, as in the person's review, instead of folding into one line. */
  keepSettled?: boolean
}

export function NeedsYou({
  items,
  answers,
  onAnswer,
  renderMedia,
  empty,
  settledLine,
  side,
  keepSettled = false,
}: Props) {
  const [showSettled, setShowSettled] = useState(false)
  const card = useRef<HTMLDivElement | null>(null)
  const ordered = orderItems(items)
  const stateOf = (item: Item) => rowState(item, answers[item.id])
  // What was answered in the chat leaves the card for a record of its own, newest first.
  const answered = answeredInChat(ordered)
  // Before a decision settles them, settled records (a Plan decision) stay inside the card with
  // their Revisit; what a decision settled folds into one line, and opens on click.
  const settled = keepSettled
    ? []
    : ordered.filter(
        (item) =>
          stateOf(item) === "settled" && item.settledAt !== undefined && !answered.includes(item),
      )
  const open = ordered.filter((item) => !settled.includes(item) && !answered.includes(item))
  // An answer picked here counts the moment it is clicked, whether or not it is saved yet.
  const waiting = openCount(
    items.map((item) => ({
      ...item,
      state: stateOf(item),
      answer: answers[item.id] ?? item.answer,
    })),
  )
  const asking = mainAction(items, answers).changes
  useGlobalArrowFocus(card)

  const renderRow = (item: Item, index: number) => (
    <ItemRow
      key={item.id}
      item={item}
      answer={answers[item.id]}
      childAnswers={answers}
      onAnswer={onAnswer}
      media={renderMedia?.(item)}
      tabIndex={index === 0 ? 0 : -1}
    />
  )
  const allDone = keepSettled && waiting === 0 && ordered.length > 0
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the items, each of which is focusable
    <div
      className="grid gap-3.5"
      ref={card}
      onKeyDown={(event) =>
        handleNeedsKeyDown({ event, card: card.current, open, answers, onAnswer })
      }
    >
      {open.length > 0 || settled.length === 0 ? (
        <section className="q-calls" data-testid="needs-you" aria-label="Needs you">
          <div className="q-calls-h">
            <WhoMark who={allDone ? "done" : "you"} />
            <span className="title">Needs you</span>
            <span className="side">
              {needsSummaryLine({
                keepSettled,
                waiting,
                total: ordered.length,
                asking,
                side,
              })}
            </span>
          </div>
          {waiting === 0 && (!keepSettled || ordered.length === 0) ? (
            <p className="q-empty m-0">{empty}</p>
          ) : null}
          {open.length > 0 ? (
            <ul className="q-items">{open.map((item, index) => renderRow(item, index))}</ul>
          ) : null}
        </section>
      ) : null}
      <AnsweredInChatSection answered={answered} />
      <SettledItemsSection
        settled={settled}
        settledLine={settledLine}
        showSettled={showSettled}
        onToggle={() => setShowSettled((was) => !was)}
        renderRow={renderRow}
      />
    </div>
  )
}
