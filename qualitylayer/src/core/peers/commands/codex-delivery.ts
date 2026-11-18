import { randomUUID } from "node:crypto"
import { asRecord, isUuid, log, PeerError, readJson, threadStatePath } from "../base.ts"
import { claudeRecordBySocket, claudeRecordsByTarget } from "../claude.ts"
import {
  buildTag,
  codexQueueOrWait,
  resolveThread,
  routeSubAgent,
  type Thread,
  threadIsHeld,
  threadIsPaused,
  threadLabel,
  WAITING_DETAIL,
  writerLockPath,
} from "../codex.ts"
import { ordinaryDelivery, updateOrdinary } from "../inbox.ts"
import { nativeCaller, peerEnvelope } from "../native.ts"
import { type Args, fail, flag, opt, out, printResult } from "./arguments.ts"
import { callingFrom } from "./identity.ts"
import { saveOrdinaryForCaller } from "./inbox.ts"

export function liveCodexTarget(target: string): Thread {
  const thread = resolveThread(target)
  if (thread.role === "guardian")
    throw new PeerError(
      `Codex ${thread.id} is an approval guardian, not a user task session. Address the requesting task's full UUID from qualitylayer peers list; no session was resumed or replaced.`,
    )
  if (thread.degraded) log("liveness unverified: the Codex state schema is unknown")
  else {
    const [held] = threadIsHeld(thread.rollout_path, null, writerLockPath(thread.id))
    if (held === null)
      throw new PeerError(
        "Codex thread liveness is unavailable; run qualitylayer peers doctor where process inspection is permitted",
      )
    if (!held)
      throw new PeerError(
        `no active session for thread ${thread.id}; its process has exited (the queue would sit undrained)`,
      )
    if (threadIsPaused(thread.rollout_path)) {
      log(
        `thread ${thread.id} is paused after an interrupt: the message is queued but drains only when its user types the next prompt`,
      )
    }
  }
  return thread
}

function inheritedSender(native: ReturnType<typeof nativeCaller>, fromSocket: string | null) {
  // A Codex started from a Claude Code shell inherits that session's variables:
  // only when Claude Code is the nearer ancestor does the message come from it.
  const inherited = native !== null || callingFrom() === "codex"
  if (fromSocket === null && !inherited)
    fromSocket = process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? null
  const envSid = inherited ? undefined : process.env.CLAUDE_CODE_SESSION_ID
  const ownThread = native ? undefined : process.env.CODEX_THREAD_ID
  return { fromSocket, envSid, ownThread }
}

function codexSender(args: Args, native: ReturnType<typeof nativeCaller>) {
  let fromName = native
    ? `${native.kind}-${native.uuid.slice(0, 8)}`
    : (opt(args, "from-name") ?? null)
  let fromSid = native?.uuid ?? opt(args, "from-sid") ?? null
  let fromSocket = native ? null : (opt(args, "from-socket") ?? null)
  const inherited = inheritedSender(native, fromSocket)
  fromSocket = inherited.fromSocket
  const { envSid, ownThread } = inherited
  const anonymous = fromName === null && fromSid === null && !fromSocket
  if (anonymous && !isUuid(envSid) && isUuid(ownThread)) {
    // Codex to Codex: signed as the sending thread, with no reply route (its turn ends in its own TUI).
    const state = asRecord(readJson(threadStatePath(ownThread as string), {})) ?? {}
    fromName =
      typeof state.name === "string" ? state.name : `codex-${(ownThread as string).slice(0, 8)}`
    fromSid = ownThread as string
  }
  if (!fromSocket && !fromSid && isUuid(envSid)) {
    const matches = claudeRecordsByTarget(envSid as string)
    if (matches.length === 1) fromSocket = matches[0]?.messagingSocketPath ?? null
  }
  if (fromSocket) {
    // A reply address needs its session id, resolved here from the registry.
    const rec = claudeRecordBySocket(fromSocket)
    if (rec === null) {
      return {
        ok: false as const,
        message: `no live Claude session listens on ${fromSocket}, so --from-socket would name a reply address nothing answers`,
      }
    }
    fromSid ??= rec.sessionId ?? null
    fromName ??= rec.name ?? null
  } else if (!fromName && !fromSid) {
    log(
      "sender identity absent: replies stay in the Codex TUI; from Claude Code, send through its Bash tool so CLAUDE_CODE_MESSAGING_SOCKET is available",
    )
  }
  return { ok: true as const, fromName, fromSid, fromSocket }
}

export async function sendCodex(target: string, original: string, args: Args): Promise<number> {
  const native = nativeCaller()
  // A spawned sub-agent the native queue has not loaded takes no direct input: its live
  // coordinator receives the message and is told whom it is for.
  const routed = routeSubAgent(target)
  const thread = liveCodexTarget(routed?.coordinator.id ?? target)
  let message =
    routed === null ? original : `for your sub-agent ${threadLabel(routed.child)}: ${original}`
  const sender = codexSender(args, native)
  if (!sender.ok) return fail(sender.message)
  const { fromName, fromSid, fromSocket } = sender
  const msgId = randomUUID()
  saveOrdinaryForCaller(msgId, { kind: "codex", uuid: thread.id }, native ? original : message)
  if (native) message = peerEnvelope(native, msgId, message, ordinaryDelivery(msgId))
  let waiting = false
  try {
    waiting =
      codexQueueOrWait(
        thread.id,
        native
          ? message
          : `${buildTag(fromName, fromSid, fromSocket, msgId, flag(args, "no-reply"))}\n${message}`,
        thread.cwd,
      ) === "waiting"
    updateOrdinary(
      msgId,
      waiting
        ? { delivery_status: "waiting", detail: WAITING_DETAIL }
        : { delivery_status: "queued" },
    )
  } catch (cause) {
    updateOrdinary(msgId, { delivery_status: "delivery_failed", detail: (cause as Error).message })
    if (flag(args, "json"))
      out(
        JSON.stringify({ status: "delivery_failed", message_id: msgId, receipt_confirmed: false }),
      )
    throw cause
  }
  printResult(
    args,
    {
      status: waiting ? "waiting" : "queued",
      receipt_confirmed: false,
      delivery_condition: waiting
        ? "peers_inbox"
        : threadIsPaused(thread.rollout_path)
          ? "paused_until_user_prompt"
          : "native_queue",
      target: "codex",
      thread_id: thread.id,
      thread_name: thread.name,
      message_id: msgId,
      ...(routed === null ? {} : { for_sub_agent: routed.child.id }),
    },
    (waiting
      ? `waiting in the peers inbox of ${thread.name ?? thread.id} (${thread.id}): ${WAITING_DETAIL}; message ${msgId}`
      : `queued to ${thread.name ?? thread.id} (${thread.id}), message ${msgId}`) +
      (routed === null ? "" : `, for its sub-agent ${threadLabel(routed.child)}`),
  )
  return 0
}
