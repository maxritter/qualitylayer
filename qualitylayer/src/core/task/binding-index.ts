import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { NATIVE_PEERS_MAX } from "../home-caps.ts"

export type BindingTarget = { repoId: string; slug: string; at: number }
export type WorkflowBinding = { slug: string; at: number; source: "workflow" }

export class BindingStorageError extends Error {}

export const BINDING_INDEX_BYTES = 4 * 1024
const part = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)
export const bindingKey = (value: string): boolean => /^[a-f0-9]{16}$/.test(value)
export const bindingIndexDir = (ctx: Pick<Ctx, "home">) => join(ctx.home, "session-bindings")
export const bindingIndexPath = (ctx: Pick<Ctx, "home">, key: string) =>
  join(bindingIndexDir(ctx), `${key}.json`)

export async function readBindingJson(
  ctx: Ctx,
  path: string,
  max = BINDING_INDEX_BYTES,
): Promise<unknown> {
  const text = await readBindingText(ctx, path, max)
  try {
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

async function readBindingText(
  ctx: Ctx,
  path: string,
  max = BINDING_INDEX_BYTES,
): Promise<string | null> {
  try {
    const text = ctx.fs.readRegularFile
      ? new TextDecoder().decode(await ctx.fs.readRegularFile(path, max))
      : await ctx.fs.readFile(path)
    return Buffer.byteLength(text) <= max ? text : null
  } catch {
    return null
  }
}

export function workflowBindingOf(value: unknown): WorkflowBinding | null {
  const row = value as Partial<WorkflowBinding> | null
  return row &&
    row.source === "workflow" &&
    part(row.slug) &&
    typeof row.at === "number" &&
    Number.isFinite(row.at)
    ? {
        slug: row.slug,
        at: row.at,
        source: "workflow",
      }
    : null
}

export function bindingTargetOf(value: unknown): BindingTarget | null {
  const row = value as Partial<BindingTarget> | null
  return row &&
    part(row.repoId) &&
    part(row.slug) &&
    typeof row.at === "number" &&
    Number.isFinite(row.at)
    ? { repoId: row.repoId, slug: row.slug, at: row.at }
    : null
}

export const workflowBindingPath = (
  ctx: Pick<Ctx, "home">,
  target: Pick<BindingTarget, "repoId">,
  key: string,
) => join(ctx.home, "projects", target.repoId, "sessions", `${key}.json`)

export async function withBindingIndex<T>(
  ctx: Ctx,
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!bindingKey(key)) throw new Error("Invalid native session binding key")
  await ctx.fs.mkdir(bindingIndexDir(ctx))
  return ctx.fs.withLock(join(bindingIndexDir(ctx), "index.lock"), action)
}

async function admitBindingIndex(ctx: Ctx, key: string): Promise<void> {
  if (await ctx.fs.exists(bindingIndexPath(ctx, key))) return
  const entries = (await ctx.fs.entries(bindingIndexDir(ctx))).filter((entry) =>
    /^[a-f0-9]{16}\.json$/.test(entry.name),
  )
  let count = entries.length
  if (count < NATIVE_PEERS_MAX) return
  for (const entry of entries) {
    const oldKey = entry.name.slice(0, -5)
    const path = bindingIndexPath(ctx, oldKey)
    const target = bindingTargetOf(await readBindingJson(ctx, path))
    if (!target) continue
    const binding = workflowBindingOf(
      await readBindingJson(ctx, workflowBindingPath(ctx, target, oldKey)),
    )
    if (binding?.slug === target.slug && binding.at === target.at) continue
    if (binding?.slug === target.slug && binding.at > target.at) {
      await writeBindingIndex(ctx, oldKey, { ...target, at: binding.at })
      continue
    }
    const { observedTarget } = await import("./bound-target.ts")
    const current = await observedTarget(ctx, oldKey)
    if (current.kind === "bound") {
      await writeBindingIndex(ctx, oldKey, {
        repoId: current.repo.id,
        slug: current.slug,
        at: current.generation,
      })
      continue
    }
    if (binding) continue
    await ctx.fs.remove(path)
    if (--count < NATIVE_PEERS_MAX) return
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
    if (!part(id) || id === repoId) continue
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

/** The index is a lookup hint; readers must still match the project binding generation. */
export function writeBindingIndex(ctx: Ctx, key: string, target: BindingTarget): Promise<void> {
  const text = `${JSON.stringify({ repoId: target.repoId, slug: target.slug, at: target.at })}\n`
  if (Buffer.byteLength(text) > BINDING_INDEX_BYTES)
    throw new Error("Native session binding record is too large")
  return ctx.fs.atomicWrite(bindingIndexPath(ctx, key), text)
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
