import type { Database } from "bun:sqlite"
import {
  eligibilityDigest,
  MEMORY_CATALOG_MAX_BYTES,
  MEMORY_RECORDS_MAX,
  pageSize,
  type preview,
} from "../core/memory/validation.ts"
import type {
  MemoryConflict,
  MemoryPage,
  MemoryProject,
  MemoryProjectQuery,
  MemoryQuery,
  MemoryRecord,
  MemoryRepositoryConflicts,
} from "../memory-contracts.ts"
import {
  acceptExistingRepositoryInDb,
  type CatalogMetaOps,
  existingRepositoryPublicationsInDb,
  migrateRepositorySourcesInDb,
  publishExistingInDb,
  tagAnswersInDb,
} from "./catalog-migrations.ts"
import {
  forgetEmptyProjectInDb,
  listRecordsPageInDb,
  queryConflictQueueInDb,
  queryProjectsPageInDb,
  readProjectRow,
  recordConflictInDb,
  registerProjectInDb,
  saveRecordInDb,
} from "./catalog-queries.ts"
import {
  buildRecordFilter,
  fullTextQuery,
  openCatalogDatabase,
  type RecordRow,
  SHARED_SQL,
  toFloats,
} from "./catalog-sql.ts"

export type ProjectRow = Omit<MemoryProject, "count"> & {
  commonDir: string | null
  indexPath: string | null
}

function readMetaFromDb(db: Database, key: string): string | null {
  return (
    (db.query("SELECT value FROM metadata WHERE key=?").get(key) as { value: string } | null)
      ?.value ?? null
  )
}

function writeMetaToDb(db: Database, key: string, value: string): void {
  if (readMetaFromDb(db, key) === value) return
  db.query("INSERT OR REPLACE INTO metadata VALUES (?,?)").run(key, value)
}

export class MemoryCatalog {
  private readonly db: Database
  private readonly metaOps: CatalogMetaOps

  constructor(file: string, maximumBytes = MEMORY_CATALOG_MAX_BYTES) {
    this.db = openCatalogDatabase(file, maximumBytes, readMetaFromDb, writeMetaToDb)
    this.metaOps = {
      meta: (key) => this.meta(key),
      setMeta: (key, value) => this.setMeta(key, value),
      publish: (record) => this.publish(record),
    }
  }
  close() {
    this.db.close()
  }
  atomic<T>(write: () => T): T {
    return this.db.transaction(write)()
  }
  meta(key: string): string | null {
    return readMetaFromDb(this.db, key)
  }
  setMeta(key: string, value: string) {
    writeMetaToDb(this.db, key, value)
  }
  ensureMeta(key: string, value: string): string {
    const existing = this.meta(key)
    if (existing !== null) return existing
    this.db.query("INSERT OR IGNORE INTO metadata VALUES (?,?)").run(key, value)
    return this.meta(key) as string
  }
  project(id: string): ProjectRow | null {
    return readProjectRow(this.db, id)
  }
  register(p: ProjectRow) {
    registerProjectInDb(this.db, p, this.countProjects())
  }
  /** Removes only an absent folder's empty memory descriptor, never its lessons or project registry. */
  forgetEmptyProject(id: string, root: string): boolean {
    return forgetEmptyProjectInDb(this.db, id, root)
  }
  consent(id: string, enabled: boolean) {
    this.db.query("UPDATE projects SET sharing=? WHERE id=?").run(Number(enabled), id)
  }
  countProjects(): number {
    return (this.db.query("SELECT count(*) n FROM projects").get() as { n: number }).n
  }
  /** The Git projects that can share, and how many do; the person's own project never shares and is not counted. */
  countSharing(personal: string): { shared: number; total: number } {
    return this.db
      .query(
        "SELECT count(*) total, coalesce(sum(sharing),0) shared FROM projects WHERE git=1 AND id<>?",
      )
      .get(personal) as { shared: number; total: number }
  }
  projectView(p: ProjectRow): MemoryProject {
    return {
      id: p.id,
      name: p.name,
      root: p.root,
      sharing: p.sharing,
      git: p.git,
      count: this.count({ project: p.id }),
    }
  }
  projects(q: MemoryProjectQuery = {}): MemoryPage<MemoryProject> {
    return queryProjectsPageInDb(this.db, q, (p) => this.projectView(p))
  }
  read(id: string): MemoryRecord | null {
    const r = this.db.query("SELECT data FROM records WHERE id=?").get(id) as RecordRow | null
    return r ? JSON.parse(r.data) : null
  }
  /** Whether a lesson is shared: see SHARED_SQL. */
  isShared(id: string): boolean {
    const row = this.db.query(`SELECT ${SHARED_SQL} AS shared FROM records WHERE id=?`).get(id) as {
      shared: number
    } | null
    return row?.shared === 1
  }
  /** The active lessons that are shared, in one project or in all. */
  countShared(project?: string): number {
    const where = project === undefined ? "" : " AND project=?"
    return (
      this.db
        .query(`SELECT count(*) n FROM records WHERE state='active' AND ${SHARED_SQL}${where}`)
        .get(...(project === undefined ? [] : [project])) as { n: number }
    ).n
  }
  /** Pins are local to this catalog; the lesson record and its Git file never carry one. */
  isPinned(id: string): boolean {
    const row = this.db.query("SELECT pinned FROM records WHERE id=?").get(id) as {
      pinned: number
    } | null
    return row?.pinned === 1
  }
  pinnedIds(project: string): string[] {
    return (
      this.db
        .query(
          "SELECT id FROM records WHERE project=? AND state='active' AND pinned=1 ORDER BY updated DESC,id",
        )
        .all(project) as { id: string }[]
    ).map((row) => row.id)
  }
  setPinned(id: string, pinned: boolean) {
    this.db.transaction(() => {
      const changed = this.db
        .query("UPDATE records SET pinned=? WHERE id=? AND pinned<>?")
        .run(Number(pinned), id, Number(pinned)).changes
      if (!changed) return
      const record = this.read(id)
      if (record)
        this.db
          .query(
            "INSERT INTO metadata VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)",
          )
          .run(`generation:${record.project}`)
    })()
  }
  vector(
    id: string,
  ): { revision: number; model: string; dims: number; vector: Float32Array } | null {
    const row = this.db
      .query("SELECT revision,model,dims,vector FROM vectors WHERE id=?")
      .get(id) as {
      revision: number
      model: string
      dims: number
      vector: Uint8Array
    } | null
    return row ? { ...row, vector: toFloats(row.vector) } : null
  }
  /** Stores a vector only for the revision the lesson still has; false when it moved on. */
  setVector(id: string, revision: number, model: string, vector: Float32Array): boolean {
    return (
      this.db
        .query(
          `INSERT OR REPLACE INTO vectors SELECT id,revision,?,?,? FROM records
            WHERE id=? AND revision=? AND state='active'`,
        )
        .run(
          model,
          vector.length,
          new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
          id,
          revision,
        ).changes > 0
    )
  }
  /** Active lessons with no vector for their current revision and `model`, newest first. */
  missingVectors(
    model: string,
    limit: number,
    project?: string,
  ): { id: string; revision: number; title: string; content: string }[] {
    return this.db
      .query(
        `SELECT r.id,r.revision,r.title,r.content FROM records r
          LEFT JOIN vectors v ON v.id=r.id AND v.revision=r.revision AND v.model=?
          WHERE r.state='active' AND v.id IS NULL ${project === undefined ? "" : "AND r.project=?"}
          ORDER BY r.updated DESC,r.id LIMIT ?`,
      )
      .all(...(project === undefined ? [model, limit] : [model, project, limit])) as {
      id: string
      revision: number
      title: string
      content: string
    }[]
  }
  countMissingVectors(model: string, project: string): number {
    return (
      this.db
        .query(
          `SELECT count(*) n FROM records r
            LEFT JOIN vectors v ON v.id=r.id AND v.revision=r.revision AND v.model=?
            WHERE r.state='active' AND v.id IS NULL AND r.project=?`,
        )
        .get(model, project) as { n: number }
    ).n
  }
  /** The current vectors of a project's active lessons. */
  activeVectors(project: string, model: string): { id: string; vector: Float32Array }[] {
    return (
      this.db
        .query(
          `SELECT v.id,v.vector FROM vectors v JOIN records r ON r.id=v.id AND r.revision=v.revision
            WHERE r.project=? AND r.state='active' AND v.model=?`,
        )
        .all(project, model) as { id: string; vector: Uint8Array }[]
    ).map((row) => ({ id: row.id, vector: toFloats(row.vector) }))
  }
  markPending(id: string, project: string, revision: number) {
    this.db.query("INSERT OR REPLACE INTO index_pending VALUES (?,?,?)").run(id, project, revision)
  }
  save(
    r: MemoryRecord,
    publication?: MemoryRecord,
    provenance?: { pilotMetadata?: string; wireProject?: string },
  ) {
    saveRecordInDb(this.db, r, this.metaOps, { publication, provenance })
  }
  countAll(): number {
    return (this.db.query("SELECT count(*) n FROM records").get() as { n: number }).n
  }
  pendingCount(project?: string): number {
    const row =
      project === undefined
        ? this.db.query("SELECT count(*) n FROM index_pending").get()
        : this.db.query("SELECT count(*) n FROM index_pending WHERE project=?").get(project)
    return (row as { n: number }).n
  }
  pending(id: string): number | null {
    return (
      (
        this.db.query("SELECT revision FROM index_pending WHERE id=?").get(id) as {
          revision: number
        } | null
      )?.revision ?? null
    )
  }
  acknowledgeIndex(id: string, revision: number) {
    this.db.query("DELETE FROM index_pending WHERE id=? AND revision<=?").run(id, revision)
  }
  failIndex(project: string) {
    this.db.query("INSERT OR IGNORE INTO index_issues VALUES (?)").run(project)
  }
  healIndex(project: string) {
    if (this.pendingCount(project) === 0)
      this.db.query("DELETE FROM index_issues WHERE project=?").run(project)
  }
  indexIssue(project?: string): boolean {
    const row =
      project === undefined
        ? this.db.query("SELECT count(*) n FROM index_issues").get()
        : this.db.query("SELECT count(*) n FROM index_issues WHERE project=?").get(project)
    return this.pendingCount(project) > 0 || (row as { n: number }).n > 0
  }
  count(q: MemoryQuery = {}): number {
    const { where, args } = buildRecordFilter(q)
    return (
      this.db.query(`SELECT count(*) n FROM records WHERE ${where}`).get(...args) as { n: number }
    ).n
  }
  hasRecords(project?: string): boolean {
    const found =
      project === undefined
        ? this.db.query("SELECT 1 FROM records LIMIT 1").get()
        : this.db.query("SELECT 1 FROM records WHERE project=? LIMIT 1").get(project)
    return found !== null
  }
  fileIds(q: MemoryQuery, paths: readonly string[], activeOnly = true): string[] {
    if (!paths.length) return []
    const { where, args } = buildRecordFilter({ ...q, query: undefined }, activeOnly)
    return (
      this.db
        .query(`SELECT records.id FROM records WHERE ${where} AND EXISTS (
      SELECT 1 FROM json_each(records.data,'$.files') binding, json_each(?) requested
      WHERE binding.value=requested.value
      OR substr(binding.value,-length(requested.value)-1)='/'||requested.value
      OR substr(requested.value,-length(binding.value)-1)='/'||binding.value
      OR instr('/'||binding.value,'/'||requested.value||'/')>0
    ) ORDER BY records.updated DESC,records.id LIMIT ?`)
        .all(...args, JSON.stringify(paths), pageSize(q.limit)) as { id: string }[]
    ).map((row) => row.id)
  }

  /** Agent word matches are ranked before limiting; the management list stays chronological. */
  searchIds(q: MemoryQuery, activeOnly = true): string[] {
    const match = fullTextQuery(q.query)
    if (!match) return []
    const { where, args } = buildRecordFilter({ ...q, query: undefined }, activeOnly)
    return (
      this.db
        .query(
          `SELECT records.id FROM search JOIN records ON records.id=search.id
            WHERE ${where} AND search MATCH ?
            ORDER BY bm25(search,0,4,1),records.updated DESC,records.id LIMIT ?`,
        )
        .all(...args, match, pageSize(q.limit)) as { id: string }[]
    ).map((row) => row.id)
  }
  list(
    q: MemoryQuery = {},
    activeOnly = false,
  ): MemoryPage<ReturnType<typeof preview> & { pinned: boolean; shared: boolean }> {
    return listRecordsPageInDb(this.db, q, activeOnly)
  }
  /** Every active lesson of one project, for a pass that must see them all at once. */
  activeRecords(project: string): MemoryRecord[] {
    return (
      this.db
        .query("SELECT data FROM records WHERE project=? AND state='active' LIMIT ?")
        .all(project, MEMORY_RECORDS_MAX) as RecordRow[]
    ).map((row) => JSON.parse(row.data))
  }
  publication(id: string): MemoryRecord | null {
    const row = this.db
      .query("SELECT data FROM publications WHERE id=?")
      .get(id) as RecordRow | null
    return row ? JSON.parse(row.data) : null
  }
  migrateRepositorySources(origin: string) {
    migrateRepositorySourcesInDb(this.db, origin, this.metaOps)
  }
  /**
   * Once, on the first open after upgrade: this origin's private task, session and manual lessons
   * that pass the privacy filter become project-visible and publishable, as `store` now makes them.
   * Pilot, imported, retired and personal lessons stay as they are. Content and revision do not
   * change, so vectors and the index stay valid.
   */
  publishExisting(origin: string) {
    publishExistingInDb(this.db, origin, this.metaOps)
  }
  /**
   * Once, on the first open after upgrade: the person's own task answers ("Decided with you: ...")
   * saved before they were kept local get the `answer` tag, so a session start leaves them out.
   * Nothing else changes: visibility, revision, vectors and any publication stay as they were, so
   * what was already shared is not touched. A shared answer's publication therefore keeps its old
   * tags on purpose (Max, 30 October): the tag only steers this computer's session start. It runs
   * before `publishExisting`, which skips tagged answers, so a private answer is never published.
   */
  tagAnswers() {
    tagAnswersInDb(this.db, this.metaOps)
  }
  publish(record: MemoryRecord) {
    const publication = { ...record }
    if (publication.source === "session" && publication.sourceId?.startsWith("native:")) {
      delete publication.sourceId
      delete publication.author
      delete publication.sourceAt
    }
    this.db
      .query("INSERT OR REPLACE INTO publications VALUES (?,?,?,?)")
      .run(record.id, record.project, record.origin, JSON.stringify(publication))
  }
  published(project: string, origin?: string): MemoryRecord[] {
    return (
      this.db
        .query(
          `SELECT data FROM publications WHERE project=?${origin ? " AND origin=?" : ""} ORDER BY id LIMIT ?`,
        )
        .all(
          ...(origin ? [project, origin, MEMORY_RECORDS_MAX] : [project, MEMORY_RECORDS_MAX]),
        ) as RecordRow[]
    ).map((row) => JSON.parse(row.data))
  }
  fingerprint(project: string, path: string): string | null {
    return (
      (
        this.db
          .query("SELECT fingerprint FROM exchange WHERE project=? AND path=?")
          .get(project, path) as { fingerprint: string } | null
      )?.fingerprint ?? null
    )
  }
  seen(project: string, path: string, value: string) {
    this.db.query("INSERT OR REPLACE INTO exchange VALUES (?,?,?)").run(project, path, value)
  }
  conflict(project: string, r: MemoryRecord) {
    recordConflictInDb(this.db, project, r)
  }
  conflictsFor(project: string, id?: string): MemoryConflict[] {
    const rows = this.db
      .query(
        `SELECT fingerprint,data FROM conflicts WHERE project=?${id ? " AND id=?" : ""} ORDER BY id,revision,fingerprint`,
      )
      .all(...(id ? [project, id] : [project])) as { fingerprint: string; data: string }[]
    return rows.map((row) => ({ fingerprint: row.fingerprint, record: JSON.parse(row.data) }))
  }
  clearConflicts(project: string, id: string) {
    this.db.query("DELETE FROM conflicts WHERE project=? AND id=?").run(project, id)
  }
  conflictQueue(project?: string): MemoryRepositoryConflicts {
    return queryConflictQueueInDb(this.db, project)
  }
  exportableCount(project: string): number {
    return (
      this.published(project).filter(
        (record) =>
          record.visibility === "project" &&
          record.source !== "pilot" &&
          this.meta(`eligible:${record.id}`) === eligibilityDigest(record),
      ).length + existingRepositoryPublicationsInDb(this.db, project).length
    )
  }
  /** Old exchange already accepted these records locally; preserve their eligibility on export. */
  acceptExistingRepository(project: string) {
    acceptExistingRepositoryInDb(this.db, project, this.metaOps)
  }
}
