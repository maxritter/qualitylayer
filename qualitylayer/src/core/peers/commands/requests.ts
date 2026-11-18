import {
  log,
  nowSeconds,
  parseTime,
  REQUEST_POLL_MS,
  readJson,
  requestPath,
  requestReplyPath,
  unlinkQuiet,
  warnVersions,
} from "../base.ts"
import { threadIsPaused } from "../codex.ts"
import { recipientState, recipientWatch } from "../recipient.ts"
import { type Args, fail, flag, out, printResult } from "./arguments.ts"
import { timelyReply } from "./mailbox.ts"
import { deliverRequest, openRequest } from "./request-send.ts"
import { peerWatched } from "./request-watch.ts"

export async function cmdAsk(args: Args): Promise<number> {
  warnVersions()
  const r = await openRequest(args, "ask")
  let keep = false
  try {
    let messageId: string
    try {
      messageId = await deliverRequest(r)
    } catch (cause) {
      return fail(`could not send request to ${r.to}: ${(cause as Error).message}`)
    }
    log(`request ${r.id} submitted to ${r.sessionName ?? r.sessionId}; waiting up to ${r.timeout}s`)
    const deadline = Date.now() + r.timeout * 1000
    const since = parseTime(r.meta.created_at) ?? nowSeconds()
    const watch = recipientWatch(() => recipientState(r.targetKind, r.sessionId, since))
    while (Date.now() < deadline) {
      const response = readJson(requestReplyPath(r.id), null)
      if (timelyReply(response, r.id, r.meta)) {
        const payload = {
          status: "replied",
          request_id: r.id,
          request_message_id: messageId,
          target_kind: r.targetKind,
          session_id: r.sessionId,
          session_name: r.sessionName,
          message: response.message,
        }
        if (flag(args, "json")) out(JSON.stringify(payload))
        else
          process.stdout.write(
            response.message.endsWith("\n") ? response.message : `${response.message}\n`,
          )
        return 0
      }
      const seen = watch()
      if (seen !== null && !timelyReply(readJson(requestReplyPath(r.id), null), r.id, r.meta)) {
        // The mailbox stays: a recipient that comes back can still answer, and `await` collects it.
        keep = true
        return peerWatched(
          args,
          r.id,
          { kind: r.targetKind, id: r.sessionId, name: r.sessionName },
          seen,
        )
      }
      await Bun.sleep(REQUEST_POLL_MS)
    }
    return fail(`request ${r.id} timed out after ${r.timeout} seconds; no reply was queued`, 124)
  } finally {
    if (!keep) {
      unlinkQuiet(requestPath(r.id))
      unlinkQuiet(requestReplyPath(r.id))
    }
  }
}

/** Exit codes of `ask` and `await`: the recipient ended, or it cannot answer until something changes. */

export async function cmdDispatch(args: Args): Promise<number> {
  warnVersions()
  const r = await openRequest(args, "dispatch")
  let messageId: string
  try {
    messageId = await deliverRequest(r)
  } catch (cause) {
    // No reply can ever arrive: leave no orphan mailbox behind.
    unlinkQuiet(requestPath(r.id))
    unlinkQuiet(requestReplyPath(r.id))
    if (flag(args, "json")) {
      out(
        JSON.stringify({
          status: "delivery_failed",
          request_id: r.id,
          target_session_id: r.sessionId,
          detail: (cause as Error).message,
        }),
      )
    }
    return fail(`could not send request to ${r.to}: ${(cause as Error).message}`)
  }
  log(`dispatched request ${r.id} to ${r.sessionName ?? r.sessionId}; expires in ${r.timeout}s`)
  printResult(
    args,
    {
      status: r.targetKind === "codex" ? "queued" : "socket_write_succeeded",
      receipt_confirmed: false,
      target_kind: r.targetKind,
      delivery_condition:
        r.thread === null
          ? "socket_write"
          : threadIsPaused(r.thread.rollout_path)
            ? "paused_until_user_prompt"
            : "native_queue",
      request_id: r.id,
      request_message_id: messageId,
      requester_thread_id: r.threadId,
      target_session_id: r.sessionId,
      target_session_name: r.sessionName,
      created_at: r.meta.created_at,
      expires_at: r.expiresAt,
    },
    `dispatched request ${r.id} to ${r.sessionName ?? r.sessionId}; await it with \`qualitylayer peers await --request ${r.id}\``,
  )
  return 0
}
