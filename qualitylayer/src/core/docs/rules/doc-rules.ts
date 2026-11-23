// Rules for the Plan's documents. Each guards a record the App reads or a hard limit; how the text
// is written is the phase text's business, never a rule's.

import { join } from "node:path"
import { agentFileOf, RESEARCH_DIR } from "../names.ts"
import { checkMermaid } from "../visuals.ts"
import { proseLines, type Rule, type RuleInput, sectionRanges, verr } from "./types.ts"

export { referencesResolve } from "./doc-references.ts"

/** A file of the task folder, "" when it is not written. */
async function taskFile(input: RuleInput, name: string): Promise<string> {
  const path = join(input.taskDir, name)
  return (await input.ctx.fs.exists(path)) ? await input.ctx.fs.readFile(path) : ""
}

export const mermaidParses: Rule = async (input) => {
  const errors = []
  for (const fence of input.fences()) {
    if (fence.kind !== "mermaid") continue
    const error = await checkMermaid(fence)
    if (error !== null) errors.push(error)
  }
  return errors
}

/**
 * The Plan names the project's checks, in its agents' file's Checks: what `qualitylayer check all`
 * runs before the judge.
 */
export const projectChecks: Rule = async (input) => {
  const agents = agentFileOf("plan")
  const text = `${input.markdown}\n${input.docName === agents ? "" : await taskFile(input, agents)}`
  const line = text.match(/^\*\*Project checks:\*\*(.*)$/im)?.[1]
  if (line !== undefined && /`[^`]+`/.test(line)) return []
  return [
    verr(
      1,
      "project-checks",
      "the Plan has no **Project checks:** line with commands",
      `under "## Checks" in ${agents}, add **Project checks:** with the repository's test, lint, type and build commands in backticks, e.g. **Project checks:** \`bun test\` · \`bun run lint\` · \`bun run typecheck\``,
    ),
  ]
}

/** The Plan says whether the change crosses a trust boundary: it decides whether security reviews it. */
export const trustBoundaryLine: Rule = (input) => {
  const line = input.markdown.match(/^\*\*Trust boundary:\*\*[ \t]*(.*)$/im)?.[1]
  if (line !== undefined && line.trim() !== "") return []
  return [
    verr(
      1,
      "trust-boundary-line",
      "the Plan has no **Trust boundary:** line",
      "add **Trust boundary:** none, or **Trust boundary:** <what crosses it: network input, auth, files from users, secrets, other processes>",
    ),
  ]
}

/** What a decision's body says of itself: its lines outside the code fences. */
function decisionBlocks(input: RuleInput): { title: string; line: number; text: string }[] {
  const section = sectionRanges(input.markdown).find((r) => r.heading === "Engineering decisions")
  if (section === undefined) return []
  const blocks: { title: string; line: number; lines: string[] }[] = []
  for (const { text, line } of proseLines(input.markdown)) {
    if (line <= section.start || line >= section.end) continue
    const head = text.match(/^### (.+)$/)
    if (head?.[1] !== undefined) blocks.push({ title: head[1].trim(), line, lines: [] })
    else blocks[blocks.length - 1]?.lines.push(text)
  }
  return blocks.map((b) => ({ title: b.title, line: b.line, text: b.lines.join("\n") }))
}

/** A decision is the person's call when it says `late: true` (also `**Late:** true`). */
export const isYourCall = (text: string): boolean =>
  /^(?:\*\*late:\*\*|late:)\s*true\s*$/im.test(text.replace(/^\s+/gm, ""))

/**
 * Each recorded call names its options and recommendation so the App can draw it.
 */
export const yourCallCount: Rule = (input) => {
  const calls = decisionBlocks(input).filter((b) => isYourCall(b.text))
  const errors = []
  for (const call of calls) {
    const missing = [
      ["**A:**", /^\*\*A:\*\*\s*\S/m],
      ["**B:**", /^\*\*B:\*\*\s*\S/m],
      ["**Recommended:**", /^\*\*Recommended:\*\*\s*[AB]\b/m],
    ].filter(([, pattern]) => !(pattern as RegExp).test(call.text.replace(/^\s+/gm, "")))
    if (missing.length === 0) continue
    errors.push(
      verr(
        call.line,
        "your-call-count",
        `the call "${call.title}" lacks its options: ${missing.map(([name]) => name).join(", ")}`,
        "a call for the person gives the lines **A:** and **B:** (one option each) and **Recommended:** A or B",
      ),
    )
  }
  return errors
}

const WORDS_OF = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3)

/** The helpers' reports, as written: `research/r1.md` … */
async function reports(input: RuleInput): Promise<string> {
  const dir = join(input.taskDir, RESEARCH_DIR)
  if (!(await input.ctx.fs.exists(dir))) return ""
  const names = (await input.ctx.fs.entries(dir))
    .filter((entry) => entry.kind === "file" && /^r\d+\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const texts = await Promise.all(names.map((name) => taskFile(input, `${RESEARCH_DIR}/${name}`)))
  return texts.join("\n")
}

/**
 * A deployed state the reading did not check (`**Deployed state not checked:** …` in the Plan's
 * Findings or a helper's report) is answered in the Plan: named in a *Prerequisites* row with the
 * check that settles it, or in the agents' file's *Risks* with the check that holds it. A Plan that
 * rests on it without either is refused.
 */
export const deployedStateChecked: Rule = async (input) => {
  const agents = await taskFile(input, agentFileOf("plan"))
  const read = [agents, await reports(input)].join("\n")
  const unchecked = [...read.matchAll(/^\*\*Deployed state not checked:\*\*(.+)$/gim)]
    .map((match) => (match[1] ?? "").trim())
    .filter((text) => text !== "")
  if (unchecked.length === 0) return []
  const sections = [
    { heading: "Prerequisites", text: input.markdown },
    { heading: "Risks", text: agents },
  ]
  const answers = sections.flatMap(({ heading, text }) => {
    const lines = text.split(/\r?\n/)
    return sectionRanges(text)
      .filter((r) => r.heading === heading)
      .map((r) => lines.slice(r.start, r.end - 1).join("\n"))
  })
  return unchecked.flatMap((what) => {
    const key = WORDS_OF(what)
    const need = Math.min(2, key.length)
    const answered = answers.some((text) => {
      const have = new Set(WORDS_OF(text))
      return key.filter((word) => have.has(word)).length >= need
    })
    return answered
      ? []
      : [
          verr(
            1,
            "deployed-state-checked",
            `the reading left a deployed state unchecked: "${what.slice(0, 120)}", and nothing in the Plan answers it`,
            'add a row to "Prerequisites" with the check that settles it, or a line under "Risks" with the check that holds it, naming it in the same words',
          ),
        ]
  })
}
