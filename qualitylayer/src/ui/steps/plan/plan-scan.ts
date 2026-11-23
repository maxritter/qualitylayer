// Linear readers for the Plan page's line shapes. Each one returns exactly what the regular
// expression it names returned, without that pattern's backtracking: a long run of spaces, `;` or
// `·` costs one pass, not one pass per character. tests/ui/plan-scan.test.ts runs each against its
// old pattern.

import {
  artifactName,
  firstBreak,
  isBreak,
  isCallLine,
  isSpace,
  lastBreak,
  restOfLine,
  skipSpace,
  verdictLength,
} from "./plan-scan-core.ts"

export { artifactName, isCallLine, verdictLength }

const GAP = " gave no readable answer"

/**
 * The closing `; <name> gave no readable answer` parts of a panel's backing, as
 * `who.match(/(?:;\s*[^;·]+? gave no readable answer)+$/)?.[0] ?? ""` gave them.
 */
export function gapTail(who: string): string {
  let start = who.length
  while (start > 0) {
    const semi = who.lastIndexOf(";", start - 1)
    if (semi < 0) break
    const part = who.slice(semi + 1, start)
    if (part.length <= GAP.length || !part.endsWith(GAP) || part.includes("·")) break
    start = semi
  }
  return who.slice(start)
}

const DISAGREES = " disagrees"

/** `part.match(/^(.+?) disagrees(?::\s*(.*))?$/)`: the name and the reason, or null. */
export function disagreement(part: string): { name: string; reason: string | undefined } | null {
  const stop = firstBreak(part)
  const last = lastBreak(part)
  for (
    let at = part.indexOf(DISAGREES, 1);
    at >= 0 && at <= stop;
    at = part.indexOf(DISAGREES, at + 1)
  ) {
    const after = at + DISAGREES.length
    if (after === part.length) return { name: part.slice(0, at), reason: undefined }
    if (part[after] !== ":") continue
    const reason = restOfLine(part, after + 1, last)
    if (reason !== undefined) return { name: part.slice(0, at), reason }
  }
  return null
}

/**
 * The head line of *Reviews*: `line.match(/^\*\*(.+?)\*\*\s*·\s*(.*)$/) ??
 * line.match(/^\*\*(.+?):\*\*\s*(.*)$/)` as [label, summary], or null.
 */
export function reviewHead(line: string): [string, string] | null {
  if (!line.startsWith("**")) return null
  const stop = firstBreak(line)
  const last = lastBreak(line)
  for (let at = line.indexOf("**", 3); at >= 0 && at <= stop; at = line.indexOf("**", at + 1)) {
    const dot = skipSpace(line, at + 2)
    if (line[dot] !== "·") continue
    const summary = restOfLine(line, dot + 1, last)
    if (summary !== undefined) return [line.slice(2, at), summary]
  }
  for (let at = line.indexOf(":**", 3); at >= 0 && at <= stop; at = line.indexOf(":**", at + 1)) {
    const summary = restOfLine(line, at + 3, last)
    if (summary !== undefined) return [line.slice(2, at), summary]
  }
  return null
}

function isMiddleDotSplit(line: string, at: number, last: number): boolean {
  if (at + 3 >= line.length || last >= at + 3) return false
  return isSpace(line[at]) && line[at + 1] === "·" && isSpace(line[at + 2])
}

/** `line.match(/^\s*-\s+(.+?)\s·\s(.+)$/)` as [what, rest], or null. */
export function reviewItem(line: string): [string, string] | null {
  const dash = skipSpace(line, 0)
  if (line[dash] !== "-") return null
  const from = dash + 1
  const text = skipSpace(line, from)
  if (text === from) return null
  const last = lastBreak(line)
  let next = text + 1
  while (next < line.length && !isMiddleDotSplit(line, next, last)) next++
  let breakFrom = firstBreak(line, text)
  // `\s+` gives back one space at a time; the item then starts inside the spaces.
  for (let start = text; start > from; start--) {
    if (start < text && isBreak(line[start])) breakFrom = start
    const at = start <= text - 2 && isMiddleDotSplit(line, text - 1, last) ? text - 1 : next
    if (at < line.length && at <= breakFrom) return [line.slice(start, at), line.slice(at + 3)]
  }
  return null
}
