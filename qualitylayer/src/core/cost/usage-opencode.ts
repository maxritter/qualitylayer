// OpenCode's usage for the usage count (usage.ts). Its calls are not in transcript files but in one
// SQLite database, so each session with messages in the range stands for a file: it is named by the
// database and the session (`<database>#<session>`), changed when it gains a message, and read
// with the same reader that prices a task's OpenCode sessions (native.ts). The database is only
// opened for reading, and no OpenCode process is started.

import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import type { Ctx } from "../../ctx.ts"
import { opencodeDatabase } from "../agents/storage.ts"
import { opencodeSessions } from "./native.ts"
import type { Call } from "./transcripts.ts"
import type { Candidate } from "./usage-files.ts"

/** Sessions looked at, however large the database. */
const SESSIONS_MAX = 20_000
const SEPARATOR = "#"

/**
 * The sessions with a message changed since `since`, the newest first. OpenCode writes a call's
 * tokens and completion into its message row afterwards and stamps `time_updated`, so a session's
 * change time is its newest `time_updated`, and its size the number of its messages: a session that
 * gained a message or finished one is read again.
 */
export function opencodeCandidates(ctx: Ctx, since: number): Candidate[] {
  const file = opencodeDatabase(ctx)
  if (!file || !existsSync(file)) return []
  let db: Database | undefined
  try {
    db = new Database(file, { readonly: true })
    const sessions = db
      .query(
        "SELECT session_id AS id, COUNT(*) AS size, MAX(time_updated) AS mtimeMs FROM session_message GROUP BY session_id HAVING MAX(time_updated) >= ? ORDER BY mtimeMs DESC LIMIT ?",
      )
      .all(since, SESSIONS_MAX) as { id: string; size: number; mtimeMs: number }[]
    return sessions.map((row) => ({
      path: `${file}${SEPARATOR}${row.id}`,
      mtimeMs: row.mtimeMs,
      size: row.size,
    }))
  } finally {
    db?.close()
  }
}

/** The calls of one session (not of the sessions it started, which are listed on their own). */
export function opencodeCalls(ctx: Ctx, candidate: Candidate): Call[] {
  const session = candidate.path.slice(candidate.path.lastIndexOf(SEPARATOR) + 1)
  const sessions = opencodeSessions(ctx, [session], session)
  const file = opencodeDatabase(ctx)
  if (sessions === null && file && existsSync(file))
    throw new Error("OpenCode usage source could not be read")
  const found = sessions?.find((one) => one.id === session)
  return found?.calls ?? []
}
