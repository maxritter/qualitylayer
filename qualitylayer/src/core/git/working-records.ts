import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { WORKING_CLOSED_KEEP_MS, WORKING_EVENTS_MAX, WORKING_FILE_MAX_BYTES } from "../home-caps.ts"

export { admitWorkingRecord } from "./working-admit.ts"
export {
  clearWorkingRecords,
  closeWorkingRecords,
  deleteWorkingRecords,
  endWorkingCalls,
  expireWorkingRecords,
  reopenWorkingRecords,
} from "./working-lifecycle.ts"

export const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex")
export const workingTaskKey = (task: { repoId: string; slug: string }) =>
  digest(`${task.repoId}\0${task.slug}`)
export type WorkingOperation = {
  path: string
  from?: string
  before: string | null
  after: string | null
}
export type WorkingRecord = {
  id: string
  task: string
  repository?: string
  session: string
  agent: string
  run: string
  generation: number
  head?: string
  verified?: true
  input: string
  at: number
  end?: number
  closed?: number
  state: "pending" | "verified" | "ambiguous" | "failed" | "unavailable"
  operations: WorkingOperation[]
}
export type WorkingLedger = {
  version: 1
  records: WorkingRecord[]
  objects: Record<string, number>
}
export const LEDGER_BYTES = 8 * 1024 * 1024
const empty = (): WorkingLedger => ({ version: 1, records: [], objects: {} })
export const workingDirectory = (ctx: Ctx) => join(ctx.home, "working-changes")
export const workingObjectPath = (ctx: Ctx, hash: string) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid saved file identity")
  return join(workingDirectory(ctx), "objects", hash)
}
export const hashesOfRecord = (record: WorkingRecord) =>
  record.operations
    .flatMap((op) => [op.before, op.after])
    .filter((hash): hash is string => hash !== null)

const isSha256 = (value: string) => /^[a-f0-9]{64}$/.test(value)

function isValidLedgerShape(ledger: WorkingLedger): boolean {
  if (ledger.version !== 1 || !Array.isArray(ledger.records)) return false
  if (ledger.records.length > WORKING_EVENTS_MAX) return false
  return typeof ledger.objects === "object" && ledger.objects !== null
}

function validateRecord(row: WorkingRecord) {
  if (
    !isSha256(row.id) ||
    !isSha256(row.task) ||
    !Array.isArray(row.operations) ||
    row.operations.length > 64
  )
    throw new Error("Invalid saved change record")
  if (hashesOfRecord(row).some((hash) => !isSha256(hash)))
    throw new Error("Invalid saved source identity")
}

export async function readWorkingLedger(ctx: Ctx): Promise<WorkingLedger> {
  const path = join(workingDirectory(ctx), "index.json")
  if (!(await ctx.fs.exists(path))) return empty()
  if (!ctx.fs.readRegularFile) throw new Error("Safe saved-change reads are unavailable")
  const safe = ctx.fs.forPublication?.(ctx.home, workingDirectory(ctx))
  if (!safe?.readRegularFile) throw new Error("Safe saved-change reads are unavailable")
  const body = await safe.readRegularFile(path, LEDGER_BYTES)
  const ledger = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as WorkingLedger
  if (!isValidLedgerShape(ledger)) throw new Error("Saved change history is unavailable")
  for (const row of ledger.records) validateRecord(row)
  return ledger
}

export async function pruneWorkingLedger(ctx: Ctx, ledger: WorkingLedger) {
  const now = ctx.clock.now()
  for (const row of ledger.records)
    if (row.closed !== undefined && now - row.closed >= WORKING_CLOSED_KEEP_MS)
      row.state = "unavailable"
  const used = new Set(
    ledger.records.filter((row) => row.state !== "unavailable").flatMap(hashesOfRecord),
  )
  for (const hash of Object.keys(ledger.objects)) {
    if (used.has(hash)) continue
    await ctx.fs.remove(workingObjectPath(ctx, hash))
    delete ledger.objects[hash]
  }
}

/** One short metadata transaction; it never locks the person's working files. */
export async function updateWorkingLedger<T>(
  ctx: Ctx,
  change: (ledger: WorkingLedger) => Promise<T>,
): Promise<T> {
  const dir = workingDirectory(ctx)
  await ctx.fs.mkdir(dir, { mode: 0o700 })
  await ctx.fs.assertSafeDirectory?.(dir)
  return ctx.fs.withLock(
    join(dir, ".metadata.lock"),
    async () => {
      const ledger = await readWorkingLedger(ctx)
      await pruneWorkingLedger(ctx, ledger)
      const result = await change(ledger)
      const body = JSON.stringify(ledger)
      if (Buffer.byteLength(body) > LEDGER_BYTES)
        throw new Error("Saved change history reached its limit")
      await ctx.fs.atomicWrite(join(dir, "index.json"), body)
      return result
    },
    { waitMs: 10, label: "saved workflow changes" },
  )
}

/** Source is read only after the caller establishes task + part membership. */
export async function workingSource(
  ctx: Ctx,
  hash: string,
  maxBytes = WORKING_FILE_MAX_BYTES,
): Promise<string> {
  if (!ctx.fs.readRegularFile) throw new Error("Safe saved source reads are unavailable")
  const safe = ctx.fs.forPublication?.(ctx.home, workingDirectory(ctx))
  if (!safe?.readRegularFile) throw new Error("Safe saved source reads are unavailable")
  const bytes = await safe.readRegularFile(
    workingObjectPath(ctx, hash),
    Math.min(maxBytes, WORKING_FILE_MAX_BYTES),
  )
  if (digest(bytes) !== hash) throw new Error("Saved file version changed")
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (text.includes("\0")) throw new Error("Binary saved source")
  return text
}
