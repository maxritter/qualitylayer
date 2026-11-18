import { parseTime } from "../base.ts"
import { recipientState, recipientWatch, type Watched, watchedDetail } from "../recipient.ts"
import { type Args, fail, flag, out } from "./arguments.ts"

export const PEER_GONE_EXIT = 4
export const PEER_STUCK_EXIT = 5

export function peerWatched(
  args: Args,
  id: string,
  target: { kind: string; id: string; name: string | null },
  seen: NonNullable<Watched>,
): number {
  const { kind, id: sessionId, name: sessionName } = target
  const detail = watchedDetail(id, `${sessionName ?? sessionId} (${kind}:${sessionId})`, seen)
  const gone = "gone" in seen
  if (flag(args, "json"))
    out(
      JSON.stringify({
        status: gone ? "peer_gone" : "peer_stuck",
        request_id: id,
        target_kind: kind,
        session_id: sessionId,
        session_name: sessionName,
        ...(gone ? {} : { reason: seen.stuck }),
        detail,
      }),
    )
  return fail(detail, gone ? PEER_GONE_EXIT : PEER_STUCK_EXIT)
}

/** The request's recipient as its record names it, and a watch on it from the request's start. */
export function watchTarget(meta: Record<string, unknown>) {
  const kind = typeof meta.target_kind === "string" ? meta.target_kind : "cc"
  const id = typeof meta.target_session_id === "string" ? meta.target_session_id : null
  const name = typeof meta.target_session_name === "string" ? meta.target_session_name : null
  const since = parseTime(meta.created_at) ?? 0
  const watch = recipientWatch(() =>
    id === null ? { presence: "unknown" } : recipientState(kind, id, since),
  )
  return { kind, id: id ?? "", name, watch }
}
