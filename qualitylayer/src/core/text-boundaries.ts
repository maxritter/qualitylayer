/** Remove only the requested ending characters, keeping every other part of the text. */
export function trimEndCharacters(text: string, characters: string): string {
  let end = text.length
  while (end > 0 && characters.includes(text.charAt(end - 1))) end--
  return text.slice(0, end)
}

export function trimEdgeCharacters(text: string, characters: string): string {
  let start = 0
  while (start < text.length && characters.includes(text.charAt(start))) start++
  return trimEndCharacters(text.slice(start), characters)
}

export function skipWhitespace(text: string, at: number): number {
  while (at < text.length && /\s/.test(text.charAt(at))) at++
  return at
}

/** JavaScript's dot excludes these four line terminators. */
export function isLineText(text: string): boolean {
  return !/[\r\n\u2028\u2029]/.test(text)
}

/** The lazy nonempty line tail after a greedy whitespace separator, without its trailing whitespace. */
export function trimmedLineTail(text: string, at: number, minimumSpace: number): string | null {
  const start = skipWhitespace(text, at)
  if (start - at < minimumSpace) return null
  if (start < text.length) {
    const tail = text.slice(start).trimEnd()
    return isLineText(tail) ? tail : null
  }
  // An all-whitespace tail still needs one character for dot; the separator gives its last one back.
  for (let end = text.length - 1; end >= at + minimumSpace; end--)
    if (isLineText(text.charAt(end))) return text.charAt(end)
  return null
}
