import type { Ctx } from "../../ctx.ts"
import type { MemoryExchangeResult } from "../../memory-contracts.ts"
import type { ProjectRow } from "../../memory-store/catalog.ts"
import { MemoryExportBatch } from "./export-batch.ts"
import { MemoryExportPreflight } from "./export-preflight.ts"
import type { MemoryCatalogAdapter } from "./index.ts"
import { type MemoryRepositoryIO, openMemoryRepository } from "./repository-io.ts"
import { memoryIssue, memoryResult } from "./result.ts"

export type MemoryExportCatalog = Pick<
  MemoryCatalogAdapter,
  "meta" | "conflict" | "published" | "acceptExistingRepository"
>

/** Receives an already registered, locked capability; the dry run never changes repository bytes. */
export async function exchangeFiles(
  io: MemoryRepositoryIO,
  catalog: MemoryExportCatalog,
  project: ProjectRow,
  now: number,
) {
  const result = memoryResult()
  try {
    catalog.acceptExistingRepository(project.id)
    const accepted = catalog.published(project.id)
    const preview = await MemoryExportPreflight.capture(io)
    await new MemoryExportBatch(preview, catalog, project, now, false).run(accepted)
    await preview.assertUnchanged()
    return await new MemoryExportBatch(io, catalog, project, now, true).run(accepted)
  } catch (cause) {
    memoryIssue(result, cause, "Could not prepare memory export")
    return result
  }
}

/** Export never accepts repository lessons into the local catalog. Consent remains project-local. */
export async function exchangeRecords(
  ctx: Ctx,
  catalog: MemoryCatalogAdapter,
  project: ProjectRow,
): Promise<MemoryExchangeResult> {
  if (!project.git || !project.sharing) return memoryResult()
  const io = await openMemoryRepository(ctx, project)
  try {
    return await io.lock("memory-export", () =>
      exchangeFiles(io, catalog, project, ctx.clock.now()),
    )
  } finally {
    io.close()
  }
}
