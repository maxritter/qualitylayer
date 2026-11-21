// Messages typed into the agent's window that its record does not show yet (the "Awaiting agent" rows).
// They belong to the run, not to the mounted Conversation: the agent still holds the message (Claude Code
// lists it as queued in its Terminal) when the view unmounts on a switch to Terminal, another task or an
// evicted viewer, so returning lists it again until the record has it. No poll: the view reads the record
// the way it always does and settles what the record shows.

import { useSyncExternalStore } from "react"
import type { ConversationEvent } from "../../../core/conversation/types.ts"
import type { RunWindow } from "../../run-context.tsx"
import { sameWords } from "./model.ts"

/** How long a sent message waits before its delivery is uncertain. */
export const SENT_MS = 120_000
/** Messages kept per run, and runs kept: the oldest goes first. */
const KEPT_MESSAGES = 8
const KEPT_RUNS = 16

/** `seen` holds the person's messages the record already had when this one was sent. */
export type Pending = {
  key: number
  text: string
  at: number
  seen: ReadonlySet<string>
  transmitted?: string
  unconfirmed?: true
}
type Owner = Pick<RunWindow, "id" | "generation" | "nativeSession">
type Entry = { generation: number; nativeSession: string | undefined; list: readonly Pending[] }

const none: readonly Pending[] = []
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()

/** A restarted generation or another native conversation never inherits a message typed into the old one. */
const ownedBy = (entry: Entry, run: Owner) =>
  entry.generation === run.generation &&
  (!entry.nativeSession || entry.nativeSession === run.nativeSession)
const read = (run: Owner): readonly Pending[] => {
  const entry = entries.get(run.id)
  return entry && ownedBy(entry, run) ? entry.list : none
}

function write(run: Owner, list: readonly Pending[]): void {
  if (list === read(run)) return
  entries.delete(run.id)
  if (list.length > 0) {
    entries.set(run.id, { generation: run.generation, nativeSession: run.nativeSession, list })
    while (entries.size > KEPT_RUNS) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      entries.delete(oldest.value)
    }
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The messages of this run still waiting for the agent's record. */
export const useAwaiting = (run: Owner): readonly Pending[] =>
  useSyncExternalStore(
    subscribe,
    () => read(run),
    () => none,
  )

export function addAwaiting(
  run: Owner,
  text: string,
  seen: ReadonlySet<string>,
  at: number,
  transmitted = text,
): void {
  const list = read(run)
  const key = (list.at(-1)?.key ?? 0) + 1
  write(
    run,
    [...list, { key, text, at, seen, ...(text === transmitted ? {} : { transmitted }) }].slice(
      -KEPT_MESSAGES,
    ),
  )
}

/** The record shows a message the person sent, new since it was sent: it stops waiting. */
export function settleAwaiting(run: Owner, events: readonly ConversationEvent[]): void {
  const list = read(run)
  const left = list.filter(
    (item) =>
      !events.some(
        (event) =>
          event.kind === "user" &&
          !item.seen.has(event.id) &&
          (sameWords(event.text, item.text) ||
            (item.transmitted !== undefined && sameWords(event.text, item.transmitted))),
      ),
  )
  if (left.length < list.length) write(run, left)
}

/** Native commands may have no transcript row. Keep ordinary text available for recovery. */
export function expireAwaiting(run: Owner, now: number): void {
  const list = read(run)
  if (!list.some((item) => !item.unconfirmed && now - item.at >= SENT_MS)) return
  write(
    run,
    list.flatMap((item): Pending[] => {
      if (item.unconfirmed || now - item.at < SENT_MS) return [item]
      if (/^\/[\w-]+(?:\s|$)/.test(item.text.trimStart())) return []
      return [{ ...item, unconfirmed: true }]
    }),
  )
}

export function dismissAwaiting(run: Owner, key: number): void {
  const list = read(run)
  const kept = list.filter((item) => item.key !== key || !item.unconfirmed)
  if (kept.length !== list.length) write(run, kept)
}

/** Runs the App no longer lists keep nothing. */
export function pruneAwaiting(inventory: ReadonlySet<string>): void {
  let removed = false
  for (const id of [...entries.keys()])
    if (!inventory.has(id)) removed = entries.delete(id) || removed
  if (removed) for (const listener of listeners) listener()
}
