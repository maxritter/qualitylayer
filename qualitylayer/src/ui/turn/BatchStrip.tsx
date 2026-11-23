// The parts a question batch adds to its card: the strip (every member of the batch, answered ones
// ticked and changeable, the one in focus marked), the link from a grade 2 or 3 question to the
// finding of the research document it rests on, and the line about the batches still to come.

import { CheckIcon } from "lucide-react"
import type { BatchMember } from "../../interaction/contracts.ts"

function BatchStripItem({
  member,
  currentId,
  onFocus,
  onChange,
}: {
  member: BatchMember
  currentId: string | undefined
  onFocus: ((id: string) => void) | undefined
  onChange: ((id: string) => void) | undefined
}) {
  const done = member.answer !== undefined
  const on = member.id === currentId
  const disabled = !on && (done ? onChange === undefined : onFocus === undefined)
  const waits = disabled && !done
  const classes = ["bq-i", done ? "done" : "", on ? "on" : "", waits ? "waiting" : ""]
    .join(" ")
    .trim()
  const label = done
    ? `Question ${member.number}: ${member.text}. Answered: ${member.answer}. Change it`
    : `Question ${member.number}: ${member.text}`
  return (
    <button
      type="button"
      className={classes}
      data-testid="batch-strip-item"
      data-state={done ? "answered" : "open"}
      aria-current={on ? "true" : undefined}
      aria-label={label}
      title={done ? `${member.text} · answered: ${member.answer}` : member.text}
      disabled={disabled}
      onClick={() => (done ? onChange?.(member.id) : onFocus?.(member.id))}
    >
      {done ? <CheckIcon className="bq-tick" aria-hidden="true" /> : null}
      {member.number}
    </button>
  )
}

export function BatchStrip({
  title,
  members,
  currentId,
  onFocus,
  onChange,
}: {
  title?: string | undefined
  members: BatchMember[]
  /** The member in focus; absent when every question is answered. */
  currentId?: string | undefined
  /** An open member was picked: bring it into focus. Absent: only the first open member can be answered, so the others are marks. */
  onFocus?: ((id: string) => void) | undefined
  /** An answered member was picked: change its answer. Absent: the tick is a plain mark. */
  onChange?: ((id: string) => void) | undefined
}) {
  const place = Math.max(
    0,
    members.findIndex((m) => m.id === currentId),
  )
  const singleOpen = members.length === 1 && members[0]?.answer === undefined
  return (
    <div className="bq" data-testid="batch-strip">
      {title ? <span className="bq-t">{title}</span> : null}
      {singleOpen ? null : (
        <fieldset className="bq-strip" aria-label="Questions in this batch">
          {members.map((member) => (
            <BatchStripItem
              key={member.id}
              member={member}
              currentId={currentId}
              onFocus={onFocus}
              onChange={onChange}
            />
          ))}
        </fieldset>
      )}
      {currentId !== undefined ? (
        <span className="sr-only" data-testid="batch-strip-place">
          question {place + 1} of {members.length}
        </span>
      ) : null}
    </div>
  )
}

/** "Probably the only batch. More questions appear only if your answers open a new choice." */
const batchAheadWords = (ahead: string) =>
  `${ahead.replace(/\.$/, "")}. More questions appear only if your answers open a new choice.`

/** What the Saved chip says on hover: answers are kept as they are given, and where to change them. */
export const savedNote = (ahead: string | undefined) =>
  [
    "Answers are saved as you go.",
    "Change them under Decided with you until the Plan is written.",
    ...(ahead ? [batchAheadWords(ahead)] : []),
  ].join(" ")
