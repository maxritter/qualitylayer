import type { Ctx } from "../../ctx.ts"
import type { MemoryRecord } from "../../memory-contracts.ts"
import { PERSONAL_PROJECT } from "../../memory-contracts.ts"
import type { PilotCandidate, PilotReceipt, PilotReview } from "../../pilot-memory-contracts.ts"
import type { MemoryCatalogAdapter } from "./index.ts"
import { planPilotRecords, requirePilotCapacity } from "./pilot-identities.ts"
import {
  EMBED_BATCH_SIZE,
  flushEmbeddings,
  indexMigratedRecord,
  pushIssue,
  receiptGroup,
  saveMigratedItem,
} from "./pilot-migration-helpers.ts"
import type { MemoryProjects } from "./projects.ts"
import type { MemoryRuntime } from "./runtime.ts"

export type MappedPilotRecord = { record: PilotCandidate; project: string }

export class PilotMigrationWriter {
  constructor(
    private readonly ctx: Ctx,
    private readonly runtime: MemoryRuntime,
    private readonly projects: MemoryProjects,
  ) {}

  async review(input: MappedPilotRecord[], leftOut: number): Promise<PilotReview> {
    const db = await this.runtime.catalog()
    for (const { record, project } of input) {
      if (record.excluded || record.state !== "active") continue
      if (project !== PERSONAL_PROJECT) this.projects.get(db, project)
    }
    const result = planPilotRecords(db, input, leftOut)
    requirePilotCapacity(db, result)
    return result
  }

  private async applyItem(
    db: MemoryCatalogAdapter,
    item: MappedPilotRecord,
    receipt: PilotReceipt,
    vectors: MemoryRecord[],
    signal?: AbortSignal,
  ): Promise<void> {
    const group = receiptGroup(receipt, item.record.group, item.project)
    try {
      const outcome = saveMigratedItem(db, this.projects, item, this.ctx.clock.now())
      if (outcome.state === "same") {
        receipt.alreadyImported++
        group.alreadyImported++
        return
      }
      receipt.imported++
      group.imported++
      await indexMigratedRecord(this.runtime, outcome.record, receipt, signal)
      vectors.push(outcome.record)
      if (vectors.length === EMBED_BATCH_SIZE) {
        await flushEmbeddings(this.runtime, db, vectors, receipt, signal)
      }
    } catch (error) {
      receipt.failed++
      group.failed++
      pushIssue(
        receipt,
        error instanceof Error ? error.message : "A Pilot memory could not be imported.",
      )
    }
  }

  async apply(
    input: MappedPilotRecord[],
    leftOut: number,
    signal?: AbortSignal,
  ): Promise<PilotReceipt> {
    if (input.some((item) => item.project === PERSONAL_PROJECT)) {
      await this.projects.registerPersonal()
    }
    return await this.runtime.mutate(async (db) => {
      if (!this.projects.enabled(db)) throw new Error("Local memory is paused")
      for (const item of input) this.projects.get(db, item.project)
      requirePilotCapacity(db, planPilotRecords(db, input, leftOut))
      const receipt: PilotReceipt = {
        imported: 0,
        updated: 0,
        alreadyImported: 0,
        leftOut,
        failed: 0,
        issues: [],
        groups: [],
      }
      const vectors: MemoryRecord[] = []
      for (let at = 0; at < input.length; at++) {
        if (signal?.aborted) {
          receipt.leftOut += input.length - at
          receipt.issues.push(
            "Import cancelled. Memories already saved were kept; retrying will not duplicate them.",
          )
          break
        }
        const item = input[at]
        if (!item || item.record.excluded || item.record.state !== "active") {
          receipt.leftOut++
          continue
        }
        await this.applyItem(db, item, receipt, vectors, signal)
      }
      await flushEmbeddings(this.runtime, db, vectors, receipt, signal)
      return receipt
    })
  }
}
