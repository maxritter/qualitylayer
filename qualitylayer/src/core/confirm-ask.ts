// A point only the person can confirm is asked as one short question in the second person ("Does
// the greeting script do what you chose: …?"). The judge opens its `[USER]` line with that
// question; what it saw follows and waits behind Details. A line that does not open with one (an
// older record, a judge that wrote about the person in the third person) is never asked as it is.

import { trimEndWhile } from "./text-boundaries.ts"

const MAX_QUESTION = 140

/** Words that put the person in the third person: "Max must confirm …", "his recorded choices". */
const THIRD_PERSON =
  /\b(?:he|she|him|his|her|they|them|their|user|person|owner)\b|^[A-Z][a-z]+\s+(?:must|needs|should|has to|can)\b|\bmust confirm\b/

/** The question a judge's line opens with, and what follows it; no question when none opens it. */
export function splitAsk(text: string): { ask: string | null; rest: string } {
  const line = text.replace(/\s+/g, " ").trim()
  const first = line.match(/^(.{4,}?\?)(?:\s+|$)(.*)$/)
  const ask = first?.[1]
  if (ask === undefined || ask.length > MAX_QUESTION || THIRD_PERSON.test(ask))
    return { ask: null, rest: line }
  return { ask, rest: (first?.[2] ?? "").trim() }
}

/** Whether a line is short and plain enough to be asked in its own words: "confirm using the live account". */
export function plainAsk(text: string): boolean {
  const line = text.replace(/\s+/g, " ").trim()
  return (
    line !== "" &&
    line.length <= MAX_QUESTION &&
    !/[.!?]\s+\S/.test(line) &&
    !THIRD_PERSON.test(line)
  )
}

/** A Done means statement ("the result reflects the choices you made"), not an action to do. */
const STATEMENT = /^(?:the|a|an|it|this|that|these|those|each|every|all|no|any|both|your|my)\b/i

const lowerFirst = (text: string) =>
  /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text

/** The question for a point: the judge's own when it is one, else built from the short words. */
export function confirmQuestionOf(words: string, what: string): string {
  const said = words.trim()
  if (said.endsWith("?")) return said
  const bare = trimEndWhile(said, (c) => /[.?!\s]/.test(c))
  if (bare !== "")
    return STATEMENT.test(bare) ? `Is this right: ${bare}?` : `Did you do this: ${bare}?`
  return `Is this right: ${lowerFirst(trimEndWhile(what.trim(), (c) => /[.?!\s]/.test(c)))}?`
}
