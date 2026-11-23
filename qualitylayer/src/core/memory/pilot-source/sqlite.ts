import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { selectedPath, verifySources } from "./files.ts"
import { excludedCount, invalid, learning, observation, words } from "./normalize.ts"
import { streamSource } from "./snapshot.ts"
import { budget, PILOT_ROWS_MAX, type PilotSourceData } from "./types.ts"

const OBSERVATION_FIELDS = [
  "id",
  "memory_session_id",
  "project",
  "text",
  "type",
  "title",
  "subtitle",
  "facts",
  "narrative",
  "concepts",
  "files_read",
  "files_modified",
  "shared_uid",
  "shared_author",
  "created_at",
  "created_at_epoch",
]
const SUMMARY_FIELDS = [
  "id",
  "memory_session_id",
  "project",
  "learned",
  "created_at",
  "created_at_epoch",
]

function columns(db: Database, table: string): Set<string> {
  const definition = db.query("SELECT type,sql FROM sqlite_master WHERE name=?").get(table) as {
    type: string
    sql: string
  } | null
  if (!definition) return new Set()
  if (definition.type !== "table" || !/^CREATE\s+TABLE\b/i.test(definition.sql)) {
    throw new Error("Pilot source collections must be ordinary database tables.")
  }
  return new Set(
    (db.query("SELECT name FROM pragma_table_info(?)").all(table) as { name: string }[]).map(
      (row) => row.name,
    ),
  )
}

function* rows(
  db: Database,
  table: string,
  fields: string[],
  required: string[] = [],
): Generator<Record<string, unknown>> {
  const known = columns(db, table)
  if (!known.size) return
  if (required.some((field) => !known.has(field))) {
    throw new Error("Pilot database schema is not supported.")
  }
  const selected = fields.filter((field) => known.has(field))
  if (!selected.length) return
  const oversized = selected.map((field) => `length(CAST("${field}" AS BLOB))>32768`).join(" OR ")
  const fieldsSql = selected
    .map(
      (field) =>
        `CASE WHEN length(CAST("${field}" AS BLOB))>32768 THEN NULL ELSE "${field}" END AS "${field}"`,
    )
    .join(",")
  const result = db
    .query(
      `SELECT ${fieldsSql},CASE WHEN ${oversized} THEN 1 ELSE 0 END AS _oversized FROM "${table}" LIMIT ${PILOT_ROWS_MAX + 1}`,
    )
    .iterate()
  let count = 0
  for (const row of result) {
    if (++count > PILOT_ROWS_MAX) {
      throw new Error(
        "Pilot database exceeds the supported row limit. Choose a smaller existing backup or exported knowledge; no memories were imported.",
      )
    }
    yield row as Record<string, unknown>
  }
}

function checkoutRows(data: PilotSourceData, db: Database) {
  const current = rows(
    db,
    "memory_project_checkouts",
    ["project", "root_path"],
    ["project", "root_path"],
  )
  const older = rows(db, "project_roots", ["project", "root_path"], ["project", "root_path"])
  for (const source of [current, older]) {
    for (const row of source) {
      const project = words(row.project)
      const root = words(row.root_path)
      if (!project || !root) continue
      const roots = data.roots.get(project) ?? []
      if (!roots.includes(root)) roots.push(root)
      data.roots.set(project, roots.sort())
    }
  }
}

function readRemovedUids(data: PilotSourceData, db: Database, observed: Set<string>): void {
  if (!columns(db, "shared_memory_records").has("uid") || !observed.has("shared_uid")) return
  const removed = db
    .query(
      `SELECT s.uid FROM shared_memory_records s LEFT JOIN observations o ON o.shared_uid=s.uid WHERE o.id IS NULL AND length(CAST(s.uid AS BLOB))<=512 LIMIT ${PILOT_ROWS_MAX + 1}`,
    )
    .all() as { uid: string }[]
  if (removed.length > PILOT_ROWS_MAX) {
    throw new Error("Pilot identity ledger exceeds the supported row limit.")
  }
  for (const row of removed) data.removed.add(row.uid)
}

function importTableRows(
  data: PilotSourceData,
  db: Database,
  spec: {
    table: string
    fields: string[]
    required: string[]
    oversizedMessage: string
    ingest: (data: PilotSourceData, row: Record<string, unknown>) => void
  },
): void {
  for (const row of rows(db, spec.table, spec.fields, spec.required)) {
    budget(data)
    if (row._oversized) {
      invalid(data, spec.oversizedMessage)
      continue
    }
    spec.ingest(data, row)
  }
}

function readDatabase(data: PilotSourceData, db: Database) {
  const observed = columns(db, "observations")
  const summaries = columns(db, "session_summaries")
  if (!observed.size && !summaries.size) {
    throw new Error("This is not a supported Pilot memory database.")
  }
  const versions = rows(db, "schema_versions", ["version"])
  if ([...versions].some((row) => Number(row.version) > 28)) {
    throw new Error("This Pilot database version is newer than the supported format.")
  }
  checkoutRows(data, db)
  readRemovedUids(data, db, observed)
  importTableRows(data, db, {
    table: "observations",
    fields: OBSERVATION_FIELDS,
    required: ["id", "project", "type"],
    oversizedMessage: "A Pilot observation exceeds the supported lesson size and was left out.",
    ingest: observation,
  })
  importTableRows(data, db, {
    table: "session_summaries",
    fields: SUMMARY_FIELDS,
    required: ["project", "learned"],
    oversizedMessage:
      "A Pilot session learning exceeds the supported lesson size and was left out.",
    ingest: learning,
  })
  for (const table of ["sdk_sessions", "user_prompts", "pending_messages"]) {
    if (!columns(db, table).size) continue
    const result = db.query(`SELECT count(*) n FROM "${table}"`).get() as { n: number }
    excludedCount(data, result.n)
  }
}

/** SQLite may recover a WAL only inside this disposable copy, never beside the selected source. */
export async function sqliteSource(data: PilotSourceData, source: string): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "qualitylayer-pilot-"))
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      await selectedPath(source + suffix)
      await streamSource(
        data,
        source + suffix,
        join(temporary, basename(source) + suffix),
        suffix !== "",
      )
    }
    await verifySources(data.stamps, data.signal, data.deadline)
    const db = new Database(join(temporary, basename(source)), { readonly: true, strict: true })
    try {
      db.exec("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA cache_size=-8192")
      const healthy = db.query("PRAGMA quick_check(1)").get() as { quick_check: string }
      if (healthy.quick_check !== "ok") {
        throw new Error(
          "Pilot database snapshot is not consistent. Stop Pilot Shell or choose an existing backup.",
        )
      }
      readDatabase(data, db)
    } finally {
      db.close()
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
