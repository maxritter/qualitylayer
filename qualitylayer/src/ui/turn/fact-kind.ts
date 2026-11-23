// What kind of fact a choice's line is, so the question card can lead each with the mark for it: when
// it happens (timing), what it adds or costs, why it holds, or where the evidence is. The agent writes
// plain lines ("Usage within five minutes", "Adds about 1 ms per request", "Tests run on: main's
// runtime"); the kind is read from the line's own words, never asked of the agent, and the tooltip
// names it, so a line the guess misses still reads right.

export type FactKind = "timing" | "adds" | "why" | "evidence"

export const FACT_KIND_WORDS: Record<FactKind, string> = {
  timing: "Timing",
  adds: "What it adds",
  why: "Why it holds",
  evidence: "Evidence",
}

const ADDS = /^(?:adds?|added|costs?|extra|needs?|requires?|nothing added|no extra|one more)\b/i
const TIMING =
  /\b(?:\d+(?:[.,]\d+)?\s*(?:ms|s|sec|seconds?|min|minutes?|h|hours?|days?|weeks?)\b|within|late|later|hour|hourly|minute|nightly|daily|weekly|real[- ]time|latency|delay|instant|immediately|every)\b/i

const HEAD_PATTERNS: readonly [RegExp, FactKind][] = [
  [/^evidence/, "evidence"],
  [/^(?:timing|when|latency|speed|time)\b/, "timing"],
  [/^(?:adds?|costs?|cost|extra|needs?|requires?)\b/, "adds"],
  [/^(?:why|because|holds)\b/, "why"],
]

/** The kind of one fact line; `term` is the part before a colon, when the line has one. */
export function factKind(text: string, term?: string): FactKind {
  const head = (term ?? "").toLowerCase()
  const matched = HEAD_PATTERNS.find(([pattern]) => pattern.test(head))
  if (matched) return matched[1]
  const whole = text.trim()
  if (ADDS.test(whole)) return "adds"
  return TIMING.test(whole) ? "timing" : "why"
}
