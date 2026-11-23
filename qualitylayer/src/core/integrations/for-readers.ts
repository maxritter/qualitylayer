// A task file as the people on GitHub or GitLab read it: no front matter (the task's identity stays in
// the local file, where QualityLayer reads it) and no section that would show only its heading. The
// line map keeps a comment on a line of the sent file pointing at the same line of the local one.

import { parseDoc } from "../docs/frontmatter.ts"
import { proseLines } from "../docs/rules/types.ts"

export type ForReaders = {
  text: string
  /** For each line of `text` (index = line - 1), its line number in the file it came from. */
  lines: number[]
}

function consumeLineComments(
  line: string,
  startInComment: boolean,
): { silent: boolean; inComment: boolean } {
  let inComment = startInComment
  let rest = line
  let shown = false
  while (rest !== "") {
    if (inComment) {
      const end = rest.indexOf("-->")
      inComment = end === -1
      rest = end === -1 ? "" : rest.slice(end + 3)
      continue
    }
    const start = rest.indexOf("<!--")
    const visible = start === -1 ? rest : rest.slice(0, start)
    if (visible.trim() !== "") shown = true
    inComment = start !== -1
    rest = start === -1 ? "" : rest.slice(start + 4)
  }
  return { silent: !shown, inComment }
}

/** Whether a line shows nothing when rendered: blank, or inside an HTML comment. */
function silentLines(lines: string[]): boolean[] {
  let inComment = false
  return lines.map((line) => {
    const result = consumeLineComments(line, inComment)
    inComment = result.inComment
    return result.silent
  })
}

function headingLevel(lines: string[], prose: Set<number>, index: number): number {
  if (!prose.has(index)) return 0
  return lines[index]?.match(/^(#{1,6}) /)?.[1]?.length ?? 0
}

function sectionEnd(lines: string[], prose: Set<number>, start: number, depth: number): number {
  let end = start + 1
  while (end < lines.length) {
    const nextDepth = headingLevel(lines, prose, end)
    if (nextDepth > 0 && nextDepth <= depth) break
    end++
  }
  return end
}

function emptyHeadingIndices(lines: string[], silent: boolean[], prose: Set<number>): Set<number> {
  const dropped = new Set<number>()
  for (let index = 0; index < lines.length; index++) {
    const depth = headingLevel(lines, prose, index)
    if (depth === 0) continue
    const end = sectionEnd(lines, prose, index, depth)
    let hasContent = false
    for (let i = index + 1; i < end && !hasContent; i++) {
      hasContent = !silent[i] && headingLevel(lines, prose, i) === 0
    }
    if (!hasContent) {
      for (let i = index; i < end; i++) dropped.add(i)
    }
  }
  return dropped
}

function compactKeptLines(
  lines: string[],
  dropped: Set<number>,
  prose: Set<number>,
  offset: number,
): { line: string; from: number; prose: boolean }[] {
  const kept: { line: string; from: number; prose: boolean }[] = []
  for (const [index, line] of lines.entries()) {
    if (dropped.has(index)) continue
    // No two blank lines where a section went, and none at the start (a code block keeps its own).
    const isProse = prose.has(index)
    const blank = line.trim() === "" && isProse
    const before = kept.at(-1)
    const duplicateBlank = before === undefined || (before.prose && before.line.trim() === "")
    if (blank && duplicateBlank) continue
    kept.push({ line, from: index + 1 + offset, prose: isProse })
  }
  while (kept.length > 0 && (kept.at(-1)?.line.trim() ?? "") === "") kept.pop()
  return kept
}

export function forReaders(markdown: string): ForReaders {
  const { bodyStart } = parseDoc(markdown)
  const all = markdown.replace(/\r\n?/g, "\n").split("\n")
  const offset = bodyStart - 1
  const lines = all.slice(offset)
  const silent = silentLines(lines)
  const prose = new Set(proseLines(lines.join("\n")).map((l) => l.line - 1))
  const dropped = emptyHeadingIndices(lines, silent, prose)
  const kept = compactKeptLines(lines, dropped, prose, offset)
  return {
    text: `${kept.map((k) => k.line).join("\n")}\n`,
    lines: kept.map((k) => k.from),
  }
}
