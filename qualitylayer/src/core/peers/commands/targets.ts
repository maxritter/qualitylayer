import { BUDDY_KINDS, isUuid, type PeerKind } from "../base.ts"
import {
  ResolveAmbiguousKind,
  ResolveError,
  ResolveNoLive,
  ResolveNotFound,
  resolveThread,
  resolveThreadPreferLive,
} from "../codex.ts"
import { isNativeKind, resolveNative } from "../native.ts"
import type { Buddy } from "./buddy-context.ts"
import { resolveClaudeRecord } from "./claude-targets.ts"

import type {} from "./identity.ts"
export function resolveTypedKind(kind: PeerKind, target: string, liveOnly = false): Buddy {
  if (isNativeKind(kind)) {
    const row = resolveNative(kind, target)
    return { kind, uuid: row.uuid, name: row.name }
  }
  if (kind === "cc") {
    const rec = resolveClaudeRecord(target)
    if (!isUuid(rec.sessionId))
      throw new ResolveError(`Claude session ${JSON.stringify(target)} has no UUID session id`)
    return { kind: "cc", uuid: rec.sessionId as string, name: rec.name ?? null }
  }
  const thread = liveOnly ? resolveThread(target, true) : resolveThreadPreferLive(target)
  return { kind: "codex", uuid: thread.id, name: thread.name }
}

export function resolveTyped(raw: string): Buddy {
  let target = raw.startsWith("@") ? raw.slice(1) : raw
  for (const kind of BUDDY_KINDS) {
    if (target.startsWith(`${kind}:`)) return resolveTypedKind(kind, target.slice(kind.length + 1))
  }
  if (target === "") throw new ResolveError("an empty target names no session")
  const found: Buddy[] = []
  const errors: Error[] = []
  let deadCodex = false
  for (const kind of BUDDY_KINDS) {
    try {
      found.push(resolveTypedKind(kind, target, true))
    } catch (cause) {
      if (cause instanceof ResolveNoLive) deadCodex = true
      else if (!(cause instanceof ResolveNotFound)) errors.push(cause as Error)
    }
  }
  if (deadCodex && found.length === 0 && errors.length === 0)
    return resolveTypedKind("codex", target)
  if (errors.length > 0) {
    throw new ResolveAmbiguousKind(
      `${errors[0]?.message}; pick the kind`,
      BUDDY_KINDS.map((k) => `${k}:${target}`),
    )
  }
  if (found.length > 1) {
    const choices = found.map((b) => `${b.kind}:${b.uuid}`)
    throw new ResolveAmbiguousKind(
      `${JSON.stringify(target)} matches both ${choices.join(" and ")}; pick one`,
      choices,
    )
  }
  const only = found[0]
  if (only === undefined) {
    target = JSON.stringify(target)
    throw new ResolveError(
      `no Claude session or Codex thread named ${target}; run \`qualitylayer peers list\``,
    )
  }
  return only
}
