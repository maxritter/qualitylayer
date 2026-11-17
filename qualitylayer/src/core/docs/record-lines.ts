import { isLineText, skipWhitespace } from "../text-boundaries.ts"

/** Read a trimmed record value after a greedy separator, without crossing a line ending. */
export function recordLineTail(
  text: string,
  after: number,
  minimumSpace: number,
  allowEmpty = false,
): string | null {
  const start = skipWhitespace(text, after)
  if (start - after < minimumSpace) return null
  if (start < text.length) {
    const value = text.slice(start)
    return isLineText(value) ? value.trimEnd() : null
  }
  if (allowEmpty) return ""
  // The separator can give back the last character for a required whitespace-only value.
  return start > after + minimumSpace && isLineText(text.charAt(start - 1)) ? "" : null
}

export function findingAnswerLine(
  line: string,
): { stance?: "taken" | "kept" | "ask"; text: string } | null {
  const prefix = /^\s*(?:[-*>]\s*)?\*{0,2}Answer:?\*{0,2}/i.exec(line)
  if (prefix === null) return null
  let at = skipWhitespace(line, prefix[0].length)
  const state = /^(Taken|Kept|Ask)\b/i.exec(line.slice(at))?.[0]
  if (state !== undefined) at = skipWhitespace(line, at + state.length)
  if (/[·:—–-]/.test(line.charAt(at))) at++
  const text = recordLineTail(line, at, 0, true)
  const stance = state?.toLowerCase() as "taken" | "kept" | "ask" | undefined
  return text === null ? null : { stance, text }
}

export function checkListItem(line: string): string | null {
  const prefix = /^\s*(?:[-*]|\d+\.)/.exec(line)?.[0]
  return prefix === undefined ? null : recordLineTail(line, prefix.length, 1)
}

export function checkHeading(line: string): string | null {
  if (!line.startsWith("###")) return null
  const start = skipWhitespace(line, 3)
  if (start === 3) return null
  const number = /^\d+\./.exec(line.slice(start))?.[0]
  if (number !== undefined) {
    const title = recordLineTail(line, start + number.length, 0)
    if (title !== null) return title
  }
  return recordLineTail(line, 3, 1)
}

export function checkField(line: string): { name: string; value: string } | null {
  const field = /^\s*[-*]\s+\*{0,2}(Do|Run|Expect|Expected|Saw)\*{0,2}:\*{0,2}/i.exec(line)
  if (field === null) return null
  const value = recordLineTail(line, field[0].length, 0, true)
  return value === null ? null : { name: (field[1] ?? "").toLowerCase(), value }
}

export function noteLine(line: string): { task: string; kind: string; text: string } | null {
  const note =
    /^[-*]\s+(T\d+(?:\s*,\s*T\d+)*|Plan)\s*\((tactical|glue|amended|agreed|judged)\)\s*:/i.exec(
      line,
    )
  if (note === null) return null
  const text = recordLineTail(line, note[0].length, 0)
  return text === null ? null : { task: note[1] ?? "", kind: note[2] ?? "", text }
}
