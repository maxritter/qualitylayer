// What a person's typed words pick among a question's choices, for the agents that hand a command
// no picker: the same rule for every agent and every question, so "Approve" approves "Approve
// Plan" in Cursor's chat as it does where a hook reads the message. The words are never replaced:
// this only says which choice they point at, and refuses to guess between two.

export { typedAnswer } from "./typed-answer.ts"

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

export const NUMBER = /^\s*(?:(?:option|choice|number|no\.?|nr\.?|#)\s*)?(\d{1,2})(?:\s*[.)])?$/i

/** A number in front of words, as a picker's list shows them: "1. Approve", "2) Request changes". */
const NUMBER_THEN_WORDS =
  /^\s*(?:(?:option|choice|number|no\.?|nr\.?|#)\s*)?(\d{1,2})(?:\s*[.):\-–—])?\s+(\S[\s\S]*)$/i

const NONE: TypedChoice = { kind: "none" }

function exactLabelMatch(labels: string[][], target: string): TypedChoice | null {
  if (target === "") return null
  const found = labels.flatMap((label, i) => (label.join(" ") === target ? [i] : []))
  if (found.length > 1) return { kind: "ambiguous", options: found }
  return found[0] !== undefined ? { kind: "choice", index: found[0] } : null
}

function matchPrefixedNumber(stripped: string, choices: readonly Choice[]): TypedChoice | null {
  const prefixed = NUMBER_THEN_WORDS.exec(stripped)
  if (!prefixed) return null
  const index = Number(prefixed[1]) - 1
  if (index < 0 || index >= choices.length) return NONE
  const rest = typedChoice(prefixed[2] ?? "", choices)
  if (rest.kind === "choice")
    return rest.index === index ? rest : { kind: "ambiguous", options: [index, rest.index] }
  return rest.kind === "ambiguous" && rest.options.includes(index)
    ? { kind: "choice", index }
    : NONE
}

function matchFuzzyChoice(
  said: string[],
  labels: string[][],
  choices: readonly Choice[],
): TypedChoice {
  const decide = (rule: (label: string[]) => boolean): TypedChoice | null => {
    const found = labels.flatMap((label, i) => (rule(label) ? [i] : []))
    const [only] = found
    if (only === undefined) return null
    if (found.length > 1) return { kind: "ambiguous", options: found }
    return choices[only]?.words === true ? NONE : { kind: "choice", index: only }
  }
  const named = said.filter((word) => !FILLER.has(word))
  // A label with only politeness around it ("approve, thanks", "please approve") is that label.
  const exactLean = exactLabelMatch(labels, named.join(" "))
  if (exactLean !== null) return exactLean
  return (
    decide((label) => said.every((word, at) => label[at] === word)) ??
    (named.length > 0 ? decide((label) => named.every((word) => label.includes(word))) : null) ??
    NONE
  )
}

/**
 * Which choice `words` names: its exact label (case, quotes and a trailing "." aside), its number,
 * the beginning of exactly one label, or words that all occur in exactly one label. More than one
 * label that fits is ambiguous. A choice that takes the person's own words is never named by part
 * of its label: words beside another choice's label stay doubtful, and words that fit only it are
 * the person's own.
 */
function matchBareNumber(stripped: string, choices: readonly Choice[]): TypedChoice | null {
  const numbered = NUMBER.exec(stripped.trimEnd())
  if (!numbered) return null
  const index = Number(numbered[1]) - 1
  return index >= 0 && index < choices.length ? { kind: "choice", index } : NONE
}

export function typedChoice(words: string, choices: readonly Choice[]): TypedChoice {
  const said = tokens(words)
  if (said.length === 0) return NONE
  const labels = choices.map((choice) => tokens(choice.label))
  const exact = exactLabelMatch(labels, said.join(" "))
  if (exact !== null) return exact
  // The number and the words must name the same choice: "1. Approve" is the first choice when it
  // is called Approve, and "1. Request changes" is two different answers, so none is taken.
  const stripped = words.replace(/^\/(?:ql|qualitylayer)\s+/i, "")
  const prefixed = matchPrefixedNumber(stripped, choices)
  if (prefixed !== null) return prefixed
  if (said.length > 6) return NONE
  return matchBareNumber(stripped, choices) ?? matchFuzzyChoice(said, labels, choices)
}

function isFixedChoiceQuestion(question: { id: string; gate?: string; hold?: string }): boolean {
  // The place question (task/place.ts) saves the person's two Workflow rows: only a choice can.
  return (
    question.gate !== undefined ||
    question.hold !== undefined ||
    question.id === "answer-place" ||
    /^need-T\d+-/.test(question.id)
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
    isFixedChoiceQuestion(question) && !question.choices.some((choice) => choice.words === true)
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
