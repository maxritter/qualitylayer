// One download for every pinned tool: the official release URL (or a loopback override in tests),
// a time and byte budget, and a SHA-256 that must equal the one pinned in source. Nothing here
// decides which tool or version; the callers pin both.

import { createHash } from "node:crypto"
import type { Ctx } from "../../ctx.ts"
import { addressOverride } from "../licence/address-policy.ts"

export type PinnedFile = {
  /** The pinned release folder, e.g. `https://github.com/qltysh/qlty/releases/download/v0.657.0`. */
  release: string
  /** The environment variable a test sets to a loopback server instead. */
  overrideEnv: string
  /** The asset's name in the release. */
  file: string
  sha256: string
  /** Most bytes the asset may have. */
  limit: number
  /** Most milliseconds the download may take, at most two minutes. */
  timeoutMs: number
  /** The tool's name in errors: "Qlty", "Betterleaks". */
  label: string
}

export function sha256Of(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function isAllowedBaseUrl(base: URL, loopback: boolean, release: string): boolean {
  if (base.username || base.password || base.search || base.hash) return false
  if (loopback && (base.protocol === "http:" || base.protocol === "https:")) return true
  return base.href.replace(/\/$/, "") === release
}

function resolvePinnedTarget(ctx: Ctx, pin: PinnedFile): { url: string; loopback: boolean } {
  const { label } = pin
  if (!Number.isSafeInteger(pin.timeoutMs) || pin.timeoutMs < 1 || pin.timeoutMs > 120_000)
    throw new Error(`${label} download deadline must be between 1 and 120000ms`)
  const override = addressOverride(ctx.env, pin.overrideEnv)
  const base = new URL(override ?? pin.release)
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  if (!isAllowedBaseUrl(base, loopback, pin.release))
    throw new Error(
      `${label} release override must be loopback HTTP(S) or the pinned official release`,
    )
  return { url: `${base.href.replace(/\/$/, "")}/${pin.file}`, loopback }
}

async function readPinnedBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  limit: number,
  label: string,
  onCancel: (cancel: () => void) => void,
): Promise<Uint8Array> {
  const reader = body.getReader()
  onCancel(() => {
    void reader.cancel().catch(() => {})
  })
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    signal.throwIfAborted()
    const { value, done } = await reader.read()
    signal.throwIfAborted()
    if (done) break
    size += value.length
    if (size > limit) throw new Error(`${label} download exceeds its byte budget`)
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Downloads one pinned asset and returns its bytes only when their SHA-256 is the pinned one. */
export async function fetchPinned(ctx: Ctx, pin: PinnedFile): Promise<Uint8Array> {
  const { label } = pin
  const { url, loopback } = resolvePinnedTarget(ctx, pin)
  const controller = new AbortController()
  let cancelBody: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      cancelBody?.()
      reject(new Error(`${label} download exceeded its time budget`))
    }, pin.timeoutMs)
  })
  const download = async (): Promise<Uint8Array> => {
    const response = await ctx.http.fetch(url, {
      signal: controller.signal,
      redirect: loopback ? "error" : "follow",
    })
    cancelBody = () => {
      void response.body?.cancel().catch(() => {})
    }
    if (controller.signal.aborted) cancelBody()
    controller.signal.throwIfAborted()
    if (!response.ok || response.body === null)
      throw new Error(`${label} download answered HTTP ${response.status}`)
    if (Number(response.headers.get("content-length")) > pin.limit)
      throw new Error(`${label} download exceeds its byte budget`)
    const bytes = await readPinnedBody(response.body, controller.signal, pin.limit, label, (fn) => {
      cancelBody = fn
    })
    if (sha256Of(bytes) !== pin.sha256)
      throw new Error(`${label} download SHA256 differs from the pinned release`)
    return bytes
  }
  try {
    return await Promise.race([expired, download()])
  } finally {
    clearTimeout(timer)
    cancelBody?.()
  }
}
