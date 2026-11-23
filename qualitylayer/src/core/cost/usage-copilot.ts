// Copilot's session records for the usage count: `session-state/<id>/events.jsonl`, whose
// `session.usage_record` rows carry the tokens of every model call. Its `inputTokens` hold the cached
// tokens too (read and written), so the input the model read fresh is what is left.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Call } from "./transcripts.ts"
import { copilotCall, copilotText } from "./usage-copilot-call.ts"
import { type Candidate, FILES_MAX, listed } from "./usage-files.ts"
import type { ChunkParser } from "./usage-parsers.ts"

export { copilotCall }

const RECORD = "events.jsonl"

/** The session records changed since `since`. */
export async function copilotFiles(ctx: Ctx, base: string, since: number): Promise<Candidate[]> {
  const sessions = join(base, "session-state")
  const found: Candidate[] = []
  for (const session of await listed(ctx, sessions)) {
    if (session.kind !== "directory") continue
    const path = join(sessions, session.name, RECORD)
    const stat = await ctx.fs.stat?.(path)
    if (stat !== null && stat !== undefined && stat.mtimeMs >= since)
      found.push({ path, mtimeMs: stat.mtimeMs, size: stat.size })
    if (found.length >= FILES_MAX) break
  }
  return found
}

/** Compaction usage may omit its model; the behavior model is attribution, never a price alias. */
function compactionCall(row: Record<string, unknown>): Call | null {
  const data = row.data as
    | {
        compactionTokensUsed?: Record<string, unknown>
        requestId?: unknown
        behaviorModelId?: unknown
      }
    | undefined
  const usage = data?.compactionTokensUsed
  if (!usage) return null
  const key = copilotText(data.requestId) ?? copilotText(row.id)
  if (key === null) return null
  return copilotCall({
    ...row,
    type: "session.usage_record",
    data: {
      usage: {
        ...usage,
        model: copilotText(usage.model) ?? copilotText(data.behaviorModelId) ?? "unknown",
        apiCallId: key,
      },
    },
  })
}

function recordUsage(
  row: Record<string, unknown>,
  calls: Map<string, Call>,
  mirrored: Set<string>,
): void {
  const call = copilotCall(row)
  if (call === null) return
  const usage = (
    row.data as { usage?: { apiCallId?: unknown; accounting?: { usageId?: unknown } } } | undefined
  )?.usage
  for (const id of [copilotText(usage?.apiCallId), copilotText(usage?.accounting?.usageId)])
    if (id) mirrored.add(id)
  const key = call.id ?? `#${calls.size}`
  call.id = key
  const previous = calls.get(key)
  call.legacyIds = [...new Set([...(previous?.legacyIds ?? []), ...(call.legacyIds ?? [])])]
  calls.set(key, call)
}

function parseCopilotLine(
  line: string,
  calls: Map<string, Call>,
  mirrored: Set<string>,
  compactions: Map<string, Call>,
): void {
  if (!line.includes('"session.usage_record"') && !line.includes('"session.compaction_complete"'))
    return
  try {
    const row = JSON.parse(line)
    if (row.type === "session.compaction_complete") {
      const call = compactionCall(row)
      if (call?.id) compactions.set(call.id, call)
    } else recordUsage(row, calls, mirrored)
  } catch {
    // A torn last line of a record still being written.
  }
}

export function copilotParser(): ChunkParser {
  const calls = new Map<string, Call>()
  const mirrored = new Set<string>()
  const compactions = new Map<string, Call>()
  return {
    chunk(chunk) {
      for (const line of chunk.split("\n")) parseCopilotLine(line, calls, mirrored, compactions)
    },
    finish: () => [
      ...calls.values(),
      ...[...compactions].filter(([id]) => !mirrored.has(id)).map(([, call]) => call),
    ],
  }
}
