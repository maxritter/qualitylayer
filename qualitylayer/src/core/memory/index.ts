import type { Ctx } from "../../ctx.ts"
import type {
  MemoryApi,
  MemoryConflict,
  MemoryEmbedder,
  MemoryEngine,
  MemoryExchangeResult,
  MemoryPreview,
  MemoryRecord,
  MemoryRecordView,
  MemoryReindexResult,
  MemorySearchOptions,
  MemorySearchResult,
  MemorySemantic,
  MemorySources,
  MemoryStoreInput,
} from "../../memory-contracts.ts"
import type { MemoryCatalog } from "../../memory-store/catalog.ts"
import type { PilotReceipt, PilotReview } from "../../pilot-memory-contracts.ts"
import type { GitObjectReader } from "./git-object.ts"
import { MemoryMutations } from "./mutations.ts"
import { MemoryNavigation } from "./navigation.ts"
import { PilotImporter } from "./pilot-import.ts"
import { type MappedPilotRecord, PilotMigrationWriter } from "./pilot-migration.ts"
import { MemoryPortability } from "./portability.ts"
import { MemoryProjects } from "./projects.ts"
import { MemoryRuntime } from "./runtime.ts"
import { MemorySearch } from "./search/index.ts"
import { MemorySettings } from "./settings.ts"
import { MemorySourceCatalog } from "./source-catalog.ts"
import type { GitReader } from "./sources.ts"
import { MemoryWriter } from "./store.ts"
/** What `store` says about a retired lesson: only a restore brings it back. */
export const MEMORY_RETIRED = "This lesson is retired; restore it explicitly before updating"

export type MemoryService = MemoryApi & {
  reviewPilotRecords(input: MappedPilotRecord[], leftOut: number): Promise<PilotReview>
  importPilotRecords(
    input: MappedPilotRecord[],
    leftOut: number,
    signal?: AbortSignal,
  ): Promise<PilotReceipt>
  sharingEnabled(project: string): Promise<boolean>
  registerProject(input: {
    id: string
    name: string
    root: string
    commonDir?: string
    /** Background discovery keeps unrelated temporary checkouts out of the persistent catalog. */
    automatic?: true
  }): Promise<void>
  /**
   * Registers the project of the lessons about the person, lazily and never as a Git project. Its
   * folder is `<home>/memory/personal`; nothing in it is published.
   */
  registerPersonal(): Promise<void>
  store(input: MemoryStoreInput): Promise<MemoryRecord>
  /** Pins or unpins an active lesson; at most five per project. */
  pin(id: string, pinned: boolean): Promise<MemoryRecordView>
  /** The project's pinned active lessons, newest first; at most five exist. */
  pinned(project: string): Promise<MemoryPreview[]>
  /** The lessons saved before and after one, from the engine's timeline; `around` is 1 to 3. */
  neighbours(id: string, around: number): Promise<MemoryPreview[]>
  exchange(project: string): Promise<MemoryExchangeResult>
  restoreProject(project: string): Promise<MemoryExchangeResult>
  conflicts(project: string): Promise<MemoryConflict[]>
  reconcile(project: string, id: string, revision: number, candidate: string): Promise<MemoryRecord>
  /**
   * Full text and meaning, fused; a query that matches neither way returns no lesson. Agents get
   * active lessons only. `options` is for managing lessons: a source or scope narrows the matches
   * before any limit or duplicate is applied, and `includeRetired` lets a retired lesson match so
   * it can be found and restored. A managing search may ask for up to `MEMORY_SEARCH_MAX` lessons.
   */
  search(
    project: string,
    query: string,
    limit?: number,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult>
  /** Shares one query embedding across projects; each project's relevance order is preserved. */
  searchProjects(
    projects: string[],
    query: string,
    limit?: number,
  ): Promise<{ lessons: MemoryPreview[][]; semantic: MemorySemantic; issue?: string }>
  context(project: string, query: string): Promise<MemoryPreview[]>
  contextVersion(project: string): Promise<string>
  /**
   * The sources state of every active lesson of a project, from one bounded Git read per HEAD; a
   * lesson whose files are all gone is retired here, once, with that reason.
   */
  sources(project: string): Promise<Map<string, MemorySources>>
  /** Active lessons naming one of `paths` (a folder covers what is under it), with their sources. */
  lessonsOn(project: string, paths: string[]): Promise<MemoryPreview[]>
  /** Embeds every active lesson, in every project, that has no current vector. */
  reindex(): Promise<MemoryReindexResult>
  close(): Promise<void>
}

export type MemoryCatalogAdapter = Pick<MemoryCatalog, keyof MemoryCatalog>
export type MemoryServiceOptions = {
  openCatalog?: (file: string) => MemoryCatalogAdapter
  /** Without one, search uses full text only and reports `semantic: "off"`. */
  embedder?: MemoryEmbedder
  /** The bounded Git read behind the sources state; tests hand it a slow or oversized one. */
  readGit?: GitReader
  /** Restore validates the returned bytes against its pinned index/tree object id. */
  readRepositoryObject?: GitObjectReader
}

export function createMemoryService(
  ctx: Ctx,
  engine?: MemoryEngine,
  options: MemoryServiceOptions = {},
): MemoryService {
  const runtime = new MemoryRuntime(ctx, engine, options)
  const projects = new MemoryProjects(ctx, runtime)
  const settings = new MemorySettings(runtime, projects)
  const navigation = new MemoryNavigation(runtime, projects)
  const mutations = new MemoryMutations(ctx, runtime, projects)
  const writer = new MemoryWriter(ctx, runtime, projects)
  const pilot = new PilotImporter(ctx, runtime, projects)
  const pilotMigration = new PilotMigrationWriter(ctx, runtime, projects)
  const portability = new MemoryPortability(ctx, runtime, projects, options)
  const sources = new MemorySourceCatalog(ctx, runtime, projects, mutations, options)
  const retrieval = new MemorySearch(runtime, {
    getProject: projects.get.bind(projects),
    enabled: projects.enabled.bind(projects),
    withSources: sources.withSources.bind(sources),
  })
  return {
    registerPersonal: projects.registerPersonal.bind(projects),
    registerProject: projects.registerProject.bind(projects),
    sharingEnabled: settings.sharingEnabled.bind(settings),
    sharing: settings.sharing.bind(settings),
    settings: settings.settings.bind(settings),
    projects: settings.projects.bind(settings),
    overview: settings.overview.bind(settings),
    contextVersion: settings.contextVersion.bind(settings),
    pin: navigation.pin.bind(navigation),
    pinned: navigation.pinned.bind(navigation),
    neighbours: navigation.neighbours.bind(navigation),
    retire: mutations.retire.bind(mutations),
    confirm: mutations.confirm.bind(mutations),
    store: writer.store.bind(writer),
    importPilot: pilot.importPilot.bind(pilot),
    reviewPilotRecords: pilotMigration.review.bind(pilotMigration),
    importPilotRecords: pilotMigration.apply.bind(pilotMigration),
    exchange: portability.exchange.bind(portability),
    restoreProject: portability.restoreProject.bind(portability),
    conflicts: portability.conflicts.bind(portability),
    reconcile: portability.reconcile.bind(portability),
    sources: sources.sources.bind(sources),
    list: sources.list.bind(sources),
    read: sources.read.bind(sources),
    lessonsOn: sources.lessonsOn.bind(sources),
    search: retrieval.search.bind(retrieval),
    searchProjects: retrieval.searchProjects.bind(retrieval),
    reindex: runtime.reindex.bind(runtime),
    close: runtime.close.bind(runtime),
    async context(project, query) {
      return (await retrieval.search(project, query)).lessons
    },
  }
}
