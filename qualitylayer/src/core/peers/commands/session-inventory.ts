import { parseTime } from "../base.ts"
import type { Said } from "../claims.ts"
import type { ClaudeRecord } from "../claude.ts"
import { claudeFacts, claudeTranscript } from "../doing.ts"
import type { NativeRegistration } from "../native.ts"
import { sessionFacts } from "./session-facts.ts"
export const claudeView = async (r: ClaudeRecord, said: Map<string, Said>) => ({
  pid: r.pid ?? null,
  sessionId: r.sessionId ?? null,
  name: r.name ?? null,
  status: r.status ?? null,
  version: r.version ?? null,
  kind: r.kind ?? null,
  entrypoint: r.entrypoint ?? null,
  socket: r.messagingSocketPath ?? null,
  ...(await sessionFacts(
    `cc:${r.sessionId}`,
    said,
    {
      cwd: r.cwd ?? null,
      transcript:
        typeof r.sessionId === "string" ? claudeTranscript(r.sessionId, r.cwd ?? null) : null,
      name: r.name ?? null,
    },
    claudeFacts,
    parseTime(r.updatedAt),
  )),
})
export const nativeView = async (row: NativeRegistration, said: Map<string, Said>) => ({
  kind: row.kind,
  uuid: row.uuid,
  session: row.session,
  name: row.name,
  status: row.status,
  updated: row.updated,
  ...(await sessionFacts(
    `${row.kind}:${row.uuid}`,
    said,
    { cwd: row.cwd, transcript: null, name: row.name },
    () => ({ titles: [], prompt: null }),
    parseTime(row.updated),
  )),
})
