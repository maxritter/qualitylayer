// Whether a file changed after this task's sessions last wrote it, by more than formatting.
//
// A slice commit takes a card file whole. Another session can add a hunk to the same file while
// the slice is built, and no record names that session. What the task's own sessions saw is the
// file right after each edit; if the file's content differs from it later, something else changed
// it. The comparison is a "shape": the multiset of the file's characters without whitespace,
// quotes, commas, semicolons and parentheses, so a formatter run (Biome after an edit) never
// counts, while an added or removed line does. Kept per session beside its edit record.

import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { projectRuntimeDir } from "../paths.ts"

type Seen = { at: number; shape: string }
type ShapeRecord = { task: string; files: Record<string, Seen> }

/** A shape older than this says nothing about what is uncommitted now. */
const KEEP_MS = 3 * 24 * 3_600_000
const CONTENT_LIMIT = 1024 * 1024
const MOST_FILES = 512

/** Tab, line feeds, space, `"`, `'`, `(`, `)`, `,`, `;` and `\`: what a formatter adds, drops or moves. */
const FORMAT_BYTES = new Set([9, 10, 13, 32, 34, 39, 40, 41, 44, 59, 92])

const shapesDir = (ctx: Ctx, repoId: string) => join(projectRuntimeDir(ctx, repoId), "edit-shapes")

/** How often each byte occurs, formatting left out: what a shape is made of. */
function byteCounts(bytes: Uint8Array): number[] {
  const counts = new Array<number>(256).fill(0)
  for (const byte of bytes) if (!FORMAT_BYTES.has(byte)) counts[byte] = (counts[byte] ?? 0) + 1
  return counts
}

const shapeOfCounts = (counts: number[]) =>
  createHash("sha256").update(counts.join(",")).digest("hex")

/** The formatting-proof fingerprint of a file's bytes. */
export function contentShape(bytes: Uint8Array): string {
  return shapeOfCounts(byteCounts(bytes))
}

async function shapeOf(ctx: Ctx, repoRoot: string, path: string): Promise<string | null> {
  if (!ctx.fs.readRegularFile) return null
  try {
    return contentShape(await ctx.fs.readRegularFile(join(repoRoot, path), CONTENT_LIMIT))
  } catch {
    return null
  }
}

async function readShapes(ctx: Ctx, file: string): Promise<ShapeRecord | null> {
  try {
    const read = JSON.parse(await ctx.fs.readFile(file)) as Partial<ShapeRecord>
    return typeof read.task === "string" && typeof read.files === "object" && read.files !== null
      ? (read as ShapeRecord)
      : null
  } catch {
    return null
  }
}

/** Remember each file's shape as this session's edit left it. `paths` are repository-relative. */
export async function recordShapes(
  ctx: Ctx,
  repo: { id: string; root: string },
  key: string,
  task: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return
  const file = join(shapesDir(ctx, repo.id), `${key}.json`)
  const now = ctx.clock.now()
  const before = await readShapes(ctx, file)
  const files: Record<string, Seen> = Object.create(null)
  for (const [path, seen] of Object.entries(before?.task === task ? before.files : {}))
    if (now - seen.at < KEEP_MS) files[path] = seen
  for (const path of paths.slice(0, 64)) {
    delete files[path]
    const shape = await shapeOf(ctx, repo.root, path)
    if (shape !== null) files[path] = { at: now, shape }
  }
  const newest = Object.entries(files)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MOST_FILES)
  await ctx.fs.mkdir(shapesDir(ctx, repo.id))
  await ctx.fs.atomicWrite(
    file,
    `${JSON.stringify({ task, files: Object.fromEntries(newest) } satisfies ShapeRecord)}\n`,
  )
}

/** Each task session's latest shape of each path. */
async function ownShapes(ctx: Ctx, repoId: string, task: string): Promise<Map<string, Seen>> {
  const latest = new Map<string, Seen>()
  const dir = shapesDir(ctx, repoId)
  let names: string[]
  try {
    names = await ctx.fs.readdir(dir)
  } catch {
    return latest
  }
  const now = ctx.clock.now()
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const record = await readShapes(ctx, join(dir, name))
    if (record?.task !== task) continue
    for (const [path, seen] of Object.entries(record.files)) {
      const held = latest.get(path)
      if (now - seen.at < KEEP_MS && (held === undefined || seen.at > held.at))
        latest.set(path, seen)
    }
  }
  return latest
}

/**
 * Of `paths`, those the task's sessions edited whose content now differs, beyond formatting, from
 * what their latest edit left: someone else changed them since. A file the task's sessions never
 * edited, or one that cannot be read, says nothing and is not listed.
 */
export async function changedAfterOwnEdit(
  ctx: Ctx,
  repo: { id: string; root: string },
  task: string,
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0) return []
  const own = await ownShapes(ctx, repo.id, task)
  const moved: string[] = []
  for (const path of paths) {
    const seen = own.get(path)
    if (seen === undefined) continue
    const now = await shapeOf(ctx, repo.root, path)
    if (now !== null && now !== seen.shape && !(await landedSince(ctx, repo.root, path, seen)))
      moved.push(path)
  }
  return moved
}

async function readCountsAt(
  ctx: Ctx,
  root: string,
  path: string,
  rev: string,
): Promise<number[] | null> {
  const read = await ctx.git.run(root, ["cat-file", "--filters", `${rev}:${path}`], {
    maxOutputBytes: CONTENT_LIMIT,
  })
  return read.code === 0 ? byteCounts(new TextEncoder().encode(read.stdout)) : null
}

async function readWorkCounts(ctx: Ctx, root: string, path: string): Promise<number[] | null> {
  if (!ctx.fs.readRegularFile) return null
  try {
    return byteCounts(await ctx.fs.readRegularFile(join(root, path), CONTENT_LIMIT))
  } catch {
    return null
  }
}

/**
 * Whether what changed in the file since the task's last edit is exactly what commits since then
 * brought to HEAD: another session committed its own hunks of the file, so they are no one's
 * uncommitted work, and the file is the task's own plus HEAD's.
 */
async function landedSince(ctx: Ctx, root: string, path: string, seen: Seen): Promise<boolean> {
  const work = await readWorkCounts(ctx, root, path)
  if (work === null) return false
  // Commit times have whole seconds: a commit of the edit's own second may be from before it.
  const since = new Date(Math.floor(seen.at / 1000) * 1000).toISOString()
  const log = await ctx.git.run(root, ["log", "--format=%H", `--since=${since}`, "--", path])
  const commits = log.code === 0 ? log.stdout.split("\n").filter(Boolean).slice(0, 8) : []
  if (commits.length === 0) return false
  const head = await readCountsAt(ctx, root, path, "HEAD")
  if (head === null) return false
  // The file as the task left it: now, less what the commits since then added, plus what they took
  // out; tried from the newest commit back, since which of them came after the edit is not known.
  for (const commit of commits) {
    const before = await readCountsAt(ctx, root, path, `${commit}^`)
    if (before === null) continue
    const left = work.map((count, byte) => count - (head[byte] ?? 0) + (before[byte] ?? 0))
    if (left.every((count) => count >= 0) && shapeOfCounts(left) === seen.shape) return true
  }
  return false
}
