// What a machine's framed page and the page that frames it say to each other. Both directions live
// here, so both pages run the same checks and one fixture guards them.
//
// The relay only grows: a `ql: 1` message keeps its fields and their meaning in every later
// version. A new need adds a field or a type; a reader ignores what it does not know and never
// requires what an older page does not send (`tests/fixtures/machine-relay-v1.json`).

import { machineFrame } from "./framed.ts"
import {
  type FromFrame,
  type FromParent,
  frameMessageOf,
  parentMessageOf,
  type RelayMachine,
  type RelayNotice,
  type Theme,
} from "./relay-parse.ts"

export {
  type FromFrame,
  type FromParent,
  frameMessageOf,
  parentMessageOf,
  type RelayMachine,
  type RelayNotice,
  type Theme,
}

type Heard = Pick<MessageEvent, "data" | "origin" | "source">

/**
 * What a machine's frame said. `frames` maps each frame's window to the origin its page was loaded
 * from: a message counts only when it comes from one of those windows and from that origin.
 */
export function fromFrame(
  event: Heard,
  frames: ReadonlyMap<unknown, { id: string; origin: string }>,
): { id: string; message: FromFrame } | null {
  const frame = event.source === null ? undefined : frames.get(event.source)
  if (frame === undefined || event.origin !== frame.origin) return null
  const message = frameMessageOf(event.data)
  return message === null ? null : { id: frame.id, message }
}

/** What the page that frames this one said: only its window, only its origin. */
export function fromParent(
  event: Heard,
  parentOrigin: string,
  parent: unknown = window.parent,
): FromParent | null {
  if (event.source !== parent || event.origin !== parentOrigin) return null
  return parentMessageOf(event.data)
}

/**
 * The two pages find each other without a timer, whichever is ready first. The page that frames asks
 * by sending the list: when a frame's page loaded, when that page speaks for the first time since, and
 * whenever the list changed (choosing a machine changes it). A framed page answers every list with
 * what waits on it now, and its own first word is what it says when it mounts. Asking twice and
 * answering twice change nothing; an answer is never answered with another list.
 */
export function answerTo(
  said: FromParent | null,
  now: { needsYou: number; badge: number },
): FromFrame | null {
  return said?.type === "machines" ? { ql: 1, type: "waiting", ...now } : null
}

/**
 * The place the page that frames this one sends it to: only its window and its origin count, and only
 * a route of this page (it starts `#/`). Nothing is heard in a page that is not framed.
 */
export function listenForGo(go: (route: string) => void, self: Window = window): () => void {
  const frame = machineFrame(self.location, self)
  if (frame === null) return () => {}
  const heard = (event: MessageEvent) => {
    const said = fromParent(event, frame.parent, self.parent)
    if (said?.type === "go" && said.route.startsWith("#/")) go(said.route)
  }
  self.addEventListener("message", heard)
  return () => self.removeEventListener("message", heard)
}

/** Say something to the page that frames this one; nothing happens in a page that is not framed. */
export function toParent(message: FromFrame, self: Window = window): boolean {
  const frame = machineFrame(self.location, self)
  if (frame === null) return false
  self.parent.postMessage(message, frame.parent)
  return true
}

/** Say something to one machine's frame, addressed to the origin its page was loaded from. */
export function toFrame(
  frame: Pick<Window, "postMessage">,
  origin: string,
  message: FromParent,
): void {
  frame.postMessage(message, origin)
}
