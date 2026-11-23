// The project look on disk: `<home>/project-look.json`, so the App and every paired browser show the
// same projects the same way. The shapes and limits are in `project-look.ts`.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { type LookPatch, PROJECT_LOOK_MAX_BYTES, type ProjectLooks } from "./project-look.ts"
import {
  applyLookPatch,
  cleanedLooks,
  prunedLooks,
  validateLookPatch,
} from "./project-look-validate.ts"

const lookPath = (ctx: Ctx) => join(ctx.home, "project-look.json")

/** The saved looks. A missing, unreadable, oversized or wrong-version file reads as none. */
export async function readLooks(ctx: Ctx): Promise<ProjectLooks> {
  try {
    const text = await ctx.fs.readFile(lookPath(ctx))
    if (Buffer.byteLength(text) > PROJECT_LOOK_MAX_BYTES) return { order: [], projects: {} }
    return cleanedLooks(JSON.parse(text))
  } catch {
    return { order: [], projects: {} }
  }
}

/** The ids of the projects registered on this machine. */
async function knownProjectIds(ctx: Ctx): Promise<Set<string>> {
  const dir = join(ctx.home, "projects")
  const ids = new Set<string>()
  if (!(await ctx.fs.exists(dir))) return ids
  for (const id of await ctx.fs.readdir(dir).catch(() => [] as string[])) {
    if (await ctx.fs.exists(join(dir, id, "project.json"))) ids.add(id)
  }
  return ids
}

async function write(ctx: Ctx, looks: ProjectLooks): Promise<void> {
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.atomicWrite(lookPath(ctx), `${JSON.stringify({ v: 1, ...looks }, null, 2)}\n`)
}

const locked = <T>(ctx: Ctx, action: () => Promise<T>): Promise<T> =>
  ctx.fs.withLock(join(ctx.home, "project-look.lock"), action)

const bad = (message: string) => err({ code: "bad_args", message })

function checkArtifactTargets(
  id: string,
  artifacts: readonly string[],
  known: Set<string>,
): Result<void> {
  for (const d of artifacts) {
    const other = d.slice(0, d.indexOf(":"))
    if (other === id) return bad("a project lists the artifacts of other projects only")
    if (!known.has(other)) return bad(`unknown project "${other}"`)
  }
  return ok(undefined)
}

/** Change one project's color, name or hidden flag. An entry left empty is removed. */
export async function setLook(
  ctx: Ctx,
  id: string,
  patch: LookPatch,
): Promise<Result<ProjectLooks>> {
  const checked = validateLookPatch(patch)
  if (!checked.ok) return checked
  return locked(ctx, async () => {
    const known = await knownProjectIds(ctx)
    if (!known.has(id)) return bad(`unknown project "${id}"`)
    const targets = checkArtifactTargets(id, patch.artifacts ?? [], known)
    if (!targets.ok) return targets
    const looks = prunedLooks(await readLooks(ctx), known)
    const entry = applyLookPatch(looks.projects[id], patch)
    if (entry !== null) looks.projects[id] = entry
    else delete looks.projects[id]
    await write(ctx, looks)
    return ok(looks)
  })
}

/** The person's order. Unknown ids are dropped, each project counts once. */
export async function setOrder(ctx: Ctx, ids: unknown): Promise<Result<ProjectLooks>> {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
    return bad("expected { ids: string[] }")
  return locked(ctx, async () => {
    const known = await knownProjectIds(ctx)
    const looks = prunedLooks(await readLooks(ctx), known)
    const order = [...new Set((ids as string[]).filter((id) => known.has(id)))]
    const next = { ...looks, order }
    await write(ctx, next)
    return ok(next)
  })
}
