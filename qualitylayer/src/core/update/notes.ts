// GitHub release bodies, shared by the App, update sheet and terminal.
import { replaceInlineLinks } from "../docs/inline-links.ts"
import { recordLineTail } from "../docs/record-lines.ts"
import { proseLines } from "../docs/rules/types.ts"

/** The GitHub repository that publishes the releases; the downloader and the App's release links share it. */
export const RELEASE_REPO = "maxritter/qualitylayer"

export type NoteGroup = { title: string; items: string[] }

function headingTitle(line: string): string | null {
  const prefix = /^#{2,6}\s/.exec(line)
  if (prefix === null) return null
  const rest = line.slice(prefix[0].length)
  if (rest === "") return null
  const title = rest.trim()
  // Internal line terminators cannot belong to a title; surrounding Unicode whitespace can.
  if (/[\r\n\u2028\u2029]/.test(title)) return null
  // An all-whitespace heading keeps its last whitespace character as its title.
  return title || rest.slice(-1)
}

/** The groups of one section's Markdown; each item is its Markdown text, continuation lines joined. */
export function parseNotes(markdown: string): NoteGroup[] {
  const groups: NoteGroup[] = []
  let group: NoteGroup | null = null
  for (const { text: line } of proseLines(markdown.replace(/<!--[\s\S]*?-->/g, ""))) {
    const heading = headingTitle(line)
    if (heading !== null) {
      group = { title: heading, items: [] }
      groups.push(group)
      continue
    }
    if (line.trim() === "") continue
    const bullet = /^\s*[-*]/.exec(line)
    const item = bullet === null ? null : recordLineTail(line, bullet[0].length, 1, true)
    group ??= (() => {
      const first: NoteGroup = { title: "", items: [] }
      groups.push(first)
      return first
    })()
    if (item !== null) group.items.push(item)
    else if (/^\s+\S/.test(line) && group.items.length > 0)
      group.items[group.items.length - 1] += ` ${line.trim()}`
    else group.items.push(line.trim())
  }
  return groups.filter((g) => g.items.length > 0)
}

/** One item of Markdown as plain text: no emphasis marks, no code ticks, a link is its words. */
export function plainText(markdown: string): string {
  return replaceInlineLinks(markdown.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"), (label) => label)
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

export type Release = {
  /** The release tag without its v: `12.0.0-beta.14`, `11.0.1`. */
  version: string
  /** The version label; Pilot Shell versions say so. */
  label: string
  notes: string
  /** When GitHub published it (ISO, UTC); absent when the site did not say. */
  published?: string
}
