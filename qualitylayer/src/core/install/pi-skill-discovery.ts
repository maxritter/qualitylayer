import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import {
  type DiscoveryRecord,
  digestText,
  isPlainObject,
  isStringArray,
  type PiSettings,
  piPaths,
  RECORD_MAX_BYTES,
  readDiscoveryRecord,
  statePath,
} from "./pi-skill-discovery-record.ts"
import { QUALITYLAYER_SKILLS } from "./skill-names.ts"

async function readSettingsDoc(
  ctx: Ctx,
  file: string,
): Promise<{ original: string | undefined; settings: PiSettings } | null> {
  try {
    const original = (await ctx.fs.exists(file)) ? await ctx.fs.readFile(file) : undefined
    const parsed: unknown = original === undefined ? {} : JSON.parse(original)
    if (!isPlainObject(parsed)) return null
    if (parsed.skills !== undefined && !isStringArray(parsed.skills)) return null
    return { original, settings: parsed }
  } catch {
    return null
  }
}

async function missingExclusions(
  ctx: Ctx,
  dirs: { root: string; shared: string },
  existing: string[],
  priorAdded: string[],
): Promise<string[]> {
  const added: string[] = []
  for (const name of QUALITYLAYER_SKILLS) {
    const member = `-${join(dirs.shared, name, "SKILL.md")}`
    if (existing.includes(member) || priorAdded.includes(member)) continue
    const hasNative = await ctx.fs.exists(join(dirs.root, "skills", name, "SKILL.md"))
    const hasShared = await ctx.fs.exists(join(dirs.shared, name, "SKILL.md"))
    if (hasNative && hasShared) added.push(member)
  }
  return added
}

/** Pi discovers both roots; keep its client-specific workflow rather than the shared Codex copy. */
export async function configurePiSkillDiscovery(ctx: Ctx, home: string): Promise<void> {
  const { root, file, shared } = piPaths(ctx, home)
  if (!(await ctx.fs.exists(root))) return
  const allowed = QUALITYLAYER_SKILLS.map((name) => `-${join(shared, name, "SKILL.md")}`)
  const before = await readDiscoveryRecord(ctx, file, allowed)
  const doc = await readSettingsDoc(ctx, file)
  if (!doc) return
  const skills = [...((doc.settings.skills as string[] | undefined) ?? [])]
  const added = await missingExclusions(ctx, { root, shared }, skills, before?.added ?? [])
  if (!added.length) return
  skills.push(...added)
  const written = `${JSON.stringify({ ...doc.settings, skills }, null, 2)}\n`
  const canRestore =
    before === null ||
    (doc.original !== undefined && before.writtenHash === digestText(doc.original))
  const record = `${JSON.stringify({
    file,
    added: [...(before?.added ?? []), ...added],
    createdFile: before?.createdFile ?? doc.original === undefined,
    hadSkills: before?.hadSkills ?? doc.settings.skills !== undefined,
    ...(canRestore
      ? {
          original: before === null ? doc.original : before.original,
          writtenHash: digestText(written),
        }
      : {}),
  })}\n`
  // A lossless backup that cannot fit stays out of the preferences rather than growing the journal.
  if (Buffer.byteLength(record) > RECORD_MAX_BYTES) return
  // Record ownership first; an interrupted install never leaves an untracked preference mutation.
  await ctx.fs.atomicWrite(statePath(ctx), record)
  try {
    await ctx.fs.atomicWrite(file, written)
  } catch (error) {
    if (before) await ctx.fs.atomicWrite(statePath(ctx), `${JSON.stringify(before)}\n`)
    else await ctx.fs.remove(statePath(ctx))
    throw error
  }
}

async function revertSettingsFile(
  ctx: Ctx,
  file: string,
  record: DiscoveryRecord,
): Promise<boolean> {
  const text = await ctx.fs.readFile(file)
  const exactMatch =
    record.writtenHash === digestText(text) && (record.original !== undefined || record.createdFile)
  if (exactMatch) {
    if (record.original !== undefined) await ctx.fs.atomicWrite(file, record.original)
    else await ctx.fs.remove(file)
    return true
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.skills)) return false
  const skills = parsed.skills.filter((item) => !record.added.includes(item as string))
  if (skills.length !== parsed.skills.length) {
    const next: PiSettings = { ...parsed, skills }
    if (skills.length === 0 && record.hadSkills === false) delete next.skills
    if (record.createdFile && Object.keys(next).length === 0) await ctx.fs.remove(file)
    else await ctx.fs.atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`)
  }
  return true
}

/** Remove only exclusions this installer added, preserving a person's later skill preferences. */
export async function revertPiSkillDiscovery(ctx: Ctx, home: string): Promise<void> {
  const { file, shared } = piPaths(ctx, home)
  const record = await readDiscoveryRecord(
    ctx,
    file,
    QUALITYLAYER_SKILLS.map((name) => `-${join(shared, name, "SKILL.md")}`),
  )
  if (!record) return
  if (await ctx.fs.exists(file)) {
    if (!(await revertSettingsFile(ctx, file, record))) return
  }
  await ctx.fs.remove(statePath(ctx))
}
