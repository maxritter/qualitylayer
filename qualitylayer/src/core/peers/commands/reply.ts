import {
  asRecord,
  nowIso,
  nowSeconds,
  readJson,
  requestPath,
  requestReplyPath,
  writeJsonExclusive,
} from "../base.ts"
import { type Args, fail, messageFrom, opt, printResult } from "./arguments.ts"
import { callerIdentity } from "./identity.ts"
import { replyMatches } from "./mailbox.ts"
import { cleanupExpiredRequests } from "./request-retention.ts"

function replyRequest(id: string, path: string) {
  cleanupExpiredRequests()
  const meta = asRecord(readJson(path, null))
  if (meta === null) return { ok: false as const, message: `request ${id} is unknown or expired` }
  if (Number(meta.expires_at ?? 0) <= nowSeconds()) {
    cleanupExpiredRequests()
    return { ok: false as const, message: `request ${id} is expired` }
  }
  return { ok: true as const, meta }
}

export async function cmdReply(args: Args): Promise<number> {
  const id = opt(args, "request")
  if (id === undefined) return fail("--request <uuid> is required", 2)
  const message = messageFrom(args)
  const path = requestPath(id)
  const replyPath = requestReplyPath(id)
  const loaded = replyRequest(id, path)
  if (!loaded.ok) return fail(loaded.message)
  const { meta } = loaded
  const caller = callerIdentity({ positional: [], opts: {} })
  const targetKind = meta.target_kind ?? "cc"
  const sid = caller.uuid
  if (caller.kind !== targetKind || sid !== meta.target_session_id)
    return fail(
      `request ${id} belongs to ${targetKind}:${meta.target_session_id}, not ${caller.kind}:${sid}`,
    )
  const payload = {
    request_id: id,
    target_kind: targetKind,
    session_id: sid,
    message,
    replied_at: nowIso(),
  }
  let status = "replied"
  if (!writeJsonExclusive(replyPath, payload)) {
    let existing: Record<string, unknown> = {}
    for (let i = 0; i < 20; i++) {
      const value = asRecord(readJson(replyPath, null))
      if (value !== null) {
        existing = value
        break
      }
      await Bun.sleep(10)
    }
    if (!replyMatches(existing, id, sid, targetKind) || existing.message !== message)
      return fail(`request ${id} already has a different reply`)
    status = "already_replied"
  }
  printResult(
    args,
    { status, request_id: id, session_id: sid },
    `${status.replace("_", " ")} to request ${id}`,
  )
  return 0
}
