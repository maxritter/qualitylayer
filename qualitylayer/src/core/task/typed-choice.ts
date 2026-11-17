// What a person's typed words pick among a question's choices, for the agents that hand a command
// no picker: the same rule for every agent and every question, so "Approve" approves "Approve
// Plan" in Cursor's chat as it does where a hook reads the message. The words are never replaced:
// this only says which choice they point at, and refuses to guess between two.

import { trimEndWhile } from "../text-boundaries.ts"

export type TypedChoice =
  /** Exactly one choice: its zero-based index. */
  | { kind: "choice"; index: number }
  /** Two or more choices fit; none is taken. */
  | { kind: "ambiguous"; options: number[] }
  | { kind: "none" }

type Choice = { label: string; words?: true }

/** Words that say nothing about which choice is meant. */
const FILLER = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "it",
  "and",
  "or",
  "i",
  "please",
  "ok",
  "ql",
  "thanks",
  "thank",
  "you",
  "thx",
])

/** Lower-case words without the case, punctuation, quotes or the "(Recommended)" tag around them. */
function tokens(words: string): string[] {
  return words
    .toLowerCase()
    .replace(/\((?:recommended)\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "")
}

const NUMBER = /^\s*(?:(?:option|choice|number|no\.?|nr\.?|#)\s*)?(\d{1,2})(?:\s*[.)])?$/i

/** A number in front of words, as a picker's list shows them: "1. Approve", "2) Request changes". */
const NUMBER_THEN_WORDS =
  /^\s*(?:(?:option|choice|number|no\.?|nr\.?|#)\s*)?(\d{1,2})(?:\s*[.):\-\u2013\u2014])?\s+(\S[\s\S]*)$/i

const NONE: TypedChoice = { kind: "none" }

/**
 * Which choice `words` names: its exact label (case, quotes and a trailing "." aside), its number,
 * the beginning of exactly one label, or words that all occur in exactly one label. More than one
 * label that fits is ambiguous. A choice that takes the person's own words is never named by part
 * of its label: words beside another choice's label stay doubtful, and words that fit only it are
 * the person's own.
 */
export function typedChoice(words: string, choices: readonly Choice[]): TypedChoice {
  const said = tokens(words)
  if (said.length === 0) return NONE
  const labels = choices.map((choice) => tokens(choice.label))
  const exact = labels.flatMap((label, i) => (label.join(" ") === said.join(" ") ? [i] : []))
  if (exact.length > 1) return { kind: "ambiguous", options: exact }
  if (exact[0] !== undefined) return { kind: "choice", index: exact[0] }
  // The number and the words must name the same choice: "1. Approve" is the first choice when it
  // is called Approve, and "1. Request changes" is two different answers, so none is taken.
  const prefixed = NUMBER_THEN_WORDS.exec(words.replace(/^\/(?:ql|qualitylayer)\s+/i, ""))
  if (prefixed) {
    const index = Number(prefixed[1]) - 1
    if (index < 0 || index >= choices.length) return NONE
    const rest = typedChoice(prefixed[2] ?? "", choices)
    if (rest.kind === "choice")
      return rest.index === index ? rest : { kind: "ambiguous", options: [index, rest.index] }
    return rest.kind === "ambiguous" && rest.options.includes(index)
      ? { kind: "choice", index }
      : NONE
  }
  if (said.length > 6) return NONE
  const numbered = NUMBER.exec(words.replace(/^\/(?:ql|qualitylayer)\s+/i, "").trimEnd())
  if (numbered) {
    const index = Number(numbered[1]) - 1
    return index >= 0 && index < choices.length ? { kind: "choice", index } : NONE
  }
  // The first rule that fits any label decides.
  const decide = (rule: (label: string[]) => boolean): TypedChoice | null => {
    const found = labels.flatMap((label, i) => (rule(label) ? [i] : []))
    const [only] = found
    if (only === undefined) return null
    if (found.length > 1) return { kind: "ambiguous", options: found }
    return choices[only]?.words === true ? NONE : { kind: "choice", index: only }
  }
  const named = said.filter((word) => !FILLER.has(word))
  // A label with only politeness around it ("approve, thanks", "please approve") is that label.
  const lean = named.join(" ")
  const exactLean =
    lean === "" ? [] : labels.flatMap((label, i) => (label.join(" ") === lean ? [i] : []))
  if (exactLean.length > 1) return { kind: "ambiguous", options: exactLean }
  if (exactLean[0] !== undefined) return { kind: "choice", index: exactLean[0] }
  return (
    decide((label) => said.every((word, at) => label[at] === word)) ??
    (named.length > 0 ? decide((label) => named.every((word) => label.includes(word))) : null) ??
    NONE
  )
}

/**
 * Whether a question can only be answered by one of its choices: a review's, a hold's or a
 * prerequisite's, none of which takes the person's own words. Other questions keep words that name
 * no choice as the person's own answer.
 */
export function requiresChoice(question: {
  id: string
  gate?: string
  hold?: string
  choices: readonly Choice[]
}): boolean {
  return (
    // The place question (task/place.ts) saves the person's two Workflow rows: only a choice can.
    (question.gate !== undefined ||
      question.hold !== undefined ||
      question.id === "answer-place" ||
      /^need-T\d+-/.test(question.id)) &&
    !question.choices.some((choice) => choice.words === true)
  )
}

/** How a refused answer is told to the agent, with the options named. */
export function typedChoiceRefusal(
  words: string,
  choices: readonly { label: string }[],
  found: TypedChoice,
  /** The gate the question approves: while it is open, waiting is the agent's own move. */
  gate?: string,
): string {
  const named = (indices: number[]) =>
    indices.map((i) => `${i + 1}. ${choices[i]?.label ?? ""}`).join(", ")
  const said = words.trim().slice(0, 120)
  const ask =
    found.kind === "ambiguous"
      ? `"${said}" fits more than one choice (${named(found.options)}); nothing changed. Ask the person which one they mean`
      : `"${said}" is none of this question's choices (${named(choices.map((_, i) => i))}); nothing changed. Ask the person to pick one by its words or number`
  return gate === undefined
    ? `${ask}.`
    : `${ask}, once; then your move is \`qualitylayer wait --for approval\`, again while it says pending: it returns when they approve or comment, here or in the App.`
}

/** What typed words answer: a choice (with the words beside it kept as a note), several, or nothing. */
export type TypedAnswer =
  | { kind: "choice"; index: number; note?: string }
  | { kind: "ambiguous"; options: number[] }
  | { kind: "none" }

const ORDINALS: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  last: -1,
}
const ORDINAL =
  /^\s*(?:(?:the|my)\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last)(?:\s+(?:one|option|choice|answer))?\b[\s,.:;–—-]*([\s\S]*)$/i
const RECOMMENDATION =
  /^\s*(?:(?:please|ok|okay)[\s,]+)?(?:(?:go with|go for|use|take|pick|choose|i(?:'ll| will)? (?:go with|take))\s+)?(?:your|the)\s+(?:recommendation|recommended(?:\s+(?:one|option|choice|answer))?)(?:[\s,]+please)?[\s.!]*$/i

const stripTag = (label: string) =>
  label
    .trimEnd()
    .replace(/\(recommended\)$/i, "")
    .trim()
const stripEnd = (words: string) => trimEndWhile(words.trimStart(), (c) => /[\s.!]/.test(c))

/**
 * Which choice typed words answer, for a question the person answers by typing. A bare number is
 * the list's line of that number; otherwise an exact label wins, then the one label that differs
 * only in case; two labels that differ only in case are asked about, never guessed. Where the question takes the person's own words (`own`), anything
 * that is not clearly a choice (its number, "the first one", "your recommendation", a number in
 * front of words) stays their words; other questions use the full rule of `typedChoice`.
 */
export function typedAnswer(
  words: string,
  choices: readonly Choice[],
  options: { recommended?: number; own?: boolean } = {},
): TypedAnswer {
  const said = words.replace(/^\s*\/(?:ql|qualitylayer)\s+/i, "").trim()
  if (said === "") return NONE
  // A bare number is the line of the numbered list the person was shown, even when another choice
  // is itself called that number; a number past the list falls through to a label that reads it.
  const bare = NUMBER.exec(said)
  if (bare) {
    const at = Number(bare[1]) - 1
    if (at >= 0 && at < choices.length && choices[at]?.words !== true)
      return { kind: "choice", index: at }
  }
  const forms = [said, stripEnd(said)]
  const same = (match: (label: string, form: string) => boolean) => {
    for (const form of forms) {
      const found = choices.flatMap((c, i) => (match(stripTag(c.label), form) ? [i] : []))
      if (found.length > 0) return found
    }
    return []
  }
  for (const found of [
    same((label, form) => label === stripTag(form)),
    same((label, form) => label.toLowerCase() === stripTag(form).toLowerCase()),
  ]) {
    const [only] = found
    if (only === undefined) continue
    if (found.length > 1) return { kind: "ambiguous", options: found }
    return choices[only]?.words === true ? NONE : { kind: "choice", index: only }
  }
  // "Confirmed" or "looks good" at a question whose first choice approves is that choice.
  if (
    choices[0]?.words !== true &&
    APPROVING.test(choices[0]?.label ?? "") &&
    AFFIRMATION.test(stripEnd(said))
  )
    return { kind: "choice", index: 0 }
  if (options.own !== true) return typedChoice(said, choices)
  const pick = (index: number, note?: string): TypedAnswer =>
    index >= 0 && index < choices.length && choices[index]?.words !== true
      ? { kind: "choice", index, ...(note ? { note } : {}) }
      : NONE
  const number = NUMBER.exec(said)
  if (number) return pick(Number(number[1]) - 1)
  if (RECOMMENDATION.test(said) && options.recommended !== undefined)
    return pick(options.recommended)
  // A position, then perhaps words: the choice's own label, or the person's remark beside it.
  const beside = (index: number, rest: string): TypedAnswer => {
    const remark = rest.trim()
    if (remark === "" || FILLER_ONLY.test(remark)) return pick(index)
    const named = typedAnswer(remark, choices, { own: true })
    if (named.kind === "choice") return named.index === index ? pick(index) : NONE
    // Words that fit this choice and another only by case are still words about this one.
    return named.kind === "ambiguous" && named.options.includes(index)
      ? pick(index)
      : pick(index, said)
  }
  const ordinal = ORDINAL.exec(said)
  if (ordinal) {
    const at = ORDINALS[(ordinal[1] ?? "").toLowerCase()] ?? 0
    const index = at === -1 ? choices.length - 1 : at - 1
    return beside(index, ordinal[2] ?? "")
  }
  const prefixed = NUMBER_THEN_REMARK.exec(said)
  if (prefixed) return beside(Number(prefixed[1]) - 1, prefixed[2] ?? "")
  return NONE
}

/** A number, then words about it: "2, but keep the comma". */
const NUMBER_THEN_REMARK =
  /^\s*(?:(?:option|choice|number|no\.?|nr\.?|#)\s*)?(\d{1,2})(?:\s*[.):,;\-\u2013\u2014])?\s+(\S[\s\S]*)$/i

const APPROVING = /^(?:approve|agree|confirm|yes)\b/i
const AFFIRMATION =
  /^\s*(?:(?:option\s+|choice\s+|number\s+|no\.?\s+|#)?1(?:\s*[.):,\u2013\u2014-])?\s+)?(?:yes|yep|yeah|ok|okay|confirmed?|looks good|lgtm|sounds good|ship it|go ahead|go for it|correct|that'?s right)(?:[,\s]+(?:thanks|thank you|please))?$/i

const FILLER_ONLY = /^(?:one|option|choice|please|thanks|thank you|ok|okay)[\s.!]*$/i
