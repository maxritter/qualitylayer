import { realpath } from "node:fs/promises"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { worktrees } from "./repo.ts"

export const commitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
export const physical = async (path: string | null) =>
  path ? realpath(path).catch(() => null) : null

async function git(ctx: Ctx, root: string, args: string[]) {
  const result = await ctx.git.run(root, args, { fresh: true })
  if (result.code !== 0) throw new Error("The candidate worktree could not be read.")
  return result.stdout
}
async function checkoutHead(ctx: Ctx, root: string) {
  const data = await git(ctx, root, ["show", "-s", "--format=%H%x00%s", "HEAD"])
  const [head, subject] = data.trimEnd().split("\0")
  if (!head || !commitId.test(head)) throw new Error("This worktree has no reviewable commit.")
  return { head, subject: subject?.slice(0, 300) ?? "" }
}
export async function requireCleanReviewWorktree(ctx: Ctx, root: string) {
  const status = await git(ctx, root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)docs/plans/**",
  ])
  // An explicit commit selection may never silently include an unfinished or untracked code edit.
  // Task records are local evidence and live beside the work; they do not change the chosen commit.
  if (status.length > 0)
    throw new Error("Commit or put aside uncommitted changes in this worktree before choosing it.")
}
export async function staleCount(
  ctx: Ctx,
  root: string,
  receipts: readonly string[],
): Promise<number | undefined> {
  if (receipts.length === 0) return 0
  if (receipts.length > 512 || receipts.some((sha) => !/^[a-f0-9]{7,64}$/.test(sha)))
    return undefined
  const head = await ctx.git.run(root, ["rev-parse", "--verify", "HEAD"])
  if (head.code !== 0 || !commitId.test(head.stdout.trim())) return undefined
  // One ancestry-only query on the normal path. Enumerate stale receipts only for recovery.
  const count = await ctx.git.run(root, [
    "merge-base",
    "--independent",
    head.stdout.trim(),
    ...receipts,
  ])
  if (count.code !== 0) return undefined
  return count.stdout.trim() === head.stdout.trim()
    ? 0
    : countOffHistory(ctx, root, head.stdout.trim(), receipts)
}

async function countOffHistory(ctx: Ctx, root: string, head: string, receipts: readonly string[]) {
  let stale = 0
  for (const receipt of new Set(receipts)) {
    const result = await ctx.git.run(root, ["merge-base", "--is-ancestor", receipt, head])
    if (result.code !== 0 && result.code !== 1) return undefined
    if (result.code === 1) stale++
  }
  return stale
}
export async function readReviewWorktree(ctx: Ctx, root: string) {
  const [checkout, common, found, current] = await Promise.all([
    ctx.git.topLevel(root).then(physical),
    ctx.git.commonDir(root).then(physical),
    checkoutHead(ctx, root),
    git(ctx, root, ["branch", "--show-current"]),
  ])
  return { checkout: checkout ?? "", common, ...found, branch: current.trim() || null }
}

export async function choicesFor(ctx: Ctx, task: Task, common: string, branch: string | undefined) {
  const roots = await worktrees(ctx, task.repoRoot)
  const choices = await Promise.all(
    roots.slice(0, 32).map(async ({ path, branch: named }) => {
      try {
        const expected = await physical(path)
        if (!expected) return null
        const { common: repository, ...found } = await readReviewWorktree(ctx, expected)
        if (found.checkout !== expected || repository !== common || found.branch !== named)
          return null
        await requireCleanReviewWorktree(ctx, expected)
        return { ...found, shared: named === null || named !== branch }
      } catch {
        return null
      }
    }),
  )
  return choices.filter((choice) => choice !== null)
}
