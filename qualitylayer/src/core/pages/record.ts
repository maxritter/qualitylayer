// What QualityLayer last wrote into a task's documents: one fingerprint per marked section. The
// record lives in the task's runtime folder, so the files stay as people read them; it tells
// QualityLayer's own text from an agent's edit of it.

import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { normalizedLineEnds } from "../text-boundaries.ts"
import type { LaneRow } from "./lanes.ts"

/** Per document (its name from the task folder): per marker key. */
export type PagesRecord = Record<string, Record<string, string>>

const recordPath = (runtimeDir: string) => join(runtimeDir, "pages.json")

/** Keep a generated document and its ownership record in one cross-process transaction. */
export function withPagesLock<T>(
  ctx: Ctx,
  runtimeDir: string,
  action: () => Promise<T>,
): Promise<T> {
  return ctx.fs.withLock(join(runtimeDir, "pages.lock"), action, {
    createParent: false,
    label: "updating task documents",
  })
}

/** The fingerprint of a text as QualityLayer compares it: line endings and trailing blanks aside. */
export const fingerprint = (text: string): string =>
  createHash("sha256").update(normalizedLineEnds(text).trim()).digest("hex").slice(0, 16)

export async function readPagesRecord(ctx: Ctx, runtimeDir: string): Promise<PagesRecord> {
  const path = recordPath(runtimeDir)
  if (!(await ctx.fs.exists(path))) return {}
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(path)) as unknown
    return parsed !== null && typeof parsed === "object" ? (parsed as PagesRecord) : {}
  } catch {
    return {}
  }
}

export async function writePagesRecord(
  ctx: Ctx,
  runtimeDir: string,
  record: PagesRecord,
): Promise<void> {
  await ctx.fs.mkdir(runtimeDir)
  await ctx.fs.atomicWrite(recordPath(runtimeDir), `${JSON.stringify(record, null, 2)}\n`)
}

/**
 * Whether a marked section's text is QualityLayer's: empty (a marker an
 * agent or a template just placed, for QualityLayer to fill), or what it last wrote there. A marker
 * QualityLayer has not filled yet holds nothing. A document it never wrote (a task copied from
 * another machine, whose runtime folder stayed behind) is taken as it stands.
 */
export function ownText(
  doc: Record<string, string> | undefined,
  key: string,
  text: string,
): boolean {
  if (text.trim() === "") return true
  if (doc === undefined) return true
  return doc[key] === fingerprint(text)
}

/**
 * The lanes of Verify as the board draws them: who runs each check and how it stands. The people's
 * file holds one line per stage; the lanes behind those lines are this record, refreshed with them.
 */
export type VerifyLanesRecord = { at: number; lanes: LaneRow[] }

const lanesPath = (runtimeDir: string) => join(runtimeDir, "verify-lanes.json")

export async function readVerifyLanes(
  ctx: Ctx,
  runtimeDir: string,
): Promise<VerifyLanesRecord | null> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(lanesPath(runtimeDir))) as VerifyLanesRecord
    return Array.isArray(parsed.lanes) ? parsed : null
  } catch {
    return null
  }
}

/** Written only when the lanes change, so a refresh that changes nothing touches no file. */
export async function writeVerifyLanes(
  ctx: Ctx,
  runtimeDir: string,
  lanes: readonly LaneRow[],
  at: number,
): Promise<void> {
  const before = await readVerifyLanes(ctx, runtimeDir)
  if (before !== null && JSON.stringify(before.lanes) === JSON.stringify(lanes)) return
  await ctx.fs.mkdir(runtimeDir)
  await ctx.fs.atomicWrite(lanesPath(runtimeDir), `${JSON.stringify({ at, lanes })}\n`)
}
