import type { Ctx } from "../../ctx.ts"
import type { MemoryRecord } from "../../memory-contracts.ts"
import { portableDigest } from "./portable.ts"
import { repositoryFrontier } from "./repository-history.ts"
import { decodeMemoryFile } from "./repository-io.ts"
import type { MemoryRepositorySnapshot } from "./repository-snapshot.ts"
import {
  MEMORY_EXCHANGE_FILES_MAX,
  segment,
  validateRecord,
  validateRepositoryRecord,
} from "./validation.ts"

export const MEMORY_DIRECTORY = "docs/memories"
/** Where earlier versions exported lessons; moved to MEMORY_DIRECTORY on the next export. */
export const LEGACY_MEMORY_DIRECTORY = ".qualitylayer/memories"

async function readTracked(
  ctx: Ctx,
  snapshot: MemoryRepositorySnapshot,
  oid: string,
  path: string,
) {
  const bytes = await snapshot.record(oid, path)
  const record = validateRecord(JSON.parse(decodeMemoryFile(bytes)))
  validateRepositoryRecord(record, ctx.clock.now())
  return record
}

/** Only tracked regular files supply restore candidates. A worktree edit is never silently accepted. */
export async function repositoryRecords(
  ctx: Ctx,
  snapshot: MemoryRepositorySnapshot,
  issue: (message: string) => void,
) {
  // Both locations remain valid while the person reviews and commits a move.
  const entries = await snapshot.listing()
  if (entries.length > MEMORY_EXCHANGE_FILES_MAX)
    throw new Error("Tracked memory files exceed the 5000-file restore limit")
  const found: { path: string; record: MemoryRecord; oid: string }[] = []
  const seenVersions = new Set<string>()
  let skipped = 0
  for (const line of entries) {
    if (
      /^100644 [a-f0-9]{40,64} 0\t(?:(?:docs\/memories|\.qualitylayer\/memories)\/[^/]+\/LESSONS\.md|docs\/memories\/[^/]+\/history\/readable\/[a-f0-9-]+\.md)$/.test(
        line,
      )
    )
      continue
    try {
      const { oid, path, origin, id } = trackedAddress(line)
      const record = await readTracked(ctx, snapshot, oid, path)
      if (record.origin !== origin || record.id !== id || record.visibility !== "project")
        throw new Error("Invalid repository record identity or provenance")
      const fingerprint = portableDigest(record)
      if (seenVersions.has(fingerprint)) continue
      seenVersions.add(fingerprint)
      found.push({ path, record, oid })
    } catch (cause) {
      skipped++
      issue(cause instanceof Error ? cause.message : "Malformed repository memory")
    }
  }
  snapshot.assertCurrent()
  return { found: repositoryFrontier(found), skipped }
}

function trackedAddress(line: string) {
  const match = /^100644 ([a-f0-9]{40,64}) 0\t(.+)$/.exec(line)
  const address =
    match &&
    /^(?:docs\/memories|\.qualitylayer\/memories)\/([^/]+)\/([^/]+)\.json$/.exec(match[2] as string)
  const history =
    match &&
    /^docs\/memories\/([^/]+)\/history\/([^/]+)\/[a-f0-9]{64}(?:-[a-f0-9-]{36})?\.json$/.exec(
      match[2] as string,
    )
  const identity = address || history
  if (!match || !identity || !segment(identity[1]) || !segment(identity[2]))
    throw new Error("Skipped an unsafe or conflicted tracked memory path")
  return { oid: match[1] as string, path: match[2] as string, origin: identity[1], id: identity[2] }
}
