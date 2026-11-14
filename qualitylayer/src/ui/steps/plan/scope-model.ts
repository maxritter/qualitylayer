// What the Plan page reads out of its Scope section, apart from any drawing: its two lists. Pure,
// so a test reads it as it is.

import { isLineText, skipWhitespace, trimmedLineTail } from "../../../core/text-boundaries.ts"
import { bodyOf } from "../../step-page/sections.ts"

export type Scope = { inScope: string[]; outOfScope: string[] }

const bulletsOf = (lines: string[]): string[] => {
  const out: string[] = []
  for (const line of lines) {
    const start = skipWhitespace(line, 1)
    const bullet = /^[-*+]/.test(line) && start > 1 && isLineText(line.slice(start))
    if (bullet) out.push(line.slice(start).trim())
    else if (/^\s+\S/.test(line) && out.length > 0) out[out.length - 1] += ` ${line.trim()}`
  }
  return out
}

/** Scope's two lists, under `### In scope` and `### Out of scope`. */
export function scopeOf(section: string): Scope {
  const lists = { inScope: [] as string[], outOfScope: [] as string[] }
  let into: keyof Scope | null = null
  let lines: string[] = []
  const close = () => {
    if (into !== null) lists[into] = bulletsOf(lines)
    lines = []
  }
  for (const line of bodyOf(section).split(/\r?\n/)) {
    const head = line.startsWith("###") ? (trimmedLineTail(line, 3, 1) ?? undefined) : undefined
    if (head !== undefined) {
      close()
      into = /^out of\b/i.test(head) ? "outOfScope" : /^in\b/i.test(head) ? "inScope" : null
      continue
    }
    if (into !== null) lines.push(line)
  }
  close()
  return lists
}
