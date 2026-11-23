// OpenCode 2.x keeps a session as typed messages in SQLite (`session_message`). An assistant message holds its text,
// reasoning and tool calls as content items and is rewritten while it streams, so the reader returns whole messages
// changed since a watermark and the caller merges the events by id. The terminal stays the agent's engine.

import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { marks, readOpencodeState, readOpencodeUsage } from "./opencode-db.ts"
import { mapOpencodeRows } from "./opencode-rows.ts"
import { CONVERSATION_LIMITS, type ConversationEvent, type ConversationUsage } from "./types.ts"

export { mapOpencodeRows }

/** One `session_message` row, with the columns this reader uses. */
export type OpencodeRow = {
  id: string
  session: string
  type: string
  seq: number
  created: number
  data: string
}

export type OpencodeRead = {
  events: ConversationEvent[]
  usage?: ConversationUsage
  since: number
  state?: "working" | "idle"
  truncated?: boolean
}

const SESSIONS = 256
const ROWS = CONVERSATION_LIMITS.events

function readParentLinks(db: Database, family: string[]): Record<string, string> | undefined {
  if (family.length <= 1) return undefined
  const some = marks(family.length)
  const parents: Record<string, string> = {}
  const links = db
    .query(
      `SELECT json_extract(j.value, '$.id') AS call, json_extract(j.value, '$.state.metadata.sessionID') AS child FROM session_message m, json_each(m.data, '$.content') j WHERE m.session_id IN (${some}) AND m.type = 'assistant' AND json_extract(j.value, '$.type') = 'tool' AND json_extract(j.value, '$.state.metadata.sessionID') IS NOT NULL`,
    )
    .all(...family) as { call: string; child: string }[]
  for (const link of links) parents[link.child] = link.call
  return parents
}

/**
 * Events of one OpenCode session and its subagents, changed since a millisecond watermark, with the session's
 * full usage. Null when the database or the session is not there, or the database cannot be read right now.
 */
export function readOpencode(dbPath: string, session: string, since = 0): OpencodeRead | null {
  if (!existsSync(dbPath)) return null
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    db.exec("PRAGMA busy_timeout = 500")
    if (!db.query("SELECT 1 FROM session_v2 WHERE id = ?").get(session)) return null
    const family = (
      db
        .query(
          "WITH RECURSIVE related(id) AS (SELECT id FROM session_v2 WHERE id = ? UNION SELECT s.id FROM session_v2 s JOIN related r ON s.parent_id = r.id) SELECT id FROM related LIMIT ?",
        )
        .all(session, SESSIONS) as { id: string }[]
    ).map((row) => row.id)
    const some = marks(family.length)
    const rawRows = (
      db
        .query(`SELECT id, session, type, seq, created, updated, CASE WHEN bytes <= ? THEN data ELSE NULL END AS data FROM (
        SELECT *, SUM(length(CAST(data AS BLOB))) OVER (ORDER BY created DESC, seq DESC) AS bytes FROM (
          SELECT id, session_id AS session, type, seq, time_created AS created, time_updated AS updated, data
          FROM session_message WHERE session_id IN (${some}) AND time_updated > ? ORDER BY time_created DESC, seq DESC LIMIT ?
        )
      )`)
        .all(CONVERSATION_LIMITS.readBytes, ...family, since, ROWS) as (Omit<
        OpencodeRow,
        "data"
      > & { updated: number; data: string | null })[]
    ).reverse()
    const rows = rawRows.filter(
      (row): row is OpencodeRow & { updated: number } => row.data !== null,
    )
    const events = mapOpencodeRows(rows, { parents: readParentLinks(db, family) })
    const watermark = rawRows.reduce((latest, row) => Math.max(latest, row.updated), since)
    return {
      events,
      usage: readOpencodeUsage(db, session, family),
      since: watermark,
      state: readOpencodeState(db, session),
      ...(rows.length !== rawRows.length ? { truncated: true } : {}),
    }
  } catch {
    return null
  } finally {
    db?.close()
  }
}
