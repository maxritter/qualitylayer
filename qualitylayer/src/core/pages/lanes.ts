// Verify's lanes and the four stages they fall into. The people's file (03-verify.md, *Checks*) lists
// one numbered line per stage (`stagesText`); the lanes themselves (who runs each, its state, its
// result and why it runs here) are the records the stages are drawn from, read by the App's lanes
// view as `lanesText`/`parseLanes` text. Plain Markdown: GitHub and an editor read it as it is.
// Free of imports from the server, so the App's browser bundle reads it as it is.

import { VERIFY_LANES, type VerifyLaneId } from "../flow.ts"
import type { ScreenPair } from "../review/screens.ts"
import {
  isLineText,
  lastLineBreak,
  skipWhitespace,
  trimEdgeCharacters,
  trimEndCharacters,
  trimEndWhile,
} from "../text-boundaries.ts"

/** What the independent review's screen comparison adds to its result: the problems when there are some, else the count. */
export function screenFacts(pairs: readonly Pick<ScreenPair, "outcome" | "stale">[]): string[] {
  if (!pairs.length) return []
  const stale = pairs.filter((pair) => pair.stale).length
  const captured = pairs.filter((pair) => !pair.stale && pair.outcome === "captured").length
  const missing = pairs.length - stale - captured
  const count = (n: number, what: string) => `${n} ${n === 1 ? "screen" : "screens"} ${what}`
  return stale + missing === 0
    ? [count(pairs.length, "compared")]
    : [
        ...(stale > 0 ? [count(stale, "stale")] : []),
        ...(missing > 0 ? [count(missing, "not captured")] : []),
      ]
}

/** Where a lane stands: waiting for its turn, running, done, failed, left to you, or not run here. */
export type LaneState = "waiting" | "running" | "done" | "fail" | "you" | "skipped"

export type LaneRow = {
  id: VerifyLaneId
  /** Who runs it: "a fresh agent · Sonnet 5.5", "QualityLayer itself · no agent". */
  who: string
  state: LaneState
  /** What it found or did, in a few words; empty while it has not run. */
  result: string
  /** The completed result is kept, but its required screen evidence is no longer current. */
  needsRefresh?: true
  /** Why it runs (or does not run) on this change; empty for a lane that always runs. */
  why?: string
}

/**
 * The four stages Verify is planned in from the start: the project checks, the security scans and
 * (with a trust boundary) the Security review together; the Independent review with the Second
 * opinion beside it; the fix round; and the recheck, which no lane owns.
 */
export const LANE_STAGES: readonly { name: string; lanes: readonly VerifyLaneId[] }[] = [
  { name: "Checks and security", lanes: ["checks", "scans", "security"] },
  { name: "Independent review", lanes: ["judge", "second"] },
  { name: "Fix round", lanes: ["fix"] },
  { name: "Recheck", lanes: [] },
]

/**
 * The grammar of a lane's `Result:` line (rule `lane-grammar`): a state word, then at most three
 * facts joined by ` · `, under 90 characters. `Why it runs here:` is one sentence in product words.
 * The reviewer's full text stays in its block under *Security* in the agents' file.
 */
export const LANE_STATE_WORDS: readonly string[] = [
  "done",
  "running",
  "waiting",
  "failed",
  "skipped",
  "not run",
  "needs you",
]

/**
 * A result without its state words. A row already shows the state by its mark, so a page that draws a
 * lane's result keeps the counted facts: `done · 11 of 12 points pass · 1 yours` reads `11 of 12 points
 * pass · 1 yours`. A result that is only a state word is returned as written.
 */
export function withoutStateWord(result: string): string {
  const parts = result.split("·").map((part) => part.trim())
  const facts = parts.filter(
    (part) => part !== "" && !LANE_STATE_WORDS.includes(part.toLowerCase()),
  )
  return facts.length > 0 ? facts.join(" · ") : result.trim()
}
export const LANE_RESULT_MAX = 90
export const LANE_FACTS_MAX = 3
/** What a lane without a result yet says; `parseLanes` reads it back as none. */
export const LANE_NO_RESULT = "not yet"

const STATE_WORD: Record<LaneState, string> = {
  waiting: "waiting",
  running: "running",
  done: "done",
  fail: "failed",
  you: "needs you",
  skipped: "skipped",
}

/** A lane's result in the grammar: its state word and up to three facts, shortened to fit. */
export function laneResult(state: LaneState | "not run", facts: readonly string[]): string {
  const word = state === "not run" ? state : STATE_WORD[state]
  const kept = facts.map((fact) => fact.trim()).filter((fact) => fact !== "")
  kept.length = Math.min(kept.length, LANE_FACTS_MAX)
  let text = [word, ...kept].join(" · ")
  while (text.length >= LANE_RESULT_MAX && kept.length > 0) {
    kept.pop()
    text = [word, ...kept].join(" · ")
  }
  return text
}

/**
 * The counted facts of a helper's free-text result (`done · 2 simplifications (a1b2c3d) · 5 tests
 * added · docs: README.md`): the parts that open with a number or say there was nothing, without
 * their parentheses. The helper's own words stay in its block.
 */
export function countedFacts(result: string): string[] {
  return result
    .split(" · ")
    .map((part) => withoutParentheticals(part).trim())
    .filter((part) => /^(?:\d|no\b|nothing\b|none\b)/i.test(part))
}

function withoutParentheticals(text: string): string {
  const parts: string[] = []
  let at = 0
  for (let open = text.indexOf("("); open >= 0; open = text.indexOf("(", at)) {
    const close = text.indexOf(")", open + 1)
    if (close < 0) break
    parts.push(text.slice(at, open).trimEnd())
    at = close + 1
  }
  parts.push(text.slice(at))
  return parts.join("")
}

/**
 * The grammar of a `ql:summary` (Implement and Verify): the first line is the counts joined by ` · `,
 * the second the state in one sentence, a blank line between them so Markdown shows two lines. A summary with no counts is the sentence alone. The page
 * draws the counts as its fact row and the sentence as the gist.
 */
export function summaryText(counts: readonly string[], state: string): string {
  const kept = counts.map((count) => count.trim()).filter((count) => count !== "")
  return kept.length > 0 ? `${kept.join(" · ")}\n\n${state}` : state
}

/**
 * One stage of Verify as the people's file lists it under *Checks*: `1. Checks and security · …`,
 * its state and a few words of result. The fourth, the recheck, belongs to no lane: it is the
 * independent review run again after a fix round.
 */
export type StageRow = { n: number; name: string; state: LaneState; result: string }

/** The stages of `LANE_STAGES`, numbered, from the lanes and the recheck's own state. */
export function stageRows(
  lanes: readonly LaneRow[],
  recheck: { state: LaneState; result: string },
): StageRow[] {
  return LANE_STAGES.map((stage, index): StageRow => {
    const n = index + 1
    if (stage.lanes.length === 0) return { n, name: stage.name, ...recheck }
    const own = lanes.filter((lane) => stage.lanes.includes(lane.id))
    const ran = own.filter((lane) => lane.state !== "skipped")
    const state: LaneState = own.some((lane) => lane.state === "fail")
      ? "fail"
      : own.some((lane) => lane.state === "running")
        ? "running"
        : ran.length === 0 && own.length > 0
          ? "skipped"
          : ran.length > 0 && ran.every((lane) => lane.state === "done")
            ? "done"
            : "waiting"
    const facts = ran.flatMap((lane) =>
      lane.result === "" ? [] : [withoutStateWord(lane.result)].filter((fact) => fact !== ""),
    )
    return { n, name: stage.name, state, result: facts.join(", ") }
  })
}

/** The words after a stage's name: its state when it is not done, then its facts. */
function stageDetail(row: StageRow): string {
  const word = row.state === "done" ? "" : STATE_WORD[row.state]
  return [word, row.result].filter((part) => part !== "").join(" · ") || "done"
}

/** The grammar of a `ql:stages` text: one numbered line per stage, `1. Name · result`. */
export const stagesText = (rows: readonly StageRow[]): string =>
  rows.map((row) => `${row.n}. ${row.name} · ${stageDetail(row)}`).join("\n")

/** The stage lines a *Checks* text holds, in the order written; none for text that holds none. */
export function parseStages(markdown: string): { n: number; name: string; detail: string }[] {
  return markdown.split(/\r?\n/).flatMap((line) => {
    const text = line.trim()
    const prefix = /^(\d+)\.\s+/.exec(text)
    if (prefix === null) return []
    const start = prefix[0].length
    let whitespaceDetailAt: number | null = null
    let firstBreak = -1
    let lastBreak = -1
    for (let at = start; at < text.length; at++) {
      if (!/[\r\n\u2028\u2029]/.test(text[at] ?? "")) continue
      if (firstBreak < 0) firstBreak = at
      lastBreak = at
    }
    for (const separator of text.matchAll(/(?<=\s)·\s+/g)) {
      const at = separator.index
      const detailAt = at + separator[0].length
      if (lastBreak >= detailAt) continue
      let end = at
      while (end > start && /\s/.test(text[end - 1] ?? "")) end--
      if (firstBreak >= 0 && firstBreak < end) continue
      if (end <= start) {
        // A whitespace-only name still needed a character between the two separators.
        const numberEnd = (prefix[1] ?? "").length + 1
        if (!/[^\S\r\n\u2028\u2029]/.test(text.slice(numberEnd + 1, at - 1))) continue
        whitespaceDetailAt = detailAt
        continue
      }
      return [
        {
          n: Number(prefix[1]),
          name: text.slice(start, end).trim(),
          detail: text.slice(detailAt).trim(),
        },
      ]
    }
    // Prefer a name after the full leading gap before borrowing a character from that gap.
    return whitespaceDetailAt === null
      ? []
      : [{ n: Number(prefix[1]), name: "", detail: text.slice(whitespaceDetailAt).trim() }]
  })
}

/** How long a Plan line's words may run inside a lane's one-sentence reason. */
const REASON_MAX = 140

const FILE_EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|css|html|yml|yaml|toml|sh|py|rs|go|sql|lock|txt"
const FILE_NAME = new RegExp(`^[\\w@-][\\w@.-]*\\.(?:${FILE_EXTENSIONS})$`, "i")
const TOKEN_START = "(\"'["
const TOKEN_END = ")\"'],;:.!?"
const REASON_EDGE = " ,;:—–-"

function isReasonPath(token: string): boolean {
  // Two alphabetic words such as `and/or` are prose.
  if (token.includes("/")) return !/^[A-Za-z]+\/[A-Za-z]+$/.test(token)
  return /^[\w@.-]+\.\w{1,5}:\d+/.test(token) || FILE_NAME.test(token)
}

function withoutEmptyAsides(text: string): string {
  return text.replace(/\(([^()]*)\)/g, (aside, contents: string) => {
    const rest = contents
      .trimStart()
      .replace(/^(?:see|in|at|from|via)/i, "")
      .trim()
    return rest === "" || /^[,;:]$/.test(rest) ? " " : aside
  })
}

/** Group punctuation and its closing quotes before looking for a following sentence. */
function joinReasonSentences(text: string): string {
  const parts: string[] = []
  let kept = 0
  for (let at = 0; at < text.length; ) {
    const stop = at
    if (!".!?".includes(text.charAt(at))) {
      at++
      continue
    }
    while (at < text.length && ".!?".includes(text.charAt(at))) at++
    while (at < text.length && "\"')]".includes(text.charAt(at))) at++
    const next = skipWhitespace(text, at)
    if (next > at && next < text.length) {
      parts.push(text.slice(kept, stop), ", ")
      kept = next
    }
    at = next
  }
  parts.push(text.slice(kept))
  return parts.join("")
}

function reasonSpacing(text: string): string {
  return text.replace(/\s+/g, (space, offset: number) =>
    /[,;:]/.test(text.charAt(offset + space.length)) ? "" : " ",
  )
}

/** The text without a bracket that has no partner. */
function withoutStrayBrackets(text: string): string {
  const open: number[] = []
  const stray = new Set<number>()
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") open.push(i)
    else if (text[i] === ")") {
      if (open.length > 0) open.pop()
      else stray.add(i)
    }
  }
  for (const i of open) stray.add(i)
  return reasonSpacing([...text].filter((_, i) => !stray.has(i)).join("")).trim()
}

/**
 * A Plan line's own words as part of a lane's `Why it runs here:` sentence (rule `lane-grammar`):
 * backticked code, paths, `file:line` references and routes are removed, sentences are joined with
 * commas so the reason stays one sentence, and what is left is collapsed. Empty when nothing plain
 * is left, so the caller falls back to generic words.
 */
export function plainReason(line: string | null | undefined): string {
  if (line === null || line === undefined) return ""
  const words: string[] = []
  for (const token of line.replace(/`[^`]*`/g, " ").split(/\s+/)) {
    let start = 0
    while (start < token.length && TOKEN_START.includes(token.charAt(start))) start++
    const bare = trimEndCharacters(token.slice(start), TOKEN_END)
    if (!isReasonPath(bare)) {
      words.push(token)
      continue
    }
    // The dropped token's closing punctuation (the end of a sentence, a bracket) stays.
    const tail = token.slice(trimEndCharacters(token, TOKEN_END).length)
    if (words.length > 0) words[words.length - 1] += tail
    // An HTTP verb that named the route goes with it.
    const previous = trimEndWhile(words.at(-1) ?? "", (character) => /\W/.test(character))
    if (/^(?:GET|PUT|POST|PATCH|DELETE)$/.test(previous)) words.pop()
  }
  let text = reasonSpacing(joinReasonSentences(withoutEmptyAsides(words.join(" "))))
  text = text.replace(/[,;:]+/g, (marks) => marks.charAt(0))
  text = trimEndCharacters(trimEdgeCharacters(text, REASON_EDGE), ".!?").trim()
  // What was left hanging by a removed path ("the config in") goes too.
  const hanging = /(?:^|[\s,;:])(?:in|on|at|of|to|by|via|from|with|through|and|or|the|a|an|see)$/i
  const leading = /^(?:and|or)\s+/i
  text = withoutStrayBrackets(text)
  for (let again = true; again; ) {
    const kept = text
      .replace(
        /\s+(?:in|on|at|of|to|by|via|from|with|through|and|or|the|an?|see)(?=\s*[,;:])/gi,
        "",
      )
      .replace(hanging, "")
      .replace(leading, "")
    const next = trimEndCharacters(kept, REASON_EDGE).trim()
    again = next !== text
    text = next
  }
  if (text === "") return ""
  // The Plan's sentence starts with a capital; mid-sentence it does not (unless it is an acronym).
  if (/^(?:[A-Z][a-z]|A\s)/.test(text)) text = text.charAt(0).toLowerCase() + text.slice(1)
  if (text.length > REASON_MAX) {
    const cut = text.slice(0, REASON_MAX)
    text = trimEndCharacters(cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)), REASON_EDGE)
  }
  return text
}

export const laneNameOf = (id: VerifyLaneId): string =>
  VERIFY_LANES.find((lane) => lane.id === id)?.name ?? id

const STATES: readonly LaneState[] = ["waiting", "running", "done", "fail", "you", "skipped"]

/** The lanes as the document writes them, in run order. Nothing for no lanes. */
export function lanesText(rows: readonly LaneRow[]): string {
  const byId = new Map(rows.map((row) => [row.id, row]))
  return VERIFY_LANES.flatMap((lane) => {
    const row = byId.get(lane.id)
    if (row === undefined) return []
    return [
      `- **${lane.name}** · ${row.who}`,
      `  - State: ${row.state}`,
      `  - Result: ${row.result !== "" ? row.result : LANE_NO_RESULT}`,
      ...(row.needsRefresh ? ["  - Freshness: needs refresh"] : []),
      ...(row.why !== undefined && row.why !== "" ? [`  - Why it runs here: ${row.why}`] : []),
    ]
  }).join("\n")
}

function laneHeading(line: string): { name: string; who: string } | null {
  if (!line.startsWith("- **")) return null
  const nameStart = 4
  const firstBreak = line.search(/[\r\n\u2028\u2029]/)
  const lastBreak = lastLineBreak(line)
  for (let end = line.indexOf("**", nameStart + 1); end >= 0; end = line.indexOf("**", end + 1)) {
    if (firstBreak >= 0 && firstBreak < end) break
    const separator = skipWhitespace(line, end + 2)
    if (line.charAt(separator) !== "·") continue
    const who = skipWhitespace(line, separator + 1)
    if (who > lastBreak) return { name: line.slice(nameStart, end), who: line.slice(who).trim() }
  }
  return null
}

function laneField(line: string): { name: string; value: string } | null {
  const indent = skipWhitespace(line, 0)
  if (indent === 0 || !line.startsWith("- ", indent)) return null
  const colon = line.indexOf(":", indent + 2)
  if (colon < 0) return null
  const name = line.slice(indent + 2, colon)
  if (!["State", "Result", "Freshness", "Why it runs here"].includes(name)) return null
  const value = line.slice(skipWhitespace(line, colon + 1))
  return isLineText(value) ? { name, value: value.trim() } : null
}

/** The lanes a document's *How it is checked* section holds, in the order written; none for text that holds none. */
export function parseLanes(markdown: string): LaneRow[] {
  const rows: LaneRow[] = []
  let row: LaneRow | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const head = laneHeading(line)
    if (head !== null) {
      const lane = VERIFY_LANES.find((l) => l.name === head.name)
      row = lane === undefined ? null : { id: lane.id, who: head.who, state: "waiting", result: "" }
      if (row !== null) rows.push(row)
      continue
    }
    const field = laneField(line)
    if (field === null || row === null) continue
    const { name, value } = field
    switch (name) {
      case "State":
        if ((STATES as readonly string[]).includes(value)) row.state = value as LaneState
        break
      case "Result":
        row.result = value === LANE_NO_RESULT ? "" : value
        break
      case "Freshness":
        if (value === "needs refresh") row.needsRefresh = true
        break
      default:
        row.why = value
    }
  }
  return rows
}
