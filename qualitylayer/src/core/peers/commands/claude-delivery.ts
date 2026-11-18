import { randomUUID } from "node:crypto"
import { join } from "node:path"
import {
  asRecord,
  claudeSessionsDir,
  log,
  MAX_TEXT_CHARS,
  PeerError,
  readJson,
  threadStatePath,
  utf8Len,
} from "../base.ts"
import {
  buildCcBody,
  buildUserFrame,
  buildWrapper,
  type ClaudeRecord,
  peerTokenFor,
  recordLiveness,
  sendFrame,
  socketPathOk,
} from "../claude.ts"
import { ordinaryDelivery, updateOrdinary } from "../inbox.ts"
import { nativeCaller, peerEnvelope } from "../native.ts"
import { shimPid } from "../shim.ts"
import { type Args, fail, printResult } from "./arguments.ts"
import { finishedClaudeHint, resolveClaudeRecord } from "./claude-targets.ts"
import { callingClaudeRecord, threadFromArgs } from "./identity.ts"
import { saveOrdinaryForCaller } from "./inbox.ts"

function codexReplyRoute(threadId: string | null) {
  let threadName: string | null = null
  let shimSocket: string | null = null
  if (threadId) {
    const state = asRecord(readJson(threadStatePath(threadId), {})) ?? {}
    threadName = typeof state.name === "string" ? state.name : null
    const pid = shimPid(threadId)
    if (pid !== null) {
      const shimRec = asRecord(readJson(join(claudeSessionsDir(), `${pid}.json`), {})) ?? {}
      shimSocket =
        typeof shimRec.messagingSocketPath === "string" ? shimRec.messagingSocketPath : null
    }
  }
  return { threadName, shimSocket }
}

export async function deliverClaude(
  rec: ClaudeRecord,
  message: string,
  threadId: string | null,
  replyRoute = true,
  messageId?: string,
): Promise<[string, boolean]> {
  const { threadName, shimSocket } = codexReplyRoute(threadId)
  let route = replyRoute ? shimSocket : null
  let body: string
  const caller = threadId || nativeCaller() ? null : callingClaudeRecord()
  if (caller !== null && replyRoute && socketPathOk(caller.messagingSocketPath)) {
    // Claude Code to Claude Code: signed as the calling session, so a reply goes straight back.
    route = caller.messagingSocketPath as string
    body = buildWrapper(message, route, caller.sessionId ?? "", caller.name ?? null)
  } else if (threadId === null) {
    body = `Message from a peer session:\n${message}`
  } else {
    body = buildCcBody(message, threadId, threadName, route)
  }
  if (body.length > MAX_TEXT_CHARS || utf8Len(body) > MAX_TEXT_CHARS) {
    throw new PeerError(`wrapped message exceeds the ${MAX_TEXT_CHARS}-character/byte peer cap`)
  }
  const frame = buildUserFrame(body, route)
  if (messageId) frame.msg_id = messageId
  await sendFrame(rec.messagingSocketPath as string, frame, peerTokenFor(rec))
  return [frame.msg_id, route !== null]
}

export async function sendClaude(target: string, message: string, args: Args): Promise<number> {
  const rec = resolveClaudeRecord(target)
  const original = message
  const threadId = nativeCaller() ? null : threadFromArgs(args)
  const durableId = randomUUID()
  const native = nativeCaller()
  if (!rec.sessionId) return fail("the recipient has no native session id")
  saveOrdinaryForCaller(durableId, { kind: "cc", uuid: rec.sessionId }, original)
  if (native) message = peerEnvelope(native, durableId, message, ordinaryDelivery(durableId))
  let msgId: string
  let replyCapable: boolean
  try {
    ;[msgId, replyCapable] = await deliverClaude(rec, message, threadId, true, durableId)
    updateOrdinary(durableId, {
      delivery_status: "socket_write_succeeded",
      transport_message_id: msgId,
    })
  } catch (cause) {
    const hint = recordLiveness(rec) === "dead" ? finishedClaudeHint(target, [rec]) : null
    const detail = hint ? `${(cause as Error).message}. ${hint}` : (cause as Error).message
    updateOrdinary(durableId, {
      delivery_status: "delivery_failed",
      detail,
    })
    if (hint) throw new PeerError(detail)
    if (cause instanceof PeerError) throw cause
    return fail(`could not reach ${target}: ${(cause as Error).message}`)
  }
  if (threadId && !replyCapable) {
    log(
      `Codex thread ${threadId} has no live stand-in; the message was sent, but a native peer reply cannot route back`,
    )
  }
  printResult(
    args,
    {
      status: "socket_write_succeeded",
      receipt_confirmed: false,
      target: "claude",
      session_id: rec.sessionId ?? null,
      session_name: rec.name ?? null,
      message_id: msgId,
      inbox_message_id: durableId,
      from_thread: threadId,
      reply_capable: replyCapable,
    },
    `socket write succeeded to ${target} (pid ${rec.pid}), message ${msgId}; receipt unconfirmed`,
  )
  return 0
}
