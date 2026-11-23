// The glance pages of the Plan and of artifacts, folded: a list whose
// items open with a bold headline is one row per item, a later numbered finding
// replaces the item it restates, a question/answer table is one compact row per
// question, and the sections only the agent needs sit behind a labelled count.

import type { Token, Tokens } from "marked"
import type { Block } from "./DocReader.tsx"

export { foldDocument } from "./folding-sections.ts"

/** One item of a folded list. */
export type Row = {
  number: string
  /** Sanitised inline HTML: the bold opening of the item. */
  headline: string
  /** Sanitised HTML: the rest of the item; "" when the item is only its headline. */
  body: string
  /** The item as written, for the "Was" line when a later finding replaces it. */
  whole: string
  /** "updated · artifact" or "added · research": set when a later finding wrote this row. */
  tag?: string
  /** Why the later finding was added. */
  why?: string
  /** The added callouts whose jump links land on this row. */
  anchors: string[]
  /** The wordings this row replaced, oldest first. */
  earlier: { stage: string | null; html: string }[]
}

export type QaRow = { q: string; a: string }

/** A section folded away from the page: shown as a button with its count, opened on click. */
export type Fold = { id: string; label: string; count: string }

/** Which glance page a document is, read from its frontmatter: the reader never sees the file name. */
export type GlanceKind = "frame" | "artifact"

export function glanceKind(markdown: string): GlanceKind | null {
  if (!markdown.startsWith("---")) return null
  const end = markdown.indexOf("\n---", 3)
  if (end === -1) return null
  const keys = new Map<string, string>()
  for (const line of markdown.slice(3, end).split("\n")) {
    const at = line.indexOf(":")
    if (at > 0) keys.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  const type = keys.get("type")
  if (type === "artifact") return type
  // The Plan, the task's identity file, carries the task's state.
  return keys.has("stage") ? "frame" : null
}

type Html = (tokens: Token[]) => string

/** A list whose every item opens with a bold headline, as rows; null for any other list. */
export function listRows(list: Tokens.List, html: Html, inline: Html): Row[] | null {
  if (list.items.length === 0) return null
  const start = typeof list.start === "number" ? list.start : 1
  const rows: Row[] = []
  for (const [index, item] of list.items.entries()) {
    const first = item.tokens[0]
    if (first === undefined || (first.type !== "text" && first.type !== "paragraph")) return null
    const lead = first.tokens?.[0]
    if (lead === undefined || lead.type !== "strong") return null
    const rest = (first.tokens ?? []).slice(1)
    const head = rest[0]
    if (head?.type === "text") {
      const text = head.text.replace(/^\s+/, "")
      rest[0] = { ...head, text, raw: text }
    }
    const lines: Token[] = []
    if (rest.some((t) => t.type !== "text" || t.text.trim() !== "")) {
      lines.push({ ...first, tokens: rest, text: "", raw: "" } as Token)
    }
    lines.push(...item.tokens.slice(1))
    rows.push({
      number: String(list.ordered ? start + index : index + 1),
      headline: inline(lead.tokens ?? []).replace(/[.:]$/, ""),
      body: html(lines),
      whole: html(item.tokens),
      anchors: [],
      earlier: [],
    })
  }
  return rows
}

/** A two-column table headed "Question" as rows of question and answer; null for any other table. */
export function qaRows(table: Tokens.Table, inline: Html): QaRow[] | null {
  if (table.header.length !== 2 || !/^question$/i.test(table.header[0]?.text.trim() ?? "")) {
    return null
  }
  return table.rows.map(([q, a]) => ({
    q: inline(q?.tokens ?? []),
    a: inline(a?.tokens ?? []),
  }))
}

/**
 * The blocks without the sections whose headings (lower case) are named: a section the page shows
 * in its own place (an item with its diagram, a list in a box) is not drawn twice. A section runs
 * from its `## ` heading to the next one.
 */
export function withoutSections(blocks: Block[], hide: readonly string[]): Block[] {
  const out: Block[] = []
  let skipping = false
  for (const block of blocks) {
    if (block.kind === "html" && block.heading !== undefined && (block.level ?? 6) <= 2) {
      skipping = hide.includes(block.heading.trim().toLowerCase())
    }
    if (!skipping) out.push(block)
  }
  return out
}
