import { relativeFile, safeText } from "../core/memory/validation.ts"
import type { MemoryKind } from "../memory-contracts.ts"
import { parsePilotMarkdown, pilotKind, pilotStrings } from "./pilot-markdown.ts"

export type PilotLesson = {
  sourceId: string
  title: string
  content: string
  kind: MemoryKind
  tags: string[]
  files: string[]
  author?: string
  sourceAt?: string
  metadata: unknown
}

const UID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/

function isValidJsonlHeader(
  record: Record<string, unknown>,
  projectNames: string[],
  now: number,
): boolean {
  const validIdentity =
    record.schemaVersion === 1 &&
    typeof record.uid === "string" &&
    UID_PATTERN.test(record.uid) &&
    projectNames.includes(record.project as string)
  const validFields =
    typeof record.type === "string" &&
    typeof record.author === "string" &&
    typeof record.createdAt === "string"
  if (!validIdentity || !validFields) return false
  const created = Date.parse(record.createdAt as string)
  return Number.isFinite(created) && created <= now + 60_000
}

function isRetiredOrStaleJsonl(record: Record<string, unknown>, now: number): boolean {
  if (record.status === "deprecated" || record.state === "retired") return true
  return Boolean(record.stale_after) && Date.parse(String(record.stale_after)) <= now
}

function parsePilotJsonlLine(line: string, projectNames: string[], now: number): PilotLesson {
  if (Buffer.byteLength(line) > 32 * 1024) throw new Error("Record exceeds 32 KiB")
  const r = JSON.parse(line) as Record<string, unknown>
  if (!isValidJsonlHeader(r, projectNames, now))
    throw new Error("Malformed, foreign or future Pilot record")
  if (isRetiredOrStaleJsonl(r, now)) throw new Error("Retired or stale Pilot record")
  safeText(line)
  const content = [r.subtitle, ...(Array.isArray(r.facts) ? r.facts : []), r.narrative]
    .filter((x) => typeof x === "string" && x.trim())
    .join("\n\n")
  const title = typeof r.title === "string" && r.title.trim() ? r.title : "Imported Pilot lesson"
  return {
    sourceId: r.uid as string,
    title,
    content,
    kind: pilotKind(r.type as string),
    tags: pilotStrings(r.concepts),
    files: [...pilotStrings(r.filesRead), ...pilotStrings(r.filesModified)]
      .filter(relativeFile)
      .slice(0, 32),
    author: r.author as string,
    sourceAt: r.createdAt as string,
    metadata: r,
  }
}

function parsePilotJsonlFile(
  text: string,
  projectNames: string[],
  now: number,
  reject: (reason: string) => void,
): PilotLesson[] {
  const records: PilotLesson[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      records.push(parsePilotJsonlLine(line, projectNames, now))
    } catch (cause) {
      reject(cause instanceof Error ? cause.message : "Malformed Pilot record")
    }
    if (records.length >= 5_000) {
      reject("Import record limit reached")
      break
    }
  }
  return records
}

export function parsePilot(
  name: string,
  text: string,
  projectNames: string[],
  now: number,
): { records: PilotLesson[]; skipped: number; issues: string[] } {
  const issues: string[] = []
  let skipped = 0
  const reject = (reason: string) => {
    skipped++
    if (issues.length < 100) issues.push(`${name}: ${reason}`)
  }
  if (!relativeFile(name) || !/\.(?:jsonl|md)$/.test(name)) {
    reject("Expected a relative .jsonl or .md file name")
    return { records: [], skipped, issues }
  }
  if (name.endsWith(".jsonl")) {
    return { records: parsePilotJsonlFile(text, projectNames, now, reject), skipped, issues }
  }
  const records: PilotLesson[] = []
  try {
    records.push(parsePilotMarkdown(name, text, projectNames, now))
  } catch (cause) {
    reject(cause instanceof Error ? cause.message : "Malformed knowledge document")
  }
  return { records, skipped, issues }
}
