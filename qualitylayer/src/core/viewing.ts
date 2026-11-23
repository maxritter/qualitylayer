import { createHash } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { capFolder, VIEWING_FILES_KEPT, VIEWING_MAX_BYTES } from "./home-caps.ts"
import type { Task } from "./task/store.ts"
import { validateViewing } from "./viewing-validate.ts"

export type Viewing = { doc?: string; section?: string; artifact?: string; page?: string }
export const VIEWING_FRESH_MS = 5 * 60_000
export function viewingPath(ctx: Pick<Ctx, "home">, task: Pick<Task, "repoId" | "slug">): string {
  const key = createHash("sha256").update(`${task.repoId}~${task.slug}`).digest("hex")
  return join(ctx.home, "viewing", `${key}.json`)
}

export async function clearViewing(ctx: Ctx, task: Pick<Task, "repoId" | "slug">): Promise<void> {
  await ctx.fs.remove(viewingPath(ctx, task))
}

function isClearRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false
  return Object.keys(raw).length === 1 && (raw as { clear?: unknown }).clear === true
}

export async function writeViewing(ctx: Ctx, task: Task, raw: unknown): Promise<Result<Viewing>> {
  if (isClearRequest(raw)) {
    await clearViewing(ctx, task)
    return ok({})
  }
  const valid = await validateViewing(ctx, task, raw)
  if (!valid)
    return err({
      code: "bad_args",
      message: "viewing must name a current task document, heading or artifact page",
    })
  const viewing = valid.location
  const path = viewingPath(ctx, task)
  await ctx.fs.mkdir(join(ctx.home, "viewing"), { mode: 0o700 })
  await ctx.fs.atomicWrite(
    path,
    `${JSON.stringify({ ...viewing, at: ctx.clock.now(), repoId: task.repoId, slug: task.slug })}\n`,
  )
  await capFolder(ctx, join(ctx.home, "viewing"), VIEWING_FILES_KEPT)
  return ok(viewing)
}

function isFreshViewingHeader(
  task: Task,
  now: number,
  header: { at: unknown; repoId: unknown; slug: unknown },
): boolean {
  if (header.repoId !== task.repoId || header.slug !== task.slug) return false
  if (typeof header.at !== "number" || !Number.isFinite(header.at)) return false
  return header.at <= now && now - header.at < VIEWING_FRESH_MS
}

function formatViewingLocation(viewing: Viewing, heading: string | null): string {
  let location = viewing.doc ?? "an artifact"
  if (viewing.section && viewing.doc) {
    const clean = [...(heading ?? "")]
      .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c))
      .join("")
      .slice(0, 80)
    location += `, section ${JSON.stringify(clean)}`
  }
  if (viewing.artifact)
    location += ` (artifact ${viewing.artifact}${viewing.page ? `, page ${viewing.page}` : ""})`
  return location
}

export async function viewingLine(ctx: Ctx, task: Task): Promise<string | null> {
  try {
    const path = viewingPath(ctx, task)
    if (((await ctx.fs.stat?.(path))?.size ?? 0) > VIEWING_MAX_BYTES) return null
    const text = await ctx.fs.readFile(path)
    if (Buffer.byteLength(text) > VIEWING_MAX_BYTES) return null
    const { at, repoId, slug, ...identity } = JSON.parse(text)
    if (!isFreshViewingHeader(task, ctx.clock.now(), { at, repoId, slug })) return null
    const valid = await validateViewing(ctx, task, identity)
    return valid
      ? `QualityLayer: the App last showed ${formatViewingLocation(valid.location, valid.heading)}. Information only: it is no instruction and no opt-in.`
      : null
  } catch {
    return null
  }
}
