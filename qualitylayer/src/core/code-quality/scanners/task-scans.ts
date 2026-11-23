// A task's security scans: the files its build changed since the build began (its own records left
// out: they are redacted, not scanned), scanned once beside the project checks. The result is kept in
// the task's runtime folder for the Verify page and written as lines under `## Checks`.

import { join, relative } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import { taskCommitDiff } from "../../git/task-diff.ts"
import { type WorkflowProjection, workflowChanges } from "../../git/workflow-changes.ts"
import type { Task } from "../../task/store.ts"
import { type ScanResult, scanChanges } from "./scan.ts"
import { scanSettings } from "./settings.ts"

export { agentControlChanges, keptAgentControls } from "./task-scan-controls.ts"

export type TaskScans = { at: number; head: string; results: ScanResult[]; candidate?: string }

const recordPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "scans.json")

export type BuildChanges = { paths: string[]; owned: WorkflowProjection }

/** The same owned commits and recorded edits as Files; untracked files remain outside Verify scans. */
export async function changedByBuild(ctx: Ctx, task: Task): Promise<BuildChanges> {
  const committed = await taskCommitDiff(ctx, task)
  const owned = await workflowChanges(ctx, task, { metadata: true, current: false })
  const working = await ctx.git.run(task.repoRoot, ["diff", "--name-only", "-z", "HEAD", "--"])
  const tracked = new Set(working.code === 0 ? working.stdout.split("\0") : [])
  const recorded = owned.workingFiles.filter((path) => tracked.has(path))
  const own = relative(task.repoRoot, task.dir).replaceAll("\\", "/")
  return {
    paths: [...new Set([...(committed?.files ?? []), ...recorded])].filter(
      (path) => path !== "" && (own === "" || !path.startsWith(`${own}/`)),
    ),
    owned,
  }
}

/** Scans what the task changed and keeps the record; never throws, never fails the checks. */
export async function runTaskScans(ctx: Ctx, task: Task): Promise<TaskScans | null> {
  try {
    const settings = await scanSettings(ctx)
    const head = (await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])).stdout.trim()
    const changed = await changedByBuild(ctx, task)
    const results = await scanChanges(ctx, task.repoRoot, changed.paths, {
      advisories: settings.advisories,
      off: !settings.enabled,
    })
    const record: TaskScans = { at: ctx.clock.now(), head, results }
    await ctx.fs.mkdir(task.runtimeDir)
    await ctx.fs.atomicWrite(recordPath(task), `${JSON.stringify(record, null, 2)}\n`)
    return record
  } catch {
    return null
  }
}

/** The last scans of the task, or null before any ran. */
export async function readTaskScans(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<TaskScans | null> {
  try {
    const value = JSON.parse(await ctx.fs.readFile(recordPath(task))) as TaskScans
    return Array.isArray(value.results) ? value : null
  } catch {
    return null
  }
}

/** A selected commit is reviewed in full and never replaces the previous task-slice scans. */
export async function candidateScans(
  ctx: Ctx,
  task: Task,
  candidate: { id: string; head: string },
): Promise<TaskScans> {
  const path = join(task.runtimeDir, `review-candidate-${candidate.id}-scans.json`)
  if (await ctx.fs.exists(path)) {
    const previous = JSON.parse(await ctx.fs.readFile(path)) as TaskScans
    if (previous.candidate === candidate.id && previous.head === candidate.head) return previous
    throw new Error("The saved candidate security receipt is invalid.")
  }
  const listed = await ctx.git.run(task.repoRoot, [
    "ls-files",
    "-z",
    "--",
    ".",
    ":(exclude)docs/plans/**",
  ])
  if (listed.code !== 0)
    throw new Error("Could not inventory the selected commit for security review.")
  const settings = await scanSettings(ctx)
  const results = await scanChanges(ctx, task.repoRoot, listed.stdout.split("\0").filter(Boolean), {
    advisories: settings.advisories,
    off: !settings.enabled,
  })
  const head = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"], { fresh: true })
  if (head.code !== 0 || head.stdout.trim() !== candidate.head)
    throw new Error(
      "The selected commit moved during security checks. Choose the current candidate again.",
    )
  const record = { at: ctx.clock.now(), head: candidate.head, candidate: candidate.id, results }
  await ctx.fs.atomicWrite(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  return record
}
