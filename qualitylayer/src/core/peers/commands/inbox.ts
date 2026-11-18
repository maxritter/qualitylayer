import { asRecord, nowIso, nowSeconds, type PeerKind, readJson } from "../base.ts"
import { ordinaryPath, ordinaryStatus, saveOrdinary, updateOrdinary } from "../inbox.ts"
import { type Args, fail, opt, printResult } from "./arguments.ts"
import { callerIdentity } from "./identity.ts"

export function saveOrdinaryForCaller(
  id: string,
  target: { kind: PeerKind; uuid: string },
  message: string,
) {
  let sender: { kind: PeerKind; uuid: string } | null = null
  try {
    sender = callerIdentity({ positional: [], opts: {} })
  } catch {}
  saveOrdinary(id, target, message, sender)
}

export async function cmdAck(args: Args): Promise<number> {
  const id = opt(args, "message-id")
  if (!id) return fail("--message-id <uuid> is required", 2)
  const caller = callerIdentity({ positional: [], opts: {} })
  const record = asRecord(readJson(ordinaryPath(id), null))
  const target = asRecord(record?.target)
  if (record === null || Number(record.expires_at ?? 0) <= nowSeconds())
    return fail(`message ${id} is unknown or expired`)
  if (target?.kind !== caller.kind || target.uuid !== caller.uuid)
    return fail("only this message's native recipient can acknowledge it")
  if (record.delivery_status === "delivery_failed" && !record.picked_up_at)
    return fail("cannot acknowledge a failed delivery that was never picked up")
  const updated = updateOrdinary(id, {
    picked_up_at: record.picked_up_at ?? nowIso(),
    acknowledged_at: record.acknowledged_at ?? nowIso(),
  })
  printResult(
    args,
    { status: "acknowledged", message_id: id, acknowledged_at: updated.acknowledged_at },
    `acknowledged message ${id}`,
  )
  return 0
}

export async function cmdReceipt(args: Args): Promise<number> {
  const id = opt(args, "message-id")
  if (!id) return fail("--message-id <uuid> is required", 2)
  const caller = callerIdentity({ positional: [], opts: {} })
  const record = asRecord(readJson(ordinaryPath(id), null))
  if (record === null || Number(record.expires_at ?? 0) <= nowSeconds())
    return fail(`message ${id} is unknown or expired`)
  const sender = asRecord(record.sender)
  if (sender?.kind !== caller.kind || sender.uuid !== caller.uuid)
    return fail("only this message's native sender can inspect its receipt")
  const { message: _message, ...receipt } = record
  printResult(
    args,
    { ...receipt, status: ordinaryStatus(record), receipt_confirmed: !!record.acknowledged_at },
    `${id}: ${ordinaryStatus(record)}`,
  )
  return 0
}

import { existsSync } from "node:fs"
import { requestReplyPath } from "../base.ts"
import { ownOrdinary } from "../inbox.ts"
import { addressedTo, openRequests } from "./mailbox.ts"
import { cleanupExpiredRequests } from "./request-retention.ts"

export async function cmdInbox(args: Args): Promise<number> {
  const caller = callerIdentity({ positional: [], opts: {} })
  cleanupExpiredRequests()
  const requests = openRequests()
    .filter((r) => addressedTo(r.meta, caller) && !existsSync(requestReplyPath(r.id)))
    .map(({ id, meta }) => ({
      request_id: id,
      requester_kind: meta.requester_kind ?? "codex",
      requester_session_id: meta.requester_session_id ?? meta.requester_thread_id,
      expires_at: meta.expires_at,
      message: meta.message ?? null,
    }))
  const messages = ownOrdinary(caller)
  printResult(
    args,
    { status: "inbox", owner: caller, requests, messages },
    [
      ...requests.map(
        (r) =>
          `${r.request_id} (expires ${r.expires_at}):\n${r.message ?? "request text unavailable; use the delivered envelope"}`,
      ),
      ...messages.map((m) => `${m.message_id}:\n${m.message}`),
    ].join("\n") || "no pending requests or messages for this session",
  )
  return 0
}
