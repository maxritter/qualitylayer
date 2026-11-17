import {
  isLineText,
  skipWhitespace,
  trimEndCharacters,
  trimmedLineTail,
} from "../text-boundaries.ts"

export function findingHeading(line: string): string | null {
  if (!line.startsWith("###")) return null
  const start = skipWhitespace(line, 3)
  if (start === 3) return null
  if (start === line.length) return trimmedLineTail(line, 3, 1)?.trim() ?? null
  const rest = line.slice(start).trimEnd()
  const heading = trimEndCharacters(rest, "#").trimEnd() || rest.charAt(0)
  return isLineText(heading) ? heading : null
}
