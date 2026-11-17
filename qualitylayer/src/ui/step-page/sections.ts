// What the bands read out of a document's sections, apart from any drawing: which section is the
// gist, which are the core, which fold, a fold's count and takeaway, a section that only says None,
// the counts a Summary line carries. Pure, so a test reads it as it is.

import { headingSlug } from "../../core/docs/anchor.ts"
import { trimmedLineTail } from "../../core/text-boundaries.ts"
import type { DocSection, DocSections } from "../api.ts"
import { foldsOnPage } from "../steps/fold.ts"
import type { Fact } from "./bands/FactRow.tsx"
import { factsOfLine, isDivider, plain } from "./section-text.ts"

export { factsOfLine } from "./section-text.ts"

/** The DOM id of a section on the page: its fold's summary, or its heading's wrapper. */
export const sectionId = (title: string): string => `bd-sec-${headingSlug(title)}`

/** A section's text without its `##` heading line and without the comments QualityLayer keeps. */
export function bodyOf(markdown: string): string {
  return markdown
    .replace(/^## .*\n?/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
}

/** The text of a section with the code fences taken out, which no row or sentence is read from. */
function proseOf(markdown: string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of bodyOf(markdown).split(/\r?\n/)) {
    const opened = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (opened !== undefined) {
      if (fence === null) fence = opened.slice(0, 3)
      else if (opened.startsWith(fence)) fence = null
      continue
    }
    if (fence === null) out.push(line)
  }
  return out.join("\n")
}

/** Lines of a section a person reads: not blank, not a heading, not a table's divider or header. */
export function visibleLines(markdown: string): string[] {
  const lines = proseOf(markdown)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
  const out: string[] = []
  lines.forEach((line, index) => {
    if (/^#{1,6}\s/.test(line) || isDivider(line)) return
    // A table's header row is the one before its divider.
    if (/^\s*\|/.test(line) && isDivider(lines[index + 1] ?? "")) return
    out.push(line)
  })
  return out
}

/** How many lines a fold holds, for the grouping that starts past about twelve. */
export const lineCount = (markdown: string): number => visibleLines(markdown).length

const clip = (text: string, at: number): string =>
  text.length <= at ? text : `${text.slice(0, at - 1).trimEnd()}…`

/** A paragraph's sentences; a full stop inside a code span never ends one. */
export function sentencesOf(text: string): string[] {
  const spans: string[] = []
  // Code spans stand behind private-use marks while the text is split, so a digit in the words stays.
  const masked = text.replace(/`[^`\n]+`/g, (span) => `${spans.push(span) - 1}`)
  return masked
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/(\d+)/g, (_, n: string) => spans[Number(n)] ?? ""))
    .filter((s) => s !== "")
}

/**
 * A section that says None (alone, or as "None: the reason." / "None. The reason."), Nothing is open
 * or No new module: one quiet line, never a fold.
 */
const QUIET = /^(?:none(?:[.:]\s*[^\n]*)?|nothing\b[^\n]*|no new module\b[^\n]*)$/i

/** The one quiet line a section reduces to, or null when it holds more than that. */
export function quietLine(markdown: string): string | null {
  const lines = bodyOf(markdown)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
  const only = lines.length === 1 ? plain(lines[0] ?? "").replace(/^[-*+]\s+/, "") : ""
  return only !== "" && QUIET.test(only) ? only.replace(/\.$/, "") : null
}

/** The first words of a list item, a table row or a paragraph: what the row is about. */
export function headlineOfLine(line: string): string {
  const text = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*\|/, "")
    .trim()
  const bold = /^\*\*(.+?)\*\*/.exec(text)?.[1]
  if (bold !== undefined) return plain(bold).replace(/[.:]$/, "")
  // A table row's first cell with words in it: not its number.
  const cell = text.split("|").find((c) => /[A-Za-z]{2}/.test(c)) ?? text
  return plain(sentencesOf(cell)[0] ?? cell).replace(/[.:]$/, "")
}

/**
 * What a fold's summary line says of its section: how many rows it holds (the `###` takeaways,
 * else the list items, else the table rows), and its first row as the takeaway.
 */
export function foldFacts(markdown: string): { count: number | null; takeaway: string } {
  const body = proseOf(markdown)
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "")
  const heads = lines.filter((l) => /^###\s/.test(l))
  if (heads.length > 0)
    return {
      count: heads.length,
      takeaway: clip(plain((heads[0] ?? "").replace(/^###\s+/, "")), 90),
    }
  const items = lines.filter((l) => /^(?:[-*+]|\d+[.)])\s+/.test(l))
  if (items.length > 0)
    return { count: items.length, takeaway: clip(headlineOfLine(items[0] ?? ""), 90) }
  const rows = visibleLines(markdown).filter((l) => /^\s*\|/.test(l))
  if (rows.length > 0)
    return { count: rows.length, takeaway: clip(headlineOfLine(rows[0] ?? ""), 90) }
  const first = visibleLines(markdown)[0] ?? ""
  return { count: null, takeaway: clip(headlineOfLine(first), 90) }
}

export type Takeaway = {
  title: string
  slug: string
  /** The first sentence under the takeaway. */
  lead: string
  /** The takeaway's own text, its `###` line first, up to the next one. */
  markdown: string
  /** `**Answers:** 1, 4` → "1, 4". */
  answers: string | null
}

/**
 * The `###` takeaways of a section, and the text that stands before the first (a trust boundary
 * line, a lead-in), which the page draws above the rows.
 */
export function takeawaysOf(markdown: string): { intro: string; items: Takeaway[] } {
  const out: Takeaway[] = []
  const intro: string[] = []
  let current: { title: string; lines: string[] } | null = null
  const flush = () => {
    if (current === null) return
    const text = current.lines.join("\n")
    const prose = proseOf(text)
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "" && !/^\*\*[^*]+:\*\*/.test(l.trim()) && !/^###\s/.test(l))
    const answers = /\*\*Answers:\*\*\s*([^\n]+)/i.exec(text)?.[1]?.trim() ?? null
    out.push({
      title: plain(current.title),
      slug: headingSlug(current.title),
      lead: plain(sentencesOf(prose[0] ?? "")[0] ?? ""),
      markdown: text,
      answers,
    })
    current = null
  }
  let fence: string | null = null
  for (const line of markdown.replace(/^## .*\n?/, "").split(/\r?\n/)) {
    const opened = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (opened !== undefined) {
      if (fence === null) fence = opened.slice(0, 3)
      else if (opened.startsWith(fence)) fence = null
    }
    const head = fence === null && line.startsWith("###") ? trimmedLineTail(line, 3, 1) : null
    if (head !== null) {
      flush()
      current = { title: head, lines: [line] }
      continue
    }
    if (current !== null) current.lines.push(line)
    else intro.push(line)
  }
  flush()
  return { intro: intro.join("\n").trim(), items: out }
}

/**
 * A Summary as the gist draws it: its counts line (the first line, when it is counts joined by
 * `·`), the words in at most two sentences, and any bullets.
 */
export function summaryOf(markdown: string): {
  facts: Fact[]
  sentences: string
  bullets: string[]
} {
  const lines = proseOf(markdown)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
  const counts = lines[0] !== undefined && /\s[·•]\s/.test(lines[0]) ? factsOfLine(lines[0]) : []
  const isCounts = counts.length >= 2
  const rest = isCounts ? lines.slice(1) : lines
  const bullets = rest
    .filter((l) => /^(?:[-*+]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^(?:[-*+]|\d+[.)])\s+/, ""))
  const prose = rest.filter((l) => !/^(?:[-*+]|\d+[.)])\s+/.test(l) && !/^\*\*[^*]+:\*\*/.test(l))
  return {
    facts: isCounts ? counts.slice(0, 5) : [],
    sentences: sentencesOf(prose.join(" ")).slice(0, 2).join(" "),
    bullets,
  }
}

/** A document's sections sorted into the bands they are drawn in. */
export type SectionBands = {
  /** The Summary the gist draws. */
  summary: DocSection | null
  /** The lead sections in file order, the Summary left out. */
  core: DocSection[]
  /** The lead-folded sections in file order. */
  folded: DocSection[]
  /** The working sections: the strip names them, the Reader holds them. */
  detail: DocSection[]
}

export function bandsOfSections(cut: Pick<DocSections, "sections">): SectionBands {
  const summary = cut.sections.find((s) => s.title === "Summary" && s.show === "lead") ?? null
  return {
    summary,
    core: cut.sections.filter((s) => s.show === "lead" && s !== summary),
    folded: cut.sections.filter(foldsOnPage),
    detail: cut.sections.filter((s) => s.show === "detail"),
  }
}
