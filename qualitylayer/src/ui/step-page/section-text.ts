import { trimmedLineTail } from "../../core/text-boundaries.ts"
import type { Fact } from "./bands/FactRow.tsx"

/** A table's divider row (`|---|---|`) and nothing else. */
export function isDivider(line: string): boolean {
  const row = line.trim()
  const cells = row.slice(row.startsWith("|") ? 1 : 0, row.endsWith("|") ? -1 : undefined)
  return cells.split("|").every((cell) => /^:?-{2,}:?$/.test(cell.trim()))
}

export function plain(text: string): string {
  const words = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/[`*_]/g, "")
  const parts: string[] = []
  let copied = 0
  let from = 0
  while (from < words.length) {
    const open = words.indexOf("[", from)
    if (open === -1) break
    const close = words.indexOf("]", open + 1)
    if (close === -1) break
    from = close + 1
    if (close === open + 1 || words.charAt(from) !== "(") continue
    const end = words.indexOf(")", from + 1)
    if (end === -1) break
    parts.push(words.slice(copied, open), words.slice(open + 1, close))
    copied = end + 1
    from = copied
  }
  parts.push(words.slice(copied))
  return parts.join("").trim()
}

/** The facts a Summary's counts line carries: `12 Done means · 4 answers` → two facts. */
export function factsOfLine(line: string): Fact[] {
  const facts: Fact[] = []
  for (const part of plain(line).split(/(?<!\s)\s+[·•]\s+/)) {
    const text = part.trim()
    const value = /^(?:about\s+)?\d[\d,.]*(?:\s?%)?(?=\s)/i.exec(text)?.[0]
    if (value === undefined) continue
    const label = trimmedLineTail(text, value.length, 1)
    if (label !== null) facts.push({ value, label: label.replace(/[.]$/, "") })
  }
  return facts
}
