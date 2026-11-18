import { selfCommand } from "../../self.ts"
import { neutraliseRequestMarkup } from "../claude.ts"
import { type Args, fail, flag, out } from "./arguments.ts"

export function localTime(seconds: number): string {
  const at = new Date(seconds * 1000)
  const offset = -at.getTimezoneOffset()
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0")
  const local = new Date(at.getTime() + offset * 60_000).toISOString().slice(0, 19)
  return `${local}${offset >= 0 ? "+" : "-"}${pad(offset / 60)}:${pad(offset % 60)}`
}

// Native queues may drain after the sender stops waiting; the envelope carries the absolute expiry.
export function requestEnvelope(
  id: string,
  message: string,
  timeout: number,
  expiresAt: number,
): string {
  const self = selfCommand(["peers"])
    .map((p) => (/^[\w./-]+$/.test(p) ? p : `'${p.replaceAll("'", "'\\''")}'`))
    .join(" ")
  const closes = new Date(expiresAt * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
  return (
    `<session-peers-request id="${id}" timeout-seconds="${Math.floor(timeout)}" expires-at="${closes}">\n${neutraliseRequestMarkup(message)}\n</session-peers-request>\n\n` +
    `Expires: ${localTime(expiresAt)} (${closes}). If that time has passed when you read this, the request is void: do not act on it and do not reply; the requester has already stopped waiting.\n` +
    "Reply contract: return the result to the request mailbox. Pipe the complete reply into this command (or pass a private file's absolute path instead of -):\n" +
    `${self} reply --request ${id} --message-file -\n` +
    "Do not use SendMessage or `send --to codex:` for this request. The mailbox is single-use and expires with the timeout."
  )
}

export function printReply(
  args: Args,
  id: string,
  meta: Record<string, unknown>,
  text: string,
): void {
  if (flag(args, "json")) {
    out(
      JSON.stringify({
        status: "replied",
        target_kind: meta.target_kind ?? "cc",
        request_id: id,
        session_id: meta.target_session_id,
        session_name: meta.target_session_name ?? null,
        message: text,
      }),
    )
  } else process.stdout.write(text.endsWith("\n") ? text : `${text}\n`)
}

export function printExpiredRequest(args: Args, id: string, detail: string): number {
  if (flag(args, "json")) out(JSON.stringify({ status: "expired", request_id: id, detail }))
  return fail(`request ${id} is ${detail}`)
}
