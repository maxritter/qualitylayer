// Putting a task away. Archiving is a marker beside the task's state: the task
// leaves the working lists, `next` no longer picks it, and it can come back.
// Deleting is only for an archived task, after the Cockpit asked once more, and
// it is for good: the plan folder and the task's state are removed. The task's
// branch and its commits stay in the repository.

import { createHash } from "node:crypto"
import { existsSync, realpathSync, rmSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { deleteWorkingRecords, reopenWorkingRecords } from "../git/working-records.ts"
import { plansDir } from "../paths.ts"
import { pruneTaskRuns } from "../retention.ts"
import { clearViewing } from "../viewing.ts"
import { clearTaskBindings } from "./binding.ts"
import { appendEvent, type Task } from "./store.ts"

const marker = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "archived.json")

/** Serialize wait-state writes with permanent deletion. The lock lives outside the removed tree. */
export function withTaskWaitLock<T>(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  action: () => Promise<T>,
): Promise<T> {
  const key = createHash("sha256").update(task.runtimeDir).digest("hex")
  return ctx.fs.withLock(join(ctx.home, "task-wait", `${key}.lock`), action)
}

export async function isArchived(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<boolean> {
  return ctx.fs.exists(marker(task))
}

export async function readArchivedAt(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<number | undefined> {
  try {
    const bytes = await ctx.fs.readRegularFile?.(marker(task), 4096)
    const at = bytes ? JSON.parse(new TextDecoder().decode(bytes)).archived : undefined
    return typeof at === "number" && Number.isFinite(at) && at >= 0 ? at : undefined
  } catch {
    return undefined
  }
}

export async function setArchived(ctx: Ctx, task: Task, archived: boolean): Promise<void> {
  if (archived) {
    const already = await isArchived(ctx, task)
    await ctx.fs.mkdir(task.runtimeDir)
    await ctx.fs.writeFile(
      marker(task),
      `${JSON.stringify({ archived: ctx.clock.now(), stage: task.stage }, null, 2)}\n`,
    )
    // Put away once is one record; putting away again changes nothing the log should repeat.
    if (!already) await appendEvent(ctx, task, { event: "archived" })
    await clearTaskBindings(ctx, task)
    await pruneTaskRuns(ctx, `${task.repoId}~${task.slug}`)
  } else {
    await ctx.fs.remove(marker(task))
    if (!["shipped", "abandoned"].includes(task.stage))
      await reopenWorkingRecords(ctx, task).catch(() => {})
  }
}

/** True when `path` is a folder strictly inside `root`, by real paths: never the root itself. */
function strictlyInside(path: string, root: string): boolean {
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p))
  const inner = real(path)
  const outer = real(root)
  return inner !== outer && inner.startsWith(`${outer}${sep}`)
}

export type Deleted = { plan: string | null }

/**
 * Delete an archived task for good: its plan folder and its state are removed,
 * after the Cockpit asked once more. Only the task's own folders go: the plan
 * folder must sit inside the repository's docs/plans and the state inside
 * QualityLayer's home, or nothing is removed.
 */
export async function deleteTask(ctx: Ctx, task: Task): Promise<Result<Deleted>> {
  if (!(await isArchived(ctx, task))) {
    return err({
      code: "bad_args",
      message: "only an archived task can be deleted; archive it first",
    })
  }
  const hasPlan = task.dir !== task.runtimeDir && existsSync(task.dir)
  if (hasPlan && !strictlyInside(task.dir, plansDir(task.repoRoot))) {
    return err({
      code: "bad_args",
      message: `refusing to delete ${task.dir}: not a task folder in docs/plans`,
    })
  }
  if (existsSync(task.runtimeDir) && !strictlyInside(task.runtimeDir, ctx.home)) {
    return err({
      code: "bad_args",
      message: `refusing to delete ${task.runtimeDir}: not QualityLayer's state`,
    })
  }
  let plan: string | null = null
  await clearViewing(ctx, task)
  await pruneTaskRuns(ctx, `${task.repoId}~${task.slug}`)
  await deleteWorkingRecords(ctx, task)
  await withTaskWaitLock(ctx, task, async () => {
    await clearTaskBindings(ctx, task)
    if (hasPlan) {
      rmSync(task.dir, { recursive: true, force: true })
      plan = task.dir
    }
    if (existsSync(task.runtimeDir)) rmSync(task.runtimeDir, { recursive: true, force: true })
  })
  return ok({ plan })
}
