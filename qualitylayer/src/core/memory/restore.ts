import type { Ctx } from "../../ctx.ts"
import {
  type MemoryEngine,
  type MemoryExchangeResult,
  type MemoryRecord,
  PERSONAL_PROJECT,
} from "../../memory-contracts.ts"
import type { ProjectRow } from "../../memory-store/catalog.ts"
import type { GitObjectReader } from "./git-object.ts"
import type { MemoryCatalogAdapter } from "./index.ts"
import { retirementMetadata } from "./lifecycle.ts"
import { portableDigest, portableRecord, relation } from "./portable.ts"
import { repositoryRecords } from "./repository.ts"
import { openMemoryRepository } from "./repository-io.ts"
import { MemoryRepositorySnapshot } from "./repository-snapshot.ts"
import { memoryIssue, memoryResult } from "./result.ts"
import { MEMORY_INDEX_ISSUE, publicationText } from "./validation.ts"

function restoreOne(
  catalog: MemoryCatalogAdapter,
  project: string,
  wire: MemoryRecord,
): "skipped" | "conflicts" | MemoryRecord {
  if (wire.source === "pilot" || wire.project === PERSONAL_PROJECT || wire.provenance)
    throw new Error("Invalid exported memory provenance")
  publicationText(wire)
  const imported: MemoryRecord = {
    ...portableRecord(wire),
    project,
    source: "repository",
    provenance: { project: wire.project, source: wire.source },
  }
  const old = catalog.read(wire.id)
  if (old && (old.project !== project || old.origin !== wire.origin))
    throw new Error("Memory identity belongs to another project or origin")
  if (old) {
    // An exact old tracked copy can recover provenance discarded by the earlier exchange format.
    if (
      !old.provenance &&
      old.source === "repository" &&
      portableDigest({ ...old, project: wire.project, source: wire.source }) ===
        portableDigest(wire)
    ) {
      const recovered = { ...old, provenance: imported.provenance }
      catalog.save(recovered, recovered)
      return "skipped"
    }
    const state = relation(old, imported)
    if (state === "same" || state === "older") return "skipped"
    if (state === "conflict") {
      catalog.conflict(project, imported)
      return "conflicts"
    }
  }
  catalog.atomic(() => {
    catalog.save(imported, imported, { wireProject: wire.project })
    catalog.setMeta(`retired:${imported.id}`, retirementMetadata(imported.retirement))
  })
  return imported
}

async function indexRestored(
  catalog: MemoryCatalogAdapter,
  engine: MemoryEngine,
  record: MemoryRecord,
  issue: (message: string) => void,
) {
  try {
    if (record.state === "retired") await engine.remove(record.project, record.id)
    else await engine.upsert(record.project, record)
    catalog.acknowledgeIndex(record.id, record.revision)
    catalog.healIndex(record.project)
  } catch {
    catalog.failIndex(record.project)
    issue(MEMORY_INDEX_ISSUE)
  }
}

/** Uses the same tracked-file and identity checks as restore without accepting any lesson. */
export async function countRepositoryRecords(
  ctx: Ctx,
  project: ProjectRow,
  readObject?: GitObjectReader,
): Promise<number> {
  const io = await openMemoryRepository(ctx, project)
  try {
    const snapshot = await MemoryRepositorySnapshot.capture(ctx, project.root, io, readObject)
    try {
      const { found } = await repositoryRecords(ctx, snapshot, () => {})
      return new Set(found.map(({ record }) => record.id)).size
    } finally {
      await snapshot.close()
    }
  } finally {
    io.close()
  }
}

/** Explicitly accept this repository's historical evidence into the local project. */
export async function restoreRecords(
  ctx: Ctx,
  catalog: MemoryCatalogAdapter,
  project: ProjectRow,
  engine?: MemoryEngine,
  readObject?: GitObjectReader,
): Promise<MemoryExchangeResult> {
  const result = memoryResult()
  const issue = (message: string) => memoryIssue(result, null, message)
  if (!project.git) throw new Error("Repository restore requires a Git project")
  const io = await openMemoryRepository(ctx, project)
  try {
    const snapshot = await MemoryRepositorySnapshot.capture(ctx, project.root, io, readObject)
    try {
      const { found, skipped } = await repositoryRecords(ctx, snapshot, issue)
      result.skipped += skipped
      const importedIds = new Set<string>()
      for (const { record: wire, path, oid } of found) {
        try {
          snapshot.assertCurrent()
          const restored = restoreOne(catalog, project.id, wire)
          if (typeof restored === "string") {
            result[restored]++
            if (restored === "conflicts")
              issue(
                `Preserved conflicting revision for ${wire.id}; use memory conflicts and reconcile`,
              )
            continue
          }
          catalog.seen(project.id, path, oid)
          importedIds.add(restored.id)
          if (engine) await indexRestored(catalog, engine, restored, issue)
        } catch (cause) {
          result.skipped++
          memoryIssue(result, cause, "Malformed repository memory")
        }
      }
      result.imported = importedIds.size
      return result
    } finally {
      await snapshot.close()
    }
  } finally {
    io.close()
  }
}
