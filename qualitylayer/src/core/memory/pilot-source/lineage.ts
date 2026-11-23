import type { PilotCandidate } from "../../../pilot-memory-contracts.ts"
import { hash } from "../identity.ts"
import { issue, type PilotSourceData } from "./types.ts"

function exclude(data: PilotSourceData, record: PilotCandidate, reason: string) {
  if (record.excluded) return
  record.excluded = reason
  data.counts.excluded++
  const group = data.groups.get(record.group)
  if (group) group.counts.excluded++
}

function groupByIdentity(records: PilotCandidate[]): Map<string, PilotCandidate[]> {
  const identities = new Map<string, PilotCandidate[]>()
  for (const record of records) {
    const key = `${String(record.metadata.originalProject ?? "")}\0${record.sourceId}`
    const known = identities.get(key) ?? []
    known.push(record)
    identities.set(key, known)
  }
  return identities
}

function reconcileFamily(data: PilotSourceData, family: PilotCandidate[]): void {
  const concepts = family.filter((record) => record.category === "knowledge")
  const revisions = new Set(
    concepts.map((record) => hash(JSON.stringify([record.title, record.content, record.state]))),
  )
  if (revisions.size > 1) {
    for (const record of family) {
      exclude(
        data,
        record,
        "Different live knowledge versions share this identity. Select one source and scan again.",
      )
    }
    issue(
      data,
      "Different private/project knowledge versions were preserved. Choose the intended source before importing those records.",
    )
    return
  }
  const authoritative = concepts[0] ?? family[0]
  if (!authoritative) return
  const duplicateReason = authoritative.excluded
    ? "The authoritative knowledge is retired or removed; its historical copy was not restored."
    : "Duplicate source identity; the authoritative knowledge is included once."
  for (const record of family) {
    if (record !== authoritative) exclude(data, record, duplicateReason)
  }
}

/** A verified UID is lineage; matching prose alone is not. */
export function reconcileLineage(data: PilotSourceData) {
  for (const family of groupByIdentity(data.records).values()) {
    if (family.length >= 2) reconcileFamily(data, family)
  }
}
