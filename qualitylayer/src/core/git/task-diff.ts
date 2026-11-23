import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { sliceCommits } from "./build-start.ts"
import {
  classifyCommits,
  inventoryCommits,
  resolveCommit,
  type TaskCommitOptions,
  TaskReviewHistoryError,
} from "./task-diff-commits.ts"

export { TaskReviewHistoryError } from "./task-diff-commits.ts"

export type TaskCommitDiff = {
  commits: string[]
  files: string[]
  command: string
  staleCommits?: string[]
  unavailableCommits?: string[]
  historical?: true
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

const isShortOrFullSha = (sha: string) => /^[a-f0-9]{7,64}$/.test(sha)

function validateDiffInputs(recorded: string[], options: TaskCommitOptions) {
  if ([options.since, options.until].some((sha) => sha !== undefined && !isShortOrFullSha(sha)))
    throw new Error("Task review has an invalid revision boundary")
  if (recorded.length > 512 || recorded.some((sha) => !isShortOrFullSha(sha)))
    throw new Error(
      "Task review has invalid commit receipts; reconcile them before reviewing the patch",
    )
}

function buildDiffResult(
  readable: string[],
  files: Set<string>,
  stale: Set<string>,
  unavailable: Set<string>,
  historical: boolean,
): TaskCommitDiff {
  return {
    commits: readable,
    ...(stale.size > 0 ? { staleCommits: [...stale] } : {}),
    ...(unavailable.size > 0 ? { unavailableCommits: [...unavailable] } : {}),
    ...(historical && readable.length > 0 ? { historical: true as const } : {}),
    files: [...files].sort(),
    command: readable.length
      ? `git ${taskDiffArgs(readable).map(quote).join(" ")}`
      : "No registered task patch changed after the recorded review boundary.",
  }
}

/** Each registered commit contributes its own patch; interleaved changes in the same file stay context. */
export async function taskCommitDiff(
  ctx: Ctx,
  task: Task,
  options: TaskCommitOptions = {},
): Promise<TaskCommitDiff | null> {
  const recorded = [...new Set(await sliceCommits(ctx, task))]
  if (!recorded.length) return null
  validateDiffInputs(recorded, options)
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
  for (const sha of inventory.unavailable) unavailable.add(sha)
  const result = buildDiffResult(
    inventory.readable,
    inventory.files,
    stale,
    unavailable,
    historical,
  )
  // A rewritten or missing object may become available, or be pruned, without moving HEAD.
  if (!browse || (!stale.size && !unavailable.size)) {
    if (kept.size >= 16) kept.clear()
    kept.set(key, result)
  }
  return result
}
