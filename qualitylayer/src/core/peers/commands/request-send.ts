import { randomUUID } from "node:crypto"
import {
  BUDDY_KINDS,
  nowIso,
  nowSeconds,
  PeerError,
  type PeerKind,
  REQUEST_TIMEOUT_DEFAULT,
  REQUEST_TIMEOUT_MAX,
  requestPath,
  requestReplyPath,
  writeJsonAtomic,
} from "../base.ts"
import type { ClaudeRecord } from "../claude.ts"
import { buildTag, codexQueueOrWait, routeSubAgent } from "../codex.ts"
import {
  isNativeKind,
  nativeCaller,
  nativeReplyBudget,
  peerEnvelope,
  resolveNative,
} from "../native.ts"
import { type Args, messageFrom, opt } from "./arguments.ts"
import { expandBuddy } from "./buddy-context.ts"
import { deliverClaude } from "./claude-delivery.ts"
import { resolveClaudeRecord } from "./claude-targets.ts"
import { liveCodexTarget } from "./codex-delivery.ts"
import { deliverPeer, KIND_PREFIXES } from "./delivery.ts"
import { callerIdentity, threadFromArgs } from "./identity.ts"
import { requestEnvelope } from "./request-format.ts"
import { cleanupExpiredRequests } from "./request-retention.ts"

export function boundedTimeout(value: string | undefined): number {
  const timeout = value === undefined ? REQUEST_TIMEOUT_DEFAULT : Number(value)
  if (!(timeout > 0) || timeout > REQUEST_TIMEOUT_MAX) {
    throw new PeerError(
      `timeout must be greater than 0 and at most ${REQUEST_TIMEOUT_MAX} seconds`,
      2,
    )
  }
  return timeout
}

export async function openRequest(args: Args, purpose: "ask" | "dispatch") {
  let to = opt(args, "to")
  if (to === undefined)
    throw new PeerError(
      `--to is required: ${KIND_PREFIXES} followed by a name or UUID, or buddy`,
      2,
    )
  to = expandBuddy(to, args, purpose)
  if (!BUDDY_KINDS.some((kind) => to?.startsWith(`${kind}:`)))
    throw new PeerError(`${purpose} --to must start with ${KIND_PREFIXES}`, 2)
  if (to.startsWith("codex:")) {
    const routed = routeSubAgent(to.slice(6))
    if (routed)
      throw new PeerError(
        `This spawned peer receives through coordinator ${routed.coordinator.id}. For a correlated request, address codex:${routed.coordinator.id} explicitly; reply authority is not transferred automatically.`,
      )
  }
  const message = messageFrom(args)
  const timeout = boundedTimeout(opt(args, "timeout"))
  const requester = opt(args, "from-thread")
    ? { kind: "codex" as const, uuid: threadFromArgs(args, true) as string }
    : callerIdentity({ positional: [], opts: {} })
  const threadId = requester.kind === "codex" ? requester.uuid : null
  const native = nativeCaller()
  if (native) nativeReplyBudget(native)
  const targetKind = to.slice(0, to.indexOf(":")) as PeerKind
  const nativeTarget = isNativeKind(targetKind)
    ? resolveNative(targetKind, to.slice(targetKind.length + 1))
    : null
  const thread = targetKind === "codex" ? liveCodexTarget(to.slice(6)) : null
  const rec = targetKind === "cc" ? resolveClaudeRecord(to.slice(3)) : null
  const sessionId = nativeTarget?.uuid ?? thread?.id ?? rec?.sessionId
  const sessionName = nativeTarget?.name ?? thread?.name ?? rec?.name ?? null
  if (!sessionId) {
    throw new PeerError(
      `target ${JSON.stringify(sessionName ?? to)} has no session id, so its reply cannot be verified`,
    )
  }
  cleanupExpiredRequests()
  const id = randomUUID()
  const expiresAt = nowSeconds() + timeout
  const meta = {
    request_id: id,
    requester_thread_id: threadId,
    requester_kind: requester.kind,
    requester_session_id: requester.uuid,
    target_kind: targetKind,
    target_session_id: sessionId,
    target_session_name: sessionName,
    message,
    created_at: nowIso(),
    expires_at: expiresAt,
    reply_path: requestReplyPath(id),
  }
  writeJsonAtomic(requestPath(id), meta)
  return {
    to,
    message,
    timeout,
    threadId,
    rec,
    thread,
    nativeTarget,
    targetKind,
    sessionId,
    sessionName,
    id,
    expiresAt,
    meta,
  }
}

export async function deliverRequest(r: Awaited<ReturnType<typeof openRequest>>): Promise<string> {
  const envelope = requestEnvelope(r.id, r.message, r.timeout, r.expiresAt)
  if (r.nativeTarget) {
    const id = randomUUID()
    await deliverPeer(
      r.nativeTarget,
      id,
      peerEnvelope(
        { kind: r.meta.requester_kind, uuid: r.meta.requester_session_id },
        id,
        envelope,
      ),
    )
    return id
  }
  if (r.thread !== null) {
    const messageId = randomUUID()
    const sender = r.meta.requester_session_id
    // A full queue leaves the request in the thread's `peers inbox`, where it is already saved.
    codexQueueOrWait(
      r.thread.id,
      `${buildTag(null, sender, null, messageId)}\n${envelope}`,
      r.thread.cwd,
    )
    return messageId
  }
  return (await deliverClaude(r.rec as ClaudeRecord, envelope, r.threadId, false))[0]
}
