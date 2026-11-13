// Copilot's plan limits, as its session records carry them: every model call of an interactive session
// writes `model.model_call_success` with `quotaSnapshots`. The plan's request allowance is one monthly
// window: the premium requests when the plan has any, else the chat requests. An unlimited allowance is no
// limit. The newest record that has a snapshot is read from its end only.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { roots } from "../install/agent-settings.ts"
import { tailLines } from "./tail.ts"
import { type LimitWindow, shownWindow, usedShare } from "./window.ts"

/**
 * The newest session records searched, and how many sessions are looked at to find them. Headless
 * `-p` runs (every review) carry no snapshot, so the search reaches past a run of them; it stops at
 * the first record that has one.
 */
const FILES = 50
const SESSIONS = 1000
const MONTH_MINUTES = 30 * 24 * 60
const MONTH_LABEL = "This month"

/** `free`: the plan limits chat requests, as only Copilot Free does; paid plans have unlimited chat. */
export type CopilotReading = { at: number; windows: LimitWindow[]; free: boolean }

type Json = Record<string, unknown>
const object = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null

/** The allowances that count, in the order they are preferred: premium requests, then chat. */
const QUOTAS = ["premium_interactions", "chat"] as const

/** A month's length in minutes, ending at `reset`: the month before it. */
function monthMinutes(reset: number): number {
  const end = new Date(reset)
  const start = Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, end.getUTCDate())
  const minutes = Math.round((reset - start) / 60_000)
  return minutes > 0 ? minutes : MONTH_MINUTES
}

function windowOf(quota: Json, now: number): LimitWindow | null {
  const remaining = typeof quota.remainingPercentage === "number" ? quota.remainingPercentage : null
  const entitlement = typeof quota.entitlementRequests === "number" ? quota.entitlementRequests : 0
  const used = typeof quota.usedRequests === "number" ? quota.usedRequests : Number.NaN
  const share = usedShare(remaining === null ? (used / entitlement) * 100 : 100 - remaining)
  if (share === null) return null
  const reset = typeof quota.resetDate === "string" ? Date.parse(quota.resetDate) : Number.NaN
  const resetsAt = Number.isNaN(reset) ? null : reset
  const shown = shownWindow(
    {
      minutes: resetsAt === null ? MONTH_MINUTES : monthMinutes(resetsAt),
      usedPercent: share,
      resetsAt,
      label: MONTH_LABEL,
    },
    now,
  )
  // A used-up allowance that does not run on past its end is out until the reset.
  const out =
    share >= 100 && quota.usageAllowedWithExhaustedQuota !== true && shown.usedPercent !== null
  return out ? { ...shown, usedPercent: null, pacePercent: null, reached: true } : shown
}

/** The windows one snapshot set shows: the first counted allowance; none when the plan is unlimited. */
function windowsOf(snapshots: Json, now: number): LimitWindow[] | null {
  let unlimited = false
  for (const name of QUOTAS) {
    const quota = object(snapshots[name])
    if (quota === null) continue
    if (quota.isUnlimitedEntitlement === true) {
      unlimited = true
      continue
    }
    if (typeof quota.entitlementRequests !== "number" || quota.entitlementRequests <= 0) continue
    const window = windowOf(quota, now)
    if (window !== null) return [window]
  }
  return unlimited ? [] : null
}

/** The last snapshot set in a record's lines, with the time it was written; null when none has one. */
export function copilotReading(lines: readonly string[], now: number): CopilotReading | null {
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at] as string
    if (!line.includes('"quotaSnapshots"')) continue
    try {
      const row = object(JSON.parse(line))
      const snapshots = object(object(row?.data)?.quotaSnapshots)
      if (row?.type !== "model.model_call_success" || snapshots === null) continue
      const windows = windowsOf(snapshots, now)
      const stamp = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN
      const free = object(snapshots.chat)?.isUnlimitedEntitlement === false
      if (windows !== null) return { at: Number.isNaN(stamp) ? now : stamp, windows, free }
    } catch {
      // A torn last line says nothing.
    }
  }
  return null
}

/** The newest session records, by when they were written. */
async function newestRecords(ctx: Ctx, sessions: string): Promise<string[]> {
  let names: string[]
  try {
    names = (await ctx.fs.readdir(sessions)).slice(0, SESSIONS)
  } catch {
    return []
  }
  const files: { path: string; at: number }[] = []
  for (const name of names) {
    const path = join(sessions, name, "events.jsonl")
    const stat = await ctx.fs.stat?.(path)
    if (stat !== null && stat !== undefined) files.push({ path, at: stat.mtimeMs })
  }
  return files
    .sort((a, b) => b.at - a.at)
    .slice(0, FILES)
    .map((file) => file.path)
}

/** The newest allowance reading in Copilot's session records; null when none has one. */
export async function latestCopilotReading(ctx: Ctx): Promise<CopilotReading | null> {
  const folder = roots(ctx)?.copilot
  if (folder === undefined) return null
  const now = ctx.clock.now()
  for (const path of await newestRecords(ctx, join(folder, "session-state"))) {
    const reading = copilotReading(await tailLines(ctx, path), now)
    if (reading !== null) return reading
  }
  return null
}
