// *Try it yourself* of a task's Review document (03-verify.md): `### Try it` with one
// `#### <title>` block per step (`- Do:`, `- Run:`, `- Expect:`, `- Saw:`), `### Not verified` and
// `### Docs`. The App shows it in the Approve view, and the document is the one place that holds it.
// Pure text, so the rule and the readers share it.

import { recordLineTail } from "../docs/record-lines.ts"
import { proseLines, sectionRanges } from "../docs/rules/types.ts"
import { isLineText } from "../text-boundaries.ts"

function tryStepTitle(line: string): string | null {
  if (!line.startsWith("#### ")) return null
  const rest = line.slice(5)
  const number = /^\d+\./.exec(rest)?.[0]
  const numbered = number === undefined ? null : recordLineTail(rest, number.length, 0)
  return numbered ?? (rest !== "" && isLineText(rest) ? rest.trim() : null)
}

/** The text under `## Try it yourself`, without its heading; null when the document has no such section. */
export function tryItSection(markdown: string): string | null {
  const range = sectionRanges(markdown).find((r) => r.heading === "Try it yourself")
  if (range === undefined) return null
  return markdown
    .split(/\r?\n/)
    .slice(range.start, range.end - 1)
    .join("\n")
}

/**
 * *Try it yourself* in the shape `parseFinalChecks` reads (`## Try it` with `### <title>` steps,
 * `## Not verified`, `## Docs`), one heading level up.
 * Empty when the document has no such section.
 */
export function finalChecksFromReview(markdown: string): string {
  const body = tryItSection(markdown)
  if (body === null) return ""
  const prose = new Set(proseLines(body).map((l) => l.line))
  return body
    .split(/\r?\n/)
    .map((line, index) => {
      return !prose.has(index + 1)
        ? line
        : line.replace(
            /^(#{3,6})(\s)/,
            (_, hashes: string, space: string) => `${hashes.slice(1)}${space}`,
          )
    })
    .join("\n")
}

/** The steps of `### Try it`: each `#### ` block's title and its lines; none when the heading is missing. */
export function tryItSteps(markdown: string): { title: string; line: number; text: string }[] {
  const lines = markdown.split(/\r?\n/)
  const range = sectionRanges(markdown).find((r) => r.heading === "Try it yourself")
  if (range === undefined) return []
  const steps: { title: string; line: number; text: string }[] = []
  let inTry = false
  const prose = new Set(proseLines(markdown).map((l) => l.line))
  for (let index = range.start; index < range.end - 1; index++) {
    const line = lines[index] ?? ""
    if (!prose.has(index + 1)) continue
    const h3 = line.match(/^### (.+)$/)
    if (h3 !== null) {
      inTry = (h3[1] ?? "").trim().toLowerCase() === "try it"
      continue
    }
    const title = tryStepTitle(line)
    if (inTry && title !== null) {
      steps.push({ title, line: index + 1, text: "" })
      continue
    }
    const last = steps[steps.length - 1]
    if (inTry && last !== undefined) last.text += `${line}\n`
  }
  return steps
}
