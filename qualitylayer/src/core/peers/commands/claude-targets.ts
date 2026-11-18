import { statSync } from "node:fs"
import { isUuid } from "../base.ts"
import {
  type ClaudeRecord,
  classifyClaudeRecords,
  claudeRecordsByTarget,
  readClaudeRecords,
  socketPathOk,
} from "../claude.ts"
import { ResolveError, ResolveNotFound } from "../codex.ts"
import { claudeTranscript } from "../doing.ts"

export function resolveClaudeRecord(target: string): ClaudeRecord {
  const candidates = claudeRecordsByTarget(target, readClaudeRecords())
  const classified = classifyClaudeRecords(candidates)
  const matches = classified.filter(([, s]) => s === "live").map(([r]) => r)
  if (classified.some(([, s]) => s === "unverified")) {
    throw new ResolveError(
      `cannot verify Claude target ${JSON.stringify(target)} because the process-start probe is unavailable; retry outside the sandbox`,
    )
  }
  if (matches.length === 0) {
    const hint = finishedClaudeHint(target, candidates)
    throw new ResolveNotFound(
      hint ??
        `no live Claude session with ${isUuid(target) ? "id" : "name"} ${JSON.stringify(target)}; run qualitylayer peers list to choose a current target`,
    )
  }
  if (matches.length > 1) {
    throw new ResolveError(
      `${JSON.stringify(target)} names ${matches.length} live sessions (${matches.map((m) => m.pid).join(", ")}); rename one`,
    )
  }
  const rec = matches[0] as ClaudeRecord
  if (rec.entrypoint === "codex") {
    throw new ResolveError(
      `${JSON.stringify(target)} is a Codex stand-in, not a Claude session; address codex:${rec.sessionId}`,
    )
  }
  if (!socketPathOk(rec.messagingSocketPath)) {
    throw new ResolveError(
      `${target} listens on ${JSON.stringify(rec.messagingSocketPath)}, outside the allowlisted socket folders`,
    )
  }
  return rec
}

export function finishedClaudeHint(target: string, records: ClaudeRecord[]): string | null {
  const native = records.filter(
    (record) => record.entrypoint !== "codex" && isUuid(record.sessionId),
  )
  const ids = [...new Set(native.map((record) => record.sessionId as string))]
  const id = isUuid(target) ? target : ids.length === 1 ? ids[0] : undefined
  if (!id)
    return ids.length > 1
      ? `${JSON.stringify(target)} has ${ids.length} past native Claude sessions and no live recipient. Use a full session UUID to inspect the intended conversation; no session was resumed.`
      : null
  const record = native.find((row) => row.sessionId === id)
  const saved = claudeTranscript(id, typeof record?.cwd === "string" ? record.cwd : null)
  let savedPresent = false
  try {
    savedPresent = saved !== null && statSync(saved).isFile()
  } catch {
    // A saved conversation may disappear between lookup and stat; its resumability stays unverified.
  }
  if (savedPresent)
    return `Known saved Claude conversation ${id} has no verified live messaging endpoint. Inspect or resume it manually with claude --resume ${id}, choosing its model and effort explicitly. QualityLayer did not resume or replace the session.`
  return record
    ? `Known Claude session ${id} is no longer a live messaging recipient; no saved conversation was verified. Inspect the native conversation picker before choosing a continuation. QualityLayer did not resume or replace it.`
    : null
}
