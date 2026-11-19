import type { Ctx } from "../../ctx.ts"
import type {
  MemoryExchangeResult,
  MemoryRecord,
  MemoryRepositoryApi,
  MemoryRepositoryOperation,
  MemoryRepositoryVersion,
} from "../../memory-contracts.ts"
import { exchangeRecords } from "./exchange.ts"
import type { MemoryService, MemoryServiceOptions } from "./index.ts"
import type { MemoryProjects } from "./projects.ts"
import { VECTOR_MODEL } from "./ranking.ts"
import { reconcileRecord } from "./reconcile.ts"
import { countRepositoryRecords, restoreRecords } from "./restore.ts"
import { type MemoryRuntime, VECTORS_PER_SEARCH } from "./runtime.ts"

const versionOf = ({ title, content, revision, state }: MemoryRecord): MemoryRepositoryVersion => ({
  title,
  content,
  revision,
  state,
})

export class MemoryPortability {
  constructor(
    private readonly ctx: Ctx,
    private readonly runtime: MemoryRuntime,
    private readonly projects: MemoryProjects,
    private readonly options: MemoryServiceOptions,
  ) {}
  async preview(projectId: string, operation: MemoryRepositoryOperation) {
    const db = await this.runtime.catalog()
    const project = this.projects.get(db, projectId)
    if (!project.git) throw new Error("Choose a Git project")
    const count =
      operation === "export"
        ? db.exportableCount(project.id)
        : await countRepositoryRecords(this.ctx, project, this.options.readRepositoryObject)
    return { count }
  }

  async conflictQueue(project?: string) {
    const db = await this.runtime.catalog()
    if (project !== undefined) this.projects.get(db, project)
    return db.conflictQueue(project)
  }

  async compare(project: string, id: string) {
    const db = await this.runtime.catalog()
    this.projects.get(db, project)
    const local = db.read(id)
    const candidates = db.conflictsFor(project, id)
    if (local?.project !== project || !candidates.length)
      throw new Error("This lesson has no retained conflict")
    return {
      local: versionOf(local),
      candidates: candidates.map(({ fingerprint, record }) => ({
        fingerprint,
        version: versionOf(record),
      })),
    }
  }

  async chooseVersion(
    project: string,
    id: string,
    input: Parameters<MemoryRepositoryApi["reconcile"]>[2],
  ) {
    const { revision } = await this.reconcile(
      project,
      id,
      input.revision,
      input.candidate,
      input.fingerprints,
    )
    return { revision }
  }
  async exchange(projectId: string): Promise<MemoryExchangeResult> {
    return this.runtime.mutate(async (db) => {
      const project = this.projects.get(db, projectId)
      if (!this.projects.enabled(db))
        return { written: 0, imported: 0, skipped: 0, conflicts: 0, issues: [] }
      if (project.git && project.sharing) await this.projects.verify(project)
      return exchangeRecords(this.ctx, db, project)
    })
  }

  async restoreProject(...[projectId]: Parameters<MemoryService["restoreProject"]>) {
    return this.runtime.mutate(async (db) => {
      const project = this.projects.get(db, projectId)
      if (!this.projects.enabled(db)) throw new Error("Local memory is paused")
      this.projects.promote(db, projectId)
      const restored = await restoreRecords(
        this.ctx,
        db,
        project,
        this.runtime.engine,
        this.options.readRepositoryObject,
      )
      if (restored.imported)
        await this.runtime.embedRows(
          db,
          db.missingVectors(VECTOR_MODEL, VECTORS_PER_SEARCH, projectId),
        )
      return restored
    })
  }
  async conflicts(...[projectId]: Parameters<MemoryService["conflicts"]>) {
    const db = await this.runtime.catalog()
    this.projects.get(db, projectId)
    return db.conflictsFor(projectId)
  }
  async reconcile(
    projectId: string,
    id: string,
    revision: number,
    candidate: string,
    fingerprints?: string[],
  ) {
    return this.runtime.mutate(async (db) => {
      const project = this.projects.get(db, projectId)
      if (!this.projects.enabled(db)) throw new Error("Local memory is paused")
      if (project.git) await this.projects.verify(project)
      const record = reconcileRecord(this.ctx, db, {
        project: projectId,
        id,
        revision,
        candidate,
        fingerprints,
      })
      await this.runtime.index(record)
      if (record.state === "active") await this.runtime.embedRows(db, [record])
      return record
    })
  }
}
