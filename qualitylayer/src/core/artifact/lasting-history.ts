// A lasting artifact's history is git's: `git log` of the folder its files are in. It is kept in memory
// per artifact while HEAD and the folder stay as they were, so reading it again, and an open App that
// asks again on every file event, run no git at all. HEAD is read from `.git` without a process.
// A commit that a QualityLayer task recorded (`slice-commits.json`, written by `commit slice` and by
// a fold) carries the task's id and title.

import { join, resolve } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { recordLineTail } from "../docs/record-lines.ts"
import type { HistoryEntry } from "./format.ts"
import { LASTING_HISTORY_KEPT, LASTING_HISTORY_MAX } from "./format.ts"

/** What a commit says before it is matched to a task. */
type Commit = Omit<HistoryEntry, "task">

type Kept = { head: string; commits: Commit[]; truncated: boolean }
const kept = new Map<string, Kept>()

/** Forget every kept history (for the tests). */
export function clearHistoryCache(): void {
  kept.clear()
}

/** How many artifacts' histories are in memory (for the tests). */
/**
 * What HEAD stands at, read from `.git` without git: the branch it names and that branch's commit.
 * Null when anything about the checkout is not what this expects; the caller then asks git each time.
 */
export async function headOf(ctx: Ctx, root: string): Promise<string | null> {
  try {
    const dotGit = join(root, ".git")
    const kind = (await ctx.fs.lstat?.(dotGit))?.kind
    let gitDir = dotGit
    let common = dotGit
    if (kind === "file") {
      const pointer = /^gitdir:\s*(.+)$/m.exec(await ctx.fs.readFile(dotGit))?.[1]?.trim()
      if (pointer === undefined) return null
      gitDir = resolve(root, pointer)
      common = await ctx.fs
        .readFile(join(gitDir, "commondir"))
        .then((text) => resolve(gitDir, text.trim()))
        .catch(() => gitDir)
    } else if (kind !== "directory") return null
    const head = (await ctx.fs.readFile(join(gitDir, "HEAD"))).trim()
    const ref = head.startsWith("ref:") ? recordLineTail(head, 4, 0) : null
    if (ref === null) return /^[0-9a-f]{40,64}$/.test(head) ? head : null
    for (const base of [gitDir, common]) {
      const loose = await ctx.fs.readFile(join(base, ref)).catch(() => null)
      if (loose !== null && /^[0-9a-f]{40,64}\s*$/.test(loose)) return `${ref}@${loose.trim()}`
    }
    const packed = await ctx.fs.readFile(join(common, "packed-refs")).catch(() => "")
    for (const line of packed.split("\n")) {
      const [sha, name] = line.split(" ")
      if (name?.trim() === ref && sha !== undefined) return `${ref}@${sha}`
    }
    return `${ref}@none`
  } catch {
    return null
  }
}

/** The commits that touched `folder` (a path from the repository's root), newest first; at most the cap. */
async function logOf(ctx: Ctx, root: string, folder: string): Promise<Kept> {
  const run = await ctx.git.run(root, [
    "log",
    `-n${LASTING_HISTORY_MAX + 1}`,
    "--format=%H%x1f%ct%x1f%s",
    "--",
    `:(literal)${folder}`,
  ])
  const commits: Commit[] = []
  if (run.code === 0)
    for (const line of run.stdout.split("\n")) {
      const [sha, at, ...subject] = line.split("\x1f")
      if (sha === undefined || !/^[0-9a-f]{40,64}$/.test(sha)) continue
      commits.push({
        sha,
        at: Number(at) * 1000,
        subject: subject.join("\x1f").trim(),
      })
    }
  return {
    head: "",
    commits: commits.slice(0, LASTING_HISTORY_MAX),
    truncated: commits.length > LASTING_HISTORY_MAX,
  }
}

/** The task a commit belongs to, from what tasks recorded; undefined for a commit no task made. */
export type CommitOwners = (sha: string) => { id: string; title: string } | undefined

/**
 * The history of a folder: its commits with the task each belongs to. Kept while HEAD and the folder
 * stand, so a second call runs no git. The task of a commit is looked up on each call (the record is
 * written a beat after the commit).
 */
export async function folderHistory(
  ctx: Ctx,
  root: string,
  folder: string,
  owners: CommitOwners = () => undefined,
): Promise<{ entries: HistoryEntry[]; truncated: boolean }> {
  const key = `${root}\0${folder}`
  const head = await headOf(ctx, root)
  let found = head === null ? undefined : kept.get(key)
  if (found === undefined || found.head !== head) {
    found = { ...(await logOf(ctx, root, folder)), head: head ?? "" }
    if (head !== null) {
      kept.delete(key)
      kept.set(key, found)
      while (kept.size > LASTING_HISTORY_KEPT) kept.delete(kept.keys().next().value as string)
    }
  } else {
    kept.delete(key)
    kept.set(key, found)
  }
  return {
    entries: found.commits.map((commit) => {
      const task = owners(commit.sha)
      return task === undefined ? { ...commit } : { ...commit, task }
    }),
    truncated: found.truncated,
  }
}

// ---------------------------------------------------------------- which task made a commit

type Stamped = { mtimeMs: number; size: number; shas: string[] }
const recorded = new Map<string, Stamped>()
const RECORDS_KEPT = 1000

/** What a task recorded as its commits, read again only when the record's size or time changed. */
async function recordedShas(ctx: Ctx, runtimeDir: string): Promise<string[]> {
  const path = join(runtimeDir, "slice-commits.json")
  const seen = await ctx.fs.stat?.(path)
  if (seen === null || seen === undefined) return []
  const hit = recorded.get(path)
  if (hit !== undefined && hit.mtimeMs === seen.mtimeMs && hit.size === seen.size) return hit.shas
  let shas: string[] = []
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(path)) as unknown
    shas = Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string" && /^[0-9a-f]{4,64}$/i.test(s))
      : []
  } catch {
    shas = []
  }
  if (recorded.size >= RECORDS_KEPT) recorded.delete(recorded.keys().next().value as string)
  recorded.set(path, { mtimeMs: seen.mtimeMs, size: seen.size, shas })
  return shas
}

/** Who made which commit: the tasks' own records of the commits `commit slice` and a fold made. */
export async function commitOwners(
  ctx: Ctx,
  tasks: { id: string; title: string; runtimeDir: string }[],
): Promise<CommitOwners> {
  const byRecorded = new Map<string, { id: string; title: string }>()
  const lengths = new Set<number>()
  for (const task of tasks)
    for (const sha of await recordedShas(ctx, task.runtimeDir)) {
      byRecorded.set(sha.toLowerCase(), { id: task.id, title: task.title })
      lengths.add(sha.length)
    }
  return (sha) => {
    for (const length of lengths) {
      const owner = byRecorded.get(sha.slice(0, length).toLowerCase())
      if (owner !== undefined) return owner
    }
    return undefined
  }
}
