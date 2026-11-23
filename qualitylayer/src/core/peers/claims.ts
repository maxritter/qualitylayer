// Sharing one checkout: each session says what it is doing and which paths it
// holds, and can say it has stopped so another may go ahead. Everything is an
// entry on a topic (one board per checkout, one for statuses), folded back
// into who holds what; a session that is no longer live holds nothing.

import { realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { PeerError, parseTime, runCmd } from "./base.ts"
import type { Entry } from "./topics.ts"

/** The topic every session's statuses go to, whichever checkout it works in. */
export const STATUS_TOPIC = "peers:status"

export const boardTopic = (repo: string): string => `checkout:${repo}`

/** The checkout `dir` belongs to: its git top level, resolved, or the folder itself outside git. */
export function checkoutOf(dir: string): string {
  const [code, stdout] = runCmd(["git", "rev-parse", "--show-toplevel"], { cwd: dir })
  const top = code === 0 && stdout.trim() !== "" ? stdout.trim() : dir
  try {
    return realpathSync(top)
  } catch {
    return resolve(top)
  }
}

/** `path` with its links resolved as far as it exists, so /var and /private/var name one place. */
function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(real(parent), basename(path))
  }
}

/** A path inside the checkout, relative and with forward slashes; "." is the whole checkout. */
export function claimPath(repo: string, raw: string): string {
  const absolute = real(isAbsolute(raw) ? raw : resolve(repo, raw))
  const inside = relative(repo, absolute).split(sep).join("/").replace(/\/+$/, "")
  if (inside === "") return "."
  if (inside === ".." || inside.startsWith("../") || isAbsolute(inside))
    throw new PeerError(`${raw} is outside the checkout ${repo}`, 2)
  return inside
}

/** Whether two claimed paths cover any file in common: the same path, or one inside the other. */
export function overlaps(a: string, b: string): boolean {
  if (a === b || a === "." || b === ".") return true
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export type Held = { path: string; note: string | null; since: string }

export type Holder = {
  /** `cc:<uuid>` or `codex:<uuid>`. */
  who: string
  name: string | null
  paths: Held[]
  paused: { note: string | null; since: string } | null
}

const sender = (e: Entry): string | null =>
  e.from_kind !== null && e.from_sid !== null ? `${e.from_kind}:${e.from_sid}` : null

const dataOf = (e: Entry): Record<string, unknown> =>
  e.data !== null && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {}

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null

function applyBoardEvent(holder: Holder, entry: Entry): void {
  const data = dataOf(entry)
  const paths = Array.isArray(data.paths)
    ? data.paths.filter((p): p is string => typeof p === "string")
    : []
  switch (entry.kind) {
    case "claim": {
      const note = textOrNull(data.note)
      holder.paths = holder.paths.filter((held) => !paths.includes(held.path))
      holder.paths.push(...paths.map((path) => ({ path, note, since: entry.ts })))
      holder.paused = null
      break
    }
    case "release":
      holder.paths =
        data.all === true ? [] : holder.paths.filter((held) => !paths.includes(held.path))
      break
    case "pause":
      holder.paused = { note: textOrNull(data.note), since: entry.ts }
      break
    case "resume":
      holder.paused = null
      break
  }
}

/** Who holds which paths on a board, in posting order, keeping only the sessions `live` accepts. */
export function holders(entries: Entry[], live: (who: string) => boolean): Holder[] {
  const byWho = new Map<string, Holder>()
  for (const entry of entries) {
    const who = sender(entry)
    if (who === null) continue
    const holder = byWho.get(who) ?? { who, name: null, paths: [], paused: null }
    holder.name = entry.from_name ?? holder.name
    applyBoardEvent(holder, entry)
    byWho.set(who, holder)
  }
  return [...byWho.values()].filter((h) => live(h.who) && (h.paths.length > 0 || h.paused !== null))
}

/** The paths of `paths` another holder already holds, with who holds them. */
export function conflicts(
  board: Holder[],
  me: string,
  paths: string[],
): { path: string; holder: Holder; held: Held }[] {
  const found: { path: string; holder: Holder; held: Held }[] = []
  for (const holder of board) {
    if (holder.who === me) continue
    for (const held of holder.paths)
      for (const path of paths) if (overlaps(path, held.path)) found.push({ path, holder, held })
  }
  return found
}

/** What a session last said it is doing, and when (epoch seconds); a cleared status has no text. */
export type Said = { text: string | null; at: number }

/** Each session's last status entry. */
export function latestStatuses(entries: Entry[]): Map<string, Said> {
  const latest = new Map<string, Said>()
  for (const entry of entries) {
    const who = sender(entry)
    if (who === null || entry.kind !== "status") continue
    latest.set(who, { text: textOrNull(entry.text), at: parseTime(entry.ts) ?? 0 })
  }
  return latest
}
