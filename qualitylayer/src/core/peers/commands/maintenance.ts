import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  buddiesDir,
  claudeSessionsDir,
  envNumber,
  fileMtime,
  GC_DAYS_DEFAULT,
  isUuid,
  nowSeconds,
  unlinkQuiet,
} from "../base.ts"
import { readClaudeRecords, recordLiveness } from "../claude.ts"
import { resolveThread } from "../codex.ts"
import { isNativeKind, nativeRegistrations } from "../native.ts"
import { taskStatusDir } from "../task-status.ts"
import { topicPruneAll } from "../topics.ts"
import { type Args, flag, opt, out } from "./arguments.ts"
import { gcBridgeState } from "./bridge-retention.ts"
import { cleanupExpiredRequests } from "./request-retention.ts"

export function ownerVerifiedGone(owner: { kind: string; uuid: string }): boolean {
  if (isNativeKind(owner.kind))
    return !nativeRegistrations().some((r) => r.kind === owner.kind && r.uuid === owner.uuid)
  if (owner.kind === "cc") {
    if (!existsSync(claudeSessionsDir())) return true
    return readClaudeRecords()
      .filter((r) => r.sessionId === owner.uuid)
      .every((r) => recordLiveness(r) === "dead")
  }
  try {
    return resolveThread(owner.uuid, false).live === false
  } catch {
    return false
  }
}

/** Prune a folder's `<cc|codex>-<uuid>.json` records of sessions gone for `days`. */
export function gcSessionRecords(
  dir: string,
  what: string,
  days: number,
  dryRun: boolean,
): string[] {
  const cutoff = nowSeconds() - days * 86_400
  const removed: string[] = []
  let names: string[] = []
  try {
    names = readdirSync(dir).sort()
  } catch {
    return removed
  }
  for (const name of names) {
    const match = /^(cc|codex|pi|opencode)-(.+)\.json$/.exec(name)
    if (match === null || !isUuid(match[2])) continue
    const path = join(dir, name)
    const mtime = fileMtime(path)
    if (mtime === null || mtime > cutoff) continue
    if (!ownerVerifiedGone({ kind: match[1] as string, uuid: match[2] as string })) continue
    if (!dryRun) unlinkQuiet(path)
    removed.push(name)
    out(`${dryRun ? "would prune" : "pruned"} ${what} ${name}`)
  }
  return removed
}

export async function cmdGc(args: Args): Promise<number> {
  const daysOpt = opt(args, "days")
  const days =
    daysOpt !== undefined
      ? Number(daysOpt)
      : envNumber("QUALITYLAYER_PEERS_GC_DAYS", GC_DAYS_DEFAULT)
  const dryRun = flag(args, "dry-run")
  const removed = await gcBridgeState(days, dryRun)
  const buddies = gcSessionRecords(buddiesDir(), "buddy record", days, dryRun)
  const tasks = gcSessionRecords(taskStatusDir(), "task status", days, dryRun)
  const requests = cleanupExpiredRequests(nowSeconds(), dryRun)
  if (!dryRun) topicPruneAll()
  for (const id of requests) out(`${dryRun ? "would prune" : "pruned"} expired request ${id}`)
  if (removed.length === 0 && requests.length === 0 && buddies.length === 0 && tasks.length === 0)
    out("no stale bridge metadata")
  return 0
}
