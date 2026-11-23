// The sessions a person's agents already have in one project folder, for New chat's "Or resume a
// session": the agent, the first prompt, how many messages and when it was last written. Only Claude
// Code and Codex are read here (their records hold the prompt and the messages as plain lines, and
// both resume a session by id); an agent whose records cannot be read is left out. Reading only,
// bounded like the project history: the age window, the newest entries, a byte cap per record, a deadline.

import { realpath } from "node:fs/promises"
import { isAbsolute, join, normalize, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { roots } from "../install/agent-settings.ts"
import { rolloutId } from "./codex-rollout.ts"
import { codexDays, dayRollouts } from "./history-records.ts"
import {
  describeSessionEntry,
  SESSION_LIMITS,
  type SessionEntry,
  type SessionRequest,
} from "./history-sessions-parse.ts"
import { cwdInHead, type Limits, newest, STORE_LIMITS } from "./history-stores.ts"
import type { NativeAgent } from "./ids.ts"

export { SESSION_LIMITS }

export type HistoryAgent = Extract<NativeAgent, "claude-code" | "codex">

export type HistorySession = {
  /** The id the agent resumes the session by. */
  id: string
  agent: HistoryAgent
  /** The folder the session ran in: the project's folder or one inside it. */
  cwd: string
  /** The first prompt, one line. */
  title: string
  /** The prompts and replies in the record. */
  messages: number
  /** The record was longer than the read cap; `messages` counts what was read. */
  approximate?: true
  /** When the record was last written, in ms. */
  at: number
}

const DAY = 86_400_000
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

type Options = {
  now?: number
  /** Sessions to leave out: the ones that already are a QualityLayer task. */
  exclude?: (id: string, agent: HistoryAgent) => boolean
  limit?: number
  readCap?: number
  /** Bytes one request may read in all (default `SESSION_LIMITS.budget`). */
  budget?: number
  /** Told how many bytes each record read took. */
  onRead?: (bytes: number) => void
  deadlineMs?: number
}

const inside = (path: string, folder: string) =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)
const slugOf = (folder: string) => folder.replace(/[^a-zA-Z0-9]/g, "-")

/** The folder as given and with links resolved: agents record either. */
async function folderNames(folder: string): Promise<string[]> {
  const given = normalize(folder)
  const real = await realpath(given).catch(() => given)
  return [...new Set([given, real])]
}

async function claudeEntries(
  base: string,
  names: string[],
  limits: Limits,
): Promise<SessionEntry[]> {
  const projects = join(base, "projects")
  const slugs = names.map(slugOf)
  // The newest project folders of this one's name (itself and the folders inside it), not the first by name.
  const folders = await newest(
    projects,
    SESSION_LIMITS.claudeFolders,
    (dir, directory) =>
      directory && slugs.some((slug) => dir === slug || dir.startsWith(`${slug}-`)),
    limits,
  )
  const found: SessionEntry[] = []
  for (const folder of folders) {
    const files = await newest(
      folder.path,
      STORE_LIMITS.sessionsPerFolder,
      (name, directory) => !directory && name.endsWith(".jsonl"),
      limits,
    )
    for (const file of files) {
      if (limits.expired()) return found
      if (file.at < limits.cutoff) continue
      const cwd = await cwdInHead(file.path)
      if (cwd !== null && isAbsolute(cwd) && names.some((name) => inside(normalize(cwd), name)))
        found.push({
          agent: "claude-code",
          id: file.path.slice(file.path.lastIndexOf(sep) + 1, -".jsonl".length),
          cwd: normalize(cwd),
          at: file.at,
          file: file.path,
        })
    }
  }
  return found
}

async function codexEntries(
  base: string,
  names: string[],
  limits: Limits,
): Promise<SessionEntry[]> {
  const found: SessionEntry[] = []
  let read = 0
  for await (const day of codexDays(join(base, "sessions"), limits)) {
    if (limits.expired() || read >= STORE_LIMITS.sessionsPerAgent) break
    for (const file of await dayRollouts(day, limits)) {
      if (limits.expired() || file.at < limits.cutoff) continue
      read++
      const cwd = await cwdInHead(file.path)
      const id = rolloutId(file.path)
      if (
        id !== undefined &&
        cwd !== null &&
        isAbsolute(cwd) &&
        names.some((name) => inside(normalize(cwd), name))
      )
        found.push({ agent: "codex", id, cwd: normalize(cwd), at: file.at, file: file.path })
    }
  }
  return found
}

function requestFor(ctx: Ctx, options: Options): SessionRequest {
  const started = Date.now()
  const deadline = options.deadlineMs ?? SESSION_LIMITS.deadlineMs
  return {
    limits: {
      cutoff: (options.now ?? ctx.clock.now()) - SESSION_LIMITS.windowDays * DAY,
      expired: () => Date.now() - started >= deadline,
    },
    budget: { left: options.budget ?? SESSION_LIMITS.budget },
    cap: options.readCap ?? SESSION_LIMITS.readCap,
    ...(options.onRead ? { onRead: options.onRead } : {}),
  }
}

async function entriesIn(
  ctx: Ctx,
  folder: string,
  options: Options,
  { limits }: SessionRequest,
): Promise<SessionEntry[]> {
  const stores = roots(ctx)
  if (stores === null) return []
  const names = await folderNames(folder)
  const [claude, codex] = await Promise.all([
    claudeEntries(stores.claude, names, limits).catch(() => []),
    codexEntries(stores.codex, names, limits).catch(() => []),
  ])
  return [...claude, ...codex]
    .filter((entry) => !options.exclude?.(entry.id, entry.agent))
    .sort((a, b) => b.at - a.at)
}

/**
 * The sessions in a project folder (or in a folder inside it), newest first: the newest `limit` are
 * described, and `total` counts every session found. A session with no prompt of the person's is
 * left out.
 */
export async function listFolderSessions(
  ctx: Ctx,
  folder: string,
  options: Options = {},
): Promise<{ total: number; sessions: HistorySession[] }> {
  const request = requestFor(ctx, options)
  const entries = await entriesIn(ctx, folder, options, request)
  const limit = options.limit ?? SESSION_LIMITS.described
  const sessions: HistorySession[] = []
  let left = 0
  for (const [index, entry] of entries.entries()) {
    // The limit or the deadline ends the reading; what is not read yet is counted, not described.
    if (sessions.length >= limit || request.limits.expired()) {
      left = entries.length - index
      break
    }
    const session = await describeSessionEntry(entry, request)
    if (session !== null) sessions.push(session)
  }
  return { total: sessions.length + left, sessions }
}

/** One listed session again, by agent and id, read from the record (never from what a client sent). */
export async function findFolderSession(
  ctx: Ctx,
  folder: string,
  agent: string,
  id: string,
  options: Options = {},
): Promise<HistorySession | null> {
  if (!SESSION_ID.test(id) || (agent !== "claude-code" && agent !== "codex")) return null
  const request = requestFor(ctx, options)
  const entry = (await entriesIn(ctx, folder, options, request)).find(
    (one) => one.agent === agent && one.id === id,
  )
  return entry ? describeSessionEntry(entry, request) : null
}
