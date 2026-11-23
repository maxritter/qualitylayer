// What the QualityLayer home holds on disk, for Settings › About › Disk use. Measured once when the
// page asks, never on a timer: one walk that adds every file's size, counts a link as itself and
// never follows it, and stops at a budget so a very large home answers fast with "at least".

import { lstat, readdir } from "node:fs/promises"
import { join, sep } from "node:path"

export type FolderSize = { bytes: number; partial: boolean }

/** Entries looked at before the figure is given as partial, and how long the walk may take. */
export const WALK_MAX_ENTRIES = 250_000
export const WALK_MAX_MS = 4000
/** Folders read at once: enough to overlap the disk, few enough to stay quiet. */
const LANES = 8

type WalkState = {
  pending: string[]
  bytes: number
  seen: number
  partial: boolean
  maxEntries: number
  until: number
}

async function statEntry(path: string, state: WalkState): Promise<void> {
  try {
    const info = await lstat(path)
    if (info.isDirectory()) state.pending.push(path)
    else state.bytes += info.size
  } catch {
    // gone while walking: it holds nothing now
  }
}

async function walkDirectory(dir: string, state: WalkState): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (state.seen >= state.maxEntries || Date.now() > state.until) {
      state.partial = true
      return
    }
    state.seen++
    await statEntry(join(dir, name), state)
  }
}

async function runLane(state: WalkState): Promise<void> {
  for (let dir = state.pending.pop(); dir !== undefined; dir = state.pending.pop()) {
    if (state.partial) return
    await walkDirectory(dir, state)
  }
}

/** The bytes under `root`, or what was counted when the budget ran out (`partial`). A missing folder holds nothing. */
export async function measureFolder(
  root: string,
  limits: { maxEntries?: number; maxMs?: number } = {},
): Promise<FolderSize> {
  const state: WalkState = {
    pending: [root],
    bytes: 0,
    seen: 0,
    partial: false,
    maxEntries: limits.maxEntries ?? WALK_MAX_ENTRIES,
    until: Date.now() + (limits.maxMs ?? WALK_MAX_MS),
  }
  // Lanes that find the stack empty end at once; a folder found later is taken by the lane that found it.
  do {
    const count = Math.min(LANES, Math.max(1, state.pending.length))
    await Promise.all(Array.from({ length: count }, () => runLane(state)))
  } while (state.pending.length > 0 && !state.partial)
  return { bytes: state.bytes, partial: state.partial }
}

/** The home with the person's own folder as `~`, as a person writes it. */
export function homeWords(home: string, user: string): string {
  const prefix = user.endsWith(sep) ? user : user + sep
  return home.startsWith(prefix)
    ? `~${sep === "\\" ? "\\" : "/"}${home.slice(prefix.length)}`
    : home
}
