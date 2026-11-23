import { join } from "node:path"
import { readConfig } from "../core/config.ts"
import { dayKey } from "../core/cost/usage-days.ts"
import { type UsageSnapshot, usageSnapshot } from "../core/cost/usage-snapshot.ts"
import type { AgentLimits, LimitSources } from "../core/limits/index.ts"
import { readLimits } from "../core/limits/index.ts"
import { selectsQuota } from "../core/usage-display.ts"
import type { Ctx } from "../ctx.ts"
import { cachedUsage, markUsageDirty, readUsage, usageGeneration } from "./usage.ts"

type Quotas = {
  values: AgentLimits[]
  generation: number
  at: number
  fingerprint: string
  revision: number
}
const quotas = new WeakMap<Ctx, Quotas>()
const quotaPending = new WeakMap<
  Ctx,
  { refresh: boolean; automatic: boolean; promise: Promise<AgentLimits[]> }
>()
const quotaListeners = new WeakMap<Ctx, Set<(revision: number) => void>>()
let imports: { home: string; at: number | null } | null = null
let pending: {
  home: string
  menu: boolean
  refresh: boolean
  promise: Promise<UsageSnapshot>
} | null = null
let checked: { home: string; at: number } | null = null
const EXTERNAL_USAGE_MS = 5 * 60_000

export function rememberUsageLimits(ctx: Ctx, values: AgentLimits[]): void {
  const fingerprint = JSON.stringify(
    values.map(({ agent, source, at, cause, windows, credits, state, reason, plan }) => ({
      agent,
      source,
      at,
      cause,
      credits,
      state,
      reason,
      plan,
      windows: windows.map(({ label, minutes, usedPercent, resetsAt, reached }) => ({
        label,
        minutes,
        usedPercent,
        resetsAt,
        reached,
      })),
    })),
  )
  const before = quotas.get(ctx)
  const changed = before?.fingerprint !== fingerprint
  const revision = (before?.revision ?? 0) + (changed ? 1 : 0)
  quotas.set(ctx, {
    values,
    generation: usageGeneration(),
    at: ctx.clock.now(),
    fingerprint,
    revision,
  })
  if (changed) for (const changed of quotaListeners.get(ctx) ?? []) changed(revision)
}

export function subscribeUsageLimits(ctx: Ctx, changed: (revision: number) => void): () => void {
  const listeners = quotaListeners.get(ctx) ?? new Set()
  quotaListeners.set(ctx, listeners)
  listeners.add(changed)
  return () => {
    listeners.delete(changed)
  }
}

function isQuotaFresh(
  ctx: Ctx,
  held: Quotas | undefined,
  refresh: boolean,
  attempted: boolean | undefined,
): held is Quotas {
  if (refresh || attempted || !held) return false
  return held.generation === usageGeneration() && ctx.clock.now() - held.at < EXTERNAL_USAGE_MS
}

/** One source-owned quota reading; cost-index dirty reads never reset Claude's automatic cadence. */
export async function readUsageLimits(
  ctx: Ctx,
  sources: LimitSources,
  refresh = false,
  automatic = false,
): Promise<AgentLimits[]> {
  const active = quotaPending.get(ctx)
  if (active) {
    if ((!refresh || active.refresh) && (!automatic || active.automatic)) return active.promise
    await active.promise
    return readUsageLimits(ctx, sources, refresh, automatic)
  }
  const read = async () => {
    const attempted = automatic ? await sources.claude.automatic?.(ctx) : false
    const held = quotas.get(ctx)
    if (isQuotaFresh(ctx, held, refresh, attempted)) return held.values
    const values = await readLimits(ctx, sources, refresh)
    rememberUsageLimits(ctx, values)
    return values
  }
  const current = { refresh, automatic, promise: read() }
  quotaPending.set(ctx, current)
  try {
    return await current.promise
  } finally {
    if (quotaPending.get(ctx) === current) quotaPending.delete(ctx)
  }
}

function isUsageStale(ctx: Ctx, usage: ReturnType<typeof cachedUsage>, refresh: boolean): boolean {
  if (refresh || !usage || usage.dirty) return true
  if (!usage.data.complete || usage.data.period !== 7) return true
  const expired = checked?.home !== ctx.home || ctx.clock.now() - checked.at >= EXTERNAL_USAGE_MS
  return expired || usage.data.days.at(-1) !== dayKey(ctx.clock.now())
}

async function computeUsageDisplay(
  ctx: Ctx,
  sources: LimitSources,
  refresh: boolean,
  includeMenu: boolean,
): Promise<UsageSnapshot> {
  const config = await readConfig(ctx)
  if (!config.usage.menuBar && !includeMenu)
    return usageSnapshot(config.usage, [], null, ctx.clock.now())
  const imported = (await ctx.fs.stat?.(join(ctx.home, "usage-imports")))?.mtimeMs ?? null
  if (imports?.home === ctx.home && imports.at !== imported) markUsageDirty()
  imports = { home: ctx.home, at: imported }
  let usage = cachedUsage(ctx)
  if (isUsageStale(ctx, usage, refresh)) {
    const result = await readUsage(ctx, "7", { claude: () => sources.claude.cached(ctx) })
    usage = result.ok ? { data: result.data, dirty: false } : null
    if (result.ok) checked = { home: ctx.home, at: ctx.clock.now() }
  }
  const selectedClaude = selectsQuota(config.usage, "claude-code")
  const values = await readUsageLimits(
    ctx,
    sources,
    refresh,
    !refresh && config.usage.menuBar && selectedClaude,
  )
  return usageSnapshot(config.usage, values, usage?.data ?? null, ctx.clock.now(), includeMenu)
}

/** Idle tray reads use held data; turns, imports, a new day and explicit refresh invalidate it. */
export async function readUsageDisplay(
  ctx: Ctx,
  sources: LimitSources,
  refresh = false,
  includeMenu = false,
): Promise<UsageSnapshot> {
  if (pending?.home === ctx.home) {
    if ((!includeMenu || pending.menu) && (!refresh || pending.refresh)) return pending.promise
    await pending.promise
    return readUsageDisplay(ctx, sources, refresh, includeMenu)
  }
  const active = {
    home: ctx.home,
    menu: includeMenu,
    refresh,
    promise: computeUsageDisplay(ctx, sources, refresh, includeMenu),
  }
  pending = active
  try {
    return await active.promise
  } finally {
    if (pending === active) pending = null
  }
}
