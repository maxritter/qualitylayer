import type {
  MemoryPreview,
  MemorySearchResult,
  MemorySemantic,
} from "../../../memory-contracts.ts"
import type { MemoryCatalogAdapter } from "../index.ts"
import type { MemoryRuntime } from "../runtime.ts"
import { MemoryCandidates } from "./candidates.ts"
import { MEMORY_QUERY_MAX, MemoryQuery, type SearchOptions } from "./query.ts"
import { searchResults } from "./results.ts"

type Scope = {
  getProject(db: MemoryCatalogAdapter, id: string): unknown
  enabled(db: MemoryCatalogAdapter): boolean
  withSources(items: MemoryPreview[]): Promise<MemoryPreview[]>
}

export class MemorySearch {
  constructor(
    private readonly runtime: MemoryRuntime,
    private readonly scope: Scope,
  ) {}

  async search(
    project: string,
    text: string,
    limit = 8,
    options: SearchOptions = {},
  ): Promise<MemorySearchResult> {
    const db = await this.runtime.catalog()
    this.scope.getProject(db, project)
    if (!this.scope.enabled(db)) return { lessons: [], semantic: "off" }
    if (typeof text !== "string" || text.length > MEMORY_QUERY_MAX)
      throw new Error("Invalid memory context query")
    const hasCandidates = options.includeRetired
      ? db.hasRecords(project)
      : db.count({ project }) > 0
    if (!hasCandidates) return { lessons: [], semantic: "off" }
    const query = new MemoryQuery(db, { project, text, options })
    const embedQuery = options.embedQuery ?? (() => this.runtime.embedTexts([text]))
    const pool = await new MemoryCandidates(this.runtime, query).collect(embedQuery)
    const found = searchResults(query, pool, limit)
    const lessons = (await this.scope.withSources(found)).filter(
      (lesson) => lesson.state === "active" || options.includeRetired === true,
    )
    return {
      lessons,
      semantic: pool.semantic,
      ...(this.runtime.embeddingIssue ? { issue: this.runtime.embeddingIssue } : {}),
    }
  }

  async searchProjects(
    projects: string[],
    text: string,
    limit?: number,
  ): Promise<{ lessons: MemoryPreview[][]; semantic: MemorySemantic; issue?: string }> {
    let asked: Promise<Float32Array[] | null> | undefined
    const embedQuery = () => {
      asked ??= this.runtime.embedTexts([text])
      return asked
    }
    const results: MemorySearchResult[] = []
    for (const project of projects)
      results.push(await this.search(project, text, limit, { embedQuery }))
    const states = results.map((result) => result.semantic)
    return {
      lessons: results.map((result) => result.lessons),
      semantic: states.includes("partial") ? "partial" : states.includes("full") ? "full" : "off",
      ...(this.runtime.embeddingIssue ? { issue: this.runtime.embeddingIssue } : {}),
    }
  }
}
