// What the Conversation route puts on the wire. The session's whole record stays in the server's cache;
// the page gets the last few turns, with long text cut and marked, and asks for the rest:
//
//   - a first read, or one with a cursor the cache does not know, is the last turns (`reset`) with a pointer
//     to the older ones (`earlier`);
//   - a read with a cursor carries only the events that are new or changed since, cut the same way; more
//     news than one update may carry becomes the last turns again;
//   - older turns come a page at a time by the id of the event they precede;
//   - an event that was cut comes whole by its id.
//
// A turn is the person's message and everything the agent did after it, up to the next message.

import { continues } from "../core/conversation/service.ts"
import type {
  ConversationEvent,
  ConversationPage,
  ConversationSnapshot,
} from "../core/conversation/types.ts"
import {
  small,
  tailCount,
  total,
  type Weighed,
  WIRE,
  weigh,
  wireEvent,
} from "./conversation-wire-events.ts"

/** Longest id a request may name; the readers' ids are far shorter. */
export const WIRE_ID_CHARS = 512

const isTurnStart = (event: ConversationEvent) =>
  event.kind === "user" && event.parent === undefined

const isMessage = (event: ConversationEvent) =>
  event.parent === undefined && (event.kind === "user" || event.kind === "assistant")

/** Where the turn that ends before index `end` begins. */
function turnStart(events: readonly ConversationEvent[], end: number): number {
  let start = end - 1
  while (start > 0 && !isTurnStart(events[start] as ConversationEvent)) start--
  return start
}

type Kept = { events: number; bytes: number }

const fits = (kept: Kept, part: Weighed) =>
  kept.bytes + total(part.sizes) <= WIRE.bytes && kept.events + part.events.length <= WIRE.events

/** The pointer to what comes before index `from`, when something does. */
function earlierBefore(events: readonly ConversationEvent[], from: number) {
  const first = events[from]
  return from > 0 && first
    ? {
        earlier: {
          before: first.id,
          messages: events.slice(0, from).filter(isMessage).length,
          ...(events[0]?.at ? { since: events[0].at } : {}),
        },
      }
    : {}
}

/**
 * The last turns of `events` that fit the limits: whole turns, newest first, but always the newest
 * turn, whose tail alone is kept when it is larger than a page.
 */
function lastTurns(events: readonly ConversationEvent[]): ConversationPage {
  const chunks: ConversationEvent[][] = []
  const kept: Kept = { events: 0, bytes: 0 }
  let from = events.length
  while (from > 0 && chunks.length < WIRE.turns) {
    const part = weigh(events, turnStart(events, from), from)
    if (kept.events > 0 && !fits(kept, part)) break
    const take = kept.events > 0 ? part.events.length : tailCount(part.sizes)
    chunks.unshift(part.events.slice(part.events.length - take))
    kept.bytes += total(part.sizes.slice(part.sizes.length - take))
    kept.events += take
    from -= take
    if (take < part.events.length) break
  }
  return { events: chunks.flat(), ...earlierBefore(events, from) }
}

/** The turns before the event `before`; nothing when the cache no longer has it. */
export function earlierPage(
  events: readonly ConversationEvent[],
  before: string,
): ConversationPage {
  const index = events.findIndex((event) => event.id === before)
  return index < 0 ? { events: [] } : lastTurns(events.slice(0, index))
}

/** One event whole, as the readers produced it. */
export const wholeEvent = (events: readonly ConversationEvent[], id: string) =>
  events.find((event) => event.id === id)

/** File cards are hydrated only after selection, then their final URLs must fit the same page. */
export function boundedAttachmentPage<T extends ConversationPage>(page: T): T {
  if (small(page.events)) return page
  const selected = lastTurns(page.events)
  const earlier = selected.earlier
    ? {
        ...selected.earlier,
        messages: selected.earlier.messages + (page.earlier?.messages ?? 0),
        ...(page.earlier?.since ? { since: page.earlier.since } : {}),
      }
    : page.earlier
  return { ...page, ...selected, ...(earlier ? { earlier } : {}), reset: true }
}

/**
 * The snapshot for the request that read it with `after`: an update when `after` continues the cache's
 * own stream and the news is small, otherwise the last turns; `all` reads the whole cache for that.
 */
export function wireSnapshot(
  snapshot: ConversationSnapshot,
  after: string | undefined,
  all: () => ConversationSnapshot,
): ConversationSnapshot {
  const continuing = continues(after, snapshot.cursor)
  if (continuing && small(snapshot.events))
    return { ...snapshot, events: snapshot.events.map(wireEvent) }
  const whole = continuing ? all() : snapshot
  return { ...whole, ...lastTurns(whole.events), reset: true }
}
