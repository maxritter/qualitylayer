// Reads one session's conversation while it is on screen, merging what arrives by event id. The page has
// no idle polling: it reads on a change signal or in finite catch-up batches, one read at a time.
//
//   - the view opens, or the page becomes visible again
//   - the stream's `live` or `runs` counter moves (the hooks write a live file on every tool start and
//     finish, turn stop and permission prompt)
//   - the attached terminal prints something, at most once a second: a read starts only when a second
//     has passed since the last one started and none is in flight
//   - the person sent a message or answered a permission (`refresh`)
//
// A trigger that comes while a read is in flight reads once more when it ends. A burst of terminal
// output is the exception: it does not queue a read behind a short one, so a spinner is never a clock.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react"
import type {
  ConversationEvent,
  ConversationPage,
  ConversationSnapshot,
} from "../../../core/conversation/types.ts"
import { subscribeEventCount } from "../../hooks.ts"
import {
  CATCHUP_MAX_READS,
  type ConversationState,
  createGate,
  type Gate,
  OUTPUT_READ_MS,
  requestRead,
} from "./conversation-gate.ts"
import { addEarlier, fillEvent, type Loaded } from "./model.ts"

export { CATCHUP_MAX_READS, type ConversationState, OUTPUT_READ_MS }

/** A signal without a payload, for the many small things that say "look again" (the terminal's output). */
export type Pulse = {
  notify(): void
  subscribe(listener: () => void): () => void
}
export function createPulse(): Pulse {
  const listeners = new Set<() => void>()
  return {
    notify: () => {
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** What a read leaves out: the turns before the ones held, and an event that arrived shortened, whole. */
export type ConversationMore = {
  earlier(before: string): Promise<ConversationPage | undefined>
  whole(id: string): Promise<ConversationEvent | undefined>
}

type ConversationReader = {
  /** Reads the turns before the first one held; false when they could not be read. */
  loadEarlier(): Promise<boolean>
  /** Reads these events whole; false when any could not be read; absent when the server has no more to give. */
  showMore: ((ids: readonly string[]) => Promise<boolean>) | undefined
}

/** Changes what the view holds of the session, once it holds anything. */
type Update = (apply: (loaded: Loaded) => Loaded) => void

function useUpdate(setState: Dispatch<SetStateAction<ConversationState>>): Update {
  return useCallback(
    (apply) =>
      setState((before) => (before.loaded ? { ...before, loaded: apply(before.loaded) } : before)),
    [setState],
  )
}

async function readEarlier(more: ConversationMore, asked: string, update: Update) {
  try {
    const page = await more.earlier(asked)
    if (page) update((before) => addEarlier(before, asked, page))
    return page !== undefined
  } catch {
    return false
  }
}

async function readWhole(more: ConversationMore, ids: readonly string[], update: Update) {
  try {
    const events = await Promise.all(ids.map((id) => more.whole(id)))
    const found = events.filter((event): event is ConversationEvent => event !== undefined)
    update((before) => found.reduce((loaded, event) => fillEvent(loaded, event), before))
    return found.length === ids.length
  } catch {
    return false
  }
}

/** What a read leaves out, read on request; each result is applied to what the view holds. */
export function useMore(
  more: ConversationMore | undefined,
  loaded: Loaded | undefined,
  update: Update,
): ConversationReader {
  const held = useRef(loaded)
  held.current = loaded
  const paging = useRef(false)
  const loadEarlier = useCallback(async () => {
    const asked = held.current?.earlier?.before
    if (!asked || paging.current || !more) return false
    paging.current = true
    try {
      return await readEarlier(more, asked, update)
    } finally {
      paging.current = false
    }
  }, [more, update])
  const showMore = useCallback(
    async (ids: readonly string[]) => (more ? readWhole(more, ids, update) : false),
    [more, update],
  )
  return { loadEarlier, showMore: more ? showMore : undefined }
}

function usePageVisible(): boolean {
  const [seen, setSeen] = useState(
    typeof document === "undefined" || document.visibilityState !== "hidden",
  )
  useEffect(() => {
    const update = () => setSeen(document.visibilityState !== "hidden")
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])
  return seen
}

export function useConversation(
  load: ((after?: string) => Promise<ConversationSnapshot | undefined>) | undefined,
  on: boolean,
  output?: Pulse,
  /** The view is no longer open on the session; called once its last read has ended. */
  closed?: () => void,
): ConversationState & { refresh(): void; update: Update } {
  const [state, setState] = useState<ConversationState>({
    loaded: undefined,
    unavailable: false,
    failing: false,
    catchupLimited: false,
  })
  const cursor = useRef<string | undefined>(undefined)
  const loader = useRef(load)
  loader.current = load
  const closer = useRef(closed)
  closer.current = closed
  const gate = useRef<Gate>(createGate())
  const seen = usePageVisible()
  const reading = on && seen && load !== undefined
  const ask = useCallback(
    (paced: boolean) => requestRead({ gate: gate.current, cursor, loader, setState }, paced),
    [],
  )

  // Opening, and the page coming back, read at once; the triggers below read while it stays open.
  useEffect(() => {
    if (!reading) return
    const g = gate.current
    g.open = true
    g.catchupReads = 0
    setState((before) => ({ ...before, catchupLimited: false }))
    ask(false)
    const again = () => ask(false)
    const stops = [
      subscribeEventCount("live", again),
      subscribeEventCount("runs", again),
      output?.subscribe(() => ask(true)),
    ]
    return () => {
      g.open = false
      clearTimeout(g.catchupTimer)
      g.catchupTimer = undefined
      for (const stop of stops) stop?.()
    }
  }, [reading, output, ask])

  // The view going away, or off screen, says so after the read in flight has ended: a late answer of the
  // server must not mark it open again.
  const present = on && load !== undefined
  useEffect(() => {
    if (!present) return
    return () => {
      void (gate.current.flight ?? Promise.resolve()).finally(() => closer.current?.())
    }
  }, [present])

  const refresh = useCallback(() => {
    const g = gate.current
    g.catchupReads = 0
    clearTimeout(g.catchupTimer)
    g.catchupTimer = undefined
    setState((before) => ({ ...before, catchupLimited: false }))
    ask(false)
  }, [ask])
  const update = useUpdate(setState)
  return { ...state, refresh, update }
}
