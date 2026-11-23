// When your turn starts (a gate opens, an approval is asked, the agent waits for you) the Conversation
// moves to its latest message, so the page that asks is never read from an old one behind "Jump to
// latest". A person who scrolled the log in the last few seconds is left where they are.

import { type RefObject, useCallback, useEffect, useRef } from "react"

/** How long after the person's own scroll the log stays where they put it. */
export const USER_SCROLL_MS = 5000

/** What scrolls the log for the person: the wheel, a drag, a touch, a key. Programmatic moves are none of these. */
const BY_PERSON = ["wheel", "touchmove", "keydown", "pointerdown"] as const

function swapScrollListeners(
  before: HTMLDivElement | null,
  node: HTMLDivElement | null,
  handler: () => void,
): void {
  if (before) for (const name of BY_PERSON) before.removeEventListener(name, handler)
  if (node) for (const name of BY_PERSON) node.addEventListener(name, handler, { passive: true })
}

function scrollToLatest(node: HTMLDivElement, follow: RefObject<boolean>): void {
  follow.current = true
  node.scrollTop = node.scrollHeight
  // The log learns its place from scroll events (the virtualizer, the Jump to latest button).
  node.dispatchEvent(new Event("scroll"))
}

/**
 * `turn` is empty while nothing waits on the person, and names the wait (the last turn that ended)
 * while it does: a change to a non-empty `turn` moves the log to its end and keeps it following.
 */
export function useLatestOnTurn(
  scroll: RefObject<HTMLDivElement | null>,
  follow: RefObject<boolean>,
  turn: string,
  now: () => number = Date.now,
): void {
  const touched = useRef(Number.NEGATIVE_INFINITY)
  const clock = useRef(now)
  clock.current = now
  const listening = useRef<HTMLDivElement | null>(null)
  const seen = useRef("")
  const mark = useRef(() => {
    touched.current = clock.current()
  })
  const listen = useCallback((node: HTMLDivElement | null) => {
    swapScrollListeners(listening.current, node, mark.current)
    listening.current = node
  }, [])
  // The log mounts and unmounts with the view: listen to whichever element is there.
  useEffect(() => {
    if (scroll.current !== listening.current) listen(scroll.current)
  })
  useEffect(() => () => listen(null), [listen])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of `turn` is the trigger
  useEffect(() => {
    if (turn === seen.current) return
    const node = scroll.current
    if (turn !== "" && node === null) return
    seen.current = turn
    if (turn === "" || node === null) return
    if (now() - touched.current < USER_SCROLL_MS) return
    scrollToLatest(node, follow)
  }, [turn])
}
