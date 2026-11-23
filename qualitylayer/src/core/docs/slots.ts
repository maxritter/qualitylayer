// The template's placeholder for a section that was optional: `<!-- optional section here, only
// when there is content: "First release" -->`. An agent that writes the section often leaves the
// comment behind; it is flagged, and `plan draft` removes exactly that comment. So it does with a
// `<!-- fill: … -->` line left in a section that already holds what it asked for: a refusal for it
// only cost the agent a round trip. A section that
// holds nothing else keeps its comment, and a fill comment inside a heading stays: both still fail.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"

/**
 * The exact comment a template puts where an optional section may go: `<!-- optional section here,
 * only when there is content: "First release" -->`, or, for a section whose schema says when to
 * write it, `<!-- optional section "Today and after the change": write it whenever … -->`.
 */
export const OPTIONAL_SLOT_LINE =
  /^<!-- optional section (?:here, only when there is content: "(.+)"|"([^"]+)": write it .+) -->$/

/** The template's comment for an optional section; `when` is the schema's phrase for writing it. */
export const slotLine = (heading: string, when?: string): string =>
  when === undefined
    ? `<!-- optional section here, only when there is content: "${heading}" -->`
    : `<!-- optional section "${heading}": write it ${when} -->`

/** The heading an optional-section comment stands for; undefined for any other line. */
export function slotHeading(line: string): string | undefined {
  const found = OPTIONAL_SLOT_LINE.exec(line)
  return found?.[1] ?? found?.[2]
}

/** A line that is nothing but one template fill comment: the match never crosses its own `-->`. */
const FILL_LINE = /^\s*<!-- fill:(?:(?!-->).)*-->\s*$/

/** A fence line's marker (three or more backticks or tildes), or null for any other line. */
const fenceOf = (line: string): string | null => /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null

export type LeftoverSlot = { line: number; text: string; heading: string }

function closesFence(open: string, marker: string | null, line: string): boolean {
  return (
    marker !== null &&
    marker[0] === open[0] &&
    marker.length >= open.length &&
    line.trim() === marker
  )
}

type SectionSlotState = { heading: string; fills: LeftoverSlot[]; written: boolean }

function recordProseLine(
  line: string,
  lineNo: number,
  section: SectionSlotState,
  optional: LeftoverSlot[],
): void {
  const slot = slotHeading(line)
  if (slot !== undefined) optional.push({ line: lineNo, text: line, heading: slot })
  else if (FILL_LINE.test(line))
    section.fills.push({ line: lineNo, text: line, heading: section.heading })
  else if (line.trim() !== "" && !line.trim().startsWith("<!--")) section.written = true
}

/**
 * Placeholder comments whose `## heading` exists in the document, and fill comments standing alone
 * in a section that holds written content (outside code fences).
 */
export function leftoverSlots(markdown: string): LeftoverSlot[] {
  const lines = markdown.split(/\r?\n/)
  const headings = new Set<string>()
  const optional: LeftoverSlot[] = []
  const fills: LeftoverSlot[] = []
  // The fill comments of the section being read, and whether it holds anything else.
  let section: SectionSlotState = { heading: "", fills: [], written: false }
  const closeSection = () => {
    if (section.written) fills.push(...section.fills)
  }
  // The open fence's marker: it closes only with the same character, at least as many times, and
  // nothing after it, so a shorter fence quoted inside it is its content.
  let open: string | null = null
  lines.forEach((raw, index) => {
    const line = raw.trimEnd()
    const marker = fenceOf(line)
    if (open !== null) {
      if (closesFence(open, marker, line)) open = null
      section.written = true
      return
    }
    if (marker !== null) {
      open = marker
      section.written = true
      return
    }
    const top = /^#{1,2} (.+)$/.exec(line)?.[1]
    if (top !== undefined) {
      closeSection()
      section = { heading: top.trim(), fills: [], written: false }
      if (line.startsWith("## ")) headings.add(top.trim())
      return
    }
    recordProseLine(line, index + 1, section, optional)
  })
  closeSection()
  // An optional section's placeholder is left over once its heading exists anywhere in the document.
  return [...optional.filter((slot) => headings.has(slot.heading)), ...fills].sort(
    (a, b) => a.line - b.line,
  )
}

/** The document without its leftover placeholder comments, and the comments removed. */
export function removeLeftoverSlots(markdown: string): { markdown: string; removed: string[] } {
  const leftovers = leftoverSlots(markdown)
  if (leftovers.length === 0) return { markdown, removed: [] }
  const drop = new Set(leftovers.map((slot) => slot.line - 1))
  const lines = markdown.split("\n")
  const kept: string[] = []
  lines.forEach((line, index) => {
    if (!drop.has(index)) {
      kept.push(line)
      return
    }
    // Leave one blank line, not two, where the comment stood between blank lines.
    if (kept.at(-1)?.trim() === "" && (lines[index + 1] ?? "").trim() === "") drop.add(index + 1)
  })
  return { markdown: kept.join("\n"), removed: leftovers.map((slot) => slot.text) }
}

/** Remove the leftover placeholder comments from a document on disk; the comments removed. */
export async function tidyLeftoverSlots(
  ctx: Pick<Ctx, "fs">,
  taskDir: string,
  docName: string,
): Promise<string[]> {
  const path = join(taskDir, docName)
  if (!(await ctx.fs.exists(path))) return []
  const { markdown, removed } = removeLeftoverSlots(await ctx.fs.readFile(path))
  if (removed.length > 0) await ctx.fs.writeFile(path, markdown)
  return removed
}
