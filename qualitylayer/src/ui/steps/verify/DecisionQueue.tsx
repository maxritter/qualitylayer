import { CheckIcon, ChevronLeftIcon, MessageSquareIcon } from "lucide-react"
import type { ReactNode } from "react"
import { answerLabel, asksForChange, type Item, type ItemAnswer } from "../../../core/items.ts"
import type { TaskSurfaceProps } from "../../interaction/props.ts"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { CodeRow } from "../../review-workspace/CodeRow.tsx"
import { sectionId } from "../../step-page/sections.ts"
import { StepItem } from "../StepItem.tsx"
import { itemStatusLabel, type QueueModel, useReviewQueue } from "./use-review-queue.ts"
import "./decision-queue.css"

function SavedAnswerCard({
  item,
  answer,
  onEdit,
}: {
  item: Item
  answer: ItemAnswer
  onEdit: () => void
}) {
  return (
    <div className="review-saved-answer">
      <h3>
        <InlineMarkdown text={item.what} />
      </h3>
      <p>You answered: {answerLabel(answer.kind, item.family, item.answers.labels)}</p>
      {answer.note ? (
        <p>
          <InlineMarkdown text={answer.note} />
        </p>
      ) : null}
      <button type="button" className="q-btn" onClick={onEdit}>
        Change answer
      </button>
    </div>
  )
}

export function ReviewDecisionQueue({
  items: givenItems,
  props,
  children,
  onAnswered,
}: {
  items: Item[]
  props: TaskSurfaceProps
  children: ReactNode | ((ready: boolean) => ReactNode)
  onAnswered: (item: Item, answer: ItemAnswer) => void
}) {
  const queue = useReviewQueue({ items: givenItems, onAnswered })
  const { items, remaining, current, overview, answer, editing, index, edit } = queue
  if (items.length === 0)
    return (
      <div className="review-turn" data-testid="review-decisions">
        <CodeRow taskId={props.task.id} />
        {typeof children === "function" ? children(true) : children}
      </div>
    )
  return (
    <div className="review-turn" data-testid="review-decisions">
      <section
        className="ir-step-turn review-queue"
        id={sectionId("Your turn")}
        aria-label="Your turn"
        tabIndex={-1}
      >
        <header>
          <div className="review-queue-status">
            <b>Your turn</b>
            <span role="status">
              {items.length - remaining.length} of {items.length} answered · {remaining.length}{" "}
              remaining
            </span>
          </div>
          <CodeRow taskId={props.task.id} />
          <DecisionNavigation queue={queue} />
        </header>
        {overview || !current ? (
          <DecisionOverview queue={queue} />
        ) : (
          <>
            {answer && editing !== current.id ? (
              <SavedAnswerCard item={current} answer={answer} onEdit={() => edit(current.id)} />
            ) : (
              <StepItem
                key={`${current.id}:${current.digest}:${editing === current.id}`}
                item={current}
                props={props}
                initialAnswer={answer}
                onCancelEdit={editing === current.id ? () => edit(null) : undefined}
                onAnswered={queue.answerCurrent}
              />
            )}
            <footer className="review-queue-navigation">
              <button
                type="button"
                className="q-link"
                disabled={index <= 0}
                onClick={queue.previous}
              >
                <ChevronLeftIcon size={14} /> Previous
              </button>
              <span>
                Decision {index + 1} of {items.length}
              </span>
              <button type="button" className="q-link" onClick={queue.skipCurrent}>
                Skip for now
              </button>
            </footer>
          </>
        )}
        {typeof children === "function" ? children(!queue.required) : children}
      </section>
    </div>
  )
}

function DecisionNavButton({ item, at, queue }: { item: Item; at: number; queue: QueueModel }) {
  const answer = queue.answerOf(item)
  const isAnswered = queue.answered(item)
  const change = Boolean(answer && asksForChange(answer.kind))
  const label = itemStatusLabel(item, answer, isAnswered, queue.skipped.has(item.id))
  const answerState = change ? "change" : isAnswered ? "saved" : "open"
  const isCurrent = !queue.overview && queue.current?.id === item.id
  return (
    <button
      type="button"
      aria-label={`${at + 1}. ${item.what}: ${label}`}
      aria-current={isCurrent ? "step" : undefined}
      title={`${item.what} · ${label}`}
      data-answer={answerState}
      onClick={() => queue.choose(item.id)}
    >
      <span>{at + 1}</span>
      {change ? <MessageSquareIcon size={10} /> : isAnswered ? <CheckIcon size={10} /> : null}
    </button>
  )
}

function DecisionNavigation({ queue }: { queue: QueueModel }) {
  return (
    <nav aria-label="Review decisions">
      {queue.items.map((item, at) => (
        <DecisionNavButton key={item.id} item={item} at={at} queue={queue} />
      ))}
      <button
        type="button"
        className="review-finish"
        aria-current={queue.overview ? "step" : undefined}
        onClick={() => queue.showOverview(true)}
      >
        Finish review
      </button>
    </nav>
  )
}

function overviewHint(remainingCount: number, required: boolean): string {
  if (remainingCount === 0) return "Your answers are saved. Approval is a separate decision."
  return required
    ? "Some items are unanswered. Required confirmations must be settled before approval."
    : "Some items are unanswered. Approving accepts them as they stand."
}

function DecisionOverview({ queue }: { queue: QueueModel }) {
  const { title, remaining, required, items, answerOf, answered, skipped, choose } = queue
  const firstRemaining = remaining[0]
  return (
    <div className="review-overview">
      <h2>{title}</h2>
      <p>{overviewHint(remaining.length, required)}</p>
      <ul>
        {items.map((item) => {
          const label = itemStatusLabel(item, answerOf(item), answered(item), skipped.has(item.id))
          return (
            <li key={item.id}>
              <button type="button" onClick={() => choose(item.id)}>
                <span className="review-overview-title">
                  <InlineMarkdown text={item.what} />
                </span>
                <b>{label}</b>
              </button>
            </li>
          )
        })}
      </ul>
      {firstRemaining ? (
        <button type="button" className="q-btn" onClick={() => choose(firstRemaining.id)}>
          Continue review
        </button>
      ) : null}
    </div>
  )
}
