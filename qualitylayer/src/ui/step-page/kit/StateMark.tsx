// The state of a slice or a stage, a small mark after its title: a check when done, a ring while in
// work, a hollow dot still to come (Workflow model: one number style). The number in front of the title
// never changes shape; it is the plain `.sp-no` column. The words are for screen readers.

import { CheckIcon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"

export type MarkState = "done" | "work" | "todo" | "fail"

const WORDS: Record<MarkState, string> = {
  done: "done",
  work: "in work",
  todo: "to come",
  fail: "failed",
}

export function StateMark({ state, word }: { state: MarkState; word?: string }) {
  return (
    <span
      className={`sp-state ${state}`}
      data-state={state}
      role="img"
      aria-label={word ?? WORDS[state]}
    >
      {state === "done" ? <CheckIcon className="size-3" aria-hidden="true" /> : null}
      {state === "fail" ? <TriangleAlertIcon className="size-3" aria-hidden="true" /> : null}
    </span>
  )
}

/** A title with its mark after it; the mark stays beside the first line however the title wraps. */
export function TitleWithState({
  state,
  word,
  children,
}: {
  state: MarkState
  word?: string
  children: ReactNode
}) {
  return (
    <span className="sp-titled">
      <span className="sp-tx">{children}</span>
      <StateMark state={state} {...(word !== undefined ? { word } : {})} />
    </span>
  )
}
