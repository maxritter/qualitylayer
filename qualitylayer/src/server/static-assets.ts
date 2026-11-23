import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { gzip } from "node:zlib"

const compress = promisify(gzip)
const MAX_RAW_BYTES = 16 * 1024 * 1024
type Entry = { tag: string; encoded?: Uint8Array<ArrayBuffer>; attempted: boolean }

function acceptsGzip(header: string | null): boolean {
  const values = new Map(
    (header ?? "")
      .toLowerCase()
      .split(",")
      .map((part) => {
        const [name, ...parameters] = part.trim().split(";")
        const quality = parameters
          .find((value) => value.trim().startsWith("q="))
          ?.trim()
          .slice(2)
        return [name, quality === undefined ? 1 : Number(quality)] as const
      }),
  )
  return (values.get("gzip") ?? values.get("*") ?? 0) > 0
}

type CacheLimits = { entries: number; bytes: number }
type CacheState = {
  limits: CacheLimits
  cache: Map<string, Entry>
  pending: Map<string, Promise<Entry>>
  bytes: number
}

function rememberEntry(state: CacheState, key: string, entry: Entry) {
  state.bytes -= state.cache.get(key)?.encoded?.byteLength ?? 0
  state.cache.delete(key)
  if ((entry.encoded?.byteLength ?? 0) > state.limits.bytes) return
  state.cache.set(key, entry)
  state.bytes += entry.encoded?.byteLength ?? 0
  while (state.cache.size > state.limits.entries || state.bytes > state.limits.bytes) {
    const oldest = state.cache.keys().next().value
    if (oldest === undefined) break
    state.bytes -= state.cache.get(oldest)?.encoded?.byteLength ?? 0
    state.cache.delete(oldest)
  }
}

async function prepareEntry(
  state: CacheState,
  key: string,
  file: ReturnType<typeof Bun.file>,
  zip: boolean,
  heldTag?: string,
): Promise<Entry> {
  const raw = new Uint8Array(await file.arrayBuffer())
  const tag = heldTag ?? createHash("sha256").update(raw).digest("hex").slice(0, 32)
  let output: Uint8Array<ArrayBuffer> | undefined
  if (zip) {
    try {
      output = new Uint8Array(await compress(raw))
    } catch {
      /* Identity remains usable if compression is unavailable. */
    }
  }
  const entry: Entry = {
    tag,
    attempted: zip,
    ...(output && output.length < raw.length ? { encoded: output } : {}),
  }
  rememberEntry(state, key, entry)
  return entry
}

async function waitForPendingSlot(pending: Map<string, Promise<Entry>>) {
  await Promise.race(
    [...pending.values()].map((work) =>
      work.then(
        () => undefined,
        () => undefined,
      ),
    ),
  )
}

async function loadAssetEntry(
  state: CacheState,
  key: string,
  file: ReturnType<typeof Bun.file>,
  encoded: boolean,
): Promise<Entry> {
  const held = state.cache.get(key)
  if (held && (!encoded || held.attempted)) {
    rememberEntry(state, key, held)
    return held
  }
  const inFlight = state.pending.get(key)
  if (inFlight) {
    await inFlight
    return loadAssetEntry(state, key, file, encoded)
  }
  // Only two file buffers/compression jobs are live, even during parallel cold asset requests.
  if (state.pending.size >= 2) {
    await waitForPendingSlot(state.pending)
    return loadAssetEntry(state, key, file, encoded)
  }
  const work = prepareEntry(state, key, file, encoded, held?.tag)
  state.pending.set(key, work)
  try {
    return await work
  } finally {
    state.pending.delete(key)
  }
}

function etagMatches(header: string | null, tag: string): boolean {
  return (header ?? "")
    .split(",")
    .some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === tag)
}

function shouldCompressAsset(request: Request, type: string, size: number): boolean {
  const text = /^(?:text\/(?:javascript|css)|application\/javascript)(?:;|$)/i.test(type)
  return (
    text &&
    size >= 1024 &&
    size <= MAX_RAW_BYTES &&
    acceptsGzip(request.headers.get("accept-encoding"))
  )
}

/** Only the public, immutable application assets use this cache; task and API responses do not. */
export function createStaticAssets(limits = { entries: 16, bytes: 8 * 1024 * 1024 }) {
  const state: CacheState = {
    limits,
    cache: new Map<string, Entry>(),
    pending: new Map<string, Promise<Entry>>(),
    bytes: 0,
  }
  return {
    stats: () => ({ entries: state.cache.size, bytes: state.bytes, pending: state.pending.size }),
    async serve(request: Request, path: string, type: string): Promise<Response> {
      const file = Bun.file(path)
      const key = `${path}:${file.size}:${file.lastModified}`
      const zip = shouldCompressAsset(request, type, file.size)
      const entry = await loadAssetEntry(state, key, file, zip)
      const encoded = zip ? entry.encoded : undefined
      const tag = `"${entry.tag}${encoded ? "-gzip" : ""}"`
      const headers = new Headers({
        "content-type": type,
        "cache-control": "no-cache",
        vary: "Accept-Encoding",
        etag: tag,
        "content-length": String(encoded?.byteLength ?? file.size),
      })
      if (encoded) headers.set("content-encoding", "gzip")
      const matches = etagMatches(request.headers.get("if-none-match"), tag)
      return new Response(matches || request.method === "HEAD" ? null : (encoded ?? file), {
        status: matches ? 304 : 200,
        headers,
      })
    },
  }
}
