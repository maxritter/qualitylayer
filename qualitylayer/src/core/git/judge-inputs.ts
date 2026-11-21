import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { readmeFrontmatter, type Task } from "../task/store.ts"
import { COMMIT_ALIAS_HINT } from "./build-start.ts"
import { duplicateReceipts, duplicateReceiptsText } from "./commit-receipts.ts"
import { requireOwnedTreeCurrent } from "./owned-tree.ts"

export type JudgeInputs = { commit: string; tree: string; commits: string[] }
const full = /^[a-f0-9]{40,64}$/
export class RecordedHistoryRewritten extends Error {
  constructor(
    readonly head: string,
    readonly branch: string,
    readonly before: string,
    readonly after: string,
  ) {
    super(
      "Recorded task history was rewritten on its recorded branch; a fresh full working-tree judgement is required",
    )
  }
}
function requireInput(
  value: unknown,
  message = "The judge's task commit/input authority is missing or invalid",
): asserts value {
  if (!value) throw Error(message)
}
/** The refusal for receipts that history cannot explain, naming a repeated entry when there is one. */
async function unexplained(
  ctx: Ctx,
  task: Task,
  commits: string[],
  affected = commits,
): Promise<never> {
  const { duplicates } = await duplicateReceipts(ctx, task, commits)
  if (duplicates.length > 0)
    throw new Error(
      `The judge's task commit/input authority is invalid. ${duplicateReceiptsText(duplicates, false)}`,
    )
  throw new Error(
    `The judge's task commit/input authority cannot reconcile recorded commits ${affected
      .slice(0, 8)
      .map((sha) => sha.slice(0, 12))
      .join(", ")} with the recorded branch's rewrite history. No receipt or commit was changed.`,
  )
}
async function run(ctx: Ctx, task: Task, args: string[]) {
  const result = await ctx.git.run(task.repoRoot, args)
  requireInput(result.code === 0 && Buffer.byteLength(result.stdout) <= 2 * 1024 * 1024)
  return result.stdout.trimEnd()
}
/** A replacement series can already contain the new receipt when the recorded branch moves to its tip. */
async function sameSingleParent(ctx: Ctx, task: Task, before: string, after: string) {
  const rows = await run(ctx, task, [
    "show",
    "--no-patch",
    "--no-walk=unsorted",
    "--format=%P",
    before,
    after,
  ])
  const [oldParent, newParent] = rows.split("\n")
  return oldParent !== undefined && full.test(oldParent) && oldParent === newParent
}
export async function judgeInputs(ctx: Ctx, task: Task): Promise<JudgeInputs | null> {
  const path = join(task.runtimeDir, "slice-commits.json")
  await ctx.fs.assertSafeDirectory?.(task.runtimeDir)
  const info = await ctx.fs.lstat?.(path)
  requireInput(!info || info.kind === "file")
  if (!info && !(await ctx.fs.exists(path))) return null
  requireInput(((await ctx.fs.stat?.(path))?.size ?? 0) <= 64 * 1024)
  const text = await ctx.fs.readFile(path)
  requireInput(Buffer.byteLength(text) <= 64 * 1024)
  const saved: unknown = JSON.parse(text)
  requireInput(Array.isArray(saved) && saved.length > 0 && saved.length <= 512)
  const commits: string[] = []
  for (const sha of saved) {
    requireInput(typeof sha === "string" && /^[a-f0-9]{7,64}$/.test(sha))
    const commit = await run(ctx, task, ["rev-parse", "--verify", `${sha}^{commit}`])
    requireInput(full.test(commit))
    if (commits.includes(commit)) throw new Error(COMMIT_ALIAS_HINT)
    commits.push(commit)
  }
  const head = await run(ctx, task, ["rev-parse", "--verify", "HEAD^{commit}"])
  requireInput(full.test(head))
  const ancestry = new Map<string, Promise<boolean>>()
  const ancestor = (before: string, after: string) => {
    const key = `${before}:${after}`
    let known = ancestry.get(key)
    if (!known) {
      requireInput(ancestry.size < 2048)
      known = ctx.git
        .run(task.repoRoot, ["merge-base", "--is-ancestor", before, after])
        .then((result) => {
          requireInput(result.code === 0 || result.code === 1)
          return result.code === 0
        })
      ancestry.set(key, known)
    }
    return known
  }
  const stale: string[] = []
  const crossings: { before: string; after: string }[] = []
  let registeredOutOfOrder = false
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i] as string
    const current = await ancestor(commit, head)
    if (!current) stale.push(commit)
    const previous = commits[i - 1]
    if (previous && !(await ancestor(previous, commit))) {
      if (await ancestor(commit, previous)) registeredOutOfOrder = true
      else crossings.push({ before: previous, after: commit })
    }
  }
  if (stale.length === 0 && crossings.length === 0 && registeredOutOfOrder)
    await unexplained(ctx, task, commits)
  if (stale.length > 0 || crossings.length > 0) {
    const fm = await readmeFrontmatter(ctx, task)
    requireInput(
      typeof fm.base === "string" &&
        /^[a-f0-9]{7,64}$/.test(fm.base) &&
        typeof fm.branch === "string" &&
        fm.branch.length > 0 &&
        fm.branch.length <= 256,
    )
    const base = await run(ctx, task, ["rev-parse", "--verify", `${fm.base}^{commit}`])
    requireInput(full.test(base) && !commits.includes(base))
    await run(ctx, task, ["check-ref-format", `refs/heads/${fm.branch}`])
    const branch = await run(ctx, task, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    requireInput(
      branch === fm.branch,
      `The task records branch ${JSON.stringify(fm.branch)}. The current checkout is on ${JSON.stringify(branch.slice(0, 256))}. A history rewrite must be proved on the recorded branch.`,
    )
    const text = await run(ctx, task, [
      "reflog",
      "show",
      "--max-count=129",
      "--format=%H%x00%gs",
      `refs/heads/${fm.branch}`,
    ])
    const rows = text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("\0")
        const commit = line.slice(0, at),
          message = line.slice(at + 1)
        requireInput(at > 0 && full.test(commit) && message.length <= 4096)
        return { commit, message }
      })
    let inspected = 0
    const rewrites: { before: string; current: string }[] = []
    for (let i = 0; i + 1 < rows.length; i++) {
      const row = rows[i],
        previous = rows[i + 1]
      if (
        !row ||
        !previous ||
        !/^(?:rebase \(finish\):|commit \(amend\):|reset: moving to )/.test(row.message)
      )
        continue
      requireInput(++inspected <= 32)
      let current: string | undefined
      if (await ancestor(row.commit, head)) current = row.commit
      else
        for (const rewrite of rewrites)
          if (await ancestor(row.commit, rewrite.before)) {
            current = rewrite.current
            break
          }
      if (current === undefined) continue
      // Intermediate rewrite targets may themselves have been amended. Keep only a connected
      // path back from a current anchor; the original base/stale/crossing proof still follows.
      rewrites.push({ before: previous.commit, current })
      if (!(await ancestor(base, previous.commit))) continue
      let proven = true
      for (const commit of stale) {
        if (
          !(await ancestor(base, commit)) ||
          !(await ancestor(commit, previous.commit)) ||
          (await ancestor(commit, current))
        ) {
          proven = false
          break
        }
      }
      for (const crossing of crossings) {
        if (
          stale.includes(crossing.after) &&
          !stale.includes(crossing.before) &&
          (await ancestor(current, crossing.before))
        )
          continue
        if (
          stale.includes(crossing.before) &&
          (await ancestor(crossing.after, current)) &&
          !(await ancestor(crossing.after, previous.commit)) &&
          (await sameSingleParent(ctx, task, crossing.before, crossing.after))
        )
          continue
        if (
          !(await ancestor(crossing.before, previous.commit)) ||
          (await ancestor(crossing.before, current)) ||
          !(await ancestor(current, crossing.after))
        ) {
          proven = false
          break
        }
      }
      if (proven) throw new RecordedHistoryRewritten(head, fm.branch, previous.commit, current)
    }
    await unexplained(ctx, task, commits, [
      ...new Set([...stale, ...crossings.flatMap(({ before, after }) => [before, after])]),
    ])
  }
  const commit = head
  await requireOwnedTreeCurrent(ctx, task, commits)
  const tree = await run(ctx, task, ["rev-parse", "--verify", `${commit}^{tree}`])
  requireInput(full.test(tree))
  return { commit, tree, commits }
}
