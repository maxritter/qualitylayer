// What the Implement and Verify pages read out of the summary QualityLayer writes (the grammar of
// `summaryText`, core/pages/lanes.ts): the first line is the counts joined by ` · `, the second the
// state in one sentence. The gist draws the counts as its fact row; the build's start and elapsed
// time are in the state sentence. Pure, so a test reads it as it is.

import { isLineText, skipWhitespace } from "../../core/text-boundaries.ts"
import type { Fact } from "../step-page/bands/FactRow.tsx"

/** A section's text without comments and its `##` heading: the lines a person reads. */
const linesOf = (markdown: string): string[] =>
  markdown
    .replace(/^## .*\n?/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")

/** `14 of 28 tasks` → value "14 of 28", label "tasks"; `48 min` and `$11.40` → "spent". */
const COUNT_VALUE = /^\$?\d[\d,.]*(?:\s+of\s+\d[\d,.]*)?(?:\s+h(?:\s+\d+\s+min)?|\s+min)?(?=\s|$)/

function countOf(text: string): { value: string; label?: string } | null {
  const value = COUNT_VALUE.exec(text)?.[0]
  if (value === undefined) return null
  const label = text.slice(skipWhitespace(text, value.length))
  if (!isLineText(label)) return null
  return label === "" ? { value } : { value, label }
}

/**
 * The facts a summary's counts line carries, at most five: each part that opens with a number. A
 * duration with no word after it is the time spent, an amount of money the cost.
 */
export function summaryFacts(summary: string): Fact[] {
  const first = linesOf(summary)[0] ?? ""
  if (!/\s·\s/.test(first) && !/^\d/.test(first)) return []
  const facts: Fact[] = []
  for (const part of first.split(/(?<!\s)\s+·\s+/)) {
    const found = countOf(part.trim())
    if (found === null) continue
    // "3 h 10 min so far" is how long the build has run, said in the meta line, not a count.
    if (/^so far\b/i.test(found.label ?? "")) continue
    const label =
      found.label?.replace(/\.$/, "") ?? (found.value.startsWith("$") ? "cost" : "spent")
    facts.push({ value: found.value, label })
  }
  return facts.slice(0, 5)
}

/** The state sentence: the line after the counts, or the only line when there are no counts. */
export function summaryState(summary: string): string {
  const lines = linesOf(summary)
  const counts = countOf(lines[0] ?? "") === null ? 0 : 1
  return lines.slice(counts).join(" ")
}

function isPunctuationEndValid(summary: string, mark: string, after: number): boolean {
  if (mark === ".") {
    const rest = skipWhitespace(summary, after)
    return rest === summary.length || !isLineText(summary.slice(after, rest))
  }
  return mark === "," && /\s/.test(summary.charAt(after))
}

function whitespaceEnd(
  summary: string,
  mark: string,
  end: number,
  after: number,
): { end: number; valid: boolean } | null {
  if (after === summary.length || !isLineText(mark)) return { end, valid: true }
  const atMiddleDot = summary.charAt(after) === "·" && /\s/.test(summary.charAt(after + 1))
  return atMiddleDot ? { end: after - 1, valid: true } : null
}

/** The timestamp suffix may include a time zone, but ends at the first valid delimiter. */
function startedEnd(summary: string, from: number): { end: number; valid: boolean } {
  const boundaries = /[,·.]|\s+/g
  boundaries.lastIndex = from
  for (let match = boundaries.exec(summary); match !== null; match = boundaries.exec(summary)) {
    const end = match.index
    const after = boundaries.lastIndex
    const mark = match[0]
    if (/^[,·.]$/.test(mark)) return { end, valid: isPunctuationEndValid(summary, mark, after) }
    const ws = whitespaceEnd(summary, mark, end, after)
    if (ws !== null) return ws
  }
  return { end: summary.length, valid: true }
}

function startedOf(summary: string): string | undefined {
  let rejectedThrough = 0
  for (const date of summary.matchAll(/\bstarted (\d{1,2}\.? \S+ \d{1,2}:\d{2})/gi)) {
    const from = date.index + date[0].length
    // Any timestamp ending before the same invalid delimiter would fail for the same reason.
    if (from < rejectedThrough) continue
    const { end, valid } = startedEnd(summary, from)
    if (valid) return (date[1] ?? "") + summary.slice(from, end)
    rejectedThrough = end + 1
  }
  return undefined
}

/** When the build started and how long it has run, from the state sentence; null when it names none. */
export function buildTiming(
  summary: string,
): { started: string; elapsed?: string; built?: string } | null {
  // A finished build: `Built 7 Nov, 09:22 to 09:28 · 6 min.`
  const built = /\bBuilt (\d{1,2}\.? \S+?,? \d{1,2}:\d{2}) to (\d{1,2}:\d{2}) · ([^.]+)\./.exec(
    summary,
  )
  if (built !== null)
    return {
      started: built[1] ?? "",
      built: `built ${built[1]} to ${built[2]}`,
      elapsed: built[3] ?? "",
    }
  // The time as `when()` writes it (`8 Oct, 09:12`), up to the elapsed time, a dot or the end.
  const started = startedOf(summary)
  if (started === undefined) return null
  const elapsed = /((?<!\d)\d+(?: h(?: \d+ min)?| min)|under a minute) so far/i.exec(summary)?.[1]
  return { started, ...(elapsed !== undefined ? { elapsed: `${elapsed} so far` } : {}) }
}
