// The rules of a task with one document per step: the markers QualityLayer writes are well formed,
// present, and hold QualityLayer's text; the Plan names its
// artifact and marks each decision for the person's call.

import type { ValidationError } from "../../../ctx.ts"
import { ownText, readPagesRecord } from "../../pages/record.ts"
import { type Marker, markerKey, parseMarkers } from "../markers.ts"
import { proseLines, type Rule, sectionRanges, verr } from "./types.ts"

type SectionRange = ReturnType<typeof sectionRanges>[number]

export { fenceStyleSafe, planArtifact, wireframeFragment, wireframeHeader } from "./page-fences.ts"

/** Where a marker a template places stands: the heading it goes under. */
const MARKER_HOME: Record<string, string> = {
  "decided-by-you": "Decided with you",
  reviews: "Reviews",
  summary: "Summary",
  slices: "Slices",
  decisions: "Decided while building",
  limits: "Known limits",
  stages: "Checks",
  "fix-round": "For the fix round",
  proof: "Done means, checked",
  findings: "Findings",
  checks: "Commands",
  "fix-rounds": "Fix rounds",
  code: "Code",
  acceptance: "Done means",
  ship: "Ship",
}

const MARKER_ARGS_OF: Record<string, string> = { slices: " live" }

/** The document holds the marker. */
const holds = (markers: readonly Marker[], name: string) => markers.some((m) => m.name === name)

const pair = (name: string) =>
  `\`<!-- ql:${name}${MARKER_ARGS_OF[name] ?? ""} -->\` and \`<!-- /ql:${name} -->\``

function checkRequiredMarkers(
  docName: string,
  required: readonly string[],
  markers: readonly Marker[],
  errors: ValidationError[],
): void {
  for (const name of required) {
    if (holds(markers, name)) continue
    const home = MARKER_HOME[name]
    errors.push(
      verr(
        1,
        "marker-missing",
        `${docName} has no \`ql:${name}\` marker`,
        `add the two lines ${pair(name)}${home !== undefined ? ` under "## ${home}"` : ""}, with nothing between them: QualityLayer writes the text`,
      ),
    )
  }
}

function checkDuplicateMarkers(markers: readonly Marker[], errors: ValidationError[]): void {
  const seen = new Map<string, number>()
  for (const marker of markers) {
    const key = markerKey(marker)
    const before = seen.get(key)
    if (before !== undefined) {
      errors.push(
        verr(
          marker.line,
          "marker-twice",
          `\`ql:${key}\` stands twice, on line ${before} and line ${marker.line}`,
          "keep one of them; a decision of its own takes the next id: d1, d2 …",
        ),
      )
    } else {
      seen.set(key, marker.line)
    }
  }
}

const edited = (marker: Marker) =>
  verr(
    marker.line,
    "marker-edited",
    `the text inside \`ql:${markerKey(marker)}\` (lines ${marker.line}–${marker.endLine}) is not what QualityLayer wrote there`,
    `QualityLayer writes the text between \`<!-- ql:${markerKey(marker)} -->\` and \`<!-- /ql:${marker.name} -->\`, from its records and the person's answers. Move your words above or below the markers, then delete everything between them: QualityLayer writes it again`,
  )

/**
 * The markers of a document: written as the grammar says, each one the schema asks for present, no
 * key twice, and each one's text what QualityLayer last wrote there (or empty, for it to fill).
 */
export const markersOwned: Rule = async (input) => {
  const { markers, problems } = parseMarkers(input.markdown)
  const errors = problems.map((p) => verr(p.line, "marker-malformed", p.message, p.fix))
  checkRequiredMarkers(input.docName, input.schema.markers ?? [], markers, errors)
  checkDuplicateMarkers(markers, errors)
  if (input.runtimeDir === null) return errors
  const record = (await readPagesRecord(input.ctx, input.runtimeDir))[input.docName]
  for (const marker of markers) {
    if (!ownText(record, markerKey(marker), marker.fallback)) errors.push(edited(marker))
  }
  return errors
}

/**
 * Where a helper's block belongs in a task's Verify document, by the heading it opens with: the
 * security review under *Security*, a judge's round under *Verification*.
 */
const BLOCK_HOME: readonly [RegExp, string][] = [
  [/^(?:Security|Security re-check)$/i, "Security"],
  [/^Iteration \d+(?:\s*[·-]\s*share \d+)?$/i, "Verification"],
  [/^Review fix [0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12} · re-check [1-9]\d*$/i, "Verification"],
]

function checkOwnedHeading(
  title: string,
  line: number,
  ranges: readonly SectionRange[],
  errors: ValidationError[],
): void {
  const home = BLOCK_HOME.find(([pattern]) => pattern.test(title))?.[1]
  const under = ranges.find((r) => line > r.start && line < r.end)?.heading
  if (home === undefined) {
    if (under === "Security" || under === "Verification") {
      errors.push(
        verr(
          line,
          "section-owned",
          `the block "### ${title}" is not a ${under} record`,
          under === "Security"
            ? "keep only Security and Security re-check blocks here; put receipts in records/ and link them"
            : "keep only Iteration N and Review fix <UUID> · re-check R blocks here; put other receipts in records/ and link them",
        ),
      )
    }
    return
  }
  if (under === home) return
  errors.push(
    verr(
      line,
      "section-owned",
      `the block "### ${title}" stands ${under !== undefined ? `under "## ${under}"` : "above every section"}, but it belongs under "## ${home}"`,
      `move the whole block under "## ${home}"; each section holds only what its writer records there`,
    ),
  )
}

/**
 * Who may write which section of a task's document: the text between QualityLayer's markers is
 * QualityLayer's (as `markers-owned`), and a block a helper or the build appends stands under the
 * heading that is its own, never under another's.
 */
export const sectionOwned: Rule = async (input) => {
  const errors = await markersOwned(input)
  const ranges = sectionRanges(input.markdown)
  for (const { text, line } of proseLines(input.markdown)) {
    const title = text.match(/^### (.+)$/)?.[1]?.trim()
    if (title !== undefined) checkOwnedHeading(title, line, ranges, errors)
  }
  return errors
}
