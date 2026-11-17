import type { Ctx } from "../../ctx.ts"
import { isCompressedRollout, readCompressedWindow } from "../agents/codex-rollout.ts"

export const MAX_SESSION_RECORD_BYTES = 8 * 1024 * 1024
const MAX_BYTES = MAX_SESSION_RECORD_BYTES
const HEADER_BYTES = 1024 * 1024
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Read only the identity header and bounded record body; no proof is issued here. */
export async function readSessionRecord(
  ctx: Ctx,
  agent: string,
  file: string,
): Promise<string | null> {
  if (isCompressedRollout(file)) {
    const frame = await readCompressedWindow(file, HEADER_BYTES, MAX_BYTES - HEADER_BYTES)
    if (frame === null) return null
    const whole =
      frame.size <= MAX_BYTES
        ? Buffer.concat([frame.head.subarray(0, frame.size - frame.tail.length), frame.tail])
        : null
    return framedRecord(agent, frame.size, async (offset, length) => {
      if (whole !== null) return whole.subarray(offset, offset + length).toString("utf8")
      const bytes = offset === 0 ? frame.head : frame.tail
      const start = offset === 0 ? 0 : offset - (frame.size - frame.tail.length)
      return bytes.subarray(start, start + length).toString("utf8")
    })
  }
  const info = await ctx.fs.stat?.(file)
  if (!info) return null
  return framedRecord(
    agent,
    info.size,
    ctx.fs.readRange
      ? async (offset, length) => (await ctx.fs.readRange?.(file, offset, length)) ?? ""
      : undefined,
    () => ctx.fs.readFile(file),
  )
}

/** A record within `MAX_BYTES`: whole, or its identity rows and its last bytes. */
async function framedRecord(
  agent: string,
  size: number,
  range: ((offset: number, length: number) => Promise<string>) | undefined,
  whole?: () => Promise<string>,
): Promise<string | null> {
  if (size > MAX_BYTES) {
    if (!range) return null
    const head = await range(0, HEADER_BYTES)
    const tail = await range(size - MAX_BYTES + HEADER_BYTES, MAX_BYTES - HEADER_BYTES)
    // Only complete rows are evidence; the window edges can cut through JSON or UTF-8.
    const headerRows = head
      .slice(0, head.lastIndexOf("\n") + 1)
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => object(JSON.parse(line)))
    if (!headerRows.length) return null
    const identity =
      agent === "claude-code"
        ? headerRows.map((row) => ({ sessionId: row?.sessionId }))
        : headerRows.filter(
            (row) =>
              row?.type === "session" ||
              row?.type === "session_meta" ||
              row?.type === "session.start",
          )
    return `${identity.map((row) => JSON.stringify(row)).join("\n")}\n${JSON.stringify({ type: "qualitylayer_omitted_prefix" })}\n${tail.slice(tail.indexOf("\n") + 1, tail.lastIndexOf("\n") + 1)}`
  }
  const text = range ? await range(0, MAX_BYTES + 1) : ((await whole?.()) ?? "")
  return Buffer.byteLength(text) > MAX_BYTES ? null : text
}
