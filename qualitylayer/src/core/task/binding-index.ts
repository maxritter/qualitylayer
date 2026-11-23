import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { NATIVE_PEERS_MAX } from "../home-caps.ts"
import {
  type BindingTarget,
  bindingIndexDir,
  bindingIndexPath,
  bindingKey,
  bindingTargetOf,
  isBindingPart,
  readBindingJson,
  readBindingText,
  type WorkflowBinding,
  workflowBindingOf,
  workflowBindingPath,
  writeBindingIndex,
} from "./binding-index-records.ts"

export {
  type BindingTarget,
  bindingIndexDir,
  bindingIndexPath,
  bindingKey,
  bindingTargetOf,
  readBindingJson,
  workflowBindingOf,
  workflowBindingPath,
} from "./binding-index-records.ts"

export class BindingStorageError extends Error {}

export async function withBindingIndex<T>(
  ctx: Ctx,
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!bindingKey(key)) throw new Error("Invalid native session binding key")
  await ctx.fs.mkdir(bindingIndexDir(ctx))
  return ctx.fs.withLock(join(bindingIndexDir(ctx), "index.lock"), action)
}

async function tryEvictBindingEntry(ctx: Ctx, oldKey: string): Promise<boolean> {
  const path = bindingIndexPath(ctx, oldKey)
  const target = bindingTargetOf(await readBindingJson(ctx, path))
  if (!target) return false
  const binding = workflowBindingOf(
    await readBindingJson(ctx, workflowBindingPath(ctx, target, oldKey)),
  )
  if (binding?.slug === target.slug) {
    if (binding.at > target.at) await writeBindingIndex(ctx, oldKey, { ...target, at: binding.at })
    return false
  }
  const { observedTarget } = await import("./bound-target.ts")
  const current = await observedTarget(ctx, oldKey)
  if (current.kind === "bound") {
    await writeBindingIndex(ctx, oldKey, {
      repoId: current.repo.id,
      slug: current.slug,
      at: current.generation,
    })
    return false
  }
  if (binding) return false
  await ctx.fs.remove(path)
  return true
}

async function admitBindingIndex(ctx: Ctx, key: string): Promise<void> {
  if (await ctx.fs.exists(bindingIndexPath(ctx, key))) return
  const entries = (await ctx.fs.entries(bindingIndexDir(ctx))).filter((entry) =>
    /^[a-f0-9]{16}\.json$/.test(entry.name),
  )
  let count = entries.length
  if (count < NATIVE_PEERS_MAX) return
  for (const entry of entries) {
    if (await tryEvictBindingEntry(ctx, entry.name.slice(0, -5))) {
      if (--count < NATIVE_PEERS_MAX) return
    }
  }
  throw new BindingStorageError(
    "Native session binding storage is full. Retire an existing task, then retry joining this task.",
  )
}

type BindingBackup = { path: string; text: string | null }

/** Explicit assignment changes release old memberships; ordinary hook reads never inventory projects. */
async function otherBindings(ctx: Ctx, key: string, repoId: string): Promise<BindingBackup[]> {
  const projects = join(ctx.home, "projects")
  const names = await ctx.fs.readdir(projects).catch(() => [])
  const found: BindingBackup[] = []
  for (const id of names) {
    if (!isBindingPart(id) || id === repoId) continue
    const path = workflowBindingPath(ctx, { repoId: id }, key)
    const text = await readBindingText(ctx, path)
    if (text !== null && workflowBindingOf(await readBindingJson(ctx, path)))
      found.push({ path, text })
  }
  return found
}

async function restoreBindings(ctx: Ctx, backups: BindingBackup[]): Promise<void> {
  for (const backup of backups) {
    if (backup.text === null) await ctx.fs.remove(backup.path)
    else await ctx.fs.atomicWrite(backup.path, backup.text)
  }
}

/** Admission precedes authority writes; publish the current index only after the assignment is complete. */
export async function assignBinding(
  ctx: Ctx,
  key: string,
  target: Omit<BindingTarget, "at">,
): Promise<void> {
  await withBindingIndex(ctx, key, async () => {
    await admitBindingIndex(ctx, key)
    const indexPath = bindingIndexPath(ctx, key)
    const beforeIndex = await readBindingText(ctx, indexPath)
    const indexed = bindingTargetOf(await readBindingJson(ctx, indexPath))
    const released =
      indexed?.repoId === target.repoId && indexed.slug === target.slug
        ? []
        : await otherBindings(ctx, key, target.repoId)
    const localPath = workflowBindingPath(ctx, target, key)
    const beforeLocal = await readBindingText(ctx, localPath)
    const binding: WorkflowBinding = { slug: target.slug, at: ctx.clock.now(), source: "workflow" }
    try {
      for (const old of released) await ctx.fs.remove(old.path)
      await ctx.fs.mkdir(join(ctx.home, "projects", target.repoId, "sessions"))
      await ctx.fs.atomicWrite(localPath, `${JSON.stringify(binding)}\n`)
      await writeBindingIndex(ctx, key, { ...target, at: binding.at })
    } catch (error) {
      try {
        await restoreBindings(ctx, [
          ...released,
          { path: localPath, text: beforeLocal },
          { path: indexPath, text: beforeIndex },
        ])
      } catch {
        throw new Error(
          "Native session binding could not be published or restored. Retry joining this task.",
          { cause: error },
        )
      }
      throw error
    }
  })
}

export async function retireBindingIndex(
  ctx: Ctx,
  key: string,
  target: Pick<BindingTarget, "repoId" | "slug">,
): Promise<void> {
  await withBindingIndex(ctx, key, async () => {
    const indexed = bindingTargetOf(await readBindingJson(ctx, bindingIndexPath(ctx, key)))
    if (indexed?.repoId === target.repoId && indexed.slug === target.slug)
      await ctx.fs.remove(bindingIndexPath(ctx, key))
  })
}

/** The existing tool-heartbeat cadence refreshes idle retention without changing claim generation. */
export async function touchBindingIndex(
  ctx: Ctx,
  key: string,
  target: BindingTarget,
): Promise<void> {
  if (!ctx.fs.touch) return
  const binding = workflowBindingOf(
    await readBindingJson(ctx, workflowBindingPath(ctx, target, key)),
  )
  if (binding?.slug !== target.slug || binding.at !== target.at) return
  await ctx.fs.touch(workflowBindingPath(ctx, target, key), ctx.clock.now())
  const indexed = bindingTargetOf(await readBindingJson(ctx, bindingIndexPath(ctx, key)))
  if (indexed?.repoId === target.repoId && indexed.slug === target.slug && indexed.at === target.at)
    await ctx.fs.touch(bindingIndexPath(ctx, key), ctx.clock.now())
}
