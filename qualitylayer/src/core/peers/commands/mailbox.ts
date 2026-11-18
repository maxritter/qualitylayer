import { randomUUID } from "node:crypto"
import { readdirSync, renameSync } from "node:fs"
import {
  asRecord,
  isUuid,
  parseTime,
  readJson,
  requestDir,
  requestPath,
  requestReplyPath,
  unlinkQuiet,
} from "../base.ts"

export function replyMatches(
  response: unknown,
  id: string,
  sid: unknown,
  kind: unknown = "cc",
): response is { message: string } {
  const rec = asRecord(response)
  if (rec === null) return false
  if (rec.request_id !== id || rec.session_id !== sid) return false
  return (rec.target_kind ?? "cc") === kind && typeof rec.message === "string"
}

function finiteTime(value: number | null): value is number {
  return value !== null && Number.isFinite(value)
}

export function timelyReply(
  response: unknown,
  id: string,
  meta: Record<string, unknown>,
): response is { message: string } {
  if (!replyMatches(response, id, meta.target_session_id, meta.target_kind ?? "cc")) return false
  const reply = asRecord(response)
  const repliedAt = parseTime(reply?.replied_at)
  const createdAt = parseTime(meta.created_at)
  const expiresAt = Number(meta.expires_at)
  if (!finiteTime(repliedAt) || !finiteTime(createdAt) || !Number.isFinite(expiresAt)) return false
  return repliedAt >= createdAt && repliedAt < expiresAt
}

/** The atomic rename gives one collector the reply and closes its request. */
export function takeReply(id: string): string | null {
  const replyPath = requestReplyPath(id)
  const claim = `${replyPath}.consumed.${process.pid}.${randomUUID()}`
  try {
    renameSync(replyPath, claim)
  } catch {
    return null
  }
  const claimed = asRecord(readJson(claim, null))
  unlinkQuiet(claim)
  unlinkQuiet(requestPath(id))
  return typeof claimed?.message === "string" ? claimed.message : ""
}

export type Who = { kind: string; uuid: string }

/** Every request mailbox that is still open, with its record. */
export function openRequests(): { id: string; meta: Record<string, unknown> }[] {
  let names: string[] = []
  try {
    names = readdirSync(requestDir())
  } catch {}
  return names
    .filter((name) => name.endsWith(".request.json"))
    .flatMap((name) => {
      const id = name.slice(0, -".request.json".length)
      const meta = isUuid(id) ? asRecord(readJson(requestPath(id), null)) : null
      return meta === null ? [] : [{ id, meta }]
    })
}

export const addressedTo = (meta: Record<string, unknown>, who: Who) =>
  (meta.target_kind ?? "cc") === who.kind && meta.target_session_id === who.uuid

export const sentBy = (meta: Record<string, unknown>, who: Who) =>
  (meta.requester_kind ?? "codex") === who.kind &&
  (meta.requester_session_id ?? meta.requester_thread_id) === who.uuid
