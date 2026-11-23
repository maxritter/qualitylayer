import type { GuideChapter, Mode, Place } from "./panel.ts"

/** A run toward one shown beat: beats `at`…`to` of `chapter` (`at` -1 opens the chapter's page first). */
export type Run = Place & { at: number; to: number; gos: number; retried: boolean }
export type MoveOutcome = { kind: "drive"; run: Run; reset?: boolean } | { kind: "end" } | { kind: "welcome" } | { kind: "none" }

/** The App's theme as it draws: its stored choice, or the system's when it follows the system. */
export function isDarkTheme(): boolean {
  const chosen = localStorage.getItem("qualitylayer-theme")
  return chosen === "dark" || (chosen !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
}

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = sessionStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Without sessionStorage a beat that changes pages starts its chapter again; the guide still plays.
  }
}

/** The beats a mode shows, in order. */
export function shownBeats(chapters: GuideChapter[], mode: Mode): Place[] {
  return chapters.flatMap((chapter, c) =>
    chapter.beats.flatMap((beat, b) => (mode === "full" || beat.short ? [{ chapter: c, beat: b }] : [])),
  )
}

export const isBefore = (a: Place, b: Place) => a.chapter < b.chapter || (a.chapter === b.chapter && a.beat < b.beat)

/** The run that reaches `to` from where the guide is: on from this page within a chapter, else from its start. */
export function runTo(to: Place, from: Place | null, onward: boolean): Run {
  const same = onward && from !== null && from.chapter === to.chapter && from.beat < to.beat
  return { chapter: to.chapter, beat: to.beat, at: same ? from.beat + 1 : -1, to: to.beat, gos: 0, retried: !same }
}

function resolveChapterJump(command: string, list: Place[], at: Place | null): Place | undefined {
  if (command.startsWith("chapter:")) {
    return list.find((place) => place.chapter === Number(command.slice(8)))
  }
  const current = at?.chapter ?? -1
  const delta = command === "chapter-next" ? 1 : command === "chapter-back" ? -1 : 0
  return list.find((place) => place.chapter >= Math.max(current + delta, 0))
}

export function resolveMove(command: string, list: Place[], at: Place | null): MoveOutcome {
  if (command === "next") {
    const to = at === null ? list[0] : list.find((place) => isBefore(at, place))
    return to ? { kind: "drive", run: runTo(to, at, true) } : { kind: "end" }
  }
  if (command === "back") {
    const to = at === null ? undefined : list.filter((place) => isBefore(place, at)).at(-1)
    return to ? { kind: "drive", run: runTo(to, at, false) } : { kind: "welcome" }
  }
  if (command === "again") {
    return list[0] ? { kind: "drive", run: runTo(list[0], null, false), reset: true } : { kind: "none" }
  }
  if (command === "chapter-next" || command === "chapter-back" || command === "restart" || command.startsWith("chapter:")) {
    const to = resolveChapterJump(command, list, at)
    return to ? { kind: "drive", run: runTo(to, at, false) } : { kind: "none" }
  }
  return { kind: "none" }
}
