// Existing licence provenance metadata in emitted text: the first 8 hex digits of
// the stable licence hash, written in zero-width characters. Workflow source is
// readable; this mark grants no authority and makes no confidentiality guarantee.
//
// It sits at several places in the text (after the first paragraph, after every second
// one, at the end), so cutting a piece out of the middle still carries it. It is a deterrent and
// a trail, not a lock: someone who strips zero-width characters removes it.

const ZERO = "​" // a 0 bit
const ONE = "‌" // a 1 bit
const OPEN = "⁠‍"
const CLOSE = "‍⁠"
const DIGITS = 8

const MARK = new RegExp(`${OPEN}([${ZERO}${ONE}]{${DIGITS * 4}})${CLOSE}`, "g")

function encode(hash: string): string {
  const bits = hash
    .slice(0, DIGITS)
    .padEnd(DIGITS, "0")
    .split("")
    .map((digit) => (Number.parseInt(digit, 16) || 0).toString(2).padStart(4, "0"))
    .join("")
  return `${OPEN}${bits.replaceAll("0", ZERO).replaceAll("1", ONE)}${CLOSE}`
}

/** The text without any mark: what a person reads. */
export function unmarked(text: string): string {
  return text.replace(MARK, "")
}

/** The hash a text was marked with (8 hex digits), or null when it carries no mark. */
export function readMark(text: string): string | null {
  for (const match of text.matchAll(MARK)) {
    const bits = (match[1] as string).replaceAll(ZERO, "0").replaceAll(ONE, "1")
    let hash = ""
    for (let at = 0; at < bits.length; at += 4)
      hash += Number.parseInt(bits.slice(at, at + 4), 2).toString(16)
    return hash
  }
  return null
}

/**
 * The text with the mark written in at the end of the first paragraph, of every
 * second one after it, and of the last. It goes before a paragraph's trailing
 * whitespace and never in front of the text, so what a text starts and ends with
 * stays as it was.
 */
export function markText(text: string, hash: string): string {
  if (text === "") return text
  const mark = encode(hash)
  const paragraphs = unmarked(text).split("\n\n")
  const last = paragraphs.length - 1
  return paragraphs
    .map((paragraph, index) => {
      if (index % 2 !== 0 && index !== last) return paragraph
      const body = paragraph.trimEnd()
      return body + mark + paragraph.slice(body.length)
    })
    .join("\n\n")
}
