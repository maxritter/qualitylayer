import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { opencodeDatabase, piSessionDirectory } from "../agents/storage.ts"
import { indexedTranscript } from "./ledger.ts"
import { recordedPricing } from "./prices.ts"
import { type Call, type codexCalls, helperIdOf, scanBrief } from "./transcripts.ts"
import { providerBillingKind } from "./usage-billing.ts"

type Parsed = ReturnType<typeof codexCalls>
const SESSIONS = 4096

const piId = (name: string) => /_([0-9a-f-]{36})\.jsonl$/i.exec(name)?.[1] ?? null

async function piNames(ctx: Ctx, root: string): Promise<string[]> {
  return ctx.fs.readdir(root).catch(() => [])
}

/** Proven claims can locate their exact native IDs outside the checkout's directory. */
async function piRoots(ctx: Ctx, cwd: string, wanted: string[]): Promise<string[]> {
  const primary = piSessionDirectory(ctx, cwd)
  if (!primary) return []
  const roots = [primary]
  if (wanted.length === 0 || ctx.env.get("PI_CODING_AGENT_SESSION_DIR")) return roots
  const missing = new Set(wanted)
  const found = (names: string[]) => {
    let own = false
    for (const name of names) {
      const id = piId(name)
      if (id && missing.delete(id)) own = true
    }
    return own
  }
  found(await piNames(ctx, primary))
  const base = dirname(primary)
  const directories = await ctx.fs.entries(base).catch(() => [])
  for (const directory of directories) {
    if (missing.size === 0) break
    const path = join(base, directory.name)
    if (directory.kind !== "directory" || path === primary) continue
    if (found(await piNames(ctx, path))) roots.push(path)
  }
  return roots
}

export async function piSessions(
  ctx: Ctx,
  cwd: string,
  wanted: string[],
  claimed: string[] = [],
): Promise<Parsed[]> {
  const result = new Map<string, Parsed>()
  for (const root of await piRoots(ctx, cwd, claimed))
    for (const session of await piInDirectory(ctx, root, wanted))
      if (session.id && !result.has(session.id)) result.set(session.id, session)
  return [...result.values()]
}

async function piInDirectory(ctx: Ctx, root: string, wanted: string[]): Promise<Parsed[]> {
  let names: string[]
  try {
    const all = (await ctx.fs.readdir(root))
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .reverse()
    const selected = new Set(wanted)
    const chosen = (name: string) => selected.has(piId(name) ?? "")
    names = [...all.filter(chosen), ...all.filter((name) => !chosen(name)).slice(0, SESSIONS)]
  } catch {
    return []
  }
  const candidates: { file: string; id: string; parent?: string }[] = []
  const selected = new Set(wanted)
  for (const name of names) {
    const id = piId(name)
    if (!id) continue
    const file = join(root, name)
    if (selected.has(id)) {
      candidates.push({ file, id })
      continue
    }
    const header = ctx.fs.readRange
      ? await ctx.fs.readRange(file, 0, 8192)
      : (await ctx.fs.readFile(file)).slice(0, 8192)
    for (const line of header.split("\n")) {
      try {
        const row = JSON.parse(line)
        if (
          row.type === "custom" &&
          row.customType === "qualitylayer-helper" &&
          typeof row.data?.parentSession === "string"
        ) {
          candidates.push({ file, id, parent: row.data.parentSession })
          break
        }
      } catch {
        /* Partial header. */
      }
    }
  }
  let added = true
  while (added) {
    added = false
    for (const candidate of candidates)
      if (candidate.parent && selected.has(candidate.parent) && !selected.has(candidate.id)) {
        selected.add(candidate.id)
        added = true
      }
  }
  const result: Parsed[] = []
  for (const candidate of candidates)
    if (selected.has(candidate.id)) result.push(await indexedTranscript(ctx, candidate.file, "pi"))
  return result
}

type OpencodeSession = { id: string; parent: string | null; cwd: string }

/** A session with the sessions it started, at any depth; with `alone` just the session. */
function relatedSessions(db: Database, id: string, alone: boolean): OpencodeSession[] {
  if (alone)
    return db
      .query("SELECT id, parent_id AS parent, directory AS cwd FROM session_v2 WHERE id = ?")
      .all(id) as OpencodeSession[]
  return db
    .query(
      "WITH RECURSIVE related(id, parent, cwd) AS (SELECT id, parent_id, directory FROM session_v2 WHERE id = ? UNION SELECT s.id, s.parent_id, s.directory FROM session_v2 s JOIN related r ON s.parent_id = r.id) SELECT * FROM related LIMIT ?",
    )
    .all(id, SESSIONS) as OpencodeSession[]
}

/**
 * Native OpenCode messages contain final per-call usage; no CLI or background service is started.
 * The sessions the wanted ones started come with them, or with `only` just that one is read.
 */
export function opencodeSessions(
  ctx: Ctx,
  wanted: string[],
  only?: string,
): (Parsed & { complete: boolean })[] | null {
  const file = opencodeDatabase(ctx)
  if (!file || !existsSync(file)) return null
  let db: Database | undefined
  try {
    db = new Database(file, { readonly: true })
    const selected = new Set(wanted)
    const found = new Map<string, { id: string; parent: string | null; cwd: string }>()
    for (const id of wanted)
      for (const session of relatedSessions(db, id, only !== undefined)) {
        found.set(session.id, session)
        selected.add(session.id)
      }
    const sessions = [...found.values()]
    const result: (Parsed & { complete: boolean })[] = []
    const messages = db.query(
      "SELECT id, type, time_created AS at, data FROM session_message WHERE session_id = ? ORDER BY seq",
    )
    for (const session of sessions) {
      if (!selected.has(session.id) || (only !== undefined && session.id !== only)) continue
      const calls: Call[] = []
      let complete = true
      let prompt: string | null = null
      for (const row of messages.iterate(session.id) as Iterable<{
        id: string
        type: string
        at: number
        data: string
      }>) {
        let message: Record<string, unknown> & {
          time?: { completed?: number }
          model?: { id?: string; providerID?: string }
          tokens?: { input: number; output: number; cache?: { read?: number; write?: number } }
        }
        try {
          message = JSON.parse(row.data)
        } catch {
          continue
        }
        if (row.type === "user" && prompt === null && typeof message.text === "string")
          prompt = message.text
        if (row.type === "assistant" && !message.time?.completed) complete = false
        if (row.type !== "assistant" || !message.time?.completed || !message.tokens) continue
        const usage = message.tokens
        if (
          ![usage.input, usage.output, usage.cache?.read ?? 0, usage.cache?.write ?? 0].every(
            (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
          )
        )
          continue
        calls.push({
          id: row.id,
          at: row.at,
          model: message.model?.id ?? "unknown",
          billing: providerBillingKind(
            message.providerID ?? message.model?.providerID,
            message.model?.id ?? "unknown",
          ),
          pricing: recordedPricing(message),
          tokens: {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cache?.read ?? 0,
            cacheWrite5m: usage.cache?.write ?? 0,
            cacheWrite1h: 0,
          },
        })
      }
      result.push({
        ...session,
        prompt,
        calls,
        complete: complete && calls.length > 0,
        ownHelper: helperIdOf(prompt),
        brief: scanBrief(prompt || "", { prompt, commands: [] }),
      })
    }
    return result
  } catch {
    return null
  } finally {
    db?.close()
  }
}
