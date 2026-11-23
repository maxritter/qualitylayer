import { join, relative } from "node:path"
import type { Ctx } from "../../ctx.ts"
import {
  ANNOTATION_ASSET_BYTES,
  type ArchiveAsset,
  fields,
  plainFilename,
  type RecordOwner,
  recordHash,
  text,
  token,
} from "./contract.ts"
import { readRecordBytes } from "./files.ts"

export type LegacyAttachmentCopy = {
  asset: ArchiveAsset
  bytes?: Uint8Array
  source?: { owner: RecordOwner; file: string }
}

type LegacyAttachmentRef = {
  name: string
  type: string
  path: string
  size?: unknown
  missing?: unknown
}

function resolveLegacyOwner(
  owner: RecordOwner,
  record: { id: string },
  reference: LegacyAttachmentRef,
  owners: readonly RecordOwner[],
): RecordOwner | undefined {
  if (!token(record.id) || !plainFilename(reference.name)) return undefined
  return owners.find(
    (candidate) =>
      candidate.home === owner.home &&
      candidate.key === owner.key &&
      reference.path === join(candidate.runtimeDir, "attachments", record.id, reference.name),
  )
}

function classifyLegacyReadError(cause: unknown, asset: ArchiveAsset): LegacyAttachmentCopy {
  const code = (cause as NodeJS.ErrnoException).code
  if (code === "ENOENT") return { asset }
  if (
    code === "ELOOP" ||
    (cause instanceof Error && cause.message === "Linked or non-directory record path")
  )
    return { asset: { ...asset, state: "unsafe" } }
  throw cause
}

/** Legacy paths are migration evidence; only an exact owner attachment path may supply bytes. */
export async function readLegacyAttachment(
  ...args: [
    ctx: Ctx,
    owner: RecordOwner,
    record: { id: string },
    raw: unknown,
    id: string,
    owners?: readonly RecordOwner[],
  ]
): Promise<LegacyAttachmentCopy> {
  const [ctx, owner, record, raw, id, owners = [owner]] = args
  if (!fields(raw, { name: text, type: text, path: text }))
    throw new Error("Corrupt legacy attachment; originals were kept")
  const reference = raw as LegacyAttachmentRef
  const asset: ArchiveAsset = {
    id,
    name: reference.name,
    type: reference.type,
    state: "missing",
    bytes: 0,
  }
  if (reference.missing === true || reference.path === "") return { asset }
  const selected = resolveLegacyOwner(owner, record, reference, owners)
  if (!selected) return { asset: { ...asset, state: "unsafe" } }
  const source = relative(selected.runtimeDir, reference.path)
  try {
    const bytes = await readRecordBytes(ctx, selected, source, ANNOTATION_ASSET_BYTES)
    if (reference.size !== bytes.length)
      throw new Error("Legacy attachment changed size; originals were kept")
    return {
      asset: { ...asset, state: "available", bytes: bytes.length, sha256: recordHash(bytes) },
      bytes,
      source: { owner: selected, file: source },
    }
  } catch (cause) {
    return classifyLegacyReadError(cause, asset)
  }
}
