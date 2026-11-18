import { dirname, join } from "node:path"
import type { Ctx } from "../ctx.ts"
import type { CheckRecord } from "./checks.ts"
import { agentFileOf, CHECKS_RECORD } from "./docs/names.ts"
import { sectionRanges } from "./docs/rules/types.ts"
import type { Task } from "./task/store.ts"

type CheckTask = Pick<Task, "runtimeDir">
type RecordTask = Pick<Task, "dir" | "repoRoot" | "runtimeDir" | "earlier">

export const recordsPath = (task: CheckTask) => join(task.runtimeDir, "checks.json")

export const REFUSED_CHECK = "not run by QualityLayer: changed after approval"

export async function readCheckRecords(ctx: Ctx, task: CheckTask): Promise<CheckRecord[]> {
  try {
    const value: unknown = JSON.parse(await ctx.fs.readFile(recordsPath(task)))
    return Array.isArray(value) ? (value as CheckRecord[]) : []
  } catch {
    return []
  }
}

/** The display payload and structured results commit together, in the existing array format. */
export async function saveCheckReceipt(
  ctx: Ctx,
  task: CheckTask,
  check: string,
  results: CheckRecord[],
  lines: string[],
): Promise<void> {
  const last = results.at(-1)
  if (last === undefined) return
  const path = recordsPath(task)
  await ctx.fs.withLock(`${path}.lock`, async () => {
    const current = await readCheckRecords(ctx, task)
    if (current.some((record) => record.check === check && record.display?.version === 1)) return
    const display = { version: 1 as const, lines }
    const receipt = [...results.slice(0, -1), { ...last, display }]
    await ctx.fs.atomicWrite(path, `${JSON.stringify([...current, ...receipt], null, 2)}\n`)
  })
}

function displayLines(records: readonly CheckRecord[]): string[] {
  const rows = records.flatMap((record) =>
    record.display?.version === 1 ? record.display.lines : [],
  )
  const refusals = new Set<string>()
  return rows.filter((row) => {
    if (!row.endsWith(` · ${REFUSED_CHECK}`)) return true
    if (refusals.has(row)) return false
    refusals.add(row)
    return true
  })
}

export async function hasChecksRecord(ctx: Ctx, task: Pick<RecordTask, "runtimeDir" | "earlier">) {
  return !task.earlier && (await readCheckRecords(ctx, task)).some((r) => r.display?.version === 1)
}

/** Only the legacy section is displayed. Its original file and the receipt's verdicts are untouched. */
async function earlierChecks(ctx: Ctx, task: RecordTask): Promise<string> {
  const fs = ctx.fs.forPublication?.(task.repoRoot, task.dir) ?? ctx.fs
  const source = join(task.dir, agentFileOf("implement"))
  if (!(await fs.exists(source))) return ""
  const markdown = await fs.readFile(source)
  const section = sectionRanges(markdown).find((range) => range.heading === "Checks")
  return section === undefined
    ? ""
    : markdown
        .split(/(?<=\n)/)
        .slice(section.start, section.end - 1)
        .join("")
        .replace(/^(?:[ \t]*\r?\n)+/, "")
}

export async function checksMarkdown(ctx: Ctx, task: RecordTask): Promise<string | null> {
  if (task.earlier) return null
  const lines = displayLines(await readCheckRecords(ctx, task))
  if (lines.length === 0) return null
  const earlier = await earlierChecks(ctx, task)
  return `# Checks\n\n${lines.join("\n")}\n${earlier.trim() === "" ? "" : `\n## Earlier checks\n\n${earlier}`}`
}

/** Rebuild the external file from the latest committed receipt, with no new check execution. */
export async function materializeChecksRecord(ctx: Ctx, task: RecordTask): Promise<string | null> {
  const markdown = await checksMarkdown(ctx, task)
  if (markdown === null) return null
  const path = join(task.dir, CHECKS_RECORD)
  const fs = ctx.fs.forPublication?.(task.repoRoot, task.dir) ?? ctx.fs
  const current = async () => ((await fs.exists(path)) ? await fs.readFile(path) : null)
  // Ordinary Reader opens must be read-only. A lock directory itself wakes the file watcher.
  if ((await current()) === markdown) return markdown
  return ctx.fs.withLock(`${recordsPath(task)}.lock`, async () => {
    const latest = await checksMarkdown(ctx, task)
    if (latest === null) return null
    if ((await current()) === latest) return latest
    await ctx.fs.mkdir(dirname(path))
    await ctx.fs.atomicWrite(path, latest, { followSymlink: false })
    return latest
  })
}
