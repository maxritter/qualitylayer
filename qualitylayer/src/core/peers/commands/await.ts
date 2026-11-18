import { existsSync } from "node:fs"
import {
  asRecord,
  nowSeconds,
  REQUEST_POLL_MS,
  readJson,
  requestPath,
  requestReplyPath,
} from "../base.ts"
import { type Args, asOption, fail, flag, opt, out } from "./arguments.ts"
import { awaitAny } from "./await-any.ts"
import { callerIdentity, threadFromArgs } from "./identity.ts"
import { takeReply, timelyReply } from "./mailbox.ts"
import { printExpiredRequest, printReply } from "./request-format.ts"
import { cleanupExpiredRequests } from "./request-retention.ts"
import { boundedTimeout } from "./request-send.ts"
import { peerWatched, watchTarget } from "./request-watch.ts"

type AwaitRequest = {
  args: Args
  id: string
  meta: Record<string, unknown>
  metaPath: string
  replyPath: string
  timeout: number
  expired(detail: string): number
}

function collectReply({
  args,
  id,
  meta,
  metaPath,
  replyPath,
  expired,
}: AwaitRequest): number | null {
  if (!existsSync(metaPath)) return expired("unknown, already consumed, or expired")
  if (!timelyReply(readJson(replyPath, null), id, meta)) return null
  const text = takeReply(id)
  if (text === null) return expired("already consumed")
  printReply(args, id, meta, text)
  return 0
}

async function awaitRequest(request: AwaitRequest): Promise<number> {
  const { args, id, meta, replyPath, timeout, expired } = request
  const expiresAt = Number(meta.expires_at ?? 0)
  const deadline = Date.now() + timeout * 1000
  const target = watchTarget(meta)
  for (;;) {
    const collected = collectReply(request)
    if (collected !== null) return collected
    if (expiresAt <= nowSeconds()) {
      cleanupExpiredRequests()
      return expired("expired before a reply arrived")
    }
    if (Date.now() >= deadline) break
    const seen = target.watch()
    if (seen !== null && !timelyReply(readJson(replyPath, null), id, meta))
      return peerWatched(args, id, target, seen)
    await Bun.sleep(REQUEST_POLL_MS)
  }
  if (expiresAt <= nowSeconds()) {
    cleanupExpiredRequests()
    return expired("expired before a reply arrived")
  }
  if (flag(args, "json"))
    out(JSON.stringify({ status: "pending", request_id: id, expires_at: meta.expires_at }))
  else process.stderr.write(`request ${id} has no reply yet; still pending and re-awaitable\n`)
  return 124
}

export async function cmdAwait(args: Args): Promise<number> {
  if (flag(args, "any")) return awaitAny(args)
  const id = opt(args, "request")
  if (id === undefined) return fail("--request <uuid> or --any is required", 2)
  const metaPath = requestPath(id)
  const replyPath = requestReplyPath(id)
  const timeout = boundedTimeout(opt(args, "timeout"))
  const requester = opt(args, "from-thread")
    ? { kind: "codex" as const, uuid: threadFromArgs(args, true) as string }
    : callerIdentity({ positional: [], opts: asOption(args) })
  const expired = (detail: string) => printExpiredRequest(args, id, detail)
  cleanupExpiredRequests()
  const meta = asRecord(readJson(metaPath, null))
  if (meta === null) return expired("unknown, already consumed, or expired")
  const ownerKind = meta.requester_kind ?? "codex"
  const ownerId = meta.requester_session_id ?? meta.requester_thread_id
  if (requester.kind !== ownerKind || requester.uuid !== ownerId) {
    return fail(
      `request ${id} was dispatched by ${ownerKind}:${ownerId}, not ${requester.kind}:${requester.uuid}`,
    )
  }
  return awaitRequest({ args, id, meta, metaPath, replyPath, timeout, expired })
}
