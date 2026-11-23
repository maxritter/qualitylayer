import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { COMMIT_ALIAS_HINT } from "./build-start.ts"
import { duplicateReceipts, duplicateReceiptsText } from "./commit-receipts.ts"
import {
  type AncestorCheck,
  type Crossing,
  FULL_SHA,
  proveHistoryRewrite,
  RecordedHistoryRewritten,
  requireJudgeInput,
  runJudgeGit,
} from "./judge-rewrite.ts"
import { requireOwnedTreeCurrent } from "./owned-tree.ts"

export { RecordedHistoryRewritten }
export type JudgeInputs = { commit: string; tree: string; commits: string[] }

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

async function readSavedCommits(ctx: Ctx, task: Task): Promise<string[] | null> {
  const path = join(task.runtimeDir, "slice-commits.json")
  await ctx.fs.assertSafeDirectory?.(task.runtimeDir)
  const info = await ctx.fs.lstat?.(path)
  requireJudgeInput(!info || info.kind === "file")
  if (!info && !(await ctx.fs.exists(path))) return null
  requireJudgeInput(((await ctx.fs.stat?.(path))?.size ?? 0) <= 64 * 1024)
  const text = await ctx.fs.readFile(path)
  requireJudgeInput(Buffer.byteLength(text) <= 64 * 1024)
  const saved: unknown = JSON.parse(text)
  requireJudgeInput(Array.isArray(saved) && saved.length > 0 && saved.length <= 512)
  const commits: string[] = []
  for (const sha of saved) {
    requireJudgeInput(typeof sha === "string" && /^[a-f0-9]{7,64}$/.test(sha))
    const commit = await runJudgeGit(ctx, task, ["rev-parse", "--verify", `${sha}^{commit}`])
    requireJudgeInput(FULL_SHA.test(commit))
    if (commits.includes(commit)) throw new Error(COMMIT_ALIAS_HINT)
    commits.push(commit)
  }
  return commits
}

function makeAncestorCheck(ctx: Ctx, repoRoot: string): AncestorCheck {
  const ancestry = new Map<string, Promise<boolean>>()
  return (before: string, after: string) => {
    const key = `${before}:${after}`
    let known = ancestry.get(key)
    if (!known) {
      requireJudgeInput(ancestry.size < 2048)
      known = ctx.git
        .run(repoRoot, ["merge-base", "--is-ancestor", before, after])
        .then((result) => {
          requireJudgeInput(result.code === 0 || result.code === 1)
          return result.code === 0
        })
      ancestry.set(key, known)
    }
    return known
  }
}

async function inspectCommitOrder(commits: string[], head: string, ancestor: AncestorCheck) {
  const stale: string[] = []
  const crossings: Crossing[] = []
  let registeredOutOfOrder = false
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i] as string
    if (!(await ancestor(commit, head))) stale.push(commit)
    const previous = commits[i - 1]
    if (previous && !(await ancestor(previous, commit))) {
      if (await ancestor(commit, previous)) registeredOutOfOrder = true
      else crossings.push({ before: previous, after: commit })
    }
  }
  return { stale, crossings, registeredOutOfOrder }
}

export async function judgeInputs(ctx: Ctx, task: Task): Promise<JudgeInputs | null> {
  const commits = await readSavedCommits(ctx, task)
  if (commits === null) return null
  const head = await runJudgeGit(ctx, task, ["rev-parse", "--verify", "HEAD^{commit}"])
  requireJudgeInput(FULL_SHA.test(head))
  const ancestor = makeAncestorCheck(ctx, task.repoRoot)
  const { stale, crossings, registeredOutOfOrder } = await inspectCommitOrder(
    commits,
    head,
    ancestor,
  )
  if (stale.length === 0 && crossings.length === 0 && registeredOutOfOrder)
    await unexplained(ctx, task, commits)
  if (stale.length > 0 || crossings.length > 0) {
    await proveHistoryRewrite(ctx, task, { commits, head, stale, crossings, ancestor })
    await unexplained(ctx, task, commits, [
      ...new Set([...stale, ...crossings.flatMap(({ before, after }) => [before, after])]),
    ])
  }
  await requireOwnedTreeCurrent(ctx, task, commits)
  const tree = await runJudgeGit(ctx, task, ["rev-parse", "--verify", `${head}^{tree}`])
  requireJudgeInput(FULL_SHA.test(tree))
  return { commit: head, tree, commits }
}
