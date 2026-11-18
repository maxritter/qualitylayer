import { randomUUID } from "node:crypto"
import { type PeerKind, warnVersions } from "../base.ts"
import { deliverHookPeer } from "../hook-peer.ts"
import { ordinaryDelivery, updateOrdinary } from "../inbox.ts"
import {
  deliverNative,
  isHookPeerKind,
  NATIVE_KINDS,
  type NativeRegistration,
  nativeCaller,
  nativeReplyBudget,
  peerEnvelope,
  resolveNative,
} from "../native.ts"
import { type Args, fail, messageFrom, opt, printResult } from "./arguments.ts"
import { expandBuddy } from "./buddy-context.ts"
import { sendClaude } from "./claude-delivery.ts"
import { sendCodex } from "./codex-delivery.ts"
import { callerIdentity } from "./identity.ts"
import { saveOrdinaryForCaller } from "./inbox.ts"

export async function cmdSend(args: Args): Promise<number> {
  warnVersions()
  let to = opt(args, "to")
  if (to === undefined)
    return fail(`--to is required: ${KIND_PREFIXES} followed by a name or UUID, or buddy`, 2)
  to = expandBuddy(to, args, "send")
  const message = messageFrom(args)
  const native = nativeCaller()
  if (native) nativeReplyBudget(native)
  for (const kind of NATIVE_KINDS) {
    if (!to.startsWith(`${kind}:`)) continue
    const row = resolveNative(kind, to.slice(kind.length + 1))
    const id = randomUUID()
    let sender: { kind: PeerKind; uuid: string } | null = null
    try {
      sender = callerIdentity({ positional: [], opts: {} })
    } catch {}
    saveOrdinaryForCaller(id, { kind, uuid: row.uuid }, message)
    let delivery: Delivery
    try {
      delivery = await deliverPeer(row, id, peerEnvelope(sender, id, message, ordinaryDelivery(id)))
      updateOrdinary(id, { delivery_status: "queued" })
    } catch (cause) {
      updateOrdinary(id, { delivery_status: "delivery_failed", detail: (cause as Error).message })
      throw cause
    }
    printResult(
      args,
      {
        status: "queued",
        receipt_confirmed: false,
        message_id: id,
        target: kind,
        session_id: row.uuid,
        delivery,
      },
      `${DELIVERY_TEXT[delivery]} ${kind}:${row.uuid}, message ${id}; receipt unconfirmed`,
    )
    return 0
  }
  if (to.startsWith("codex:")) return sendCodex(to.slice(6), message, args)
  if (to.startsWith("cc:")) return sendClaude(to.slice(3), message, args)
  return fail(`--to must start with ${KIND_PREFIXES}`, 2)
}

/** How a message reached a native session: its socket, its App session, or its next hook. */
export type Delivery = "socket" | "run" | "hook"
export const DELIVERY_TEXT: Record<Delivery, string> = {
  socket: "queued to",
  run: "typed into the App session of",
  hook: "queued for the next turn of",
}

// Hook delivery may wait until the next turn; a socket write delivers immediately.
export async function deliverPeer(
  row: NativeRegistration,
  id: string,
  text: string,
): Promise<Delivery> {
  if (!isHookPeerKind(row.kind)) {
    await deliverNative(row, id, text)
    return "socket"
  }
  return (await deliverHookPeer(row, id, text)) === "run" ? "run" : "hook"
}

export const WAIT_PREFIXES = NATIVE_KINDS.map((kind) => `${kind}:`).join(", ")
export const KIND_PREFIXES = `cc:, codex:, ${WAIT_PREFIXES}`
