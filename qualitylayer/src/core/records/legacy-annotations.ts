import type { Ctx } from "../../ctx.ts"
import { itemAnswerBytes, readItemAnswers } from "../task/item-answer-store.ts"
import { type AnswerAuthority, answerAuthorityHash } from "../task/item-answers.ts"
import { archiveRecords, writeArchiveSnapshot } from "./archive.ts"
import {
  ANNOTATION_ASSET_BYTES,
  ANSWERS_FILE,
  type AnnotationMigration,
  archivePath,
  jsonBytes,
  MIGRATION_FILE,
  migrationState,
  type RecordOwner,
  recordHash,
} from "./contract.ts"
import { readOptionalRecordBytes, readRecordBytes, recordFileIO, writeRecordText } from "./files.ts"
import { buildAnnotationArchive, retainedAnnotationAnswers } from "./legacy-archive.ts"
import {
  annotationSourceIndex,
  readAnnotationSources,
  type AnnotationSource as Source,
} from "./legacy-sources.ts"
import { validateRecordOwner } from "./owner.ts"

export { buildAnnotationArchive } from "./legacy-archive.ts"
export { annotationSourceIndex, readAnnotationSources } from "./legacy-sources.ts"

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes)

async function state(ctx: Ctx, owner: RecordOwner): Promise<AnnotationMigration | null> {
  const bytes = await readOptionalRecordBytes(ctx, owner, MIGRATION_FILE, 64 * 1024)
  return bytes ? migrationState(JSON.parse(decode(bytes)), owner.key) : null
}

async function locked<T>(ctx: Ctx, owner: RecordOwner, run: () => Promise<T>): Promise<T> {
  await validateRecordOwner(ctx, owner)
  return (await recordFileIO(ctx, owner)).lock("annotation-migration", run)
}

/** An explicit upgrade operation prepares one owner; the current reader never calls this. */
export async function prepareAnnotationMigration(
  ctx: Ctx,
  owner: RecordOwner,
  authority: AnswerAuthority,
): Promise<AnnotationMigration> {
  return locked(ctx, owner, async () => {
    const prior = await state(ctx, owner)
    if (prior) return prior
    const rows = await readAnnotationSources(ctx, owner)
    // Validate every retained shape before creating an incomplete marker.
    retainedAnnotationAnswers(rows, authority)
    const prepared: AnnotationMigration = {
      schema: 1,
      owner: owner.key,
      status: "incomplete",
      sources: annotationSourceIndex(rows),
      authority: answerAuthorityHash(authority),
    }
    await writeRecordText(ctx, owner, MIGRATION_FILE, jsonBytes(prepared))
    return prepared
  })
}

async function commitConversion(
  ctx: Ctx,
  owner: RecordOwner,
  prepared: AnnotationMigration,
  rows: Source[],
  authority: AnswerAuthority,
) {
  const answers = itemAnswerBytes(owner, retainedAnnotationAnswers(rows, authority))
  const archive = await buildAnnotationArchive(ctx, owner, rows)
  for (const output of archive.outputs)
    await writeArchiveSnapshot(ctx, owner, output.file, output.bytes)
  for (const copy of archive.copies)
    if (copy.bytes)
      await writeArchiveSnapshot(ctx, owner, archivePath(`assets/${copy.asset.id}`), copy.bytes)
  const manifest = jsonBytes(archive.manifest)
  await writeArchiveSnapshot(
    ctx,
    owner,
    archivePath("manifest.json"),
    new TextEncoder().encode(manifest),
  )
  await writeArchiveSnapshot(ctx, owner, ANSWERS_FILE, new TextEncoder().encode(answers))
  if (
    jsonBytes(prepared.sources) !==
    jsonBytes(annotationSourceIndex(await readAnnotationSources(ctx, owner)))
  )
    throw new Error("Legacy sources changed during conversion; originals were kept")
  for (const copy of archive.copies)
    if (
      copy.source &&
      recordHash(
        await readRecordBytes(ctx, copy.source.owner, copy.source.file, ANNOTATION_ASSET_BYTES),
      ) !== copy.asset.sha256
    )
      throw new Error("Legacy attachment changed during conversion")
  const complete: AnnotationMigration = {
    ...prepared,
    status: "complete",
    archive: recordHash(manifest),
    answers: recordHash(answers),
  }
  await writeRecordText(ctx, owner, MIGRATION_FILE, jsonBytes(complete))
  return complete
}

/** Only explicitly incomplete state reaches the old converter; completed owners use current readers. */
export async function migrateAnnotationHistory(
  ctx: Ctx,
  owner: RecordOwner,
  authority: AnswerAuthority,
) {
  return locked(ctx, owner, async () => {
    const prepared = await state(ctx, owner)
    if (!prepared) throw new Error("Prepare this owner's annotation migration explicitly")
    if (prepared.status === "complete") {
      await archiveRecords(ctx, owner)
      await readItemAnswers(ctx, owner)
      return prepared
    }
    if (prepared.authority !== answerAuthorityHash(authority))
      throw new Error("Answer bindings changed before conversion")
    const rows = await readAnnotationSources(ctx, owner)
    if (jsonBytes(prepared.sources) !== jsonBytes(annotationSourceIndex(rows)))
      throw new Error("Legacy sources changed before conversion; originals were kept")
    return commitConversion(ctx, owner, prepared, rows, authority)
  })
}
