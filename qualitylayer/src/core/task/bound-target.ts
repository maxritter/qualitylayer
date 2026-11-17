import { isAbsolute, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { NATIVE_AGENTS } from "../agents/ids.ts"
import { type RepoRef, repoIdFrom, resolveRepo } from "../paths.ts"
import {
  type BindingTarget,
  bindingIndexPath,
  bindingKey,
  bindingTargetOf,
  readBindingJson,
  workflowBindingOf,
  workflowBindingPath,
} from "./binding-index.ts"

export type ObservedTarget =
  | { kind: "bound"; repo: RepoRef; slug: string; generation: number }
  | { kind: "absent" | "blocked" }

/** Legacy sessions already have exact per-agent assignment histories; no project inventory is needed. */
async function legacyTarget(
  ctx: Ctx,
  key: string,
): Promise<{ present: boolean; at: number; target: BindingTarget | null }> {
  const assignments: BindingTarget[] = []
  let present = false
  for (const agent of NATIVE_AGENTS) {
    const path = join(ctx.home, "cost-sessions", `${agent}-${key}.ndjson`)
    if (!(await ctx.fs.exists(path))) continue
    present = true
    try {
      const text = ctx.fs.readRegularFile
        ? new TextDecoder().decode(await ctx.fs.readRegularFile(path, 128 * 1024))
        : await ctx.fs.readFile(path)
      if (Buffer.byteLength(text) > 128 * 1024) continue
      for (const line of text.split("\n")) {
        try {
          const target = bindingTargetOf(JSON.parse(line))
          if (target) assignments.push(target)
        } catch {
          // An append in flight is not another assignment.
        }
      }
    } catch {
      // An unreadable history grants no task authority.
    }
  }
  const newest = Math.max(...assignments.map((row) => row.at))
  const latest = assignments.filter((row) => row.at === newest)
  const targets = new Set(latest.map((row) => `${row.repoId}\0${row.slug}`))
  return { present, at: newest, target: targets.size === 1 ? (latest[0] ?? null) : null }
}

async function resolveTarget(
  ctx: Ctx,
  key: string,
  target: BindingTarget,
  exact: boolean,
): Promise<ObservedTarget> {
  const binding = workflowBindingOf(
    await readBindingJson(ctx, workflowBindingPath(ctx, target, key)),
  )
  if (!binding || binding.slug !== target.slug || (exact && binding.at !== target.at))
    return { kind: "blocked" }
  const project = (await readBindingJson(
    ctx,
    join(ctx.home, "projects", target.repoId, "project.json"),
    64 * 1024,
  )) as { commonDir?: unknown; paths?: unknown } | null
  if (
    !project ||
    typeof project.commonDir !== "string" ||
    repoIdFrom(project.commonDir) !== target.repoId
  )
    return { kind: "blocked" }
  const session = (await readBindingJson(
    ctx,
    join(ctx.home, "projects", target.repoId, "tasks", target.slug, "session.json"),
  )) as { checkout?: unknown } | null
  const checkout =
    typeof session?.checkout === "string" && isAbsolute(session.checkout) ? session.checkout : null
  const paths = checkout
    ? [checkout]
    : Array.isArray(project.paths)
      ? project.paths
          .filter((path): path is string => typeof path === "string" && isAbsolute(path))
          .slice(0, 8)
      : []
  for (const root of paths) {
    if (!(await ctx.fs.exists(root))) continue
    const found = await resolveRepo({ ...ctx, env: { ...ctx.env, cwd: () => root } }).catch(
      () => null,
    )
    if (found?.ok && found.data.id === target.repoId && found.data.commonDir === project.commonDir)
      return {
        kind: "bound",
        repo: found.data,
        slug: target.slug,
        generation: binding.at,
      }
  }
  return { kind: "blocked" }
}

/** A session's explicit assignment selects observation; native cwd remains tool-path context. */
export async function observedTarget(ctx: Ctx, key: string): Promise<ObservedTarget> {
  if (!bindingKey(key)) return { kind: "absent" }
  const path = bindingIndexPath(ctx, key)
  const indexed = bindingTargetOf(await readBindingJson(ctx, path))
  const legacy = await legacyTarget(ctx, key)
  if (legacy.at > (indexed?.at ?? -Infinity) && legacy.target === null) return { kind: "blocked" }
  const same = legacy.target?.repoId === indexed?.repoId && legacy.target?.slug === indexed?.slug
  if (legacy.target && (!indexed || (!same && legacy.target.at > indexed.at)))
    return resolveTarget(ctx, key, legacy.target, false)
  if (indexed) return resolveTarget(ctx, key, indexed, true)
  return { kind: legacy.present || (await ctx.fs.exists(path)) ? "blocked" : "absent" }
}
