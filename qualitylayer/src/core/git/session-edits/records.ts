import { createHash } from "node:crypto"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import { projectRuntimeDir } from "../../paths.ts"

export {
  otherTasksOnly,
  ownEdits,
  ownEditTimes,
  ownRecordSpan,
  recordedBytes,
} from "./records-query.ts"

export type SessionEdits = {
  task: string
  files: Record<string, number>
  contents?: Record<string, string>
  /** The commits this session's shell commands left at HEAD (`git commit` and the like), by time. */
  commits?: Record<string, number>
}

/** An edit older than this says nothing about what is uncommitted now. */
export const KEEP_MS = 3 * 24 * 3_600_000

/** The earliest time the records can still vouch for: anything before it has expired from them. */
export const editsKeptSince = (ctx: Ctx): number => ctx.clock.now() - KEEP_MS
export const CONTENT_LIMIT = 1024 * 1024

/** A bounded exact-content witness; missing, linked or large inputs remain unattributed. */
export async function editContent(
  ctx: Ctx,
  path: string,
  remaining: number,
): Promise<{ digest: string | null; charged: number }> {
  const cap = Math.min(remaining, CONTENT_LIMIT)
  if (!ctx.fs.readRegularFile || cap <= 0) return { digest: null, charged: 0 }
  try {
    const bytes = await ctx.fs.readRegularFile(path, cap)
    return { digest: createHash("sha256").update(bytes).digest("hex"), charged: bytes.length }
  } catch {
    // A failed read may already have consumed its allowance; never reuse those bytes for another file.
    return { digest: null, charged: cap }
  }
}

export const editsDir = (ctx: Ctx, repoId: string) => join(projectRuntimeDir(ctx, repoId), "edits")

export const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * Notes that the session `key`, building `task`, changed these files (absolute, or relative to
 * `cwd`). Returns the ones inside the repository.
 */
export type EditObservation = {
  repo: { id: string; root: string }
  key: string
  task: string
  cwd: string
  paths: string[]
}

export async function recordEdits(ctx: Ctx, observation: EditObservation): Promise<string[]> {
  const { repo, key, task, cwd, paths } = observation
  const inRepo = paths
    .map((path) => relative(repo.root, isAbsolute(path) ? path : resolve(cwd, path)))
    .filter((path) => path !== "" && !path.startsWith("..") && !isAbsolute(path))
    .map((path) => path.split(sep).join("/"))
  if (inRepo.length === 0) return []
  const file = join(editsDir(ctx, repo.id), `${key}.json`)
  const now = ctx.clock.now()
  const { files, contents, commits } = keptRecord(await readEdits(ctx, file), task, now)
  for (const path of inRepo) {
    files[path] = now
    delete contents[path]
  }
  // A large tool call retains its path history without making the hook hash an unbounded batch.
  let budget = 4 * CONTENT_LIMIT
  for (const path of inRepo.slice(0, 64)) {
    if (budget <= 0) break
    const size = await ctx.fs.stat?.(join(repo.root, path))
    if (!size || size.size > Math.min(budget, CONTENT_LIMIT)) continue
    const content = await editContent(ctx, join(repo.root, path), budget)
    budget -= content.charged
    if (content.digest !== null) contents[path] = content.digest
  }
  await writeRecord(ctx, repo.id, file, { task, files, contents, commits })
  return inRepo
}

/** What a session's record still holds for `task`: its entries that have not expired. */
export function keptRecord(
  before: SessionEdits | null,
  task: string,
  now: number,
): Required<SessionEdits> {
  const files: Record<string, number> = Object.create(null)
  const contents: Record<string, string> = Object.create(null)
  const commits: Record<string, number> = Object.create(null)
  if (before?.task !== task) return { task, files, contents, commits }
  for (const [path, at] of Object.entries(before.files))
    if (now - at < KEEP_MS) {
      files[path] = at
      const content = before.contents?.[path]
      if (typeof content === "string" && /^[a-f0-9]{64}$/.test(content)) contents[path] = content
    }
  for (const [sha, at] of Object.entries(asObject(before.commits) ?? {}))
    if (COMMIT_ID.test(sha) && typeof at === "number" && now - at < KEEP_MS) commits[sha] = at
  return { task, files, contents, commits }
}

export const COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export async function writeRecord(
  ctx: Ctx,
  repoId: string,
  file: string,
  record: Required<SessionEdits>,
): Promise<void> {
  const { task, files, contents, commits } = record
  await ctx.fs.mkdir(editsDir(ctx, repoId))
  await ctx.fs.atomicWrite(
    file,
    `${JSON.stringify({
      task,
      files,
      ...(Object.keys(contents).length ? { contents } : {}),
      ...(Object.keys(commits).length ? { commits } : {}),
    } satisfies SessionEdits)}\n`,
  )
}

/** Shell literals are hints, not native file receipts; never retain a path Git cannot identify. */
export async function recordShellEdits(ctx: Ctx, observation: EditObservation): Promise<string[]> {
  const { repo, cwd, paths } = observation
  const candidates = [
    ...new Set(
      paths.map((path) =>
        relative(repo.root, isAbsolute(path) ? path : resolve(cwd, path))
          .split(sep)
          .join("/"),
      ),
    ),
  ].filter(
    (path) => path !== "" && !path.startsWith("..") && !isAbsolute(path) && !path.includes("\0"),
  )
  if (!candidates.length) return []
  const listed = await ctx.git.run(repo.root, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...candidates.map((path) => `:(literal)${path}`),
  ])
  if (listed.code !== 0) return []
  const known = new Set(listed.stdout.split("\0").filter(Boolean))
  const missing = candidates.filter((path) => !known.has(path))
  if (missing.length) {
    const deleted = await ctx.git.run(repo.root, [
      "diff",
      "--name-only",
      "--diff-filter=D",
      "-z",
      "HEAD",
      "--",
      ...missing.map((path) => `:(literal)${path}`),
    ])
    if (deleted.code === 0)
      for (const path of deleted.stdout.split("\0").filter(Boolean)) known.add(path)
  }
  return recordEdits(ctx, {
    ...observation,
    cwd: repo.root,
    paths: candidates.filter((path) => known.has(path)),
  })
}

export async function readEdits(ctx: Ctx, file: string): Promise<SessionEdits | null> {
  try {
    if (!ctx.fs.readRegularFile) return null
    const bytes = await ctx.fs.readRegularFile(file, CONTENT_LIMIT)
    const read = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as Partial<SessionEdits>
    return typeof read.task === "string" && asObject(read.files) !== null
      ? (read as SessionEdits)
      : null
  } catch {
    return null
  }
}
