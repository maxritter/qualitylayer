// Tell me more, the parts both question cards share (the batch card and the single-question card):
// the small choice that opens in place ("What would help?"), the status panel that appears on the
// question the moment a request is sent, the Updated confirmation, and the Earlier wording of a
// question the agent reworded. The state comes from the question itself: `more` (request, at, taken,
// cancelled, lines) while the request is open, `found` and `earlier` after the agent answered.
// As the App Model shows it: artifacts/app/app-model/task.jsx (MorePick, MoreStatus).

import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react"
import { type LiveSignals, livenessOf } from "../../core/live/liveness.ts"
import type { Question } from "../../core/task/question.ts"
import { Disclosure } from "../kit/Fold.tsx"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import {
  type Gone,
  MoreStatus,
  type MoreUpdate,
  moreOpen,
  reveal,
  UpdatedBar,
  useMoreUpdates,
} from "./MoreStatus.tsx"
import { EXPLAIN_REQUEST, PLAIN_REQUEST } from "./more-words.ts"
import "./more-request.css"

export {
  EXPLAIN_REQUEST,
  type Gone,
  MoreStatus,
  type MoreUpdate,
  moreOpen,
  PLAIN_REQUEST,
  reveal,
  UpdatedBar,
  useMoreUpdates,
}

export function goneOf(signals: LiveSignals | null | undefined, now: number): Gone | null {
  if (signals == null) return null
  const life = livenessOf(signals, now)
  return life.state === "stopped" ? { at: life.at, interrupted: life.why === "interrupted" } : null
}

function useKeepPickVisible(box: RefObject<HTMLFieldSetElement | null>) {
  useEffect(() => {
    const el = box.current
    if (el === null) return
    reveal(el)
    el.querySelector<HTMLButtonElement>(".more-btns button")?.focus({ preventScroll: true })
    const card = el.closest("section") ?? el.parentElement
    const started = performance.now()
    let still = true
    const again = () => {
      if (still && performance.now() - started < 3_000) reveal(el)
    }
    const halt = () => {
      still = false
    }
    const watch =
      card !== null && typeof ResizeObserver !== "undefined" ? new ResizeObserver(again) : null
    if (card !== null) watch?.observe(card)
    for (const event of ["wheel", "touchmove", "keydown"]) window.addEventListener(event, halt)
    return () => {
      watch?.disconnect()
      for (const event of ["wheel", "touchmove", "keydown"]) window.removeEventListener(event, halt)
    }
  }, [box])
}

/** Step 1: what would help, one click each; own words in a short field. */
export function MorePick({
  onSend,
  onCancel,
  busy = false,
}: {
  onSend: (request: string) => void
  onCancel: () => void
  busy?: boolean
}) {
  const [text, setText] = useState("")
  const box = useRef<HTMLFieldSetElement | null>(null)
  useKeepPickVisible(box)
  const asked = text.trim()
  const ask = () => {
    if (asked !== "" && !busy) onSend(asked)
  }
  return (
    <fieldset
      ref={box}
      className="more-pick"
      aria-label="What would help?"
      data-testid="more-pick"
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
    >
      <div className="more-h">
        <b>What would help?</b>
        <button type="button" className="q-link" onClick={onCancel}>
          Cancel <kbd>Esc</kbd>
        </button>
      </div>
      <div className="more-btns">
        <button
          type="button"
          className="q-btn"
          aria-keyshortcuts="1"
          disabled={busy}
          onClick={() => onSend(PLAIN_REQUEST)}
        >
          I don't get the question
        </button>
        <button
          type="button"
          className="q-btn"
          aria-keyshortcuts="2"
          disabled={busy}
          onClick={() => onSend(EXPLAIN_REQUEST)}
        >
          Explain the choices
        </button>
      </div>
      <div className="more-own">
        <input
          type="text"
          className="more-field"
          value={text}
          maxLength={600}
          placeholder="Or ask something specific…"
          aria-label="Ask something specific about this question"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault()
              ask()
            }
          }}
        />
        <button type="button" className="q-btn" disabled={asked === "" || busy} onClick={ask}>
          Send
        </button>
      </div>
    </fieldset>
  )
}

/** The question as it was before the agent reworded it, folded: the question and its choices. */
export function EarlierWording({ earlier }: { earlier: NonNullable<Question["earlier"]> }) {
  if (earlier.length === 0) return null
  const newest = [...earlier].reverse()
  return (
    <Disclosure className="earlier" data-testid="earlier-wording" head="Earlier wording">
      <div className="earlier-b">
        {newest.map((was) => (
          <div key={was.at} className="earlier-one">
            <p>
              <InlineMarkdown text={was.question} />
            </p>
            <ol>
              {was.choices.map((choice) => (
                <li key={choice.label}>{choice.label}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </Disclosure>
  )
}
