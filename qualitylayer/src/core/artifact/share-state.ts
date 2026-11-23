import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { ARTIFACT_SHARES_MAX, ARTIFACT_SHARES_MAX_BYTES } from "../home-caps.ts"
import { takeStoredName } from "./stored-state.ts"
import { safeArtifactPath } from "./workspace.ts"

export type SharedArtifactAddress = { scope: "task" | "project"; id: string; file: string }
export type ArtifactShare = {
  address: SharedArtifactAddress
  remoteId: string
  teamId: string
  ownerToken?: string
  group?: string | null
  revision?: string
  /** The newest version this machine saved or shared; the service holds the history. */
  version?: number
}
export type ArtifactShareHolder = { runtimeDir: string }
const shareFile = (holder: ArtifactShareHolder) => {
  takeStoredName(holder.runtimeDir, "design-team.json", "artifact-team.json")
  return join(holder.runtimeDir, "artifact-team.json")
}

function isValidArtifactShare(row: ArtifactShare): boolean {
  if (!row?.address || !["task", "project"].includes(row.address.scope)) return false
  const hasStrings =
    typeof row.address.id === "string" &&
    typeof row.address.file === "string" &&
    typeof row.remoteId === "string" &&
    typeof row.teamId === "string"
  return hasStrings && (row.ownerToken === undefined || typeof row.ownerToken === "string")
}

export async function readArtifactShares(
  ctx: Ctx,
  holder: ArtifactShareHolder,
): Promise<ArtifactShare[]> {
  if (!(await ctx.fs.exists(shareFile(holder)))) return []
  await safeArtifactPath(ctx, ctx.home, shareFile(holder))
  const text = await ctx.fs.readFile(shareFile(holder))
  if (Buffer.byteLength(text) > ARTIFACT_SHARES_MAX_BYTES)
    throw new Error("The artifact share registry exceeds its size limit.")
  const rows = JSON.parse(text) as ArtifactShare[]
  if (
    !Array.isArray(rows) ||
    rows.length > ARTIFACT_SHARES_MAX ||
    !rows.every(isValidArtifactShare)
  )
    throw new Error("The artifact share registry is invalid; recover it before sharing again.")
  return rows
}

export async function changeArtifactShares<T>(
  ctx: Ctx,
  holder: ArtifactShareHolder,
  change: (rows: ArtifactShare[]) => Promise<T>,
): Promise<T> {
  await safeArtifactPath(ctx, ctx.home, shareFile(holder))
  await ctx.fs.mkdir(holder.runtimeDir)
  return ctx.fs.withLock(join(holder.runtimeDir, "artifact-team.lock"), async () => {
    const rows = await readArtifactShares(ctx, holder)
    const result = await change(rows)
    const text = `${JSON.stringify(rows)}\n`
    if (rows.length > ARTIFACT_SHARES_MAX || Buffer.byteLength(text) > ARTIFACT_SHARES_MAX_BYTES)
      throw new Error(
        "This artifact share registry is full. Stop sharing an existing artifact first.",
      )
    await ctx.fs.atomicWrite(shareFile(holder), text)
    return result
  })
}
