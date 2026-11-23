// "Show the Plan's diff": what the agent changed since the person last reviewed the Plan. When
// the person sends changes, the Plan as they saw it is kept (plan-reviewed.md in the task's
// runtime folder); the next revision is read against it as a line diff. Nothing here is a gate:
// it only says what moved.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { type Task, taskDocPath } from "../task/store.ts"

const snapshotPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "plan-reviewed.md")

/** Keep the Plan as it stands: the person is about to send changes against it. */
export async function snapshotPlan(
  ctx: Ctx,
  task: Pick<Task, "dir" | "runtimeDir">,
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  const path = taskDocPath(task, "plan")
  if (await ctx.fs.exists(path))
    await ctx.fs.atomicWrite(snapshotPath(task), await ctx.fs.readFile(path))
}

type Op = { op: " " | "+" | "-"; line: string }

function commonBounds(before: string[], after: string[]): { head: number; tail: number } {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
  return { head, tail }
}

function lcsOps(a: string[], b: string[]): Op[] {
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ op: " ", line: a[i] ?? "" })
      i++
      j++
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push({ op: "-", line: a[i] ?? "" })
      i++
    } else {
      ops.push({ op: "+", line: b[j] ?? "" })
      j++
    }
  }
  for (; i < a.length; i++) ops.push({ op: "-", line: a[i] ?? "" })
  for (; j < b.length; j++) ops.push({ op: "+", line: b[j] ?? "" })
  return ops
}

/** A line diff: the common head and tail are trimmed, the middle is a longest-common-subsequence walk. */
export function lineOps(before: string[], after: string[]): Op[] {
  const { head, tail } = commonBounds(before, after)
  const a = before.slice(head, before.length - tail)
  const b = after.slice(head, after.length - tail)
  const ops: Op[] = before.slice(0, head).map((line) => ({ op: " ", line }))
  // A very large rewrite is shown as removed then added, not diffed line by line.
  if (a.length * b.length > 4_000_000) {
    ops.push(
      ...a.map((line): Op => ({ op: "-", line })),
      ...b.map((line): Op => ({ op: "+", line })),
    )
  } else {
    ops.push(...lcsOps(a, b))
  }
  ops.push(...after.slice(after.length - tail).map((line): Op => ({ op: " ", line })))
  return ops
}

/** The changed lines with `context` lines around each change, `…` between the groups. */
export function showDiff(ops: Op[], context = 2): string {
  const near = ops.map(() => false)
  ops.forEach((o, at) => {
    if (o.op === " ") return
    for (let k = Math.max(0, at - context); k <= Math.min(ops.length - 1, at + context); k++)
      near[k] = true
  })
  const out: string[] = []
  let gap = false
  ops.forEach((o, index) => {
    if (!near[index]) {
      gap = out.length > 0
      return
    }
    if (gap) out.push("…")
    gap = false
    out.push(`${o.op}${o.line}`)
  })
  return out.join("\n")
}

/**
 * What changed in the Plan since the person last sent changes on it, as diff lines (`+`, `-`,
 * and a space for context); null when nothing was sent yet or nothing changed.
 */
export async function planChanges(
  ctx: Ctx,
  task: Pick<Task, "dir" | "runtimeDir">,
): Promise<string | null> {
  const then = snapshotPath(task)
  const now = taskDocPath(task, "plan")
  if (!(await ctx.fs.exists(then)) || !(await ctx.fs.exists(now))) return null
  const before = (await ctx.fs.readFile(then)).split(/\r?\n/)
  const after = (await ctx.fs.readFile(now)).split(/\r?\n/)
  const ops = lineOps(before, after)
  if (!ops.some((o) => o.op !== " ")) return null
  return showDiff(ops)
}
