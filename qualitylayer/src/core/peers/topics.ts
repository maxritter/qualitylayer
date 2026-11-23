// Topics: pull-only, append-only logs any session on this machine can post to
// and read with a cursor. Nothing is delivered; entries are data from another
// session, never instructions.

import { createHash } from "node:crypto"
import {
  appendFileSync,
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import {
  asRecord,
  envNumber,
  nowIso,
  nowSeconds,
  PeerError,
  parseTime,
  readJson,
  topicsDir,
  writeJsonAtomic,
} from "./base.ts"
import { withLock } from "./lock.ts"

export const TOPIC_TAIL_DEFAULT = 20
export const TOPIC_TAIL_MAX = 1000
const TOPIC_MAX_CHARS = 256
const KIND_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: a topic is one printable line
const BAD_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/

export type Entry = {
  seq: number
  ts: string
  topic: string
  from_kind: string | null
  from_name: string | null
  from_sid: string | null
  kind: string | null
  text?: string | null
  data?: unknown
}

export function validateTopic(topic: unknown): string {
  if (typeof topic !== "string" || topic.trim() === "")
    throw new PeerError("a topic must be a non-empty string", 2)
  if (topic.length > TOPIC_MAX_CHARS)
    throw new PeerError(`a topic is at most ${TOPIC_MAX_CHARS} characters`, 2)
  if (BAD_CHARS_RE.test(topic))
    throw new PeerError("a topic must not contain control characters", 2)
  return topic
}

/** The file name is a digest, never the topic: no topic can name a path outside the folder. */
function paths(topic: string): { log: string; meta: string; lock: string } {
  const digest = createHash("sha256").update(topic, "utf8").digest("hex").slice(0, 40)
  const base = join(topicsDir(), digest)
  return { log: `${base}.jsonl`, meta: `${base}.meta.json`, lock: `${base}.lock` }
}

function positiveLimit(name: string, fallback: number, integer = true): number {
  const raw = envNumber(name, fallback)
  const value = integer ? Math.floor(raw) : raw
  return value > 0 ? value : fallback
}

function limits(): [number, number, number] {
  return [
    positiveLimit("QUALITYLAYER_PEERS_TOPIC_TTL_DAYS", 7, false),
    positiveLimit("QUALITYLAYER_PEERS_TOPIC_MAX_ENTRIES", 1000),
    positiveLimit("QUALITYLAYER_PEERS_TOPIC_MAX_BYTES", 16 * 1024 * 1024),
  ]
}

function readLines(logPath: string): [Entry, number][] {
  let text: string
  try {
    text = readFileSync(logPath, "utf8")
  } catch {
    return []
  }
  const out: [Entry, number][] = []
  for (const line of text.split("\n")) {
    if (line === "") continue
    try {
      const entry = asRecord(JSON.parse(line))
      if (entry !== null && Number.isInteger(entry.seq))
        out.push([entry as Entry, Buffer.byteLength(`${line}\n`)])
    } catch {
      // a torn or foreign line
    }
  }
  return out
}

function writeLog(logPath: string, entries: Entry[]): void {
  const tmp = `${logPath}.tmp.${process.pid}`
  writeFileSync(tmp, entries.map((e) => `${JSON.stringify(e)}\n`).join(""), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, logPath)
}

/** Retained entries after pruning, and the next seq. Call under the lock. */
function state(logPath: string, metaPath: string, now: number): [Entry[], number] {
  const [ttlDays, maxEntries, maxBytes] = limits()
  const lines = readLines(logPath)
  const meta = asRecord(readJson(metaPath, {})) ?? {}
  let nextSeq = Number.isInteger(meta.next_seq) ? (meta.next_seq as number) : 1
  const last = lines[lines.length - 1]
  if (last !== undefined) nextSeq = Math.max(nextSeq, last[0].seq + 1)
  const cutoff = now - ttlDays * 86_400
  let kept = lines.filter(([entry]) => (parseTime(entry.ts) ?? 0) >= cutoff).slice(-maxEntries)
  let total = kept.reduce((sum, [, size]) => sum + size, 0)
  while (kept.length > 0 && total > maxBytes) {
    total -= kept[0]?.[1] ?? 0
    kept = kept.slice(1)
  }
  if (kept.length !== lines.length)
    writeLog(
      logPath,
      kept.map(([e]) => e),
    )
  return [kept.map(([e]) => e), nextSeq]
}

export type Identity = { kind?: string | null; name?: string | null; uuid?: string | null }

/** Append one entry; seq is unique and monotonic per topic. */
export function topicPost(
  topic: string,
  from: Identity,
  kind: string | null,
  body: { text: string } | { data: unknown },
): Entry {
  validateTopic(topic)
  if (kind !== null && !KIND_RE.test(kind)) {
    throw new PeerError(
      "--kind must be 1-64 characters of letters, digits, '.', '_', ':' or '-', starting with a letter or digit",
      2,
    )
  }
  const p = paths(topic)
  return withLock(p.lock, () => {
    const [, nextSeq] = state(p.log, p.meta, nowSeconds())
    const entry: Entry = {
      seq: nextSeq,
      ts: nowIso(),
      topic,
      from_kind: from.kind ?? null,
      from_name: from.name ?? null,
      from_sid: from.uuid ?? null,
      kind,
      ...("data" in body ? { data: body.data } : { text: body.text }),
    }
    appendFileSync(p.log, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    chmodSync(p.log, 0o600)
    writeJsonAtomic(p.meta, { topic, next_seq: nextSeq + 1, last_ts: entry.ts })
    return entry
  })
}

export type Tail = {
  topic: string
  entries: Entry[]
  next: number
  gap: { from: number; to: number } | null
}

/** Entries after `since` in order, or the last `limit` when since is null; `gap` names pruned seqs skipped. */
export function topicTail(topic: string, since: number | null, limit = TOPIC_TAIL_DEFAULT): Tail {
  validateTopic(topic)
  const p = paths(topic)
  if (!existsSync(p.meta) && !existsSync(p.log))
    return { topic, entries: [], next: since ?? 0, gap: null }
  const [entries, nextSeq] = withLock(p.lock, () => state(p.log, p.meta, nowSeconds()))
  const lastSeq = nextSeq - 1
  let gap: Tail["gap"] = null
  let chosen: Entry[]
  if (since === null) chosen = entries.slice(-limit)
  else {
    const oldest = entries[0]?.seq ?? nextSeq
    if (since + 1 < oldest && since < lastSeq) gap = { from: since + 1, to: oldest - 1 }
    chosen = entries.filter((e) => e.seq > since).slice(0, limit)
  }
  const last = chosen[chosen.length - 1]
  const fallbackNext = since === null ? lastSeq : Math.max(since, gap?.to ?? since)
  return { topic, entries: chosen, next: last?.seq ?? fallbackNext, gap }
}

export function topicList(): { topic: string; last_seq: number | null; last_ts: string | null }[] {
  let names: string[]
  try {
    names = readdirSync(topicsDir()).sort()
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith(".meta.json")) continue
    const meta = asRecord(readJson(join(topicsDir(), name), null))
    if (meta === null || typeof meta.topic !== "string") continue
    out.push({
      topic: meta.topic,
      last_seq: Number.isInteger(meta.next_seq) ? (meta.next_seq as number) - 1 : null,
      last_ts: typeof meta.last_ts === "string" ? meta.last_ts : null,
    })
  }
  return out.sort((a, b) => a.topic.localeCompare(b.topic))
}

/** Apply retention to every topic, including ones nobody posts to or reads. */
export function topicPruneAll(): void {
  for (const item of topicList()) {
    const p = paths(item.topic)
    withLock(p.lock, () => state(p.log, p.meta, nowSeconds()))
  }
}

/** Control characters other than newline and tab, escaped for a terminal. */
export function printable(text: string): string {
  return text.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: escapes control characters for a terminal
    /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
    (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  )
}
