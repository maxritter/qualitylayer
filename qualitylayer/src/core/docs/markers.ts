// The marked sections of a step document: `<!-- ql:NAME [args] -->` … `<!-- /ql:NAME -->`, each
// marker alone on its line, outside code fences. QualityLayer owns the text between the two and
// keeps it current as a plain Markdown fallback; GitHub hides the comments and shows the fallback.

import { ARTIFACT_REFERENCE } from "../artifact/reference.ts"
import { extractFences } from "./fence-scanner.ts"

/** One marked section as written. */
export type Marker = {
  name: string
  args: string[]
  /** The text between the two markers, without the blank lines around it. */
  fallback: string
  /** The 1-based line of the opening marker, and of the closing one. */
  line: number
  endLine: number
  /** The `## ` heading the marker sits under, or null above the first. */
  section: string | null
}

export type MarkerProblem = { line: number; message: string; fix: string }

/** Each marker QualityLayer fills, with the arguments it takes. */
export const MARKER_ARGS: Record<string, RegExp> = {
  // The Plan: Decided with you, Reviews, the artifacts under Interface and each Engineering
  // decision's call; its agents' file: the evidence behind each answered choice.
  "decided-by-you": /^$/,
  reviews: /^$/,
  artifact: ARTIFACT_REFERENCE,
  decide: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
  evidence: /^$/,
  approve: /^plan$/,
  // Implement's people's file: the summary, the slices, the decisions and the Known limits
  // (`qualitylayer limit add`).
  summary: /^$/,
  slices: /^(live)?$/,
  decisions: /^$/,
  limits: /^$/,
  // Verify's people's file: the Code line, Done means as it ran, the stage lines, Changed from the
  // Plan and Ship; its agents' file: the fix round, the proof, the findings, the commands and the
  // fix rounds.
  code: /^$/,
  acceptance: /^$/,
  stages: /^$/,
  risk: /^$/,
  ship: /^$/,
  "fix-round": /^$/,
  proof: /^$/,
  findings: /^$/,
  checks: /^$/,
  "fix-rounds": /^$/,
}

const markerName = (written: string | undefined): string => written ?? ""

function openingMarker(raw: string): string[] | null {
  let end = raw.length
  while (raw[end - 1] === " " || raw[end - 1] === "\t") end--
  if (raw.slice(end - 3, end) !== "-->") return null
  end -= 3
  while (raw[end - 1] === " " || raw[end - 1] === "\t") end--
  const content = raw.slice(0, end)
  const prefix = /^[ \t]*<!--[ \t]*ql:([a-z][a-z-]*)/.exec(content)
  if (prefix === null) return null
  const args = content.slice(prefix[0].length)
  if (args !== "" && (!/^[ \t]+[^\s>]/.test(args) || args.includes(">"))) return null
  return [raw, prefix[1] ?? "", args]
}
const CLOSE = /^[ \t]*<!--[ \t]*\/ql:([a-z][a-z-]*)[ \t]*-->[ \t]*$/
/** Visit prose lines only; a shorter or different fence inside an example stays literal. */
function outsideFences(lines: string[], visit: (raw: string, index: number) => void): void {
  const fences = extractFences(lines.join("\n"))
  lines.forEach((raw, index) => {
    if (fences.some((f) => index + 1 >= f.line && index + 1 <= f.endLine)) return
    visit(raw, index)
  })
}

/** Hide control comments in prose, keeping fallback text, literal code and line positions. */
export function withoutMarkerComments(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  outsideFences(lines, (raw, index) => {
    if (/^[ \t]*<!--[ \t]*\/?ql:[^>]*-->[ \t]*$/i.test(raw)) lines[index] = ""
  })
  return lines.join("\n")
}

/** The marker's name and arguments, as one key: `decide d1`, `slices live`. */
export const markerKey = (marker: Pick<Marker, "name" | "args">): string =>
  [marker.name, ...marker.args].join(" ")

const trimBlank = (lines: string[]): string[] => {
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] ?? "").trim() === "") start++
  while (end > start && (lines[end - 1] ?? "").trim() === "") end--
  return lines.slice(start, end)
}

type OpenMarker = { name: string; args: string[]; line: number; section: string | null }

function validateMarkerOpen(
  name: string,
  args: string[],
  lineNo: number,
  problems: MarkerProblem[],
): void {
  const allowed = MARKER_ARGS[name]
  if (allowed === undefined) {
    problems.push({
      line: lineNo,
      message: `\`ql:${name}\` is not a marker QualityLayer fills`,
      fix: `use one of ${Object.keys(MARKER_ARGS)
        .map((n) => `ql:${n}`)
        .join(", ")}, or remove the comment`,
    })
  } else if (!allowed.test(args.join(" "))) {
    problems.push({
      line: lineNo,
      message: `\`ql:${name}\` does not take \`${args.join(" ") || "(nothing)"}\``,
      fix: MARKER_HINT[name] ?? `write it as \`<!-- ql:${name} -->\``,
    })
  }
}

type MarkerParseOut = { lines: string[]; markers: Marker[]; problems: MarkerProblem[] }

function handleMarkerClose(
  name: string,
  open: OpenMarker | null,
  index: number,
  out: MarkerParseOut,
): OpenMarker | null {
  const lineNo = index + 1
  if (open === null || open.name !== name) {
    out.problems.push({
      line: lineNo,
      message: `\`/ql:${name}\` closes no open \`ql:${name}\``,
      fix:
        open === null
          ? `add \`<!-- ql:${name} -->\` above it, or remove it`
          : `close \`ql:${open.name}\` here instead`,
    })
    return open
  }
  out.markers.push({
    name,
    args: open.args,
    fallback: trimBlank(out.lines.slice(open.line, index)).join("\n"),
    line: open.line,
    endLine: lineNo,
    section: open.section,
  })
  return null
}

/** Every marked section of a document, in order, and what is wrong with the markers as written. */
export function parseMarkers(markdown: string): { markers: Marker[]; problems: MarkerProblem[] } {
  const lines = markdown.split(/\r?\n/)
  const markers: Marker[] = []
  const problems: MarkerProblem[] = []
  let section: string | null = null
  let open: OpenMarker | null = null
  outsideFences(lines, (raw, index) => {
    const lineNo = index + 1
    const heading = raw.match(/^## (.+)$/)
    if (heading?.[1] !== undefined && open === null) section = heading[1].trim()
    const opened = openingMarker(raw)
    if (opened !== null) {
      const name = markerName(opened[1])
      const args = (opened[2] ?? "").trim().split(/\s+/).filter(Boolean)
      if (open !== null) {
        problems.push({
          line: lineNo,
          message: `\`ql:${name}\` opens inside \`ql:${open.name}\`, which line ${open.line} opened`,
          fix: `close \`ql:${open.name}\` with \`<!-- /ql:${open.name} -->\` first`,
        })
        return
      }
      validateMarkerOpen(name, args, lineNo, problems)
      open = { name, args, line: lineNo, section }
      return
    }
    const closed = raw.match(CLOSE)
    if (closed !== null) {
      open = handleMarkerClose(markerName(closed[1]), open, index, { lines, markers, problems })
    }
  })
  if (open !== null) {
    const unclosed: { name: string; line: number } = open
    problems.push({
      line: unclosed.line,
      message: `\`ql:${unclosed.name}\` is never closed`,
      fix: `end the section with \`<!-- /ql:${unclosed.name} -->\` on its own line`,
    })
  }
  return { markers, problems }
}

const MARKER_HINT: Record<string, string> = {
  artifact:
    "use `<!-- ql:artifact <name> -->` for a task artifact, or a local artifact page such as `.qualitylayer/artifacts/<artifact>/<page>.html#<section-id>`",
  decide: "write it as `<!-- ql:decide <id> -->`, one id per decision: d1, d2 …",
  slices: "write it as `<!-- ql:slices -->`; QualityLayer writes `ql:slices live` itself",
  approve: "write it as `<!-- ql:approve plan -->`",
}

/**
 * The document with the text of each marked section replaced by what `fill` returns for it;
 * a section `fill` returns null for stays as written. A marker's text sits between its two
 * markers with no blank lines around it.
 */
export function fillMarkers(markdown: string, fill: (marker: Marker) => string | null): string {
  const { markers } = parseMarkers(markdown)
  if (markers.length === 0) return markdown
  const lines = markdown.split(/\r?\n/)
  const out: string[] = []
  let at = 0
  for (const marker of markers) {
    const text = fill(marker)
    if (text === null) continue
    out.push(...lines.slice(at, marker.line))
    const body = text.trimEnd()
    if (body !== "") out.push(...body.split("\n"))
    at = marker.endLine - 1
  }
  out.push(...lines.slice(at))
  return out.join("\n")
}

/** The document with every marked section's text taken out: what an approval of it binds. */
export const withoutMarkerText = (markdown: string): string => fillMarkers(markdown, () => "")

/**
 * A document cut at its markers, for a page that draws a live part over each marked section:
 * the Markdown between them as written, and each marker where it stands.
 */
export type DocBlock =
  | { kind: "text"; text: string; line: number }
  | { kind: "marker"; marker: number }

export function docBlocks(markdown: string): {
  markers: Marker[]
  blocks: DocBlock[]
  problems: MarkerProblem[]
} {
  const { markers, problems } = parseMarkers(markdown)
  const lines = markdown.split(/\r?\n/)
  const blocks: DocBlock[] = []
  let at = 0
  const text = (from: number, to: number) => {
    const chunk = lines.slice(from, to).join("\n")
    if (chunk.trim() !== "") blocks.push({ kind: "text", text: chunk, line: from + 1 })
  }
  markers.forEach((marker, index) => {
    text(at, marker.line - 1)
    blocks.push({ kind: "marker", marker: index })
    at = marker.endLine
  })
  text(at, lines.length)
  return { markers, blocks, problems }
}
