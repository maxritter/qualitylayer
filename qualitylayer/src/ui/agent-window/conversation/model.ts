// The Conversation view's logic apart from React: merging polled events, turning them into turns of
// rows, and the words and numbers the rows show.

import type {
  ConversationEvent,
  ConversationPage,
  ConversationSnapshot,
  ConversationUsage,
  ConversationWorker,
  EarlierTurns,
  PendingApproval,
} from "../../../core/conversation/types.ts"

export {
  type Block,
  buildBlocks,
  type Item,
  type Row,
  type Turn,
} from "./model-blocks.ts"
export {
  type DiffLine,
  diffLines,
  type TaskFileRef,
  taskDocumentOf,
  taskFileOf,
} from "./model-files.ts"
export {
  clock,
  contextShare,
  duration,
  groupWhat,
  qualityCommand,
  qualityLine,
  RECORD_NAME,
  resultOf,
  sameWords,
  sessionSpan,
  tokens,
  toolName,
  typedMessage,
  verbOf,
} from "./model-format.ts"

/** Events kept in the browser, newest last. */
const KEPT_EVENTS = 3000

/** A later copy of an event replaces the earlier one in its place; new events go at the end. */
export function mergeEvents(
  before: readonly ConversationEvent[],
  incoming: readonly ConversationEvent[],
): ConversationEvent[] {
  if (incoming.length === 0) return before as ConversationEvent[]
  const at = new Map(before.map((event, index) => [event.id, index]))
  const next = [...before]
  for (const event of incoming) {
    const index = at.get(event.id)
    if (index === undefined) {
      at.set(event.id, next.length)
      next.push(event)
    } else next[index] = event
  }
  return next.length > KEPT_EVENTS ? next.slice(next.length - KEPT_EVENTS) : next
}

/** What the view holds of one session between polls. */
export type Loaded = {
  agent: ConversationSnapshot["agent"]
  source: ConversationSnapshot["source"]
  events: ConversationEvent[]
  usage?: ConversationUsage
  state?: ConversationSnapshot["state"]
  cursor: string
  truncated: boolean
  /** Older turns the server still has before the first event held; "Show earlier" reads them. */
  earlier?: EarlierTurns
  /** What waits for the person right now; every read says it afresh, none means none. */
  approvals: PendingApproval[]
  workers: ConversationWorker[]
  workersIncomplete: boolean
  hasMore: boolean
  question: ConversationSnapshot["question"]
  checklist: ConversationSnapshot["checklist"]
}

/** What a snapshot does to the events held: replace them or merge into them, and what that says of older turns. */
function heldAfter(before: Loaded | undefined, snapshot: ConversationSnapshot) {
  const held = snapshot.reset ? [] : (before?.events ?? [])
  const events = mergeEvents(held, snapshot.events)
  // Dropping the oldest events leaves a gap before the first one held, so the pointer to older turns goes.
  const oldest = (held[0] ?? snapshot.events[0])?.id
  const dropped = events.length > 0 && events[0]?.id !== oldest
  const earlier = snapshot.reset ? snapshot.earlier : before?.earlier
  return {
    events,
    dropped,
    ...(earlier && !dropped ? { earlier } : {}),
  }
}

export function applySnapshot(before: Loaded | undefined, snapshot: ConversationSnapshot): Loaded {
  const { dropped, ...held } = heldAfter(before, snapshot)
  return {
    approvals: snapshot.approvals ?? [],
    question: snapshot.question ?? null,
    checklist: snapshot.checklist ?? null,
    workers: snapshot.workers ?? [],
    workersIncomplete: snapshot.workersIncomplete === true,
    hasMore: snapshot.hasMore === true,
    agent: snapshot.agent,
    source: snapshot.source,
    usage: snapshot.usage,
    state: snapshot.state ?? before?.state,
    cursor: snapshot.cursor,
    truncated: snapshot.truncated || (before?.truncated ?? false) || dropped,
    ...held,
  }
}

/**
 * An older page goes before what the view holds. Events the page also names move to the page's place:
 * a late copy of an old event may have arrived as news and sit at the end.
 */
export function addEarlier(loaded: Loaded, asked: string, page: ConversationPage): Loaded {
  // A reset since the read began replaced what the page was asked for; its events no longer belong here.
  if (loaded.earlier?.before !== asked) return loaded
  const named = new Set(page.events.map((event) => event.id))
  const { earlier: _spent, ...rest } = loaded
  return {
    ...rest,
    events: [...page.events, ...loaded.events.filter((event) => !named.has(event.id))],
    ...(page.earlier ? { earlier: page.earlier } : {}),
  }
}

/** An event read whole replaces its shortened copy in its place; one the view no longer holds stays out. */
export function fillEvent(loaded: Loaded, event: ConversationEvent): Loaded {
  const index = loaded.events.findIndex((held) => held.id === event.id)
  if (index < 0) return loaded
  const events = [...loaded.events]
  events[index] = event
  return { ...loaded, events }
}
