import { asRecord, isUuid, PeerError, type PeerKind } from "../base.ts"
import { claudeRecordBySocket, claudeRecordsByTarget } from "../claude.ts"
import { readRegistered } from "../codex.ts"
import { isNativeKind, nativeCaller, nativeRegistrations } from "../native.ts"
import { type Args, opt } from "./arguments.ts"
import { parseTyped, threadFromArgs } from "./identity.ts"

function named(ident: { kind: PeerKind; uuid: string }) {
  if (isNativeKind(ident.kind)) {
    const row = nativeRegistrations().find((r) => r.kind === ident.kind && r.uuid === ident.uuid)
    return { ...ident, name: row?.name ?? null }
  }
  if (ident.kind === "cc") {
    const matches = claudeRecordsByTarget(ident.uuid)
    return { ...ident, name: matches.length === 1 ? (matches[0]?.name ?? null) : null }
  }
  const entry = asRecord(readRegistered()[ident.uuid])
  return { ...ident, name: typeof entry?.name === "string" ? entry.name : null }
}

export function topicSender(
  args: Args,
): { kind: string; uuid: string; name: string | null } | null {
  const explicit = opt(args, "as")
  if (explicit !== undefined) return named(parseTyped(explicit))
  const native = nativeCaller()
  if (native) return named(native)
  const sock = process.env.CLAUDE_CODE_MESSAGING_SOCKET
  const rec = sock ? claudeRecordBySocket(sock) : null
  let claude: { kind: string; uuid: string; name: string | null } | null = null
  if (rec !== null && isUuid(rec.sessionId))
    claude = { kind: "cc", uuid: rec.sessionId as string, name: rec.name ?? null }
  else if (isUuid(process.env.CLAUDE_CODE_SESSION_ID))
    claude = named({ kind: "cc", uuid: process.env.CLAUDE_CODE_SESSION_ID as string })
  const tid = threadFromArgs(args)
  const codex = tid ? named({ kind: "codex", uuid: tid }) : null
  if (claude !== null && codex !== null) {
    throw new PeerError(
      `this environment names both Claude session ${claude.uuid} and Codex thread ${tid}; pass --as cc:${claude.uuid} or --as codex:${tid}`,
      2,
    )
  }
  return claude ?? codex
}
