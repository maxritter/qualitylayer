import { join } from "node:path"
import {
  asRecord,
  BUDDY_KINDS,
  buddiesDir,
  isUuid,
  PeerError,
  type PeerKind,
  readJson,
} from "../base.ts"

import type { Args } from "./arguments.ts"

import { callerIdentity } from "./identity.ts"
export function buddyPath(owner: { kind: string; uuid: string }): string {
  return join(buddiesDir(), `${owner.kind}-${owner.uuid}.json`)
}

export type Buddy = { kind: PeerKind; uuid: string; name?: string | null }
export type BuddyRecord = {
  owner: { kind: PeerKind; uuid: string }
  buddy: Buddy
  uses: string[]
  set_at: string
}

export function readBuddy(owner: { kind: PeerKind; uuid: string }): BuddyRecord | null {
  const rec = asRecord(readJson(buddyPath(owner), null))
  const buddy = asRecord(rec?.buddy)
  if (
    rec === null ||
    buddy === null ||
    !(BUDDY_KINDS as readonly string[]).includes(String(buddy.kind)) ||
    !isUuid(buddy.uuid)
  )
    return null
  return rec as unknown as BuddyRecord
}

/** `buddy` or `@buddy` into the caller's bound `cc:` / `codex:` UUID. */
export function expandBuddy(value: string, args: Args, purpose: string): string {
  if (value.startsWith("claude:")) return `cc:${value.slice("claude:".length)}`
  if (value !== "buddy" && value !== "@buddy") return value
  const owner = callerIdentity(args)
  const rec = readBuddy(owner)
  if (rec === null)
    throw new PeerError(
      `no buddy set for ${owner.kind}:${owner.uuid}; run \`qualitylayer peers buddy set <name|uuid>\``,
    )
  const buddy = rec.buddy
  if (purpose === "wait" && buddy.kind === "codex") {
    throw new PeerError("wait needs a Claude Code, Pi or OpenCode buddy", 2)
  }
  if (purpose === "budget" && buddy.kind !== "codex") {
    throw new PeerError(
      "the reply budget belongs to a Codex thread's stand-in; this buddy is a Claude session",
      2,
    )
  }
  return `${buddy.kind}:${buddy.uuid}`
}
