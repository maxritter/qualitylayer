import type { MemoryRecord } from "../../memory-contracts.ts"
import { hash } from "./identity.ts"

export { hash, segment } from "./identity.ts"
export { relativeFile, validateInput } from "./input-validation.ts"
export * from "./limits.ts"
export { publicationText, safeText } from "./privacy.ts"
export { validateRecord, validateRepositoryRecord } from "./record-validation.ts"
export const eligibilityDigest = (record: MemoryRecord): string =>
  hash(
    JSON.stringify([
      record.id,
      record.project,
      record.origin,
      record.kind,
      record.title,
      record.content,
      record.tags,
      record.files,
      record.source,
      record.evidence,
    ]),
  )

export function pageSize(value?: number): number {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
    throw new Error("Invalid memory page size")
  return Math.min(value ?? 30, 100)
}

export function preview(record: MemoryRecord) {
  const { content, ...metadata } = record
  return { ...metadata, preview: content.slice(0, 240) }
}
