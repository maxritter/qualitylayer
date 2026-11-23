// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
import type { Board, BoardPart, BoardPartKey, BoardRow } from '../types'
import { PR_STALE_MS } from './atoms'
import { oneLine } from './palette'

/** The board's reads: one at a time, and the last background pull request read. */
export type BoardControl = { reading: boolean; prReading: boolean; prReadAt: number }

const isObj = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object'
const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const text = (value: unknown): string => (typeof value === 'string' ? oneLine(value) : '')
const stamp = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** One row as the board reports it, or null when it cannot be drawn. */
function rowFrom(raw: any): BoardRow | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null
  const prUrl = isObj(raw.pr) ? optStr(raw.pr.url) : null
  const pr = prUrl !== null ? { number: stamp(raw.pr.number), url: prUrl, readAt: stamp(raw.pr.readAt) ?? 0 } : null
  const prog = isObj(raw.progress) ? raw.progress : null
  const progress = prog !== null && stamp(prog.done) !== null && (stamp(prog.total) ?? 0) > 0
    ? { done: prog.done, total: prog.total }
    : null
  const cmd = optStr(raw.command)
  return {
    id: raw.id,
    title: text(raw.title),
    project: text(raw.project),
    words: text(raw.words),
    since: stamp(raw.since),
    link: optStr(raw.link),
    command: cmd || null,
    agent: optStr(raw.agent),
    pr,
    progress,
  }
}

/** The board from `status --json --board`, or null when the answer is not one. */
export function boardFrom(raw: any): Board | null {
  const value = raw?.board
  if (raw?.ok === false || !isObj(value)) return null
  const part = (one: any): BoardPart | null => {
    if (!isObj(one) || !Array.isArray(one.rows) || stamp(one.count) === null) return null
    const rows = one.rows.map(rowFrom).filter((row: BoardRow | null): row is BoardRow => row !== null)
    return { rows, count: Math.max(one.count, rows.length) }
  }
  const [needs, running, prs] = [part(value.needs), part(value.running), part(value.prs)]
  if (!needs || !running || !prs) return null
  return { needs, running, prs, home: optStr(value.home) }
}

const PARTS: BoardPartKey[] = ['needs', 'running', 'prs']
const boardRows = (now: Board): BoardRow[] => PARTS.flatMap(key => now[key].rows)

export const hasStalePr = (next: Board, now: number): boolean =>
  boardRows(next).some(row => row.pr !== null && now - row.pr.readAt >= PR_STALE_MS)

/** How long ago, in a few cells: "now", "12m", "3h", "2d". */
export const age = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}
