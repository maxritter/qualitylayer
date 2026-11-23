import { marked, type Token, type Tokens } from "marked"

export type Passage = { quote: string; before?: string; after?: string }
export type PassageBlock = { text: string; also?: string[] }
export const passageText = (text: string) => text.replace(/\s+/g, " ")

function htmlWords(raw: string): string {
  const parts: string[] = []
  let copied = 0
  while (copied < raw.length) {
    const open = raw.indexOf("<", copied)
    if (open < 0) break
    const close = raw.indexOf(">", open + 1)
    if (close < 0) break
    parts.push(raw.slice(copied, open))
    copied = close + 1
  }
  return parts.join("") + raw.slice(copied)
}

/** Rendered words, without Markdown delimiters or executable HTML. */
export function passageWords(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if ("tokens" in token && Array.isArray(token.tokens)) return passageWords(token.tokens)
      if (token.type === "list")
        return (token as Tokens.List).items.map((item) => passageWords(item.tokens)).join(" ")
      if (token.type === "html") return htmlWords(token.raw)
      return "text" in token && typeof token.text === "string" ? token.text : token.raw
    })
    .join("")
}

export function passageBlocks(
  markdown: string,
): (PassageBlock & { heading?: string; level?: number })[] {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
  return marked
    .lexer(body)
    .filter((t) => t.type !== "space")
    .map((t) => ({
      text: passageText(passageWords([t])).trim(),
      also: [passageText(t.raw).trim().slice(0, 200)],
      ...(t.type === "heading" ? { heading: t.text, level: t.depth } : {}),
    }))
}

const FRAGMENT_IDENTITY_RE = /^`{3,}(?:wireframe|panel)\s+[a-z0-9][a-z0-9-]*/i

type QuoteQuery = { quote: string; identity: string | undefined; before: string; after: string }
type QuoteMatches = { matches: number[]; contextual: number[] }

function collectTextMatches(
  text: string,
  index: number,
  query: QuoteQuery,
  out: QuoteMatches,
): boolean {
  let at = text.indexOf(query.quote)
  const found = at !== -1
  while (at !== -1) {
    out.matches.push(index)
    if (
      text.slice(0, at).endsWith(query.before) &&
      text.slice(at + query.quote.length).startsWith(query.after)
    )
      out.contextual.push(index)
    at = text.indexOf(query.quote, at + Math.max(1, query.quote.length))
  }
  return found
}

function matchBlock(
  block: PassageBlock,
  index: number,
  query: QuoteQuery,
  out: QuoteMatches,
): void {
  const texts = new Set([block.text, ...(block.also ?? [])].map(passageText))
  for (const text of texts) {
    if (query.identity && FRAGMENT_IDENTITY_RE.exec(text.trim())?.[0] !== query.identity) continue
    if (collectTextMatches(text, index, query, out)) break
  }
}

/** Context selects occurrences, never a nearest-word guess. */
export function placeQuote(blocks: readonly PassageBlock[], passage: Passage) {
  const identity = FRAGMENT_IDENTITY_RE.exec(passage.quote.trim())?.[0]
  const quote = identity ?? passageText(passage.quote).trim()
  const before = passageText(passage.before ?? "")
  const after = passageText(passage.after ?? "")
  const out: QuoteMatches = { matches: [], contextual: [] }
  if (quote !== "") {
    const query: QuoteQuery = { quote, identity, before, after }
    blocks.forEach((block, index) => {
      matchBlock(block, index, query, out)
    })
  }
  const candidates =
    out.matches.length > 1 && (before !== "" || after !== "") ? out.contextual : out.matches
  return {
    index: candidates.length === 1 ? (candidates[0] as number) : null,
    ambiguous: out.matches.length > 0 && candidates.length !== 1,
    moved: out.matches.length === 0,
  }
}
