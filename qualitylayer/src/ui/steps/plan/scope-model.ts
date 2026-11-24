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

const INLINE_LABELS: Record<string, keyof Scope> = {
  in: "inScope",
  "in scope": "inScope",
  out: "outOfScope",
  "out of scope": "outOfScope",
}

const parseInlineScopeItem = (item: string): [keyof Scope, string] | null => {
  const close = item.startsWith("**") ? item.indexOf(":**", 2) : -1
  if (close === -1) return null
  const label = item.slice(2, close).trim().replace(/\s+/g, " ").toLowerCase()
  const bucket = INLINE_LABELS[label]
  const value = item.slice(close + 3).trim()
  return bucket && value !== "" ? [bucket, value] : null
}

const headingBucket = (line: string): keyof Scope | null | undefined => {
  const head = line.startsWith("###") ? (trimmedLineTail(line, 3, 1) ?? undefined) : undefined
  if (head === undefined) return undefined
  if (/^out of\b/i.test(head)) return "outOfScope"
  if (/^in\b/i.test(head)) return "inScope"
  return null
}

const collectInlineScope = (bodyLines: string[]): Scope => {
  const lists: Scope = { inScope: [], outOfScope: [] }
  for (const item of bulletsOf(bodyLines)) {
    const parsed = parseInlineScopeItem(item)
    if (parsed !== null) lists[parsed[0]].push(parsed[1])
  }
  return lists
}

/** Scope's two lists, under `### In scope` / `### Out of scope` or inline `- **In:**` / `- **Out:**` bullets. */
export function scopeOf(section: string): Scope {
  const lists: Scope = { inScope: [], outOfScope: [] }
  let into: keyof Scope | null = null
  let lines: string[] = []
  const close = () => {
    if (into !== null) lists[into] = bulletsOf(lines)
    lines = []
  }
  const bodyLines = bodyOf(section).split(/\r?\n/)
  for (const line of bodyLines) {
    const bucket = headingBucket(line)
    if (bucket !== undefined) {
      close()
      into = bucket
      continue
    }
    if (into !== null) lines.push(line)
  }
  close()
  if (lists.inScope.length > 0 || lists.outOfScope.length > 0) return lists
  return collectInlineScope(bodyLines)
}
