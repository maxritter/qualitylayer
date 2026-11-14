// The one open quick field: where the person marked and how to describe it to the agent. Plan text, an
// artifact spot or region, and code lines all open it through `openQuickAsk`; the task's QuickAsk host
// draws it.

import { useSyncExternalStore } from "react"
import type { ContextualRequest } from "../agent-window/conversation/context-draft.ts"

export type ScreenBox = { x: number; y: number; width: number; height: number }

export type QuickAskMark = {
  kind: "passage" | "artifact" | "code"
  /** "Plan › Summary", "Plan and limits › Limit", "billing.ts › Lines 10–11". */
  place: string
  quote: string
  /** Where the field opens: just below the mark, in viewport pixels. */
  at: { x: number; y: number }
  /** What stays highlighted while the field is open, in viewport pixels. */
  boxes?: readonly ScreenBox[]
  /** A spot clicked on an artifact: the pin's point. */
  pin?: { x: number; y: number }
  /** An area dragged on an artifact: its one box is drawn as a region. */
  region?: boolean
  /** Builds the full context once the person sends (hashes the shown source, names the target). */
  context(): Promise<ContextualRequest>
  /** Called when the field closes, sent or not (code lines drop their highlight). */
  onClose?(): void
}

let current: QuickAskMark | null = null
const listeners = new Set<() => void>()
const notify = () => {
  for (const listen of listeners) listen()
}

export function openQuickAsk(mark: QuickAskMark): void {
  const before = current
  current = mark
  // A new mark of the same kind already replaced the old highlight (a Shift-click extends the lines,
  // a new selection replaces the text); clearing it now would drop the new one.
  if (before && before !== mark && before.kind !== mark.kind) before.onClose?.()
  notify()
}

export function closeQuickAsk(mark?: QuickAskMark): void {
  if (mark && current !== mark) return
  const before = current
  current = null
  before?.onClose?.()
  notify()
}

export function useQuickAskMark(): QuickAskMark | null {
  return useSyncExternalStore(
    (listen) => {
      listeners.add(listen)
      return () => listeners.delete(listen)
    },
    () => current,
    () => null,
  )
}

/** "sha256:…" of the source the mark was made on, so the agent knows which revision it was. */
export async function sourceRevision(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export const clip = (text: string, n: number): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}
