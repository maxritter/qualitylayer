import type { Ctx } from "../../ctx.ts"
import type { MemoryRecord } from "../../memory-contracts.ts"
import type { MemoryCatalogAdapter } from "./index.ts"
import { retirementMetadata } from "./lifecycle.ts"
import { ancestryOf, portableRecord } from "./portable.ts"
import { publicationText, validateRecord } from "./validation.ts"

/** Reconciliation is an explicit new revision; neither candidate wins by timestamp or origin. */
export function reconcileRecord(
  ctx: Ctx,
  db: MemoryCatalogAdapter,
  input: {
    project: string
    id: string
    revision: number
    candidate: string
    fingerprints?: string[]
  },
): MemoryRecord {
  const { project, id, revision, candidate } = input
  const old = db.read(id)
  if (!old || old.project !== project) throw new Error("The lesson was not found in this project")
  if (old.revision !== revision)
    throw new Error("The lesson changed; read its current revision before reconciling")
  const conflicts = db.conflictsFor(project, id)
  if (!conflicts.length) throw new Error("This lesson has no retained conflict")
  if (
    input.fingerprints &&
    (input.fingerprints.length !== conflicts.length ||
      conflicts.some((item) => !input.fingerprints?.includes(item.fingerprint)))
  )
    throw new Error("The versions changed; refresh them before choosing")
  const selected =
    candidate === "local" ? old : conflicts.find((c) => c.fingerprint === candidate)?.record
  if (!selected) throw new Error("Unknown conflict candidate; inspect memory conflicts first")
  if (selected.origin !== old.origin || selected.project !== old.project)
    throw new Error("Conflict candidate belongs to another identity")
  const parents = conflicts.map((c) => c.record)
  const record: MemoryRecord = {
    ...selected,
    revision: Math.max(old.revision, ...parents.map((r) => r.revision)) + 1,
    updatedAt: Math.max(ctx.clock.now(), old.updatedAt, selected.updatedAt),
    ancestry: ancestryOf(old, ...parents),
  }
  validateRecord(record)
  const previous = db.publication(record.id)
  const exported =
    record.visibility === "project"
      ? record
      : previous
        ? {
            ...previous,
            state: "retired" as const,
            revision: record.revision,
            updatedAt: record.updatedAt,
            ancestry: ancestryOf(previous, ...parents),
          }
        : undefined
  if (exported) publicationText(portableRecord(exported))
  db.atomic(() => {
    db.save(record, exported)
    db.setMeta(`retired:${id}`, retirementMetadata(record.retirement))
    db.clearConflicts(project, id)
  })
  return record
}
