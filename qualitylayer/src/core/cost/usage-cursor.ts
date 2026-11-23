import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { USAGE_IMPORT_ACCOUNT_MAX_BYTES, USAGE_IMPORT_ACCOUNTS_MAX } from "../home-caps.ts"
import { zeroTokens } from "./prices.ts"
import type { Call } from "./transcripts.ts"
import { CURSOR_EXPORT_MAX_BYTES, cursorExportCalls, cursorHash } from "./usage-cursor-csv.ts"
import { type Candidate, listed, transcriptsIn } from "./usage-files.ts"
import type { ChunkParser } from "./usage-parsers.ts"

export { CURSOR_EXPORT_MAX_BYTES, cursorExportCalls }

const folder = (ctx: Ctx) => join(ctx.home, "usage-imports")

export async function importCursorExport(
  ctx: Ctx,
  file: string,
  from: number,
  to: number,
  account = "default",
): Promise<number> {
  return ctx.fs.withLock(join(ctx.home, "usage-imports.lock"), () =>
    importCursorRows(ctx, file, from, to, account),
  )
}

async function readTextLimited(ctx: Ctx, file: string, maxBytes: number): Promise<string> {
  return ctx.fs.readRegularFile
    ? Buffer.from(await ctx.fs.readRegularFile(file, maxBytes)).toString("utf8")
    : ctx.fs.readFile(file)
}

async function readRetainedCursorCalls(
  ctx: Ctx,
  destination: string,
  from: number,
  to: number,
): Promise<Call[]> {
  if (!(await ctx.fs.exists(destination))) return []
  const old = await readTextLimited(ctx, destination, USAGE_IMPORT_ACCOUNT_MAX_BYTES)
  const rows = old
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  if (rows[0]?.type !== "cursor-export" || rows[0]?.schema !== 1)
    throw new Error("Retained Cursor export is damaged; it was not replaced")
  const parser = cursorUsageParser()
  parser.chunk(old)
  const parsed = parser.finish()
  if (parsed.length !== rows.length - 1)
    throw new Error("Retained Cursor export is damaged; it was not replaced")
  return parsed.filter((call) => call.at !== null && (call.at < from || call.at > to))
}

async function importCursorRows(
  ctx: Ctx,
  file: string,
  from: number,
  to: number,
  account: string,
): Promise<number> {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 91 * 86400_000)
    throw new Error("Cursor export range must be at most 91 days")
  const text = await readTextLimited(ctx, file, CURSOR_EXPORT_MAX_BYTES)
  const accountId = cursorHash(account)
  const calls = cursorExportCalls(text, accountId)
  if (calls.some((call) => call.at === null || call.at < from || call.at > to))
    throw new Error("Cursor export contains events outside the requested range")
  const fileName = `${accountId}-cursor.jsonl`
  const destination = join(folder(ctx), fileName)
  const entries = (await listed(ctx, folder(ctx))).filter(
    (entry) => entry.kind === "file" && entry.name.endsWith("-cursor.jsonl"),
  )
  if (entries.length >= USAGE_IMPORT_ACCOUNTS_MAX && !entries.some((e) => e.name === fileName))
    throw new Error("At most 16 Cursor account exports may be retained")
  const previous = await ctx.fs.stat?.(destination)
  const kept = await readRetainedCursorCalls(ctx, destination, from, to)
  const merged = new Map(kept.concat(calls).map((call) => [call.id, call]))
  const capturedAt = ctx.clock.now()
  const lines = [
    JSON.stringify({
      type: "cursor-export",
      schema: 1,
      capturedAt,
      from,
      to: Math.min(to, capturedAt),
    }),
    ...[...merged.values()].map((call) => JSON.stringify({ type: "cursor.usage", call })),
  ]
  const output = `${lines.join("\n")}\n`
  if (Buffer.byteLength(output) > USAGE_IMPORT_ACCOUNT_MAX_BYTES)
    throw new Error("Retained Cursor export exceeds 8 MiB; import a shorter range")
  await ctx.fs.mkdir(folder(ctx), { mode: 0o700 })
  await ctx.fs.atomicWrite(destination, output)
  const written = await ctx.fs.stat?.(destination)
  if (previous && written && written.mtimeMs <= previous.mtimeMs)
    await ctx.fs.touch?.(destination, previous.mtimeMs + 1)
  return calls.length
}

const TOKEN_KEYS = Object.keys(zeroTokens()) as (keyof Call["tokens"])[]

function validCursorCall(call: Call | undefined): call is Call & { id: string } {
  if (!call || typeof call.id !== "string" || call.id.length > 256) return false
  if (typeof call.at !== "number" || !Number.isFinite(call.at)) return false
  if (typeof call.model !== "string" || call.model.length > 256) return false
  if (!call.tokens) return false
  return TOKEN_KEYS.every((key) => {
    const n = call.tokens[key]
    return typeof n === "number" && Number.isFinite(n) && n >= 0
  })
}

export function cursorUsageParser(): ChunkParser {
  const calls = new Map<string, Call>()
  return {
    chunk(text) {
      for (const line of text.split("\n")) {
        try {
          const row = JSON.parse(line)
          const call = row.call as Call | undefined
          if (row.type === "cursor.usage" && validCursorCall(call)) calls.set(call.id, call)
        } catch {
          /* Skip torn records. */
        }
      }
    },
    finish: () => [...calls.values()],
  }
}
export async function cursorUsageFiles(
  ctx: Ctx,
  _base: string,
  since: number,
): Promise<Candidate[]> {
  return (await transcriptsIn(ctx, folder(ctx), since)).filter((file) =>
    file.path.endsWith("-cursor.jsonl"),
  )
}
export async function cursorCoverage(ctx: Ctx): Promise<string | null> {
  const files = (await listed(ctx, folder(ctx))).filter(
    (entry) => entry.kind === "file" && entry.name.endsWith("-cursor.jsonl"),
  )
  if (files.length === 0) return "Provider usage export required"
  return "Provider export snapshot; later usage is not included"
}
