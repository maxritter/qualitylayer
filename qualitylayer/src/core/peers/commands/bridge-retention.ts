import { join } from "node:path"
import {
  GC_DAYS_DEFAULT,
  nowSeconds,
  PeerError,
  stateDir,
  THREAD_ARTIFACT_SUFFIXES,
  unlinkQuiet,
} from "../base.ts"
import { readRegistered, writeRegistered } from "../codex.ts"
import { shimPid } from "../shim.ts"
import { out } from "./arguments.ts"
import { underReconcileLock } from "./bridge-lock.ts"
import { bridgeThreadIds, lastSeen, scanBridgeThreads } from "./bridge-metadata.ts"

function pruneCandidates(candidates: string[], cutoff: number): string[] {
  // Recheck under the lock: a session that resumed meanwhile wins over GC.
  const again = scanBridgeThreads()
  if (again === null) return []
  const registrations = readRegistered()
  const gone: string[] = []
  for (const id of candidates) {
    if (again[1].has(id) || shimPid(id) !== null) continue
    const seen = lastSeen(id, registrations, again[0])
    if (seen === null || seen > cutoff) continue
    for (const suffix of THREAD_ARTIFACT_SUFFIXES) unlinkQuiet(join(stateDir(), id + suffix))
    delete registrations[id]
    gone.push(id)
  }
  writeRegistered(registrations)
  return gone
}

function staleCandidate(
  id: string,
  first: NonNullable<ReturnType<typeof scanBridgeThreads>>,
  cutoff: number,
): boolean {
  if (first[1].has(id) || shimPid(id) !== null) return false
  const seen = lastSeen(id, readRegistered(), first[0])
  return seen !== null && seen <= cutoff
}

export async function gcBridgeState(
  days = GC_DAYS_DEFAULT,
  dryRun = false,
  verbose = true,
): Promise<string[]> {
  if (days < 0) throw new PeerError("retention days must be zero or greater", 2)
  const first = scanBridgeThreads()
  if (first === null) {
    if (verbose) out("GC skipped: Codex discovery or liveness is unavailable")
    return []
  }
  const cutoff = nowSeconds() - days * 86_400
  const candidates = [...bridgeThreadIds()].sort().filter((id) => staleCandidate(id, first, cutoff))
  if (dryRun) {
    if (verbose) for (const id of candidates) out(`would prune ${id}`)
    return candidates
  }
  if (candidates.length === 0) return []
  const removed = await underReconcileLock(async () => pruneCandidates(candidates, cutoff))
  if (verbose) for (const id of removed) out(`pruned ${id}`)
  return removed
}
