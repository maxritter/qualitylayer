import { discoverSkills } from "../core/conversation/commands/catalog.ts"
import { CATALOG_LIMITS, type CommandCatalog } from "../core/conversation/commands/types.ts"
import type { RunRecord } from "../core/run/contracts.ts"
import { readRun } from "../core/run/registry.ts"
import type { Ctx } from "../ctx.ts"

export const conversationCatalogId = (path: string) =>
  /^\/api\/agent-runs\/([a-f0-9-]{1,128})\/conversation\/catalog$/.exec(path)?.[1]
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } })
type Cached = { value: CommandCatalog; bytes: number; at: number }
const cache = new Map<string, Cached>()
const loading = new Map<string, Promise<CommandCatalog>>()
let cacheBytes = 0
let epoch = 0
const TTL = 60_000
const MAX_LOADING = 4

export function clearCommandCatalogCache(): void {
  epoch++
  cache.clear()
  cacheBytes = 0
}
export function commandCatalogCacheSize() {
  return { entries: cache.size, loading: loading.size, bytes: cacheBytes }
}
const drop = (key: string) => {
  const entry = cache.get(key)
  if (entry) cacheBytes -= entry.bytes
  cache.delete(key)
}
function storeCatalogEntry(key: string, value: CommandCatalog) {
  const bytes = Buffer.byteLength(JSON.stringify(value))
  drop(key)
  while (
    cache.size &&
    (cache.size >= CATALOG_LIMITS.cacheEntries || cacheBytes + bytes > CATALOG_LIMITS.cacheBytes)
  ) {
    const first = cache.keys().next().value
    if (first === undefined) break
    drop(first)
  }
  if (bytes <= CATALOG_LIMITS.cacheBytes) {
    cache.set(key, { value, bytes, at: Date.now() })
    cacheBytes += bytes
  }
}

async function catalog(
  ctx: Ctx,
  run: RunRecord,
  refresh: boolean,
  discover: typeof discoverSkills,
) {
  const key = `${ctx.home}\0${run.id}\0${run.generation}`
  const pending = loading.get(key)
  if (pending) return pending
  const previous = cache.get(key)
  if (!refresh && previous && Date.now() - previous.at < TTL) return previous.value
  if (loading.size >= MAX_LOADING) throw new Error("catalog busy")
  const startedEpoch = epoch
  const promise = discover(ctx, run)
    .then((value) => {
      if (startedEpoch === epoch) storeCatalogEntry(key, value)
      return value
    })
    .finally(() => {
      if (loading.get(key) === promise) loading.delete(key)
    })
  loading.set(key, promise)
  return promise
}

type CatalogRequestCheck =
  | { ok: true; run: RunRecord; generation: number; refresh: boolean }
  | { ok: false; response: Response }

function validateCatalogRequest(
  ctx: Ctx,
  request: Request,
  id: string,
  authority: { keyPaired: boolean; canConfigure: boolean; current?: () => boolean },
): CatalogRequestCheck {
  if (!authority.keyPaired || !authority.canConfigure || authority.current?.() === false)
    return {
      ok: false,
      response: reply({ error: "Skill discovery requires the App or a browser it opened." }, 403),
    }
  const query = new URL(request.url).searchParams
  if ([...query.keys()].some((key) => !["generation", "refresh"].includes(key)))
    return { ok: false, response: reply({ error: "Unknown catalog option." }, 400) }
  const generation = Number(query.get("generation"))
  const run = readRun(ctx.home, id)
  if (!run || run.agent === "other")
    return { ok: false, response: reply({ error: "Native agent run not found." }, 404) }
  if (!Number.isSafeInteger(generation) || generation < 1 || generation !== run.generation)
    return {
      ok: false,
      response: reply({ error: "This run has changed. Open its window again." }, 409),
    }
  return { ok: true, run, generation, refresh: query.get("refresh") === "1" }
}

/** Personal skill metadata is configuration, never a task's watch-only conversation payload. */
export async function conversationCatalogResponse(
  ctx: Ctx,
  request: Request,
  id: string,
  authority: { keyPaired: boolean; canConfigure: boolean; current?: () => boolean },
  discover: typeof discoverSkills = discoverSkills,
): Promise<Response> {
  const checked = validateCatalogRequest(ctx, request, id, authority)
  if (!checked.ok) return checked.response
  try {
    const value = await catalog(ctx, checked.run, checked.refresh, discover)
    if (authority.current?.() === false)
      return reply({ error: "Skill discovery authority changed." }, 403)
    if (readRun(ctx.home, id)?.generation !== checked.generation)
      return reply({ error: "This run changed while its skills were loading." }, 409)
    return reply(value)
  } catch {
    return reply({ error: "Could not read the agent’s skills. Try again or use Terminal." }, 503)
  }
}
