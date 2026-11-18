import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { sliceCommits } from "./build-start.ts"

export type TaskCommitDiff = {
  commits: string[]
  files: string[]
  command: string
  staleCommits?: string[]
  unavailableCommits?: string[]
  historical?: true
}
export class TaskReviewHistoryError extends Error {
  constructor(commits: readonly string[]) {
    const names = commits
      .slice(0, 8)
      .map((sha) => sha.slice(0, 12))
      .join(", ")
    super(
      `Task review ${commits.length === 1 ? "commit" : "commits"} ${names} ${commits.length === 1 ? "is" : "are"} not on the candidate's history. ` +
        "Inspect the rewritten commits. Register exclusive slice replacements with qualitylayer commit slice <n> --commit <fullsha>; retain shared receipts that cannot safely be replaced. For a proven rewrite, qualitylayer verify judge can assign a fresh full-working-tree review without committed-source ownership. Earlier verification remains historical.",
    )
  }
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
export const taskDiffArgs = (commits: readonly string[], files?: readonly string[]) => [
  "show",
  "--format=fuller",
  "--first-parent",
  "--patch",
  "--textconv",
  "--no-ext-diff",
  ...commits,
  "--",
  ...(files ? files.map((file) => `:(literal)${file}`) : [".", ":(exclude)docs/plans/**"]),
]
const kept = new Map<string, TaskCommitDiff>()

type TaskCommitOptions = { since?: string; until?: string; history?: "report" | "browse" }

async function resolveCommit(ctx: Ctx, root: string, ref: string, fresh: boolean) {
  const result = await ctx.git.run(
    root,
    ["rev-parse", "--verify", `${ref}^{commit}`],
    fresh ? { fresh: true } : undefined,
  )
  const commit = result.stdout.trim()
  return result.code === 0 && /^[a-f0-9]{40,64}$/.test(commit) ? commit : null
}

async function classifyCommits(
  ctx: Ctx,
  root: string,
  recorded: string[],
  head: string,
  options: TaskCommitOptions,
) {
  const browse = options.history === "browse"
  const commits: string[] = []
  const stale = new Set<string>()
  const unavailable = new Set<string>()
  let hasCurrent = false
  for (const sha of recorded) {
    const commit = await resolveCommit(ctx, root, sha, browse)
    if (commit === null) {
      if (!browse) throw new Error(`Task review commit ${sha} is unavailable`)
      unavailable.add(sha)
      continue
    }
    const ancestor = await ctx.git.run(root, ["merge-base", "--is-ancestor", commit, head])
    if (ancestor.code !== 0) {
      if (options.until && ancestor.code === 1) continue
      if (ancestor.code !== 1) throw new Error(`Task review cannot inspect commit ${sha}`)
      if (options.history === undefined) throw new TaskReviewHistoryError([commit])
      stale.add(commit)
      continue
    }
    hasCurrent = true
    if (options.since) {
      const earlier = await ctx.git.run(root, [
        "merge-base",
        "--is-ancestor",
        commit,
        options.since,
      ])
      if (earlier.code === 0) continue
      if (earlier.code !== 1) throw new Error("Task review's earlier boundary is unavailable")
    }
    commits.push(commit)
  }
  return { commits, stale, unavailable, hasCurrent }
}

async function inventoryCommits(ctx: Ctx, root: string, commits: string[], browse: boolean) {
  const readable: string[] = []
  const files = new Set<string>()
  const unavailable: string[] = []
  for (const sha of commits) {
    const listed = await ctx.git.run(root, [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-only",
      "--first-parent",
      "-r",
      "-z",
      sha,
    ])
    if (listed.code !== 0) {
      if (!browse) throw new Error(`Task review cannot inventory commit ${sha}`)
      unavailable.push(sha)
      continue
    }
    readable.push(sha)
    for (const file of listed.stdout.split("\0"))
      if (file && !file.startsWith("docs/plans/")) files.add(file)
    if (files.size > 4096) throw new Error("Task review exceeds its file inventory cap")
  }
  return { readable, files, unavailable }
}

/** Each registered commit contributes its own patch; interleaved changes in the same file stay context. */
export async function taskCommitDiff(
  ctx: Ctx,
  task: Task,
  options: TaskCommitOptions = {},
): Promise<TaskCommitDiff | null> {
  const recorded = [...new Set(await sliceCommits(ctx, task))]
  if (!recorded.length) return null
  if (
    [options.since, options.until].some((sha) => sha !== undefined && !/^[a-f0-9]{7,64}$/.test(sha))
  )
    throw new Error("Task review has an invalid revision boundary")
  if (recorded.length > 512 || recorded.some((sha) => !/^[a-f0-9]{7,64}$/.test(sha)))
    throw new Error(
      "Task review has invalid commit receipts; reconcile them before reviewing the patch",
    )
  const browse = options.history === "browse"
  const head = await resolveCommit(ctx, task.repoRoot, options.until ?? "HEAD", browse)
  if (head === null) throw new Error("Task review candidate is unavailable")
  const key = JSON.stringify([task.repoRoot, head, options.since, options.history, recorded])
  const cached = kept.get(key)
  if (cached) return cached
  const { commits, stale, unavailable, hasCurrent } = await classifyCommits(
    ctx,
    task.repoRoot,
    recorded,
    head,
    options,
  )
  const historical = !hasCurrent && stale.size > 0
  if (historical && !browse) throw new TaskReviewHistoryError([...stale])
  const inventory = await inventoryCommits(
    ctx,
    task.repoRoot,
    historical ? [...stale] : commits,
    browse,
  )
  const { readable, files } = inventory
  for (const sha of inventory.unavailable) unavailable.add(sha)
  const result = {
    commits: readable,
    ...(stale.size > 0 ? { staleCommits: [...stale] } : {}),
    ...(unavailable.size > 0 ? { unavailableCommits: [...unavailable] } : {}),
    ...(historical && readable.length > 0 ? { historical: true as const } : {}),
    files: [...files].sort(),
    command: readable.length
      ? `git ${taskDiffArgs(readable).map(quote).join(" ")}`
      : "No registered task patch changed after the recorded review boundary.",
  }
  // A rewritten or missing object may become available, or be pruned, without moving HEAD.
  if (!browse || (!stale.size && !unavailable.size)) {
    if (kept.size >= 16) kept.clear()
    kept.set(key, result)
  }
  return result
}
