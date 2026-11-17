// A small change's one independent review: every finding it made, in any round, is answered before
// Review opens. A finding is a FAIL, MISSING or NOTE line of the judge's record. QualityLayer lists
// them in `records/independent-review.md`; the build session writes under each `Answer: Taken ·
// <what changed, the commit>` or `Answer: Kept · <why the code stays>`. The answers it wrote stay
// when the list is written again with a later round's findings.

import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import type { BuildLog } from "./docs/build-log.ts"
import { withoutExemptNotesLog } from "./exempt-notes.ts"
import type { Task } from "./task/store.ts"
import { lastLineBreak } from "./text-boundaries.ts"

export type SmallFinding = {
  key: string
  verdict: string
  point: string
  text: string
  /** `taken` or `kept` with its words; undefined while the finding waits for its answer. */
  answer?: { stance: "taken" | "kept"; text: string }
}

export const smallFindingsPath = (task: Pick<Task, "dir">): string =>
  join(task.dir, "records", "independent-review.md")

const keyOf = (verdict: string, point: string, text: string): string =>
  createHash("sha256").update(`${verdict}\0${point}\0${text}`).digest("hex").slice(0, 10)

function headerKey(line: string): string | null {
  const prefix = /^\d+\.\s+\[(\w+)\]\s+/.exec(line)
  if (!prefix) return null
  const body = line.slice(prefix[0].length)
  const firstBreak = body.search(/[\r\n\u2028\u2029]/)
  const lastBreak = firstBreak < 0 ? -1 : lastLineBreak(body)
  for (const delimiter of body.matchAll(/:\s+/g)) {
    if (firstBreak >= 0 && delimiter.index > firstBreak) break
    const start = delimiter.index + delimiter[0].length
    if (start > lastBreak) {
      const text = body.slice(start).replace(/\s+/g, " ").trim()
      return keyOf(prefix[1] ?? "", body.slice(0, delimiter.index), text)
    }
  }
  return null
}
const ANSWER = /^\s*Answer:\s*(Taken|Kept|Ask)\s*·\s*(\S.*)$/i

/** The findings in the judge's record, in order, each once. */
export function findingsOf(log: BuildLog): Omit<SmallFinding, "answer">[] {
  const seen = new Set<string>()
  const found: Omit<SmallFinding, "answer">[] = []
  for (const round of log.verification)
    for (const v of round.verdicts) {
      if (v.verdict !== "FAIL" && v.verdict !== "MISSING" && v.verdict !== "NOTE") continue
      const point = `${v.kind} ${v.subject}`.trim()
      const text = v.text.replace(/\s+/g, " ").trim()
      const key = keyOf(v.verdict, point, text)
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ key, verdict: v.verdict, point, text })
    }
  return found
}

/** The answers already written in the list, by finding key. */
export function answersIn(markdown: string): Map<string, NonNullable<SmallFinding["answer"]>> {
  const answers = new Map<string, NonNullable<SmallFinding["answer"]>>()
  let key: string | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const header = headerKey(line)
    if (header !== null) {
      key = header
      continue
    }
    const answer = ANSWER.exec(line)
    if (answer !== null && key !== null) {
      const stance = (answer[1] ?? "").toLowerCase()
      if (stance === "taken" || stance === "kept")
        answers.set(key, { stance, text: (answer[2] ?? "").trim() })
    }
  }
  return answers
}

/** The list as text, with the answers already given. */
export function findingsText(
  findings: readonly Omit<SmallFinding, "answer">[],
  answers: ReadonlyMap<string, NonNullable<SmallFinding["answer"]>>,
): string {
  const body = findings.flatMap((f, i) => {
    const answer = answers.get(f.key)
    return [
      `${i + 1}. [${f.verdict}] ${f.point}: ${f.text}`,
      answer !== undefined
        ? `   Answer: ${answer.stance === "taken" ? "Taken" : "Kept"} · ${answer.text}`
        : "   Answer: ",
      "",
    ]
  })
  return `# Independent review: findings and their answers\n\nEach finding gets \`Answer: Taken · <what changed, the commit>\` or \`Answer: Kept · <why the code stays>\`. Review opens when every finding has one.\n\n${body.join("\n")}`
}

/**
 * The findings of the judge's record with their answers; the list is written (or written again, its
 * answers kept) so the session has something to answer under.
 */
export async function syncFindings(ctx: Ctx, task: Task, log: BuildLog): Promise<SmallFinding[]> {
  // A Trivial card needs no failing test: a note that says it has none is no finding.
  const found = findingsOf(await withoutExemptNotesLog(ctx, task, log))
  const path = smallFindingsPath(task)
  const existing = (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""
  const answers = answersIn(existing)
  if (found.length > 0) {
    const next = findingsText(found, answers)
    if (next !== existing) {
      await ctx.fs.mkdir(join(task.dir, "records"))
      await ctx.fs.writeFile(path, next)
    }
  }
  return found.map(
    (f) =>
      ({ ...f, ...(answers.has(f.key) ? { answer: answers.get(f.key) } : {}) }) as SmallFinding,
  )
}

/**
 * The answer written under a judge's finding in `records/independent-review.md`, with when the list
 * was last written. Review draws it beside the finding it answers; an Ask is no answer.
 */
export async function findingAnswers(
  ctx: Ctx,
  task: Pick<Task, "dir">,
): Promise<
  (v: {
    verdict: string
    kind: string
    subject: string
    text: string
  }) => (NonNullable<SmallFinding["answer"]> & { at: number }) | undefined
> {
  const path = smallFindingsPath(task)
  if (!(await ctx.fs.exists(path))) return () => undefined
  const answers = answersIn(await ctx.fs.readFile(path))
  const at = (await ctx.fs.stat?.(path))?.mtimeMs ?? ctx.clock.now()
  return (v) => {
    const found = answers.get(
      keyOf(v.verdict, `${v.kind} ${v.subject}`.trim(), v.text.replace(/\s+/g, " ").trim()),
    )
    return found === undefined ? undefined : { ...found, at }
  }
}

export const unanswered = (findings: readonly SmallFinding[]): SmallFinding[] =>
  findings.filter((f) => f.answer === undefined)
