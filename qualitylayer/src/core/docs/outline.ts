// The grammar of the build's slices and cards, in Implement's agents' file (`agents/02-implement.md`):
// under `## Task cards`, one `### Slice N: <takeaway>` per slice with its task boxes (`- [ ] T1
// <title>`), its lines (Depends on, Commits with, Shared output, Release), its file tree and its
// Validation, then one `#### T1` card per box; `## Proof order` beside it. A Chat's slices file
// writes the same slices at `## Slice N:` with each card indented under its box (core/chat/slices.ts).
// Parsed once for the readers of the build's authority: validation, task progress (Implement ->
// Verify when every box is checked), the scaling rules (slices, what may run side by side), the
// baseline's authorised tasks and files, and the done-when audit in Verify.

import { extractFences, type Fence } from "./fence-scanner.ts"
import { cardFacts } from "./outline-cards.ts"
import { dependsParts } from "./outline-depends.ts"
import { handleProofLine } from "./outline-proof-order.ts"
import { fenceAt, parseTree, sliceFilesOf } from "./outline-tree.ts"
import {
  allTasks,
  type CardLine,
  emptyOutline,
  type Outline,
  type OutlineTask,
  type Slice,
} from "./outline-types.ts"

export {
  contractEntries,
  designNames,
  designPage,
  evidenceIn,
  extractPaths,
  isLineReference,
  isPathLike,
} from "./outline-paths.ts"
export { isGrantAtApproval, parsePrerequisites, prerequisiteSettled } from "./outline-prereqs.ts"
export {
  allTasks,
  codeSlices,
  emptyOutline,
  type Outline,
  type OutlineTask,
  type Prerequisite,
  type ProofOrderLine,
  progress,
  type Slice,
  type SliceColumn,
  type TestFirst,
  type TreeFile,
} from "./outline-types.ts"
export {
  buildWaves,
  commitGroup,
  committable,
  dependenciesOf,
  sliceColumns,
  waveWidth,
} from "./outline-waves.ts"
export { cardFacts, parseTree, sliceFilesOf }

/** A slice: `### Slice N:` under Task cards, or `## Slice N:` in a Chat's slices file. */
const SLICE = /^#{2,3} Slice (\d+): (.+)$/
const CARD = /^#### (T\d+)\b/
const TASK = /^- \[( |x|X)\] (T\d+)\b(.*)$/
const BOXISH = /^\s*[-*]\s*\[[^\]]*\]\s*T\d+/
/** The section of Implement's agents' file that holds the slices and cards. */
const CARDS = "Task cards"
const SHARED_OUTPUT = /^\*\*Shared output:\*\*\s*((?:\S.*)?)$/i
const DEPENDS = /^\*\*Depends on:\*\*\s*((?:\S.*)?)$/i
const COMMITS_WITH = /^\*\*Commits with:\*\*\s*((?:\S.*)?)$/i
const RELEASE = /^\*\*Release:\*\*\s*((?:\S.*)?)$/i

/** What a `## ` heading opens: a Chat's slice, the Task cards, the Proof order or another section. */
function sectionOf(heading: string): "slice" | "cards" | "proof" | "other" {
  if (SLICE.test(heading)) return "slice"
  const name = heading.replace(/^## /, "").trim()
  if (name === CARDS) return "cards"
  return name.toLowerCase() === "proof order" ? "proof" : "other"
}

/** A card under a slice: the lines under its `#### T1` heading. */
type CardBlock = { id: string; line: number; body: CardLine[] }

type OutlineParseState = {
  outline: Outline
  section: ReturnType<typeof sectionOf>
  slice: Slice | null
  task: OutlineTask | null
  card: CardBlock | null
  cards: CardBlock[]
  own: Map<Slice, CardLine[]>
}

function newSlice(n: number, title: string, line: number): Slice {
  return {
    n,
    title,
    summary: "",
    tree: [],
    tasks: [],
    validation: "",
    sharedOutput: null,
    release: false,
    dependsOn: null,
    dependsRaw: null,
    dependsReason: null,
    line,
  }
}

function openSlice(state: OutlineParseState, match: RegExpMatchArray, lineNo: number): void {
  state.slice = newSlice(Number(match[1]), (match[2] ?? "").trim(), lineNo)
  state.outline.slices.push(state.slice)
  state.own.set(state.slice, [])
}

function handleCardHeading(state: OutlineParseState, line: string, lineNo: number): void {
  state.task = null
  state.card = null
  const id = line.match(CARD)?.[1]
  if (id !== undefined && state.slice !== null) {
    state.card = { id, line: lineNo, body: [] }
    state.cards.push(state.card)
    return
  }
  if (/^#### /.test(line)) return
  state.slice = null
  const match = line.match(SLICE)
  if (match !== null) openSlice(state, match, lineNo)
}

function handleSliceMeta(slice: Slice, line: string): boolean {
  const depends = line.match(DEPENDS)
  if (depends !== null) {
    slice.dependsRaw = (depends[1] ?? "").trim()
    const parsed = dependsParts(slice.dependsRaw)
    slice.dependsOn = parsed.slices
    slice.dependsReason = parsed.reason
    slice.dependsReasons = parsed.reasons
    if (parsed.error !== undefined) slice.dependsError = parsed.error
    return true
  }
  const commitsWith = line.match(COMMITS_WITH)
  if (commitsWith !== null) {
    slice.commitsWith = [...(commitsWith[1] ?? "").matchAll(/\bslice\s+(\d+)\b/gi)].map((m) =>
      Number(m[1]),
    )
    return true
  }
  const release = line.match(RELEASE)
  if (release !== null) {
    slice.release = /^(yes|true)\b/i.test((release[1] ?? "").trim())
    return true
  }
  const shared = line.match(SHARED_OUTPUT)
  if (shared !== null) {
    const output = (shared[1] ?? "").replace(/`/g, "").trim()
    slice.sharedOutput = output === "" || /^none\b/i.test(output) ? null : output
    return true
  }
  return false
}

function handleSliceLine(state: OutlineParseState, line: string, lineNo: number): void {
  const slice = state.slice
  if (slice === null) return
  const taskMatch = line.match(TASK)
  if (taskMatch !== null) {
    state.task = {
      id: taskMatch[2] ?? "",
      title: (taskMatch[3] ?? "").replace(/^[ :.-]+/, "").trim(),
      checked: (taskMatch[1] ?? " ").toLowerCase() === "x",
      objective: "",
      files: [],
      filesRaw: "",
      testFirst: null,
      dod: [],
      design: [],
      labels: [],
      text: line,
      line: lineNo,
    }
    slice.tasks.push(state.task)
    return
  }
  if (BOXISH.test(line)) {
    state.outline.malformed.push({ line: lineNo, text: line.trim() })
    state.task = null
    return
  }
  // A headline wraps onto indented lines; an indented bullet is not part of it.
  if (state.task !== null && /^\s+\S/.test(line) && !/^\s*[-*] /.test(line)) {
    state.task.title = `${state.task.title} ${line.trim()}`.trim()
    state.task.text = `${state.task.text}\n${line}`
    return
  }
  state.task = null
  if (handleSliceMeta(slice, line)) return
  // The sentences that open the slice, before its first task.
  if (slice.tasks.length === 0 && line !== "" && !/^(\*\*|[-*|>]|\s)/.test(line))
    slice.summary = `${slice.summary} ${line.trim()}`.trim()
}

function processOutlineLine(
  state: OutlineParseState,
  line: string,
  lineNo: number,
  fenced: boolean,
): void {
  if (!fenced && state.section === "cards" && /^#{3,4} /.test(line)) {
    handleCardHeading(state, line, lineNo)
    return
  }
  if (state.card !== null && (fenced || !/^## /.test(line))) {
    state.card.body.push({ text: line, line: lineNo })
    return
  }
  if (state.slice !== null && (fenced || !/^## /.test(line)))
    state.own.get(state.slice)?.push({ text: line, line: lineNo })
  if (fenced) return

  if (/^## /.test(line)) {
    state.section = sectionOf(line)
    state.task = null
    state.card = null
    state.slice = null
    const match = line.match(SLICE)
    if (state.section === "slice" && match !== null) openSlice(state, match, lineNo)
    return
  }
  if (state.slice !== null) handleSliceLine(state, line, lineNo)
  else if (state.section === "proof") handleProofLine(state.outline, line, lineNo)
}

function finalizeOutline(state: OutlineParseState, fences: Fence[]): void {
  // A slice's own lines give its file tree and Validation; each card joins the box of its id.
  for (const [each, body] of state.own) Object.assign(each, sliceFilesOf(body, fences))
  const tasks = allTasks(state.outline)
  for (const block of state.cards) {
    while (block.body.length > 0 && (block.body[block.body.length - 1]?.text ?? "").trim() === "")
      block.body.pop()
    const box = tasks.find((t) => t.id === block.id)
    if (box === undefined) {
      state.outline.malformed.push({ line: block.line, text: `#### ${block.id}`, kind: "card" })
      continue
    }
    Object.assign(box, cardFacts(block.body))
    box.text = [box.text, ...block.body.map((b) => b.text)].join("\n")
  }
}

/**
 * The slices and cards of one file, with its Proof order. A slice's own lines (outside its cards)
 * give its takeaway, its lines, its boxes, its file tree and its Validation; each `#### T1` card is
 * joined to the box of its id. Tolerates CRLF and reports malformed boxes and cards without a box
 * instead of silently dropping them.
 */
export function parseOutline(markdown: string): Outline {
  const lines = markdown.split(/\r?\n/)
  const fences = extractFences(markdown)
  const state: OutlineParseState = {
    outline: emptyOutline(),
    section: "other",
    slice: null,
    task: null,
    card: null,
    cards: [],
    own: new Map(),
  }
  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1
    processOutlineLine(
      state,
      (lines[index] ?? "").trimEnd(),
      lineNo,
      fenceAt(fences, lineNo) !== undefined,
    )
  }
  finalizeOutline(state, fences)
  return state.outline
}
