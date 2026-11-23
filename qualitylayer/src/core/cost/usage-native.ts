import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { zeroTokens } from "./prices.ts"
import { type Candidates, FILES_MAX, listed, transcriptsIn } from "./usage-files.ts"
import {
  grokUsageParser,
  jsonLineParser,
  nonNegativeCount,
  parseStamp,
} from "./usage-native-grok.ts"
import type { ChunkParser } from "./usage-parsers.ts"

export { grokUsageParser }

type GrokScanState = { found: Candidates; visited: number; deadline: number }

async function scanGrokProject(
  ctx: Ctx,
  folder: string,
  since: number,
  state: GrokScanState,
): Promise<boolean> {
  const sessions = (await listed(ctx, folder)).sort((a, b) => b.name.localeCompare(a.name))
  if (sessions.length > 1000) state.found.partial = "Grok history discovery was capped"
  for (const session of sessions.slice(0, 1000)) {
    if (++state.visited > 2000 || ctx.clock.now() >= state.deadline) {
      state.found.partial = "Grok history discovery budget reached"
      return false
    }
    if (session.kind !== "directory") continue
    const updates = (await transcriptsIn(ctx, join(folder, session.name), since)).filter((file) =>
      file.path.endsWith("updates.jsonl"),
    )
    state.found.push(...updates)
    if (state.found.length >= FILES_MAX) {
      state.found.length = FILES_MAX
      state.found.partial = "Grok history discovery was capped"
      return false
    }
  }
  return true
}

export async function grokUsageFiles(ctx: Ctx, base: string, since: number): Promise<Candidates> {
  const state: GrokScanState = { found: [], visited: 0, deadline: ctx.clock.now() + 250 }
  const root = join(base, "sessions")
  const projects = (await listed(ctx, root)).sort((a, b) => b.name.localeCompare(a.name))
  if (projects.length > 200) state.found.partial = "Grok history discovery was capped"
  for (const project of projects.slice(0, 200)) {
    if (project.kind !== "directory") continue
    const keepGoing = await scanGrokProject(ctx, join(root, project.name), since, state)
    if (!keepGoing) return state.found
  }
  return state.found
}

/** Unknown models retain their token counts and remain unpriced; a later session model is not substituted. */
export function antigravityUsageParser(): ChunkParser {
  return jsonLineParser((row) => {
    if (row.type !== "PLANNER_RESPONSE" || typeof row.step_index !== "number") return []
    const at = parseStamp(row.created_at)
    if (at === null) return []
    const model =
      typeof row.model === "string"
        ? row.model
        : typeof row.model_id === "string"
          ? row.model_id
          : "unknown"
    return [
      {
        id: `step:${row.step_index}`,
        at,
        model,
        tokens: {
          ...zeroTokens(),
          input: nonNegativeCount(row.input_tokens),
          output: nonNegativeCount(row.output_tokens),
          cacheRead: nonNegativeCount(row.cache_read_tokens),
        },
        billing: "unknown",
        missingTokens: ![row.input_tokens, row.output_tokens, row.cache_read_tokens].some(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
      },
    ]
  })
}

export async function antigravityUsageFiles(
  ctx: Ctx,
  base: string,
  since: number,
): Promise<Candidates> {
  const found: Candidates = []
  const deadline = ctx.clock.now() + 250
  const root = join(base, "antigravity-cli", "brain")
  const sessions = (await listed(ctx, root)).sort((a, b) => b.name.localeCompare(a.name))
  if (sessions.length > 1000) found.partial = "Antigravity history discovery was capped"
  for (const session of sessions.slice(0, 1000)) {
    if (ctx.clock.now() >= deadline) {
      found.partial = "Antigravity history discovery budget reached"
      return found
    }
    if (session.kind !== "directory") continue
    const folder = join(root, session.name, ".system_generated", "logs")
    const files = await transcriptsIn(ctx, folder, since)
    const full = files.find((file) => file.path.endsWith("transcript_full.jsonl"))
    found.push(...(full ? [full] : files.filter((file) => file.path.endsWith("transcript.jsonl"))))
  }
  return found
}
