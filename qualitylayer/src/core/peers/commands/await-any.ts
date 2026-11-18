import { existsSync } from "node:fs"
import {
  nowSeconds,
  parseTime,
  readJson,
  requestPath,
  requestReplyPath,
  writeJsonAtomic,
} from "../base.ts"
import { arrivedOrdinary } from "../inbox.ts"
import { type Args, asOption, flag, opt, out, printResult } from "./arguments.ts"
import { callerIdentity } from "./identity.ts"
import { addressedTo, openRequests, sentBy, takeReply, timelyReply } from "./mailbox.ts"
import { printReply } from "./request-format.ts"
import { cleanupExpiredRequests } from "./request-retention.ts"
import { boundedTimeout } from "./request-send.ts"
import { peerWatched, watchTarget } from "./request-watch.ts"

export const ANY_POLL_MS = 500

// Each recipient state is reported once; later waits can collect other events.
function ownRequestEvent(
  args: Args,
  mine: ReturnType<typeof openRequests>,
  targets: Map<string, ReturnType<typeof watchTarget>>,
): number | undefined {
  for (const { id, meta } of mine) {
    if (timelyReply(readJson(requestReplyPath(id), null), id, meta)) {
      const text = takeReply(id)
      if (text === null) continue
      printReply(args, id, meta, text)
      return 0
    }
    const target = targets.get(id) ?? watchTarget(meta)
    targets.set(id, target)
    const seen = target.watch()
    const noted = seen === null ? null : "gone" in seen ? "gone" : `stuck: ${seen.stuck}`
    if (seen === null || meta.noted === noted || !existsSync(requestPath(id))) continue
    writeJsonAtomic(requestPath(id), { ...meta, noted })
    return peerWatched(args, id, target, seen)
  }
  return undefined
}

export async function awaitAny(args: Args): Promise<number> {
  const me = callerIdentity({ positional: [], opts: asOption(args) })
  const deadline = Date.now() + boundedTimeout(opt(args, "timeout")) * 1000
  const started = nowSeconds()
  const targets = new Map<string, ReturnType<typeof watchTarget>>()
  cleanupExpiredRequests()
  for (;;) {
    const open = openRequests()
    const mine = open.filter(
      (r) => sentBy(r.meta, me) && Number(r.meta.expires_at ?? 0) > nowSeconds(),
    )
    const event = ownRequestEvent(args, mine, targets)
    if (event !== undefined) return event
    const requests = open
      .filter(
        (r) =>
          addressedTo(r.meta, me) &&
          (parseTime(r.meta.created_at) ?? 0) >= started &&
          !existsSync(requestReplyPath(r.id)),
      )
      .map((r) => r.id)
    const messages = arrivedOrdinary(me, started)
    if (requests.length + messages.length > 0) {
      printResult(
        args,
        { status: "message", requests, messages },
        `${requests.length} request(s) and ${messages.length} message(s) arrived for this session; read them with \`qualitylayer peers inbox\``,
      )
      return 0
    }
    if (Date.now() >= deadline) {
      const outstanding = mine.map((r) => r.id)
      if (flag(args, "json")) out(JSON.stringify({ status: "pending", outstanding }))
      else
        process.stderr.write(
          `nothing arrived yet; ${outstanding.length} request(s) of this session still open and awaitable\n`,
        )
      return 124
    }
    await Bun.sleep(ANY_POLL_MS)
  }
}
