import type { ResttyHeadlessTerminal } from "restty/headless"
import { BoundaryTracker } from "./restore-boundary.ts"
import { CursorStateTracker } from "./restore-cursor.ts"
import { rebuild } from "./restore-rebuild.ts"

export { BoundaryTracker, CursorStateTracker, rebuild }

export const MODES = [
  1, 6, 7, 25, 45, 66, 69, 1000, 1002, 1003, 1004, 1005, 1006, 1007, 1015, 1016, 2004, 2026, 2027,
  2031, 1049,
]

export function query(t: ResttyHeadlessTerminal, sequence: string) {
  t.drainOutput()
  t.write(sequence, { recordReplay: false })
  return t.drainOutput()
}

export function modesOf(t: ResttyHeadlessTerminal) {
  return Object.fromEntries(
    MODES.map((mode) => [mode, Number(/;(\d)\$y/.exec(query(t, `\x1b[?${mode}$p`))?.[1] ?? -1)]),
  )
}

export function dcs(t: ResttyHeadlessTerminal, request: string) {
  const answer = query(t, `\x1bP$q${request}\x1b\\`)
  return answer.startsWith("\x1bP1$r") && answer.endsWith("\x1b\\") ? answer.slice(5, -2) : null
}

export function screenText(t: ResttyHeadlessTerminal): string {
  const s = t.snapshot()
  if (!s?.codepoints) return ""
  return Array.from({ length: s.rows }, (_, row) => {
    let line = ""
    for (let col = 0; col < s.cols; col++) {
      const i = row * s.cols + col
      if (s.wide?.[i] === 2) continue
      line += String.fromCodePoint(s.codepoints?.[i] || 32)
      for (let g = 0; g < (s.graphemeLen?.[i] ?? 0); g++)
        line += String.fromCodePoint(s.graphemeBuffer?.[(s.graphemeOffset?.[i] ?? 0) + g] ?? 32)
    }
    return line.trimEnd()
  })
    .join("\n")
    .trimEnd()
}

export function terminalState(t: ResttyHeadlessTerminal) {
  const s = t.snapshot()
  if (!s?.codepoints) throw new Error("terminal has no snapshot")
  return {
    cols: s.cols,
    rows: s.rows,
    codepoints: Array.from(s.codepoints, (cp) => cp || 32),
    fg: Array.from(s.fgBytes ?? []),
    bg: Array.from(s.bgBytes ?? []),
    style: Array.from(s.styleFlags ?? []),
    graphemes: Array.from({ length: s.cellCount }, (_, i) =>
      Array.from(
        s.graphemeBuffer?.subarray(
          s.graphemeOffset?.[i] ?? 0,
          (s.graphemeOffset?.[i] ?? 0) + (s.graphemeLen?.[i] ?? 0),
        ) ?? [],
      ),
    ),
    cursor: s.cursor,
    modes: modesOf(t),
    pen: dcs(t, "m"),
    kitty: t.getKittyKeyboardFlags(),
    scroll: dcs(t, "r"),
    margins: dcs(t, "s"),
    cursorStyle: dcs(t, " q"),
  }
}
