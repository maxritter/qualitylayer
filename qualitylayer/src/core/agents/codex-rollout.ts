// Codex's session rollouts: `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. Codex compresses a
// rollout whose last write is a week old into one zstd stream beside it, `<name>.jsonl.zst`, and
// removes the plain file; resuming the session writes it back to `.jsonl` first. The lines inside
// are the same. Codex reads the plain file when both are there (codex-rs/rollout/src/compression.rs).
// A compressed rollout is finished, so what was decompressed is kept, bounded, by path, size and time.

import { createReadStream, readFileSync, statSync } from "node:fs"
import { stat } from "node:fs/promises"
import { basename } from "node:path"
import { createZstdDecompress } from "node:zlib"
import { RolloutWindow } from "./rollout-window.ts"

const PLAIN = ".jsonl"
const COMPRESSED = ".jsonl.zst"

export const isCompressedRollout = (path: string) => path.endsWith(COMPRESSED)

/** `rollout-….jsonl` or `rollout-….jsonl.zst`. */
export function isRollout(path: string): boolean {
  const name = basename(path)
  return name.startsWith("rollout-") && (name.endsWith(PLAIN) || name.endsWith(COMPRESSED))
}

/** The rollout of one session: `rollout-<time>-<id>.jsonl`, plain or compressed. */
export const isRolloutOf = (name: string, id: string) =>
  name.startsWith("rollout-") &&
  (name.endsWith(`-${id}${PLAIN}`) || name.endsWith(`-${id}${COMPRESSED}`))

/** The session id of `rollout-<YYYY-MM-DDTHH-MM-SS>-<id>.jsonl[.zst]`, or of `rollout-<id>.jsonl[.zst]`. */
export const rolloutId = (path: string) =>
  /^rollout-(?:\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-)?(.+)\.jsonl(?:\.zst)?$/.exec(
    basename(path),
  )?.[1]

/** Each session once: a compressed rollout whose plain file is listed too is left out, as Codex does. */
export function oncePerSession<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
  const plain = new Set(items.map(pathOf).filter((path) => !isCompressedRollout(path)))
  return items.filter((item) => {
    const path = pathOf(item)
    return !isCompressedRollout(path) || !plain.has(path.slice(0, -".zst".length))
  })
}

export const ROLLOUT_CACHE = {
  /** The most decompressed bytes kept of one rollout; a longer one is read again when asked. */
  entryBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  /** A compressed rollout this small is read in one go where the caller cannot wait. */
  syncBytes: 4 * 1024 * 1024,
}
/** Decompressed starts or wholes, by path, size and change time, the oldest let go first. */
const kept = new Map<string, { bytes: Buffer; whole: boolean }>()
let keptBytes = 0

const keyOf = (path: string, info: { size: number; mtimeMs: number }) =>
  `${path}\0${info.size}\0${info.mtimeMs}`

function held(key: string) {
  const entry = kept.get(key)
  if (entry !== undefined) {
    kept.delete(key)
    kept.set(key, entry)
  }
  return entry
}

function keep(key: string, bytes: Buffer, whole: boolean, most = ROLLOUT_CACHE.entryBytes): void {
  if (bytes.length > most) return
  const prior = kept.get(key)
  if (prior !== undefined) keptBytes -= prior.bytes.length
  kept.delete(key)
  kept.set(key, { bytes, whole })
  keptBytes += bytes.length
  for (const [old, entry] of kept) {
    if (keptBytes <= ROLLOUT_CACHE.totalBytes) break
    kept.delete(old)
    keptBytes -= entry.bytes.length
  }
}

/** A compressed rollout's decompressed bytes as they come, never more than one piece at a time. */
async function* decompressed(path: string): AsyncGenerator<Buffer> {
  const source = createReadStream(path, { highWaterMark: 256 * 1024 })
  const stream = createZstdDecompress()
  source.on("error", (cause) => stream.destroy(cause))
  source.pipe(stream)
  try {
    for await (const piece of stream) yield piece as Buffer
  } finally {
    source.destroy()
    stream.destroy()
  }
}

/** The first `bytes` of a compressed rollout, and whether there is more; null when it cannot be read. */
export async function readCompressedHead(
  path: string,
  bytes: number,
): Promise<{ text: string; more: boolean } | null> {
  try {
    const key = keyOf(path, await stat(path))
    let entry = held(key)
    if (entry === undefined || (!entry.whole && entry.bytes.length < bytes)) {
      const pieces: Buffer[] = []
      let got = 0
      let whole = true
      for await (const piece of decompressed(path)) {
        pieces.push(piece)
        got += piece.length
        if (got >= bytes) {
          whole = false
          break
        }
      }
      entry = { bytes: Buffer.concat(pieces), whole }
      keep(key, entry.bytes, whole)
    }
    return {
      text: entry.bytes.subarray(0, bytes).toString("utf8"),
      more: !entry.whole || entry.bytes.length > bytes,
    }
  } catch {
    return null
  }
}

/** Keep exact byte windows for proof readers without retaining the decompressed middle. */
export async function readCompressedWindow(
  path: string,
  headBytes: number,
  tailBytes: number,
): Promise<{ size: number; head: Buffer; tail: Buffer } | null> {
  const window = new RolloutWindow(headBytes, tailBytes)
  try {
    const key = keyOf(path, await stat(path))
    const cached = held(key)
    if (cached?.whole)
      return {
        size: cached.bytes.length,
        head: cached.bytes.subarray(0, headBytes),
        tail: cached.bytes.subarray(Math.max(0, cached.bytes.length - tailBytes)),
      }
    for await (const piece of decompressed(path)) window.append(piece)
    const frame = window.frame()
    if (frame.size <= headBytes + tailBytes)
      keep(
        key,
        Buffer.concat([frame.head.subarray(0, frame.size - frame.tail.length), frame.tail]),
        true,
      )
    return frame
  } catch {
    return null
  }
}

/** A compressed rollout as text in chunks of whole lines, each about `chunkBytes`; it ends where it cannot be read. */
export async function* compressedLines(
  path: string,
  chunkBytes = 8 * 1024 * 1024,
): AsyncGenerator<string> {
  let carry: Buffer = Buffer.alloc(0)
  try {
    for await (const piece of decompressed(path)) {
      carry = carry.length === 0 ? piece : Buffer.concat([carry, piece])
      if (carry.length < chunkBytes) continue
      const cut = carry.lastIndexOf(10) + 1
      if (cut === 0) continue
      yield carry.subarray(0, cut).toString("utf8")
      carry = carry.subarray(cut)
    }
  } catch {
    return
  }
  if (carry.length > 0) yield carry.toString("utf8")
}

/** A whole compressed rollout; null when it cannot be read. */
export async function readCompressed(path: string): Promise<Buffer | null> {
  try {
    const key = keyOf(path, await stat(path))
    const entry = held(key)
    if (entry?.whole) return entry.bytes
    const pieces: Buffer[] = []
    for await (const piece of decompressed(path)) pieces.push(piece)
    const bytes = Buffer.concat(pieces)
    keep(key, bytes, true)
    return bytes
  } catch {
    return null
  }
}

/**
 * A whole compressed rollout read at once, for a reader that polls and cannot wait. It is kept
 * (up to the whole cache) so a poll does not decompress it again; null for a rollout too big for that.
 */
export function readCompressedSync(path: string): Buffer | null {
  try {
    const info = statSync(path)
    const key = keyOf(path, info)
    const entry = held(key)
    if (entry?.whole) return entry.bytes
    if (info.size > ROLLOUT_CACHE.syncBytes) return null
    const bytes = Buffer.from(Bun.zstdDecompressSync(readFileSync(path)))
    if (bytes.length > ROLLOUT_CACHE.totalBytes) return null
    keep(key, bytes, true, ROLLOUT_CACHE.totalBytes)
    return bytes
  } catch {
    return null
  }
}
