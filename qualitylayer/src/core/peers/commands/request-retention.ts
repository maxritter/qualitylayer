import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { capFolderSync, PEER_FILES_KEPT, trimLogSync } from "../../home-caps.ts"
import {
  asRecord,
  fileMtime,
  GC_DAYS_DEFAULT,
  isUuid,
  nowSeconds,
  REQUEST_ORPHAN_TTL,
  readJson,
  requestDir,
  requestPath,
  requestReplyPath,
  stateDir,
  unlinkQuiet,
} from "../base.ts"
import { timelyReply } from "./mailbox.ts"

/** Session-start hooks trim logs and mailbox folders to their shared caps. */
export function capPeerState(): void {
  const dir = stateDir()
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) if (name.endsWith(".log")) trimLogSync(join(dir, name))
  capFolderSync(join(dir, "messages"), PEER_FILES_KEPT, (name) => name.endsWith(".json"))
  capFolderSync(requestDir(), PEER_FILES_KEPT, (name) => name.endsWith(".json"))
}

function requestId(name: string, suffix: string): string | null {
  if (!name.endsWith(suffix)) return null
  const id = name.slice(0, -suffix.length)
  return isUuid(id) ? id : null
}

function expiredRequest(name: string, now: number, dryRun: boolean): string | null {
  const id = requestId(name, ".request.json")
  if (id === null) return null
  const data = asRecord(readJson(requestPath(id), {})) ?? {}
  if (Number(data.expires_at ?? 0) > now) return null
  // Submission closes at the deadline; a timely dispatched answer keeps its collection window.
  if (
    Number(data.expires_at) + GC_DAYS_DEFAULT * 86400 > now &&
    timelyReply(readJson(requestReplyPath(id), null), id, data)
  )
    return null
  if (!dryRun) {
    unlinkQuiet(requestPath(id))
    unlinkQuiet(requestReplyPath(id))
  }
  return id
}

function expiredOrphan(name: string, now: number, dryRun: boolean): string | null {
  const id = requestId(name, ".reply.json")
  if (id === null || existsSync(requestPath(id))) return null
  const mtime = fileMtime(requestReplyPath(id))
  if (mtime === null || !(mtime <= now - REQUEST_ORPHAN_TTL)) return null
  if (!dryRun) unlinkQuiet(requestReplyPath(id))
  return id
}

/** Remove expired mailboxes; keep timely replies for the bounded collection window. */
export function cleanupExpiredRequests(now = nowSeconds(), dryRun = false): string[] {
  const removed: string[] = []
  let names: string[]
  try {
    names = readdirSync(requestDir())
  } catch {
    return removed
  }
  for (const name of names) {
    const id = expiredRequest(name, now, dryRun)
    if (id !== null) removed.push(id)
  }
  for (const name of names) {
    const id = expiredOrphan(name, now, dryRun)
    if (id !== null && !removed.includes(id)) removed.push(id)
  }
  return removed
}
