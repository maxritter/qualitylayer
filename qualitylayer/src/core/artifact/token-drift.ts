// Whether an artifact still uses the project's design file values. `artifact new` seeds a page with the
// design file's tokens; later the file or the page moves. This reads the design file's tokens, the
// declarations a page makes in its root and theme blocks, and says which values differ.
//
// A difference is drift only when the page's value is one the design file (or the palette it reads) held
// for that token earlier in its git history (`token-history.ts`): the design moved on and the page did not
// follow. A value the file never held is the page's own choice: it is not reported and never refreshed.
// Without git or without history nothing counts as drift.
//
// The pieces: the entry page's `<style>` blocks and the local stylesheets it links inside its own
// folder are scanned (no network, no symlinks out of the folder, no `@import`); light and dark values
// are compared separately; the comparison is cached per artifact on the stamps of the design file and of
// every file it read, so an unchanged artifact costs a few `stat` calls. A caller that lists many
// artifacts passes a `DriftBudget`: it recomputes a bounded number per request and reports the last
// answer (or "not checked yet") for the rest, so repeated requests finish the work. There are no
// watchers and no timers, and nothing leaves this machine.

import type { Ctx } from "../../ctx.ts"
import type { TokenSummary } from "./format.ts"
import { clearDesignCache, currentStamp, loadDesign, stampOf } from "./token-drift-design.ts"
import { type Edit, inspectTokens } from "./token-drift-inspect.ts"
import { type Stamps, type StyleSource, sha256, stampFile } from "./token-drift-sources.ts"
import { forgetTokenHistory } from "./token-history.ts"

export type { Edit } from "./token-drift-inspect.ts"
export type { StyleSource } from "./token-drift-sources.ts"

export type TokenState = TokenSummary["state"]
export type Theme = "light" | "dark"

/** One declaration that differs from the design file. */
export type TokenChange = {
  /** The variable as the page declares it (`--accent`, `--ql-accent`, `--font-sans`). */
  name: string
  theme: Theme
  /** The file that declares it, from the artifact's folder (the page itself for an inline `<style>`). */
  file: string
  page: string
  /** The page's value. */
  value: string
  /** The design file's value now. */
  now: string
}

export type TokenDrift = {
  state: TokenState
  /** Distinct design tokens that differ (an alias pair counts once). */
  count?: number
  reason?: string
  changed?: TokenChange[]
}

/** Where an artifact is: the checkout whose design file applies, its entry page, and its folder. */
export type DriftTarget = {
  root: string
  /** The entry page, absolute. */
  page: string
  /** The artifact's own folder when it is a folder: linked stylesheets are read from inside it. */
  dir?: string
}

/** At most this many stylesheets and bytes (page included) are read for one artifact. */
export const DRIFT_FILES_MAX = 32
export const DRIFT_BYTES_MAX = 4 * 1024 * 1024
/** The cache holds at most this many artifacts and about this many bytes of results. */
export const DRIFT_CACHE_ENTRIES = 2000
export const DRIFT_CACHE_BYTES = 2 * 1024 * 1024
/** A listing request recomputes at most this many artifacts and reads at most this many bytes. */
export const DRIFT_REQUEST_RECOMPUTATIONS = 40
export const DRIFT_REQUEST_BYTES = 16 * 1024 * 1024
/** The changed declarations a cached answer keeps; `count` is always the whole number. */
export const DRIFT_CHANGED_KEPT = 20

const NOT_CHECKED_YET: TokenDrift = { state: "unassessed", reason: "not checked yet" }

export type DriftBudget = {
  /** Recomputations left. */
  recomputations: number
  /** Bytes of artifact files that may still be read. */
  bytes: number
  /** The design stamp of each checkout, read once per request. */
  stamps: Map<string, Promise<string>>
}

export function newDriftBudget(
  limits: { recomputations?: number; bytes?: number } = {},
): DriftBudget {
  return {
    recomputations: limits.recomputations ?? DRIFT_REQUEST_RECOMPUTATIONS,
    bytes: limits.bytes ?? DRIFT_REQUEST_BYTES,
    stamps: new Map(),
  }
}

/** A budget with no limit: for a command that lists one project once and then exits. */
export const unlimitedDriftBudget = (): DriftBudget =>
  newDriftBudget({ recomputations: Number.POSITIVE_INFINITY, bytes: Number.POSITIVE_INFINITY })

type Entry = { design: string; stamps: Stamps; result: TokenDrift; weight: number }

/** Least recently used first. */
const cache = new Map<string, Entry>()
let cacheWeight = 0

/** Forget every cached answer (a test starts clean). */
export function forgetTokenDrift(): void {
  cache.clear()
  clearDesignCache()
  forgetTokenHistory()
  cacheWeight = 0
}

/** How many answers are cached and about how heavy they are. */
export const tokenDriftCache = () => ({ entries: cache.size, bytes: cacheWeight })

const kept = (result: TokenDrift): TokenDrift =>
  result.changed !== undefined && result.changed.length > DRIFT_CHANGED_KEPT
    ? { ...result, changed: result.changed.slice(0, DRIFT_CHANGED_KEPT) }
    : result

function remember(key: string, entry: Omit<Entry, "weight">, files: number): Entry {
  const weight = JSON.stringify(entry.result).length + key.length + files * 120 + 200
  const stored = { ...entry, weight }
  const had = cache.get(key)
  if (had !== undefined) cacheWeight -= had.weight
  cache.delete(key)
  cache.set(key, stored)
  cacheWeight += weight
  while ((cache.size > DRIFT_CACHE_ENTRIES || cacheWeight > DRIFT_CACHE_BYTES) && cache.size > 1) {
    const oldest = cache.keys().next().value as string
    cacheWeight -= cache.get(oldest)?.weight ?? 0
    cache.delete(oldest)
  }
  return stored
}

async function unchanged(ctx: Ctx, entry: Entry): Promise<boolean> {
  for (const [path, stamp] of entry.stamps) if ((await stampFile(ctx, path)) !== stamp) return false
  return true
}

/**
 * The state of one artifact's tokens: cached while the design file and the files read stand unchanged.
 * With a budget, an artifact that needs recomputing after the budget is spent reports its last answer
 * (or "not checked yet"); the next request goes on from there.
 */
export async function tokenDrift(
  ctx: Ctx,
  target: DriftTarget,
  options: { budget?: DriftBudget } = {},
): Promise<TokenDrift> {
  const { budget } = options
  const stamp = await stampOf(ctx, target.root, budget)
  const key = `${target.root}\0${target.page}`
  const had = cache.get(key)
  if (had !== undefined && had.design === stamp && (await unchanged(ctx, had))) {
    cache.delete(key)
    cache.set(key, had)
    return had.result
  }
  if (budget !== undefined && (budget.recomputations <= 0 || budget.bytes <= 0))
    return had?.result ?? NOT_CHECKED_YET
  if (budget !== undefined) budget.recomputations--
  const done = await inspectTokens(ctx, target, await loadDesign(ctx, target.root, stamp))
  if (budget !== undefined) budget.bytes -= done.read
  const result = kept(done.result)
  remember(key, { design: stamp, stamps: done.stamps, result }, done.stamps.size)
  return result
}

/** A summary for a listing: the state, how many tokens differ, and why when it is not assessed. */
export const summaryOf = (drift: TokenDrift): TokenSummary => ({
  state: drift.state,
  ...(drift.count !== undefined && drift.state === "drifted" ? { count: drift.count } : {}),
  ...(drift.reason !== undefined ? { reason: drift.reason } : {}),
})

/** The files of the last check, with the witnesses a refresh guards its writes with. */
export type TokenCheck = {
  result: TokenDrift
  edits: Edit[]
  sources: StyleSource[]
  /** The entry page's text and its revision (sha256), as read in this check. */
  html: string | null
  revision: string | null
  page: string
  /** The design file the values came from, from the checkout's root. */
  designFile: string | null
}

/** A fresh, whole answer (every changed declaration) with what a refresh needs; never from the cache. */
export async function checkTokens(ctx: Ctx, target: DriftTarget): Promise<TokenCheck> {
  const stamp = await currentStamp(ctx, target.root)
  const design = await loadDesign(ctx, target.root, stamp)
  const done = await inspectTokens(ctx, target, design)
  remember(
    `${target.root}\0${target.page}`,
    { design: stamp, stamps: done.stamps, result: kept(done.result) },
    done.stamps.size,
  )
  return {
    result: done.result,
    edits: done.edits,
    sources: done.sources,
    html: done.html,
    revision: done.html === null ? null : sha256(done.html),
    page: done.pageName,
    designFile: design.tokens?.source ?? null,
  }
}

/** The artifact's folder as a drift target needs it: only a folder reads linked stylesheets. */
export const targetOf = (root: string, page: string, folder?: { dir: string }): DriftTarget => ({
  root,
  page,
  ...(folder !== undefined ? { dir: folder.dir } : {}),
})
