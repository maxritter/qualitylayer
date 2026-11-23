import { randomUUID } from "node:crypto"
import type { MemoryService } from "../core/memory/index.ts"
import { verifySources } from "../core/memory/pilot-source/files.ts"
import { words } from "../core/memory/pilot-source/normalize.ts"
import { scanPilotSource } from "../core/memory/pilot-source/scan.ts"
import type { PilotCancelResult, PilotScan } from "../pilot-memory-contracts.ts"
import { applyPilotScan, type PilotSavedScan, stopPilotScan } from "./pilot-memory-apply.ts"
import {
  mapPilotSelection,
  parsePilotSelection,
  parsePilotSourceInput,
} from "./pilot-memory-input.ts"

type Writer = Partial<Pick<MemoryService, "reviewPilotRecords" | "importPilotRecords">>
type Saved = PilotSavedScan
const SCAN_LIFETIME = 10 * 60_000

function listGroupRecords(saved: Saved, input: Record<string, unknown>) {
  const group = words(input.group)
  const offset = input.offset ?? 0
  if (!saved.source.groups.has(group) || !Number.isSafeInteger(offset) || Number(offset) < 0)
    throw new Error("Choose a source group and record page.")
  const rows = saved.source.records.filter((record) => record.group === group)
  return {
    total: rows.length,
    items: rows.slice(Number(offset), Number(offset) + 50).map((record) => ({
      id: record.sourceId,
      title: record.title,
      category: record.category,
      preview: record.content,
      state: record.state,
      ...(record.excluded ? { excluded: record.excluded } : {}),
    })),
  }
}

export class PilotMemoryMigration {
  private readonly scans = new Map<string, Saved>()
  private readonly receipts = new Map<string, { result: PilotCancelResult; expiresAt: number }>()
  private scanning = false
  constructor(private readonly now: () => number) {}

  private expire() {
    for (const [id, saved] of this.scans)
      if (!saved.applying && saved.scan.expiresAt < this.now()) this.scans.delete(id)
    for (const [id, saved] of this.receipts)
      if (saved.expiresAt < this.now()) this.receipts.delete(id)
  }

  private saved(id: unknown): Saved {
    this.expire()
    const saved = this.scans.get(words(id))
    if (!saved)
      throw new Error("This memory preview expired or was cancelled. Scan the source again.")
    return saved
  }

  private async scan(input: Record<string, unknown>, signal: AbortSignal): Promise<PilotScan> {
    this.expire()
    if (this.scanning || this.scans.size >= 2) {
      throw new Error(
        "A memory preview is already open. Finish or cancel it before scanning another source.",
      )
    }
    this.scanning = true
    try {
      const request = parsePilotSourceInput(input)
      const source = await scanPilotSource(request, signal)
      if (signal.aborted) throw new Error("Memory scan was cancelled.")
      const id = randomUUID()
      const scan: PilotScan = {
        id,
        source: request.kind,
        expiresAt: this.now() + SCAN_LIFETIME,
        groups: [...source.groups.values()],
        counts: source.counts,
        issues: source.issues,
        privateKnowledge: source.privateKnowledge,
        ...(source.archiveAt ? { archiveAt: source.archiveAt } : {}),
      }
      this.scans.set(id, { source, scan, applying: false })
      return scan
    } finally {
      this.scanning = false
    }
  }

  private async cancelScan(scanId: unknown): Promise<PilotCancelResult> {
    const id = words(scanId)
    const cached = this.receipts.get(id)
    if (cached) {
      if (!this.scans.get(id)?.applying) this.scans.delete(id)
      return cached.result
    }
    const saved = this.saved(scanId)
    const wasApplying = saved.applying
    const result = await stopPilotScan(saved)
    this.receipts.set(saved.scan.id, { result, expiresAt: this.now() + SCAN_LIFETIME })
    if (this.receipts.size > 20) {
      const oldest = this.receipts.keys().next().value
      if (oldest !== undefined) this.receipts.delete(oldest)
    }
    if (!wasApplying) this.scans.delete(saved.scan.id)
    return result
  }

  private async reviewOrApply(
    action: "review" | "apply",
    saved: Saved,
    input: Record<string, unknown>,
    service: Writer,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (saved.applying) throw new Error("This memory import is already running.")
    const selected = mapPilotSelection(saved, parsePilotSelection(input))
    if (!service.reviewPilotRecords || !service.importPilotRecords)
      throw new Error("This memory service cannot import local Pilot sources.")
    if (action === "review") {
      await verifySources(saved.source.stamps, signal)
      return await service.reviewPilotRecords(selected.records, selected.leftOut)
    }
    if (!selected.records.length) throw new Error("Choose at least one memory destination.")
    this.receipts.delete(saved.scan.id)
    return await applyPilotScan(saved, selected, service.importPilotRecords.bind(service), signal)
  }

  async handle(
    action: string,
    input: Record<string, unknown>,
    service: Writer,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (action === "scan") return await this.scan(input, signal)
    this.expire()
    if (action === "cancel") return await this.cancelScan(input.scan)
    const saved = this.saved(input.scan)
    if (action === "records") return listGroupRecords(saved, input)
    if (action !== "review" && action !== "apply")
      throw new Error("Unknown Pilot memory operation.")
    return await this.reviewOrApply(action, saved, input, service, signal)
  }
}
