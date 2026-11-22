// What each agent printed when asked for the models it can use, kept in one small file of the
// QualityLayer home so a process that must not start the agent (a config read in a hook, a review
// from the command line) still knows it. `model-list.ts` writes it; reading it starts nothing.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { MODEL_LIST_IDS_MAX, MODEL_LISTS_MAX_BYTES } from "../home-caps.ts"
import { isNativeAgent, type NativeAgent, validModelId } from "./ids.ts"
import { validModelLabel } from "./model-list-readers.ts"
import { type KnownModels, listsModels } from "./model-values.ts"

export type StoredModelList = {
  /** The ids the agent printed, in its order. */
  models: string[]
  labels?: Record<string, string>
  /** The model the agent would start with itself: its configured one, else the first it printed. */
  own: string | null
  /** When a read last gave these ids. */
  checkedAt: number
  /** When a read last failed: the ids above are older than that. */
  failedAt?: number
  /** The command that printed them, so a different command is asked again. */
  binary: string
}

const FILE = "model-lists.json"
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

/** One stored entry, kept only in the shape a read writes, with bounded text. */
function stored(agent: NativeAgent, value: unknown): StoredModelList | null {
  if (typeof value !== "object" || value === null) return null
  const entry = value as Record<string, unknown>
  if (!Array.isArray(entry.models) || !isTime(entry.checkedAt) || typeof entry.binary !== "string")
    return null
  const models = entry.models
    .filter((id): id is string => typeof id === "string" && validModelId(agent, id))
    .slice(0, MODEL_LIST_IDS_MAX)
  const own = typeof entry.own === "string" && validModelId(agent, entry.own) ? entry.own : null
  const raw = entry.labels
  const labels =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(
          models.flatMap((id) => {
            if (!Object.hasOwn(raw, id)) return []
            const name = (raw as Record<string, unknown>)[id]
            return validModelLabel(name) ? [[id, name]] : []
          }),
        )
      : undefined
  return {
    models,
    ...(labels ? { labels } : {}),
    own,
    checkedAt: entry.checkedAt,
    ...(isTime(entry.failedAt) ? { failedAt: entry.failedAt } : {}),
    binary: entry.binary.slice(0, 4096),
  }
}

/** Every agent's stored list; reading it launches nothing. */
export async function storedModelLists(
  ctx: Ctx,
): Promise<Partial<Record<NativeAgent, StoredModelList>>> {
  try {
    const path = join(ctx.home, FILE)
    if (!(await ctx.fs.exists(path))) return {}
    const text = ctx.fs.readRange
      ? await ctx.fs.readRange(path, 0, MODEL_LISTS_MAX_BYTES + 1)
      : await ctx.fs.readFile(path)
    if (Buffer.byteLength(text) > MODEL_LISTS_MAX_BYTES) return {}
    const value = JSON.parse(text) as Record<string, unknown>
    const out: Partial<Record<NativeAgent, StoredModelList>> = {}
    for (const [agent, entry] of Object.entries(value)) {
      const kept = isNativeAgent(agent) && listsModels(agent) ? stored(agent, entry) : null
      if (isNativeAgent(agent) && kept !== null) out[agent] = kept
    }
    return out
  } catch {
    return {}
  }
}

export async function storeModelList(
  ctx: Ctx,
  agent: NativeAgent,
  entry: StoredModelList,
): Promise<void> {
  const all = await storedModelLists(ctx)
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.atomicWrite(
    join(ctx.home, FILE),
    `${JSON.stringify({ ...all, [agent]: entry }, null, 2)}\n`,
  )
}

/** What the pickers and the config need from a stored list. */
export const knownFrom = (entry: StoredModelList | undefined): KnownModels | null =>
  entry === undefined
    ? null
    : { listed: entry.models, own: entry.own, ...(entry.labels ? { labels: entry.labels } : {}) }
