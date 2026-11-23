// The keys ⌘K brings with it, in one table: the chord, how the platform draws it, and the one
// window listener that answers the ones that work on every page. The open box keeps its number
// chords for project rows; outside it, the installed App uses the first three for its places.

import { useEffect, useRef } from "react"
import { machineFrame } from "../machines/framed.ts"

/** A chord is ⌘ on the Mac and Ctrl elsewhere, plus one key, with Shift when it says so. */
export type Chord = { key: string; shift?: boolean }

export const CHORD = {
  open: { key: "k" },
  usage: { key: "u" },
  newTask: { key: "n", shift: true },
  file: { key: "p" },
  taskList: { key: "b" },
  sidebar: { key: "j" },
  home: { key: "1" },
  artifacts: { key: "3" },
  settings: { key: "," },
  /** ⌘ + as the keyboard sends it: = unshifted, + with Shift, and the keypad's + without. */
  textBigger: { key: "=" },
  textBiggerShifted: { key: "+", shift: true },
  textBiggerKeypad: { key: "+" },
  textSmaller: { key: "-" },
  textReset: { key: "0" },
} as const satisfies Record<string, Chord>

/** The chord of the project in the nth row (1 to 9) while the box is open. */
export const projectChord = (n: number): Chord => ({ key: String(n) })

export const onMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform)

/**
 * The installed App's own window, which adds `in=app` to its address; a browser tab does not. A
 * machine's page framed by the App's window is in the desktop App as well, and says so by its
 * `host`: its keys work there as they do on this computer's page.
 */
export const inDesktopApp = (): boolean =>
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).get("in") === "app" ||
    machineFrame()?.host === "app")

/** "⇧⌘N" on the Mac, "Ctrl+Shift+N" elsewhere. */
export function chordLabel(chord: Chord, mac: boolean = onMac()): string {
  const key = chord.key.toUpperCase()
  return mac
    ? `${chord.shift === true ? "⇧" : ""}⌘${key}`
    : `Ctrl+${chord.shift === true ? "Shift+" : ""}${key}`
}

/** A shortcut hint only where these native-window chords are available. */
export function appShortcut(label: string, chord: Chord): string {
  return inDesktopApp() ? `${label} · ${chordLabel(chord)}` : label
}

type KeyFacts = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">

/**
 * Whether the key event is the chord: ⌘ alone on the Mac, Ctrl alone elsewhere (on the Mac Ctrl+K,
 * Ctrl+P and the rest stay text editing), no Alt, Shift exactly as the chord says.
 */
export function pressed(event: KeyFacts, chord: Chord, mac: boolean = onMac()): boolean {
  const held = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!held || event.altKey) return false
  if (event.shiftKey !== (chord.shift === true)) return false
  return event.key.toLowerCase() === chord.key
}

/** What closes on a press outside it: an open menu or popover, and the new-task and add-project cards. */
const OPEN_POPUP =
  '[data-slot$="-positioner"][data-open], [data-testid="new-task"], [data-testid="add-project"]'

/**
 * Menus and popovers close on a press outside them. A chord opens its page over none that were left
 * open (the Account menu, the View menu, the new-task card), so it makes that press first, but only
 * when one is open: an idle page sees no event, and what a press would clear stays as it is.
 */
export function dismissPopups(): void {
  if (document.querySelector(OPEN_POPUP) === null) return
  for (const type of ["pointerdown", "mousedown"])
    document.body.dispatchEvent(new MouseEvent(type, { bubbles: true }))
}

type CommandKeyHandlers = {
  /** ⌘K. */
  open?: () => void
  /** ⌘U: Settings › Usage. */
  usage?: () => void
  taskList?: () => void
  sidebar?: () => void
  home?: () => void
  artifacts?: () => void
  settings?: () => void
  /** ⇧⌘N: a new task, in the open task's project when a task is open. Only the installed App. */
  newTask?: () => void
  /** ⌘P: the open task's file finder. Absent when no task is open, and the key is left alone. */
  file?: () => void
  /** ⌘ +, ⌘ − and ⌘ 0: Text size one step larger (1), smaller (-1) or back to 100 % (0). Only the installed App. */
  textSize?: (by: 1 | -1 | 0) => void
}

function commandTable(
  now: CommandKeyHandlers,
  appNavigation: boolean,
): [Chord, (() => void) | undefined][] {
  const size = now.textSize
  const nav = (handler: (() => void) | undefined) => (appNavigation ? handler : undefined)
  const resize = (by: 1 | -1 | 0) => (size ? () => size(by) : undefined)
  return [
    [CHORD.open, now.open],
    [CHORD.usage, now.usage],
    [CHORD.newTask, now.newTask],
    [CHORD.file, now.file],
    [CHORD.taskList, nav(now.taskList)],
    [CHORD.sidebar, nav(now.sidebar)],
    [CHORD.home, nav(now.home)],
    [CHORD.artifacts, nav(now.artifacts)],
    [CHORD.settings, nav(now.settings)],
    [CHORD.textBigger, resize(1)],
    [CHORD.textBiggerShifted, resize(1)],
    [CHORD.textBiggerKeypad, resize(1)],
    [CHORD.textSmaller, resize(-1)],
    [CHORD.textReset, resize(0)],
  ]
}

/** Answers the chords that work on every page. The agent's terminal keeps its own keys. */
export function useCommandKeys(handlers: CommandKeyHandlers): void {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    const on = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest(".q-run-terminal")) return
      const appNavigation =
        inDesktopApp() && document.querySelector('[data-testid="command-box"]') === null
      const hit = commandTable(latest.current, appNavigation).find(
        ([chord, run]) => run !== undefined && pressed(event, chord),
      )
      if (hit?.[1] === undefined) return
      event.preventDefault()
      dismissPopups()
      hit[1]()
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [])
}
