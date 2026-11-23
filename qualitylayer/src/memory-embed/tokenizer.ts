// The BERT uncased WordPiece tokenizer all-MiniLM-L6-v2 was trained with: clean, lowercase, strip
// accents, split on whitespace and punctuation, then match the longest vocabulary piece.

export const MAX_TOKENS = 128
const MAX_WORD_CHARS = 100

export type Tokenizer = { encode(text: string): number[] }

const WHITESPACE_CONTROL_CODES = new Set([9, 10, 13])
const ASCII_PUNCTUATION_RANGES: readonly (readonly [number, number])[] = [
  [33, 47],
  [58, 64],
  [91, 96],
  [123, 126],
]
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2ceaf],
  [0xf900, 0xfaff],
  [0x2f800, 0x2fa1f],
]

function inCodeRanges(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => code >= start && code <= end)
}

function isControl(char: string, code: number): boolean {
  if (code === 0xfffd) return true
  if (WHITESPACE_CONTROL_CODES.has(code)) return false
  return /^\p{C}$/u.test(char)
}

function isSplitChar(char: string, code: number): boolean {
  return (
    inCodeRanges(code, ASCII_PUNCTUATION_RANGES) ||
    inCodeRanges(code, CJK_RANGES) ||
    /^\p{P}$/u.test(char)
  )
}

/** Whitespace and punctuation split the text; each CJK character stands alone. */
function basicTokens(text: string): string[] {
  const out: string[] = []
  let word = ""
  const flush = () => {
    if (word) out.push(word)
    word = ""
  }
  const cleaned = text
    .normalize("NFD")
    .toLowerCase()
    .replace(/\p{Mn}/gu, "")
  for (const char of cleaned) {
    const code = char.codePointAt(0) as number
    if (isControl(char, code)) continue
    if (/^\s$/u.test(char)) flush()
    else if (isSplitChar(char, code)) {
      flush()
      out.push(char)
    } else word += char
  }
  flush()
  return out
}

function parseVocabulary(vocabulary: string): Map<string, number> {
  const ids = new Map<string, number>()
  for (const [index, line] of vocabulary.split("\n").entries()) {
    const piece = line.replace(/\r$/, "")
    if (piece) ids.set(piece, index)
  }
  return ids
}

function requirePieceId(ids: Map<string, number>, piece: string): number {
  const found = ids.get(piece)
  if (found === undefined) throw new Error(`The vocabulary has no ${piece}`)
  return found
}

function matchLongestPiece(
  ids: Map<string, number>,
  chars: string[],
  start: number,
): { id: number; end: number } | undefined {
  const prefix = start > 0 ? "##" : ""
  for (let end = chars.length; end > start; end--) {
    const id = ids.get(prefix + chars.slice(start, end).join(""))
    if (id !== undefined) return { id, end }
  }
  return undefined
}

function encodeWordPieces(ids: Map<string, number>, unk: number, word: string): number[] {
  const chars = [...word]
  if (chars.length > MAX_WORD_CHARS) return [unk]
  const out: number[] = []
  let start = 0
  while (start < chars.length) {
    const match = matchLongestPiece(ids, chars, start)
    if (!match) return [unk]
    out.push(match.id)
    start = match.end
  }
  return out
}

export function createTokenizer(vocabulary: string, maxTokens = MAX_TOKENS): Tokenizer {
  const ids = parseVocabulary(vocabulary)
  const cls = requirePieceId(ids, "[CLS]")
  const sep = requirePieceId(ids, "[SEP]")
  const unk = requirePieceId(ids, "[UNK]")
  const limit = maxTokens - 2
  return {
    encode(text) {
      const body: number[] = []
      for (const word of basicTokens(text)) {
        body.push(...encodeWordPieces(ids, unk, word))
        if (body.length >= limit) break
      }
      return [cls, ...body.slice(0, limit), sep]
    },
  }
}
