import { classifyClaudeRecords, readClaudeRecords } from "../claude.ts"
import { codexThreads, liveCoordinator, type Thread } from "../codex.ts"
import { nativeRegistrations } from "../native.ts"

export function liveSessions(): (who: string) => boolean {
  return sessionsView().live
}

// An unloaded native sub-agent counts as live while its receiving coordinator is live.
export function sessionsView(): {
  live: (who: string) => boolean
  via: (who: string) => Thread | null
  threads: Thread[]
} {
  const live = new Set<string>()
  for (const row of nativeRegistrations()) live.add(`${row.kind}:${row.uuid}`)
  const via = new Map<string, Thread>()
  for (const [record, state] of classifyClaudeRecords(readClaudeRecords()))
    if (state !== "dead" && typeof record.sessionId === "string") live.add(`cc:${record.sessionId}`)
  const [threads] = codexThreads()
  for (const thread of threads) {
    if (thread.live !== false) live.add(`codex:${thread.id}`)
    {
      const coordinator = liveCoordinator(thread, threads)
      if (coordinator !== null) {
        live.add(`codex:${thread.id}`)
        if (
          thread.live === false ||
          (thread.holder_pid !== null && thread.holder_pid === coordinator.holder_pid)
        )
          via.set(`codex:${thread.id}`, coordinator)
      }
    }
  }
  return { live: (who) => live.has(who), via: (who) => via.get(who) ?? null, threads }
}

import { PeerError } from "../base.ts"
import { boardTopic, checkoutOf, type Held, holders } from "../claims.ts"
import { printable, TOPIC_TAIL_MAX, topicTail } from "../topics.ts"
import { type Args, opt } from "./arguments.ts"
import { topicSender } from "./topic-identity.ts"

export function claimant(args: Args): { kind: string; uuid: string; name: string | null } {
  const me = topicSender(args)
  if (me === null)
    throw new PeerError(
      "this needs the session's identity: run it from a Claude Code session or a Codex thread, or pass --as cc:<uuid>|codex:<uuid>",
      2,
    )
  return me
}

export const whoOf = (me: { kind: string; uuid: string }) => `${me.kind}:${me.uuid}`

export function boardOf(args: Args, live = liveSessions()) {
  const repo = checkoutOf(opt(args, "repo") ?? process.cwd())
  const entries = topicTail(boardTopic(repo), 0, TOPIC_TAIL_MAX).entries
  return { repo, board: holders(entries, live) }
}

export const heldLine = (held: Held) =>
  `${held.path}  since ${held.since}${held.note === null ? "" : `  (${printable(held.note)})`}`
