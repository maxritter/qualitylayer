// Claude Code's side of the fabric: its session registry (one JSON record per
// live session, naming the session's messaging socket), how liveness is
// proven, and how one NDJSON frame reaches a session's socket.

import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { windows } from "../platform.ts"
import { pidAlive } from "../self.ts"
import { windowsProcessStart, windowsProcessStarts } from "../windows-processes.ts"
import { asRecord, claudeSessionsDir, isUuid, readJson, runCmd } from "./base.ts"
import { realPathOrGiven } from "./claude-sockets.ts"

export {
  buildCcBody,
  buildUserFrame,
  buildWrapper,
  escapeAttr,
  neutraliseRequestMarkup,
  neutraliseWrapperMarkup,
  replyText,
  requirePeerName,
  type UserFrame,
  unwrapMessage,
  validPeerName,
} from "./claude-frames.ts"
export {
  allowlistedSocketDirs,
  defaultSocketDir,
  deliverToRecord,
  dirIsAllowlisted,
  ensureSocketDir,
  sendFrame,
  socketPathOk,
} from "./claude-sockets.ts"

export type ClaudeRecord = Record<string, unknown> & {
  pid?: number
  sessionId?: string
  name?: string
  cwd?: string
  status?: string
  messagingSocketPath?: string
  _path: string
}

export type Liveness = "live" | "dead" | "unverified"

/** The platform name Claude stamps on a record, so a pid from elsewhere reads as stale. */
export function pidDomain(): string {
  if (windows) return `win32:${hostname().toLowerCase()}`
  return process.platform === "darwin" ? "darwin" : process.platform
}

/** `ps -o lstart=` under a fixed locale and zone: [value, error]. */
export function procStartChecked(pid: number): [string | null, string | null] {
  if (windows) return windowsProcessStart(pid)
  const [code, out, err] = runCmd(["ps", "-o", "lstart=", "-p", String(pid)], {
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  })
  if (code !== 0) return [null, err.trim() || `ps exited ${code}`]
  const value = out.trim()
  return value === "" ? [null, "ps returned no process start time"] : [value, null]
}

export function procStart(pid: number): string | null {
  return procStartChecked(pid)[0]
}

export function readClaudeRecords(): ClaudeRecord[] {
  const dir = claudeSessionsDir()
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch {
    return []
  }
  const out: ClaudeRecord[] = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const rec = asRecord(readJson(join(dir, name), null))
    if (rec !== null) out.push({ ...rec, _path: join(dir, name) } as ClaudeRecord)
  }
  return out
}

/**
 * Pid alive, same pid domain, and the recorded process start equal to `ps`.
 * A denied `ps` is `unverified`, never `dead`: a sandbox can hide a healthy
 * session. A record without a start cannot rule out pid reuse: `unverified`.
 */
export function recordLiveness(rec: ClaudeRecord, snapshot?: Map<number, string>): Liveness {
  const pid = rec.pid
  if (typeof pid !== "number" || !pidAlive(pid)) return "dead"
  if (rec.pidDomain !== undefined && rec.pidDomain !== null && rec.pidDomain !== pidDomain())
    return "dead"
  const recorded = rec.procStart
  if (typeof recorded !== "string" || recorded === "") return "unverified"
  const [actual, error] =
    snapshot === undefined ? procStartChecked(pid) : [snapshot.get(pid) ?? null, null]
  if (error !== null || actual === null) return "unverified"
  const same =
    actual.trim() === recorded.trim() ||
    (windows && Number.isFinite(Date.parse(actual)) && Date.parse(actual) === Date.parse(recorded))
  return same ? "live" : "dead"
}

export function liveClaudeRecords(): ClaudeRecord[] {
  return classifyClaudeRecords(readClaudeRecords())
    .filter(([, state]) => state === "live")
    .map(([record]) => record)
}

export function classifyClaudeRecords(records: ClaudeRecord[]): [ClaudeRecord, Liveness][] {
  const snapshot = windows
    ? windowsProcessStarts(
        records.flatMap((rec) =>
          typeof rec.pid === "number" && pidAlive(rec.pid) ? [rec.pid] : [],
        ),
      )[0]
    : undefined
  return records.map((record) => [record, recordLiveness(record, snapshot)])
}

export function claudeRecordsByName(name: string, records = liveClaudeRecords()): ClaudeRecord[] {
  return records.filter((r) => r.name === name)
}

/** Records addressed by their mutable name or their stable session UUID. */
export function claudeRecordsByTarget(
  target: string,
  records = liveClaudeRecords(),
): ClaudeRecord[] {
  return isUuid(target)
    ? records.filter((r) => r.sessionId === target)
    : records.filter((r) => r.name === target)
}

export function claudeRecordBySocket(
  socket: string,
  records = liveClaudeRecords(),
): ClaudeRecord | null {
  const want = realPathOrGiven(socket)
  return (
    records.find(
      (r) =>
        typeof r.messagingSocketPath === "string" &&
        realPathOrGiven(r.messagingSocketPath) === want,
    ) ?? null
  )
}

/** The optional `<pid>.<sha256(socket)>.key` token a session may ask senders for. */
export function peerKeyName(pid: number, socket: string): string {
  const canonical = windows ? socket.toLowerCase() : socket
  return `${pid}.${createHash("sha256").update(canonical, "utf8").digest("hex")}.key`
}

function parsePeerToken(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    const obj = asRecord(parsed)
    if (obj !== null) {
      const token = obj.peerToken ?? obj.token
      return typeof token === "string" ? token : null
    }
    return typeof parsed === "string" ? parsed : raw
  } catch {
    return raw
  }
}

export function peerTokenFor(rec: ClaudeRecord): string | null {
  const pid = rec.pid
  const sock = rec.messagingSocketPath
  if (!pid || !sock) return null
  try {
    const raw = readFileSync(join(claudeSessionsDir(), peerKeyName(pid, sock)), "utf8").trim()
    return raw === "" ? null : parsePeerToken(raw)
  } catch {
    return null
  }
}
