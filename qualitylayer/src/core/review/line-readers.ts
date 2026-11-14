import { isLineText, skipWhitespace } from "../text-boundaries.ts"

function skip(text: string, at: number, characters: string): number {
  while (at < text.length && characters.includes(text.charAt(at))) at++
  return at
}

/** The verdict's Markdown marks are formatting; the captured reason stays exactly as written. */
export function verdictLine(line: string): [string, string, string] | null {
  let at = skip(line, 0, "*_")
  const verdict = /^(APPROVE|REVISE|BLOCK)\b/.exec(line.slice(at))
  if (verdict === null) return null
  at = skip(line, at + verdict[0].length, "*_")
  if (line.charAt(at) === ":") at++
  at = skip(line, at, "*_")
  at = skip(line, at, " \t")
  const reason = line.slice(at)
  return isLineText(reason) ? [line, verdict[1] as string, reason] : null
}

/** Whole-item absence phrases only; a finding beginning with one remains a finding. */
export function nothingLine(line: string): boolean {
  let text = line.startsWith("(") ? line.slice(1) : line
  text = text.trimStart()
  if (text.endsWith(")")) text = text.slice(0, -1)
  text = text.trimEnd()
  if (text.endsWith(".")) text = text.slice(0, -1).trimEnd()
  return /^(?:none|n\/a|nothing|no (?:new |further |more )?(?:findings?|items?|issues?)|nothing (?:more|else|further)|nothing (?:more |else |further )?to add)$/i.test(
    text,
  )
}

/** The second round's number, stance and reason, preserving its formatting grammar. */
export function stanceLine(
  line: string,
): [string, string | undefined, string, string, string] | null {
  let at = 0
  while (at < line.length && /[\s\-*>#]/.test(line.charAt(at))) at++
  const own = /^m/i.test(line.charAt(at)) ? line.charAt(at++) : undefined
  if (line.charAt(at) === "#") at++
  const number = at
  while (/[0-9]/.test(line.charAt(at))) at++
  if (at === number) return null
  const digits = line.slice(number, at)
  at = skip(line, at, "*")
  at = skipWhitespace(line, at)
  at = skip(line, at, ":.)-–—")
  at = skipWhitespace(line, at)
  at = skip(line, at, "*")
  at = skipWhitespace(line, at)
  const word = /^(AGREE|DISAGREE|SAME\s+AS)\b/i.exec(line.slice(at))
  if (word === null) return null
  at = skip(line, at + word[0].length, "*")
  at = skipWhitespace(line, at)
  const reason = line.slice(at)
  return isLineText(reason) ? [line, own, digits, word[1] as string, reason] : null
}

/** A panel's backing annotation, separate from the finding and its answer. */
export function backingLine(line: string): [string, string, string] | null {
  let at = skipWhitespace(line, 0)
  if (!/^Panel:/i.test(line.slice(at, at + 6))) return null
  at = skipWhitespace(line, at + 6)
  const backing = /^(all|split|one)\b/i.exec(line.slice(at))
  if (backing === null) return null
  at = skipWhitespace(line, at + backing[0].length)
  if (/[·:—–-]/.test(line.charAt(at))) at++
  at = skipWhitespace(line, at)
  const who = line.slice(at)
  return isLineText(who) ? [line, backing[1] as string, who] : null
}

export function panelReason(reason: string): string {
  const parts = reason.split("·")
  if (parts.length === 1) return reason
  return parts
    .map((part, at) =>
      at === 0 ? part.trimEnd() : at === parts.length - 1 ? part.trimStart() : part.trim(),
    )
    .join(", ")
}
