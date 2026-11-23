// Task documents the server parses on every request (a task's identity front matter, its cards, its
// build log, the three step documents) are parsed once per file stamp. A hit costs one `stat`. The
// file watcher drops a path's entries the moment it reports the path, so a rewrite of the same size
// in the same instant still gives the new text. Everything that changes without a document edit
// (checkout changes, cost, identity, live state, time) is computed on every request and never kept.

import { type BuildLog, implementAgentsPath, parseBuildLog } from "../core/docs/build-log.ts"
import { type Frontmatter, type ParsedDoc, parseDoc } from "../core/docs/frontmatter.ts"
import { readmePath, type Task } from "../core/task/store.ts"
import type { Ctx } from "../ctx.ts"

/** All entries together, by the UTF-8 size of the source text they were parsed from. */
export const DOC_CACHE_BYTES = 32 * 1024 * 1024
/** A document over this is parsed and not kept. */
export const DOC_CACHE_MAX_DOC = 2 * 1024 * 1024

type Entry = { stamp: string; parsed: Map<string, unknown>; bytes: number }

/** The least recently read path is first: a `Map` keeps insertion order and a read re-inserts. */
const entries = new Map<string, Entry>()
let kept = 0

function forget(path: string): void {
  const entry = entries.get(path)
  if (entry === undefined) return
  kept -= entry.bytes
  entries.delete(path)
}

function getCached<T>(
  path: string,
  stamp: string,
  kind: string,
): { hit: true; value: T } | { hit: false } {
  const entry = entries.get(path)
  if (entry === undefined) return { hit: false }
  if (entry.stamp !== stamp) {
    forget(path)
    return { hit: false }
  }
  if (!entry.parsed.has(kind)) return { hit: false }
  entries.delete(path)
  entries.set(path, entry)
  return { hit: true, value: entry.parsed.get(kind) as T }
}

function storeEntry(
  path: string,
  stamp: string,
  kind: string,
  parsed: unknown,
  bytes: number,
): void {
  const current = entries.get(path)
  if (current !== undefined && current.stamp === stamp) {
    if (!current.parsed.has(kind)) {
      current.bytes += bytes
      kept += bytes
    }
    current.parsed.set(kind, parsed)
    entries.delete(path)
    entries.set(path, current)
  } else {
    forget(path)
    entries.set(path, { stamp, parsed: new Map([[kind, parsed]]), bytes })
    kept += bytes
  }
  evictOverBudget(path)
}

function evictOverBudget(keepPath: string): void {
  for (const [oldest, old] of entries) {
    if (kept <= DOC_CACHE_BYTES) break
    if (oldest === keepPath) continue
    kept -= old.bytes
    entries.delete(oldest)
  }
}

export const docCache = {
  /** Bytes kept now. */
  get bytes(): number {
    return kept
  },
  get size(): number {
    return entries.size
  },
  /** Forget one document, at a watcher event for its path. */
  drop(path: string): void {
    forget(path)
  },
  /** Forget everything: the resource guard's drop, and a watcher event for a folder. */
  clear(): void {
    entries.clear()
    kept = 0
  },
  /**
   * `path` parsed by `parse`, or null when there is no such file. `kind` names the parse, since one file
   * can be read as a document, an outline or a log. Without a `stat` on the file system the file is read each time.
   */
  async read<T>(
    ctx: Ctx,
    path: string,
    kind: string,
    parse: (text: string) => T,
  ): Promise<T | null> {
    if (ctx.fs.stat === undefined)
      return (await ctx.fs.exists(path)) ? parse(await ctx.fs.readFile(path)) : null
    const seen = await ctx.fs.stat(path)
    if (seen === null) {
      forget(path)
      return null
    }
    const stamp = `${seen.mtimeMs}:${seen.size}`
    const cached = getCached<T>(path, stamp, kind)
    if (cached.hit) return cached.value
    const text = await ctx.fs.readFile(path)
    const parsed = parse(text)
    const bytes = Buffer.byteLength(text, "utf8")
    // The stamp is from before the read: a file changed in between differs at the next stat.
    if (bytes <= DOC_CACHE_MAX_DOC) storeEntry(path, stamp, kind, parsed, bytes)
    return parsed
  },
}

/** A document parsed into its front matter and body. */
export const cachedDoc = (ctx: Ctx, path: string): Promise<ParsedDoc | null> =>
  docCache.read(ctx, path, "doc", parseDoc)

/** A task's README front matter; `{}` when it has none. */
export async function cachedFrontmatter(ctx: Ctx, task: Pick<Task, "dir">): Promise<Frontmatter> {
  return (await cachedDoc(ctx, readmePath(task)))?.frontmatter ?? {}
}

/** A task's build notes (the Implement agents' file), as written and parsed; null before a build began. */
export const cachedBuildLog = (
  ctx: Ctx,
  task: Pick<Task, "dir">,
): Promise<{ text: string; log: BuildLog } | null> =>
  docCache.read(ctx, implementAgentsPath(task), "build-log", (text) => ({
    text,
    log: parseBuildLog(text),
  }))
