import { readdirSync } from "node:fs"
import { join } from "node:path"
import {
  asRecord,
  fileMtime,
  isUuid,
  parseTime,
  readJson,
  stateDir,
  THREAD_ARTIFACT_SUFFIXES,
  threadStatePath,
} from "../base.ts"
import { codexThreads, readRegistered, type Thread } from "../codex.ts"

export function bridgeThreadIds(): Set<string> {
  const ids = new Set(Object.keys(readRegistered()).filter(isUuid))
  let names: string[] = []
  try {
    names = readdirSync(stateDir())
  } catch {
    return ids
  }
  for (const name of names) {
    const suffix = THREAD_ARTIFACT_SUFFIXES.find((s) => name.endsWith(s))
    if (suffix !== undefined && isUuid(name.slice(0, -suffix.length)))
      ids.add(name.slice(0, -suffix.length))
  }
  return ids
}

export function lastSeen(
  id: string,
  registered: Record<string, unknown>,
  threads: Map<string, Thread>,
): number | null {
  const seen: number[] = []
  const meta = asRecord(registered[id])
  for (const key of ["last_seen_at", "registered_at"]) {
    const t = parseTime(meta?.[key])
    if (t !== null) seen.push(t)
  }
  const t1 = parseTime(asRecord(readJson(threadStatePath(id), {}))?.updated_at)
  if (t1 !== null) seen.push(t1)
  const t2 = parseTime(threads.get(id)?.updated_at)
  if (t2 !== null) seen.push(t2)
  for (const suffix of THREAD_ARTIFACT_SUFFIXES) {
    const m = fileMtime(join(stateDir(), id + suffix))
    if (m !== null) seen.push(m)
  }
  return seen.length > 0 ? Math.max(...seen) : null
}

export function scanBridgeThreads(): [Map<string, Thread>, Set<string>] | null {
  const [threads, ok] = codexThreads()
  if (!ok || threads.some((t) => t.live === null)) return null
  return [
    new Map(threads.map((t) => [t.id, t])),
    new Set(threads.filter((t) => t.live).map((t) => t.id)),
  ]
}
