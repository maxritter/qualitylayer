// Codex's side of the fabric: which threads exist (the state database and the
// session index), which are live (a Codex process holds the thread's rollout
// or its writer lock), the tag line a bridged message carries into a thread,
// `codex queue`, and the rollout reader that sees each turn start and end.

import { join } from "node:path"
import {
  asRecord,
  nowIso,
  PeerError,
  readJson,
  registeredPath,
  stateDir,
  writeJsonAtomic,
} from "./base.ts"
import { type ClaudeRecord, liveClaudeRecords, requirePeerName, validPeerName } from "./claude.ts"
import { codexThreads } from "./codex-db.ts"
import { canon, lsofHoldersChecked } from "./codex-lsof.ts"
import { withLock } from "./lock.ts"

export {
  codexSqliteHome,
  codexThreads,
  findStateDb,
  independentPeerThread,
  openStateDb,
  peerRoleOf,
  readCodexConfig,
  readSessionIndex,
  spawnParentOf,
} from "./codex-db.ts"
export { lsofHoldersChecked, writerLockPath } from "./codex-lsof.ts"
export {
  argvTextBudget,
  buildTag,
  codexQueue,
  codexQueueOrWait,
  parseTag,
  QUEUE_SOFT_CAP,
  QueueError,
  QueueFullError,
  queuedCount,
  stripTag,
  type Tag,
  WAITING_DETAIL,
} from "./codex-queue.ts"
export {
  ResolveAmbiguousKind,
  ResolveError,
  ResolveNoLive,
  ResolveNotFound,
  resolveThread,
  resolveThreadPreferLive,
  routeSubAgent,
} from "./codex-resolve.ts"
export {
  lastBoundary,
  lastTurnStop,
  RolloutTail,
  type TailState,
  type Turn,
  type TurnEvent,
  threadIsPaused,
} from "./codex-rollout.ts"

export type Thread = {
  id: string
  name: string | null
  rollout_path: string | null
  cwd: string | null
  updated_at: unknown
  registered: boolean
  holder_pid: number | null
  /** true live, false gone, null unverifiable. */
  live: boolean | null
  liveness_error: string | null
  /** The thread that spawned this one as a sub-agent, when Codex recorded it. */
  parent_id: string | null
  /** Native source metadata, never inferred from the mutable conversation title. */
  role?: "session" | "subagent" | "guardian" | "unknown"
  degraded?: boolean
}

export const threadLabel = (t: Thread) => (t.name ? `${t.name} (${t.id})` : t.id)

export function liveCoordinator(thread: Thread, threads: Thread[], strict = false): Thread | null {
  const byId = new Map(threads.map((t) => [t.id, t]))
  const seen = new Set([thread.id])
  let at: Thread | undefined = thread
  while (at?.parent_id != null && !seen.has(at.parent_id)) {
    seen.add(at.parent_id)
    at = byId.get(at.parent_id)
    if (at !== undefined && (strict ? at.live === true : at.live !== false)) return at
  }
  return null
}

/** [held, pid]; held null means the probe was unavailable. With `holderPid`, that exact pid must hold it. */
export function threadIsHeld(
  rolloutPath: string | null,
  holderPid: number | null = null,
  lockPath: string | null = null,
): [boolean | null, number | null] {
  const paths = [rolloutPath, lockPath].filter((p): p is string => !!p)
  if (holderPid !== null) {
    const [mine, minePath] = lsofHoldersChecked(paths, holderPid)
    if (minePath && paths.some((p) => mine.get(canon(p) ?? "")?.some(([pid]) => pid === holderPid)))
      return [true, holderPid]
  }
  const [holders, verified] = lsofHoldersChecked(paths)
  if (!verified) return [null, null]
  const found = paths.flatMap((p) => holders.get(canon(p) ?? "") ?? [])
  if (holderPid === null) return [found.length > 0, found[0]?.[0] ?? null]
  if (found.some(([pid]) => pid === holderPid)) return [true, holderPid]
  return [false, found[0]?.[0] ?? null]
}

export const reconcileLockPath = () => join(stateDir(), "reconcile.lock")

export function readRegistered(): Record<string, unknown> {
  const threads = asRecord(asRecord(readJson(registeredPath(), {}))?.threads)
  return threads ?? {}
}

export function writeRegistered(threads: Record<string, unknown>): void {
  writeJsonAtomic(registeredPath(), { threads }, 0o600)
}

/**
 * Record a thread as opted in. A title that cannot be a peer name (Codex's own
 * titles carry spaces) is kept out of the record: the stand-in then goes by
 * its UUID-derived alias, and a /rename later gives it a readable one.
 */
export function registerThread(thread: Thread): void {
  const name = validPeerName(thread.name) ? thread.name : null
  withLock(reconcileLockPath(), () => {
    const threads = readRegistered()
    threads[thread.id] = { name, registered_at: nowIso() }
    writeRegistered(threads)
  })
}

export function refreshRegisteredName(threadId: string, name: string): boolean {
  requirePeerName(name, "peer alias")
  return withLock(
    reconcileLockPath(),
    (acquired) => {
      if (!acquired) return false
      const threads = readRegistered()
      const meta = asRecord(threads[threadId])
      if (meta === null || meta.name === name) return false
      threads[threadId] = { ...meta, name }
      writeRegistered(threads)
      return true
    },
    { blocking: false },
  )
}

export function unregisterThreadUnlocked(threadId: string): boolean {
  const threads = readRegistered()
  if (!(threadId in threads)) return false
  delete threads[threadId]
  writeRegistered(threads)
  return true
}

/** The lowest live UUID carrying a title: a stable tiebreak between duplicates. */
export function codexTitleOwner(title: string | null, threads?: Thread[]): string | null {
  if (!validPeerName(title)) return null
  let list = threads
  if (list === undefined) {
    const [found, ok] = codexThreads()
    if (!ok) return null
    list = found
  }
  const owners = list
    .filter((t) => t.live === true && t.name === title)
    .map((t) => t.id)
    .sort()
  return owners[0] ?? null
}

/** A safe, unique alias for a mutable Codex title: the title itself, else a UUID-derived one. */
export function peerNameForThread(
  title: string | null,
  threadId: string,
  records: ClaudeRecord[] = liveClaudeRecords(),
  titleOwner: string | null = null,
  threads: Thread[] = [],
): string {
  const occupied = new Set(
    records.filter((r) => r.sessionId !== threadId && r.name).map((r) => r.name as string),
  )
  const candidates: string[] = []
  const ambiguous = (name: string) => {
    const prefix = name.startsWith("codex-") ? name.slice(6).replaceAll("-", "").toLowerCase() : ""
    return (
      /^[a-f0-9]{8,32}$/i.test(prefix) &&
      threads.filter((t) => t.id.replaceAll("-", "").toLowerCase().startsWith(prefix)).length > 1
    )
  }
  if (validPeerName(title) && !ambiguous(title) && (titleOwner === null || titleOwner === threadId))
    candidates.push(title)
  candidates.push(`codex-${threadId.slice(0, 8)}`, `codex-${threadId}`)
  for (const candidate of candidates) {
    if (validPeerName(candidate) && !ambiguous(candidate) && !occupied.has(candidate))
      return candidate
  }
  throw new PeerError(`no unique peer alias is available for thread ${threadId}`)
}
