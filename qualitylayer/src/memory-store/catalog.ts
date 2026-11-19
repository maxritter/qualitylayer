import { Database } from "bun:sqlite"
import { chmodSync, statSync } from "node:fs"
import {
  eligibilityDigest,
  hash,
  MEMORY_CATALOG_MAX_BYTES,
  MEMORY_PROJECTS_MAX,
  MEMORY_RECORDS_MAX,
  pageSize,
  preview,
  publicationText,
} from "../core/memory/validation.ts"
import {
  ANSWER_TAG,
  type MemoryConflict,
  type MemoryPage,
  type MemoryProject,
  type MemoryProjectQuery,
  type MemoryQuery,
  type MemoryRecord,
  PERSONAL_PROJECT,
} from "../memory-contracts.ts"

export type ProjectRow = Omit<MemoryProject, "count"> & {
  commonDir: string | null
  indexPath: string | null
}
type RecordRow = { data: string }

export class MemoryCatalog {
  private readonly db: Database
  constructor(file: string, maximumBytes = MEMORY_CATALOG_MAX_BYTES) {
    if (
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 256 * 1024 ||
      maximumBytes > MEMORY_CATALOG_MAX_BYTES
    )
      throw new Error("Invalid memory catalog size cap")
    try {
      if (statSync(file).size > maximumBytes) throw new Error("Memory catalog exceeds its size cap")
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
    }
    this.db = new Database(file, { create: true, strict: true })
    chmodSync(file, 0o600)
    const pages = (this.db.query("PRAGMA page_size").get() as { page_size: number }).page_size
    this.db.exec(`PRAGMA max_page_count=${Math.floor(maximumBytes / pages)}`)
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, root TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        sharing INTEGER NOT NULL DEFAULT 0, git INTEGER NOT NULL, common_dir TEXT, index_path TEXT);
      CREATE INDEX IF NOT EXISTS projects_name ON projects(name,id);
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, project TEXT NOT NULL, origin TEXT NOT NULL,
        revision INTEGER NOT NULL, source TEXT NOT NULL, visibility TEXT NOT NULL, state TEXT NOT NULL,
        updated INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, data TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS records_project ON records(project,state,updated DESC,id);
      CREATE INDEX IF NOT EXISTS records_source ON records(source,state,updated DESC,id);
      CREATE INDEX IF NOT EXISTS records_scope ON records(visibility,state,updated DESC,id);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,title,content);
      CREATE TABLE IF NOT EXISTS exchange(project TEXT NOT NULL,path TEXT NOT NULL,fingerprint TEXT NOT NULL,
        PRIMARY KEY(project,path));
      CREATE TABLE IF NOT EXISTS conflicts(project TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,data TEXT NOT NULL, PRIMARY KEY(project,id,revision,fingerprint));
      CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,project TEXT NOT NULL,origin TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS publications_project ON publications(project,origin);
      CREATE TABLE IF NOT EXISTS index_pending(id TEXT PRIMARY KEY,project TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS index_pending_project ON index_pending(project);
      CREATE TABLE IF NOT EXISTS index_issues(project TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
        model TEXT NOT NULL, dims INTEGER NOT NULL, vector BLOB NOT NULL);`)
    // A catalog from before pins has no column: every lesson reads as unpinned.
    const columns = this.db.query("PRAGMA table_info(records)").all() as { name: string }[]
    if (!columns.some((column) => column.name === "pinned"))
      this.db.exec("ALTER TABLE records ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
    if (this.meta("index-tracking") !== "1")
      this.db.transaction(() => {
        // Existing catalogs cannot prove that every old native write completed. Preserve canonical
        // retrieval until explicit active mutations acknowledge each outstanding revision.
        this.db.exec("INSERT OR IGNORE INTO index_pending SELECT id,project,revision FROM records")
        this.db.exec("INSERT OR IGNORE INTO index_issues SELECT DISTINCT project FROM records")
        this.setMeta("index-tracking", "1")
        this.setMeta("engine-issue", "")
      })()
  }
  close() {
    this.db.close()
  }
  atomic<T>(write: () => T): T {
    return this.db.transaction(write)()
  }
  meta(key: string): string | null {
    return (
      (this.db.query("SELECT value FROM metadata WHERE key=?").get(key) as { value: string } | null)
        ?.value ?? null
    )
  }
  setMeta(key: string, value: string) {
    if (this.meta(key) === value) return
    this.db.query("INSERT OR REPLACE INTO metadata VALUES (?,?)").run(key, value)
  }
  ensureMeta(key: string, value: string): string {
    const existing = this.meta(key)
    if (existing !== null) return existing
    this.db.query("INSERT OR IGNORE INTO metadata VALUES (?,?)").run(key, value)
    return this.meta(key) as string
  }
  project(id: string): ProjectRow | null {
    const r = this.db.query("SELECT * FROM projects WHERE id=?").get(id) as {
      id: string
      root: string
      name: string
      sharing: number
      git: number
      common_dir: string | null
      index_path: string | null
    } | null
    return r
      ? {
          id: r.id,
          root: r.root,
          name: r.name,
          sharing: !!r.sharing,
          git: !!r.git,
          commonDir: r.common_dir,
          indexPath: r.index_path,
        }
      : null
  }
  register(p: ProjectRow) {
    const old = this.project(p.id)
    if (!old && this.countProjects() >= MEMORY_PROJECTS_MAX)
      throw new Error("Memory project limit reached")
    if (old && old.root !== p.root)
      throw new Error("Project root changed; sharing consent cannot be transferred")
    if (
      old &&
      old.name === p.name &&
      old.git === p.git &&
      old.commonDir === p.commonDir &&
      old.indexPath === p.indexPath
    )
      return
    this.db
      .query(`INSERT INTO projects VALUES (?,?,?,0,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
      git=excluded.git,common_dir=excluded.common_dir,index_path=excluded.index_path`)
      .run(p.id, p.root, p.name, Number(p.git), p.commonDir, p.indexPath)
  }
  /** Removes only an absent folder's empty memory descriptor, never its lessons or project registry. */
  forgetEmptyProject(id: string, root: string): boolean {
    return this.atomic(() => {
      const project = this.project(id)
      if (!project || project.root !== root) return false
      const referenced = this.db
        .query(`
        SELECT 1 FROM records WHERE project=?1
        UNION ALL SELECT 1 FROM publications WHERE project=?1
        UNION ALL SELECT 1 FROM conflicts WHERE project=?1
        UNION ALL SELECT 1 FROM exchange WHERE project=?1
        UNION ALL SELECT 1 FROM index_pending WHERE project=?1
        UNION ALL SELECT 1 FROM index_issues WHERE project=?1
        UNION ALL SELECT 1 FROM metadata WHERE
          (value=?1 OR instr(key,?1)>0) AND key NOT IN (?2,?3,?4)
        LIMIT 1`)
        .get(id, `generation:${id}`, `index:${id}`, `sources:${id}`)
      if (referenced) return false
      this.db.query("DELETE FROM projects WHERE id=? AND root=?").run(id, root)
      this.db
        .query("DELETE FROM metadata WHERE key IN (?,?,?)")
        .run(`generation:${id}`, `index:${id}`, `sources:${id}`)
      return true
    })
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
    const limit = pageSize(q.limit),
      query = q.query?.trim() ?? "",
      retiredOnly = q.recordState === "retired",
      key = hash(retiredOnly ? `retired-projects:${query}` : `projects:${query}`),
      offset = cursor(q.cursor, key)
    if (query.length > 200) throw new Error("Project query exceeds 200 characters")
    const pattern = `%${escapeLike(query)}%`
    const args = [pattern, pattern, retiredOnly ? 1 : 0] as const
    const total = (
      this.db
        .query(
          `SELECT count(*) n FROM projects WHERE (name LIKE ? ESCAPE '\\' OR root LIKE ? ESCAPE '\\')
           AND (? = 0 OR EXISTS (SELECT 1 FROM records WHERE project=projects.id AND state='retired'))`,
        )
        .get(...args) as { n: number }
    ).n
    const rows = this.db
      .query(
        `SELECT id FROM projects WHERE (name LIKE ? ESCAPE '\\' OR root LIKE ? ESCAPE '\\')
         AND (? = 0 OR EXISTS (SELECT 1 FROM records WHERE project=projects.id AND state='retired'))
         ORDER BY name,id LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as { id: string }[]
    return {
      items: rows.map((r) => this.projectView(this.project(r.id) as ProjectRow)),
      total,
      next: offset + rows.length < total ? encodeCursor(offset + rows.length, key) : null,
    }
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
    if (!this.read(r.id) && this.countAll() >= MEMORY_RECORDS_MAX)
      throw new Error("Memory record limit reached; existing lessons can still be updated")
    this.db.transaction(() => {
      // An update keeps the lesson's pin; a retired lesson loses it.
      this.db
        .query(`INSERT INTO records(id,project,origin,revision,source,visibility,state,updated,title,content,data)
          VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project=excluded.project,
          origin=excluded.origin,revision=excluded.revision,source=excluded.source,
          visibility=excluded.visibility,state=excluded.state,updated=excluded.updated,
          title=excluded.title,content=excluded.content,data=excluded.data,
          pinned=CASE WHEN excluded.state='active' THEN records.pinned ELSE 0 END`)
        .run(
          r.id,
          r.project,
          r.origin,
          r.revision,
          r.source,
          r.visibility,
          r.state,
          r.updatedAt,
          r.title,
          r.content,
          JSON.stringify(r),
        )
      this.db.query("DELETE FROM search WHERE id=?").run(r.id)
      this.db.query("INSERT INTO search VALUES (?,?,?)").run(r.id, r.title, r.content)
      // A new revision is a new text: its vector is computed again after the save.
      this.db.query("DELETE FROM vectors WHERE id=?").run(r.id)
      this.db
        .query("INSERT OR REPLACE INTO index_pending VALUES (?,?,?)")
        .run(r.id, r.project, r.revision)
      this.db
        .query(
          "INSERT INTO metadata VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)",
        )
        .run(`generation:${r.project}`)
      if (publication) {
        this.publish(publication)
        this.setMeta(`eligible:${publication.id}`, eligibilityDigest(publication))
      }
      if (provenance?.pilotMetadata !== undefined)
        this.setMeta(`pilot:${r.id}`, provenance.pilotMetadata)
      if (provenance?.wireProject !== undefined)
        this.setMeta(`wire-project:${r.id}`, provenance.wireProject)
    })()
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
    const { where, args } = filter(q)
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
    const { where, args } = filter({ ...q, query: undefined }, activeOnly)
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
    const { where, args } = filter({ ...q, query: undefined }, activeOnly)
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
    const limit = pageSize(q.limit),
      key = hash(
        JSON.stringify([
          q.query ?? "",
          q.project ?? "",
          q.source ?? "all",
          q.scope ?? "all",
          activeOnly,
          ...(q.state ? [q.state] : []),
        ]),
      ),
      offset = cursor(q.cursor, key)
    const { where, args } = filter(q, activeOnly),
      total = (
        this.db.query(`SELECT count(*) n FROM records WHERE ${where}`).get(...args) as { n: number }
      ).n
    const rows = this.db
      .query(
        `SELECT data,pinned,${SHARED_SQL} AS shared FROM records WHERE ${where} ORDER BY updated DESC,id LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as (RecordRow & { pinned: number; shared: number })[]
    return {
      items: rows.map((r) => ({
        ...preview(JSON.parse(r.data)),
        pinned: r.pinned === 1,
        shared: r.shared === 1,
      })),
      total,
      next: offset + rows.length < total ? encodeCursor(offset + rows.length, key) : null,
    }
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
    for (;;) {
      const rows = this.db
        .query("SELECT data FROM records WHERE source='task' AND origin<>? LIMIT 100")
        .all(origin) as RecordRow[]
      if (!rows.length) return
      this.db.transaction(() => {
        const projects = new Set<string>()
        for (const row of rows) {
          const record = JSON.parse(row.data) as MemoryRecord
          const updated = this.db
            .query(
              "UPDATE records SET source='repository',data=json_set(data,'$.source','repository') WHERE id=? AND source='task' AND origin<>?",
            )
            .run(record.id, origin)
          if (updated.changes) {
            projects.add(record.project)
            this.db
              .query(
                "INSERT INTO metadata VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)",
              )
              .run(`generation:${record.project}`)
          }
        }
        for (const project of projects) {
          this.setMeta(`index:${project}`, "")
          this.db.query("DELETE FROM exchange WHERE project=?").run(project)
        }
      })()
    }
  }
  /**
   * Once, on the first open after upgrade: this origin's private task, session and manual lessons
   * that pass the privacy filter become project-visible and publishable, as `store` now makes them.
   * Pilot, imported, retired and personal lessons stay as they are. Content and revision do not
   * change, so vectors and the index stay valid.
   */
  publishExisting(origin: string) {
    if (this.meta("publish-existing") === "1") return
    this.db.transaction(() => {
      for (let after = ""; ; ) {
        const rows = this.db
          .query(
            `SELECT id,data FROM records WHERE id>? AND origin=? AND visibility='private' AND state='active'
              AND project<>? AND source IN ('task','session','manual') ORDER BY id LIMIT 100`,
          )
          .all(after, origin, PERSONAL_PROJECT) as { id: string; data: string }[]
        if (!rows.length) break
        for (const row of rows) {
          after = row.id
          const record = JSON.parse(row.data) as MemoryRecord
          // A private answer of the person was never shared, so it stays private (Max, 30 October).
          if (record.tags.includes(ANSWER_TAG)) continue
          try {
            publicationText(record)
          } catch {
            continue
          }
          const published: MemoryRecord = { ...record, visibility: "project" }
          this.db
            .query("UPDATE records SET visibility='project',data=? WHERE id=?")
            .run(JSON.stringify(published), row.id)
          this.publish(published)
          this.setMeta(`eligible:${row.id}`, eligibilityDigest(published))
        }
      }
      this.setMeta("publish-existing", "1")
    })()
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
    if (this.meta("tag-answers") === "1") return
    this.db.transaction(() => {
      for (let after = ""; ; ) {
        const rows = this.db
          .query(
            `SELECT id,data FROM records WHERE id>? AND state='active' AND source='task'
              AND json_extract(data,'$.kind')='decision' AND instr(content,?)>0 ORDER BY id LIMIT 100`,
          )
          .all(after, "\n\nDecided with you: ") as { id: string; data: string }[]
        if (!rows.length) break
        for (const row of rows) {
          after = row.id
          const record = JSON.parse(row.data) as MemoryRecord
          if (record.tags.includes(ANSWER_TAG)) continue
          this.db
            .query("UPDATE records SET data=? WHERE id=?")
            .run(JSON.stringify({ ...record, tags: [...record.tags, ANSWER_TAG] }), row.id)
        }
      }
      this.setMeta("tag-answers", "1")
    })()
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
    const existing = this.db
      .query("SELECT 1 FROM conflicts WHERE project=? AND id=? AND revision=? AND fingerprint=?")
      .get(project, r.id, r.revision, hash(JSON.stringify(r)))
    if (
      !existing &&
      (this.db.query("SELECT count(*) n FROM conflicts").get() as { n: number }).n >= 1000
    )
      throw new Error(
        "Memory conflict limit reached; reconcile existing conflicts before restoring more",
      )
    this.db
      .query("INSERT OR IGNORE INTO conflicts VALUES (?,?,?,?,?)")
      .run(project, r.id, r.revision, hash(JSON.stringify(r)), JSON.stringify(r))
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
  conflictQueue(project?: string): import("../memory-contracts.ts").MemoryRepositoryConflicts {
    const lessons = this.db
      .query(
        `SELECT DISTINCT c.project, p.name, c.id FROM conflicts c
          JOIN projects p ON p.id=c.project JOIN records r ON r.id=c.id AND r.project=c.project
          WHERE (? IS NULL OR c.project=?) ORDER BY p.name,c.project,c.id`,
      )
      .all(project ?? null, project ?? null) as { project: string; name: string; id: string }[]
    return { total: lessons.length, ...(lessons[0] ? { next: lessons[0] } : {}) }
  }
  exportableCount(project: string): number {
    return (
      this.published(project).filter(
        (record) =>
          record.visibility === "project" &&
          record.source !== "pilot" &&
          this.meta(`eligible:${record.id}`) === eligibilityDigest(record),
      ).length + this.existingRepositoryPublications(project).length
    )
  }
  private existingRepositoryPublications(project: string): MemoryRecord[] {
    const rows = this.db
      .query(
        "SELECT data FROM records WHERE project=? AND source='repository' AND visibility='project' AND id NOT IN (SELECT id FROM publications)",
      )
      .all(project) as RecordRow[]
    return rows.flatMap((row) => {
      const record = JSON.parse(row.data) as MemoryRecord
      try {
        publicationText(record)
        return [record]
      } catch {
        return []
      }
    })
  }
  /** Old exchange already accepted these records locally; preserve their eligibility on export. */
  acceptExistingRepository(project: string) {
    const records = this.existingRepositoryPublications(project)
    this.db.transaction(() => {
      for (const record of records) {
        this.publish(record)
        this.setMeta(`eligible:${record.id}`, eligibilityDigest(record))
      }
    })()
  }
}

/**
 * A lesson is shared when it may leave this computer (project-visible, past the privacy filter) and
 * its repository's sharing is on, or when it came from the repository. A project-visible lesson of a
 * repository that does not share stays on this computer.
 */
const SHARED_SQL = `(records.visibility='project' AND (records.source='repository' OR
  COALESCE((SELECT p.sharing FROM projects p WHERE p.id=records.project),0)=1))`

function toFloats(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&")
}
function filter(q: MemoryQuery, activeOnly = true): { where: string; args: (string | number)[] } {
  const parts = [activeOnly ? "state='active'" : "1"],
    args: (string | number)[] = []
  if (!activeOnly && q.state) {
    parts.push("state=?")
    args.push(q.state)
  }
  if (q.project) {
    parts.push("project=?")
    args.push(q.project)
  }
  if (q.source && q.source !== "all") {
    parts.push("source=?")
    args.push(q.source)
  }
  if (q.scope && q.scope !== "all") {
    parts.push("visibility=?")
    args.push(q.scope)
  }
  if (q.query?.trim()) {
    const match = fullTextQuery(q.query)
    if (match) {
      parts.push("id IN (SELECT id FROM search WHERE search MATCH ?)")
      args.push(match)
    } else parts.push("0")
  }
  return { where: parts.join(" AND "), args }
}
function fullTextQuery(query: string | undefined): string {
  const text = query?.trim() ?? ""
  if (text.length > 500) throw new Error("Memory query exceeds 500 characters")
  const terms = text.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 20) ?? []
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" OR ")
}
function encodeCursor(offset: number, key: string): string {
  return Buffer.from(JSON.stringify({ offset, key })).toString("base64url")
}
function cursor(value: string | undefined, key: string): number {
  if (!value) return 0
  try {
    if (value.length > 200) throw 0
    const raw = JSON.parse(Buffer.from(value, "base64url").toString())
    if (
      raw.key !== key ||
      !Number.isSafeInteger(raw.offset) ||
      raw.offset < 0 ||
      raw.offset > MEMORY_RECORDS_MAX
    )
      throw 0
    return raw.offset
  } catch {
    throw new Error("Invalid memory cursor")
  }
}
