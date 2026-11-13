// Listing and reading transcript files for the usage count (usage.ts): the `.jsonl` files of a
// folder changed since a time, and a file read in chunks of whole lines.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { compressedLines, isCompressedRollout } from "../agents/codex-rollout.ts"

export type Candidate = { path: string; mtimeMs: number; size: number }
export type Candidates = Candidate[] & { partial?: string }

/** Files looked at, however large the home. */
export const FILES_MAX = 20_000
const CHUNK_BYTES = 8 * 1024 * 1024
export const DAY_MS = 24 * 60 * 60_000

/** The entries of a folder; none when it is not there. */
export async function listed(ctx: Ctx, dir: string) {
  try {
    return await ctx.fs.entries(dir)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []
    throw cause
  }
}

async function candidate(ctx: Ctx, path: string, since: number): Promise<Candidate | null> {
  const stat = await ctx.fs.stat?.(path)
  if (stat === null) throw new Error("Usage source metadata could not be read")
  return stat === undefined || stat.mtimeMs < since
    ? null
    : { path, mtimeMs: stat.mtimeMs, size: stat.size }
}

/** The `.jsonl` files (or the ones `keep` names) directly in `dir`, changed since `since`. */
export async function transcriptsIn(
  ctx: Ctx,
  dir: string,
  since: number,
  keep = (name: string) => name.endsWith(".jsonl"),
): Promise<Candidate[]> {
  const found: Candidate[] = []
  for (const entry of await listed(ctx, dir)) {
    if (entry.kind !== "file" || !keep(entry.name)) continue
    const one = await candidate(ctx, join(dir, entry.name), since)
    if (one !== null) found.push(one)
  }
  return found
}

/** Whole-line chunks of a file, each at most about `CHUNK_BYTES`. */
export async function* chunksOf(ctx: Ctx, path: string, size: number): AsyncGenerator<string> {
  if (isCompressedRollout(path)) {
    yield* compressedLines(path, CHUNK_BYTES)
    return
  }
  if (ctx.fs.readByteRange === undefined) {
    yield await ctx.fs.readFile(path)
    return
  }
  let offset = 0
  while (offset < size) {
    const bytes = await ctx.fs.readByteRange(path, offset, CHUNK_BYTES)
    if (bytes.length === 0) throw new Error("Usage source ended before its recorded size")
    const last = offset + bytes.length >= size
    const cut = last ? bytes.length : bytes.lastIndexOf(10) + 1
    // One line longer than a chunk is dropped: it cannot be a usage row.
    if (cut > 0) yield bytes.subarray(0, cut).toString("utf8")
    offset += cut === 0 ? bytes.length : cut
  }
}
