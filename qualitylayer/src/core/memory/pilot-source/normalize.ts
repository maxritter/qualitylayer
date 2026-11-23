import type { PilotCandidate, PilotCategory } from "../../../pilot-memory-contracts.ts"
import { hash, safeText } from "../validation.ts"
import { learning, observation } from "./normalize-records.ts"
import { budget, emptyCounts, issue, type PilotSourceData } from "./types.ts"

export { learning, observation }

export const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
export const words = (value: unknown): string => (typeof value === "string" ? value : "")
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").slice(0, 32) : []

export function jsonStrings(value: unknown): string[] {
  if (typeof value !== "string") return strings(value)
  try {
    return strings(JSON.parse(value))
  } catch {
    return []
  }
}

export function group(
  data: PilotSourceData,
  project: string,
  root?: string,
  bundle?: string,
): string {
  if (project.length > 500 || (root?.length ?? 0) > 4096) {
    throw new Error("Pilot project identity exceeds its limit.")
  }
  const roots = root ? [root] : (data.roots.get(project) ?? [])
  const id = hash(JSON.stringify([project, roots, roots.length ? "" : (bundle ?? "")]))
  if (!data.groups.has(id)) {
    data.groups.set(id, { id, name: project || "Private knowledge", roots, counts: emptyCounts() })
  }
  return id
}

export function invalid(data: PilotSourceData, message: string, groupId?: string) {
  data.counts.invalid++
  const target = groupId ? data.groups.get(groupId) : null
  if (target) target.counts.invalid++
  issue(data, message)
}

function validateCandidateSize(record: PilotCandidate): number {
  if (
    !record.title.trim() ||
    record.title.length > 200 ||
    !record.content.trim() ||
    record.content.length > 24_000
  ) {
    throw new Error("Memory title or body exceeds the supported lesson size.")
  }
  const serialized = JSON.stringify(record)
  const size = Buffer.byteLength(serialized)
  if (size > 32 * 1024) throw new Error("Memory exceeds 32 KiB.")
  if (
    record.sourceId.length > 512 ||
    record.aliases.some((alias) => alias.length > 512) ||
    (record.author?.length ?? 0) > 200
  ) {
    throw new Error("Memory source identity or author exceeds its limit.")
  }
  safeText(serialized)
  if (
    record.sourceAt &&
    (!Number.isFinite(Date.parse(record.sourceAt)) ||
      Date.parse(record.sourceAt) > Date.now() + 60_000)
  ) {
    throw new Error("Memory has an invalid or future date.")
  }
  return size
}

export function add(data: PilotSourceData, record: PilotCandidate) {
  budget(data)
  try {
    const size = validateCandidateSize(record)
    data.normalizedBytes += size
    budget(data)
    data.records.push(record)
    data.counts[record.category]++
    const target = data.groups.get(record.group)
    if (target) target.counts[record.category]++
    if (record.excluded) {
      data.counts.excluded++
      if (target) target.counts.excluded++
    }
  } catch (error) {
    invalid(data, error instanceof Error ? error.message : "Invalid Pilot memory.", record.group)
  }
}

export function excludedCount(data: PilotSourceData, count: number, _category?: PilotCategory) {
  data.counts.excluded += count
}
