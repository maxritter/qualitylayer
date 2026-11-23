import { dirname, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { piSessionDirectory } from "../agents/storage.ts"
import { indexedTranscript } from "./ledger.ts"
import { opencodeSessions } from "./native-opencode.ts"
import type { codexCalls } from "./transcripts.ts"

export { opencodeSessions }

type Parsed = ReturnType<typeof codexCalls>
const SESSIONS = 4096

const piId = (name: string) => /_([0-9a-f-]{36})\.jsonl$/i.exec(name)?.[1] ?? null

async function piNames(ctx: Ctx, root: string): Promise<string[]> {
  return ctx.fs.readdir(root).catch(() => [])
}

function consumeMatchingIds(names: readonly string[], missing: Set<string>): boolean {
  let matched = false
  for (const name of names) {
    const id = piId(name)
    if (id && missing.delete(id)) matched = true
  }
  return matched
}

/** Proven claims can locate their exact native IDs outside the checkout's directory. */
async function piRoots(ctx: Ctx, cwd: string, wanted: string[]): Promise<string[]> {
  const primary = piSessionDirectory(ctx, cwd)
  if (!primary) return []
  const roots = [primary]
  if (wanted.length === 0 || ctx.env.get("PI_CODING_AGENT_SESSION_DIR")) return roots
  const missing = new Set(wanted)
  consumeMatchingIds(await piNames(ctx, primary), missing)
  const base = dirname(primary)
  const directories = await ctx.fs.entries(base).catch(() => [])
  for (const directory of directories) {
    if (missing.size === 0) break
    const path = join(base, directory.name)
    if (directory.kind !== "directory" || path === primary) continue
    if (consumeMatchingIds(await piNames(ctx, path), missing)) roots.push(path)
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

type PiCandidate = { file: string; id: string; parent?: string }

async function readPiHelperParent(ctx: Ctx, file: string): Promise<string | null> {
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
      )
        return row.data.parentSession
    } catch {
      /* Partial header. */
    }
  }
  return null
}

function expandSelectedPiIds(candidates: readonly PiCandidate[], selected: Set<string>): void {
  let added = true
  while (added) {
    added = false
    for (const candidate of candidates) {
      if (candidate.parent && selected.has(candidate.parent) && !selected.has(candidate.id)) {
        selected.add(candidate.id)
        added = true
      }
    }
  }
}

async function listPiSessionFiles(
  ctx: Ctx,
  root: string,
  selected: Set<string>,
): Promise<string[]> {
  try {
    const all = (await ctx.fs.readdir(root))
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .reverse()
    const chosen = (name: string) => selected.has(piId(name) ?? "")
    return [...all.filter(chosen), ...all.filter((name) => !chosen(name)).slice(0, SESSIONS)]
  } catch {
    return []
  }
}

async function piInDirectory(ctx: Ctx, root: string, wanted: string[]): Promise<Parsed[]> {
  const selected = new Set(wanted)
  const names = await listPiSessionFiles(ctx, root, selected)
  if (names.length === 0) return []
  const candidates: PiCandidate[] = []
  for (const name of names) {
    const id = piId(name)
    if (!id) continue
    const file = join(root, name)
    if (selected.has(id)) {
      candidates.push({ file, id })
      continue
    }
    const parent = await readPiHelperParent(ctx, file)
    if (parent !== null) candidates.push({ file, id, parent })
  }
  expandSelectedPiIds(candidates, selected)
  const result: Parsed[] = []
  for (const candidate of candidates)
    if (selected.has(candidate.id)) result.push(await indexedTranscript(ctx, candidate.file, "pi"))
  return result
}
