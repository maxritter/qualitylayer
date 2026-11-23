// Native child identities are resolved from the run's own parent record, never a caller-supplied path.
import { readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { findStateDb, openStateDb, spawnParentOf } from "../peers/codex.ts"
import { homeVariable } from "../platform.ts"
import type { RunRecord } from "../run/contracts.ts"
import type { RecordLocation } from "./locate.ts"

export const workerIdValid = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id)

const isInsideRelative = (part: string): boolean =>
  part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`)

/** Resolving the final file and checking it against the lexical trusted directory rejects
 * both a symlinked child file and a subagents/sessions directory pointing outside its owner. */
export function confinedRecord(base: string, path: string): string | null {
  try {
    const real = realpathSync(path)
    const part = relative(base, real)
    return isInsideRelative(part) && statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}

export function claudeWorkerPath(parent: string, worker: string): string | null {
  if (!workerIdValid(worker)) return null
  try {
    const realParent = realpathSync(parent)
    const folder = join(dirname(realParent), basename(realParent, ".jsonl"), "subagents")
    return confinedRecord(folder, join(folder, `agent-${worker}.jsonl`))
  } catch {
    return null
  }
}

function resolveCodexSqliteHome(ctx: Ctx, home: string, base: string): string {
  const fallback = ctx.env.get("CODEX_SQLITE_HOME") || base
  try {
    const config = join(base, "config.toml")
    if (statSync(config).size > 256 * 1024) return fallback
    const value = (Bun.TOML.parse(readFileSync(config, "utf8")) as Record<string, unknown>)
      .sqlite_home
    if (typeof value !== "string" || !value) return fallback
    return value.startsWith("~/") ? join(home, value.slice(2)) : value
  } catch {
    // No configured SQLite directory; use the declared environment/default path.
    return fallback
  }
}

type StateDb = ReturnType<typeof openStateDb>

function readEdgeParent(db: StateDb, id: string): string | null {
  try {
    const row = db
      .query("SELECT parent_thread_id FROM thread_spawn_edges WHERE child_thread_id = ? LIMIT 1")
      .get(id) as { parent_thread_id?: string } | null
    return row?.parent_thread_id ?? null
  } catch {
    /* Older clients store the edge only in source. */
    return null
  }
}

function isCodexWorkerLinked(
  db: StateDb,
  lookup: ReturnType<StateDb["query"]>,
  worker: string,
  parentSession: string,
): boolean {
  let id = worker
  const seen = new Set<string>()
  for (let depth = 0; depth < 32 && !seen.has(id); depth++) {
    seen.add(id)
    const row = lookup.get(id) as { source?: string } | null
    if (!row) return false
    const parent = spawnParentOf(row.source) ?? readEdgeParent(db, id)
    if (parent === parentSession) return true
    if (!parent || !workerIdValid(parent)) return false
    id = parent
  }
  return false
}

function readCodexRolloutPath(db: StateDb, worker: string, parentSession: string): string | null {
  db.exec("PRAGMA busy_timeout = 100")
  const columns = (db.query("PRAGMA table_info(threads)").all() as { name: string }[]).map(
    (row) => row.name,
  )
  const lookup = db.query(
    `SELECT rollout_path${columns.includes("source") ? ", source" : ""} FROM threads WHERE id = ? LIMIT 1`,
  )
  const child = lookup.get(worker) as { rollout_path?: string; source?: string } | null
  if (!child || typeof child.rollout_path !== "string") return null
  if (!isCodexWorkerLinked(db, lookup, worker, parentSession)) return null
  return basename(child.rollout_path).endsWith(`-${worker}.jsonl`) ? child.rollout_path : null
}

/** A direct or nested Codex child must reach this exact parent through native spawn metadata. */
export function codexWorkerLocation(
  ctx: Ctx,
  run: RunRecord,
  worker: string,
): RecordLocation | null {
  const home = homeVariable(ctx.env)
  if (!home || !run.nativeSession || !workerIdValid(worker) || worker === run.nativeSession)
    return null
  const base = ctx.env.get("CODEX_HOME") || join(home, ".codex")
  const file = findStateDb(resolveCodexSqliteHome(ctx, home, base))
  if (!file) return null
  const db = openStateDb(file)
  try {
    const rolloutPath = readCodexRolloutPath(db, worker, run.nativeSession)
    if (!rolloutPath) return null
    const path = confinedRecord(join(realpathSync(base), "sessions"), rolloutPath)
    return path ? { kind: "jsonl", path } : null
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** SQLite's parent_id relation is authoritative; a recursive query has a finite traversal bound. */
export function opencodeWorkerLinked(path: string, parent: string, worker: string): boolean {
  if (!workerIdValid(worker) || worker === parent) return false
  const db = openStateDb(path)
  try {
    db.exec("PRAGMA busy_timeout = 100")
    const rows = db
      .query(
        "WITH RECURSIVE related(id) AS (SELECT id FROM session_v2 WHERE id = ? UNION SELECT s.id FROM session_v2 s JOIN related r ON s.parent_id = r.id LIMIT 256) SELECT id FROM related WHERE id = ? LIMIT 1",
      )
      .get(parent, worker)
    return rows !== null
  } catch {
    return false
  } finally {
    db.close()
  }
}
