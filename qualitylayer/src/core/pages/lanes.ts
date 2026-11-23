// Verify's lanes and the four stages they fall into. The people's file (03-verify.md, *Checks*) lists
// one numbered line per stage (`stagesText`); the lanes themselves (who runs each, its state, its
// result and why it runs here) are the records the stages are drawn from, read by the App's lanes
// view as `lanesText`/`parseLanes` text. Plain Markdown: GitHub and an editor read it as it is.
// Free of imports from the server, so the App's browser bundle reads it as it is.

import { VERIFY_LANES, type VerifyLaneId } from "../flow.ts"
import type { ScreenPair } from "../review/screens.ts"
import {
  LANE_FACTS_MAX,
  LANE_NO_RESULT,
  LANE_RESULT_MAX,
  type LaneRow,
  type LaneState,
  STATE_WORD,
} from "./lane-defs.ts"

export {
  LANE_STAGES,
  LANE_STATE_WORDS,
  type LaneRow,
  type LaneState,
  withoutStateWord,
} from "./lane-defs.ts"
export { parseLanes } from "./lane-parse.ts"
export { plainReason } from "./lane-reason.ts"
export { parseStages, type StageRow, stageRows, stagesText } from "./lane-stages.ts"

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

export const laneNameOf = (id: VerifyLaneId): string =>
  VERIFY_LANES.find((lane) => lane.id === id)?.name ?? id

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
