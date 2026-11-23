// Copilot's plan limits, as its session records carry them: every model call of an interactive session
// writes `model.model_call_success` with `quotaSnapshots`. The plan's request allowance is one monthly
// window: the premium requests when the plan has any, else the chat requests. An unlimited allowance is no
// limit. The newest record that has a snapshot is read from its end only.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { roots } from "../install/agent-settings.ts"
import { copilotWindowsOf, jsonObject } from "./copilot-window.ts"
import { tailLines } from "./tail.ts"
import type { LimitWindow } from "./window.ts"

/**
 * The newest session records searched, and how many sessions are looked at to find them. Headless
 * `-p` runs (every review) carry no snapshot, so the search reaches past a run of them; it stops at
 * the first record that has one.
 */
const FILES = 50
const SESSIONS = 1000

/** `free`: the plan limits chat requests, as only Copilot Free does; paid plans have unlimited chat. */
export type CopilotReading = { at: number; windows: LimitWindow[]; free: boolean }

/** The last snapshot set in a record's lines, with the time it was written; null when none has one. */
export function copilotReading(lines: readonly string[], now: number): CopilotReading | null {
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at] as string
    if (!line.includes('"quotaSnapshots"')) continue
    try {
      const row = jsonObject(JSON.parse(line))
      const snapshots = jsonObject(jsonObject(row?.data)?.quotaSnapshots)
      if (row?.type !== "model.model_call_success" || snapshots === null) continue
      const windows = copilotWindowsOf(snapshots, now)
      const stamp = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN
      const free = jsonObject(snapshots.chat)?.isUnlimitedEntitlement === false
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
