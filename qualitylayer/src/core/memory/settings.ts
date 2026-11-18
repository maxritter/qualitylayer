import { PERSONAL_PROJECT } from "../../memory-contracts.ts"
import type { MemoryService } from "./index.ts"
import type { MemoryProjects } from "./projects.ts"
import type { MemoryRuntime } from "./runtime.ts"
import { MEMORY_INDEX_ISSUE } from "./validation.ts"
export class MemorySettings {
  constructor(
    private readonly runtime: MemoryRuntime,
    private readonly authority: MemoryProjects,
  ) {}
  async sharingEnabled(...[project]: Parameters<MemoryService["sharingEnabled"]>) {
    return this.authority.get(await this.runtime.catalog(), project).sharing
  }
  async sharing(...[id, value]: Parameters<MemoryService["sharing"]>) {
    if (typeof value !== "boolean") throw new Error("Invalid sharing consent")
    return this.runtime.mutate(async (db) => {
      const project = this.authority.get(db, id)
      if (value && !project.git) throw new Error("Sharing requires a Git repository")
      if (value) await this.authority.verify(project)
      db.atomic(() => {
        this.authority.promote(db, id)
        db.consent(id, value)
        db.setMeta(`index:${id}`, "")
      })
      return db.projectView(this.authority.get(db, id))
    })
  }
  async settings(...[patch]: Parameters<MemoryService["settings"]>) {
    const named = (value: unknown) => value === undefined || typeof value === "boolean"
    if (!patch || typeof patch !== "object" || !named(patch.enabled) || !named(patch.sessions))
      throw new Error("Invalid memory settings")
    if (patch.enabled === undefined && patch.sessions === undefined) {
      const db = await this.runtime.catalog()
      return { enabled: this.authority.enabled(db), sessions: this.authority.sessionsOn(db) }
    }
    return this.runtime.mutate(async (db) => {
      if (patch.enabled !== undefined) db.setMeta("enabled", String(patch.enabled))
      if (patch.sessions !== undefined) db.setMeta("sessions", String(patch.sessions))
      return { enabled: this.authority.enabled(db), sessions: this.authority.sessionsOn(db) }
    })
  }
  async projects(...[query]: Parameters<MemoryService["projects"]>) {
    return (await this.runtime.catalog()).projects(query)
  }
  async overview(...[project]: Parameters<MemoryService["overview"]>) {
    const db = await this.runtime.catalog()
    if (project) this.authority.get(db, project)
    const issue = db.indexIssue(project) ? MEMORY_INDEX_ISSUE : undefined
    const total = db.count({ project })
    return {
      enabled: this.authority.enabled(db),
      sessions: this.authority.sessionsOn(db),
      total,
      hasRecords: total > 0 || db.hasRecords(project),
      shared: db.countShared(project),
      imported: db.count({ project, source: "pilot" }),
      projects: db.countProjects(),
      sharedProjects: db.countSharing(PERSONAL_PROJECT),
      recent: db.list({ project, limit: 5 }, true).items,
      available: this.runtime.engine !== undefined && !issue,
      ...(issue ? { issue } : {}),
    }
  }
  async contextVersion(...[projectId]: Parameters<MemoryService["contextVersion"]>) {
    const db = await this.runtime.catalog()
    this.authority.get(db, projectId)
    return `${this.authority.enabled(db) ? "enabled" : "paused"}:${db.meta(`generation:${projectId}`) ?? "0"}`
  }
}
