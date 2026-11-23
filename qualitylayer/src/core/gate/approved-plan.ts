// A copy of the Plan as the person approved it, kept in the task's runtime folder beside the
// baseline. QualityLayer holds no other copy: when a later edit moves what the person approved, an
// agent needs these lines to put the passages back.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { folderDoc } from "../docs/names.ts"
import type { Task } from "../task/store.ts"

const copyPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "plan-approved.md")

/** The text of the Plan now, as the approval keeps it. */
export async function keepApprovedPlan(ctx: Ctx, task: Task): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  const path = join(task.dir, folderDoc("plan"))
  if (await ctx.fs.exists(path))
    await ctx.fs.atomicWrite(copyPath(task), await ctx.fs.readFile(path))
}

/** The Plan as it was approved, without its front matter; null when no copy was kept. */
export async function readApprovedPlan(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<string | null> {
  const path = copyPath(task)
  return (await ctx.fs.exists(path)) ? parseDoc(await ctx.fs.readFile(path)).body : null
}

/** Over this many lines on a side the diff compares line sets instead of aligning the lines. */
const ALIGN_LIMIT = 1500

/** Trim identical leading and trailing lines and return the differing middles. */
function trimCommonBounds(a: string[], b: string[]): [string[], string[]] {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++
  return [a.slice(head, a.length - tail), b.slice(head, b.length - tail)]
}

function diffLineSets(x: string[], y: string[]): string[] {
  const inY = new Set(y)
  const inX = new Set(x)
  const out: string[] = []
  for (const line of x) if (!inY.has(line)) out.push(`- ${line}`)
  for (const line of y) if (!inX.has(line)) out.push(`+ ${line}`)
  return out
}

function buildLcsTable(x: string[], y: string[]): Uint32Array {
  const width = y.length + 1
  const lcs = new Uint32Array((x.length + 1) * width)
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        x[i] === y[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0)
    }
  }
  return lcs
}

function diffLcs(x: string[], y: string[]): string[] {
  const width = y.length + 1
  const lcs = buildLcsTable(x, y)
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      i++
      j++
    } else if (
      j >= y.length ||
      (i < x.length && (lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0))
    ) {
      out.push(`- ${x[i]}`)
      i++
    } else {
      out.push(`+ ${y[j]}`)
      j++
    }
  }
  return out
}

/**
 * The changed lines from `before` to `after`, in document order: `- ` for a line that went, `+ ` for
 * one that came. Lines are compared without trailing space; blank lines are not changes worth showing.
 */
export function changedLines(before: string, after: string): string[] {
  const a = before.split(/\r?\n/).map((l) => l.trimEnd())
  const b = after.split(/\r?\n/).map((l) => l.trimEnd())
  const [x, y] = trimCommonBounds(a, b)
  const out = x.length > ALIGN_LIMIT || y.length > ALIGN_LIMIT ? diffLineSets(x, y) : diffLcs(x, y)
  return out.filter((line) => line.slice(2).trim() !== "")
}
