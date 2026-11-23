import { join } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import { claimTime, ForeignMatcher, type ForeignWitness } from "./foreign-matcher.ts"
import { editsDir, KEEP_MS, readEdits, type SessionEdits } from "./records.ts"

/**
 * Exact current bytes last observed in another task, with no later or ambiguous own edit.
 * When `lasting` is true (a standing pass), bytes that are still exactly the other task's stay its,
 * however old.
 */
export async function matchingForeignEdits(
  ctx: Ctx,
  repo: { id: string; root: string },
  task: string,
  paths: string[],
  lasting = false,
): Promise<Record<string, ForeignWitness>> {
  return new ForeignMatcher(ctx, repo, task, lasting).match(paths)
}

async function lastCommitTime(
  ctx: Ctx,
  root: string,
  path: string,
  cache: Map<string, number>,
): Promise<number> {
  const known = cache.get(path)
  if (known !== undefined) return known
  const log = await ctx.git.run(root, ["log", "-1", "--format=%ct", "--", path])
  const at = log.code === 0 ? Number(log.stdout.trim() || 0) * 1000 : 0
  cache.set(path, at)
  return at
}

async function collectForeignPaths(
  ctx: Ctx,
  root: string,
  edits: SessionEdits,
  state: {
    paths: string[]
    now: number
    lasting: boolean
    committedAt: Map<string, number>
    found: Record<string, string>
  },
): Promise<void> {
  for (const path of state.paths) {
    const at = claimTime(edits, path, state.now)
    if (at === null || state.found[path] !== undefined) continue
    if (!state.lasting && state.now - at >= KEEP_MS) continue
    if (at > (await lastCommitTime(ctx, root, path, state.committedAt)))
      state.found[path] = edits.task
  }
}

/**
 * Of `paths`, those a session building another task changed after the file's latest commit: its
 * edits are likely still uncommitted in the shared checkout. Each maps to that task's slug.
 * When `lasting` is true (a standing pass), an edit still uncommitted stays the other task's,
 * however old.
 */
export async function foreignEdits(
  ctx: Ctx,
  repo: { id: string; root: string },
  task: string,
  paths: string[],
  lasting = false,
): Promise<Record<string, string>> {
  const found: Record<string, string> = {}
  const names = await ctx.fs.readdir(editsDir(ctx, repo.id)).catch(() => null)
  if (names !== null) {
    const state = { paths, now: ctx.clock.now(), lasting, committedAt: new Map(), found }
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      const edits = await readEdits(ctx, join(editsDir(ctx, repo.id), name))
      if (edits !== null && edits.task !== task)
        await collectForeignPaths(ctx, repo.root, edits, state)
    }
  }
  return found
}

/**
 * Of `paths` (changed and uncommitted in the checkout), those that are positively another task's.
 * Where the other task's record holds the bytes it left (`contents`), the file must still hold
 * exactly those, with no later edit of this task's own; a record without them (a deleted file, a
 * file too large to witness) keeps its path-and-time claim, unless a session of this task edited
 * the file at that time or later: an older claim never makes this task's newer edit another's.
 * For a standing pass (`lasting`) a claim does not expire with the three days the records are
 * otherwise read for, and `ownAt` adds the task's own edits its pass keeps (they outlive the
 * sessions' records).
 */
class LooseClaims {
  private readonly ours: Map<string, number>
  private readonly theirs = new Map<string, number>()
  private readonly witnessed = new Set<string>()
  private readonly invalid = new Set<string>()
  private readonly ambiguous = new Set<string>()
  private readonly latest = new Map<string, { task: string; at: number }>()

  constructor(
    private readonly task: string,
    private readonly now: number,
    ownAt?: Map<string, number>,
  ) {
    this.ours = new Map(ownAt ?? [])
  }

  observe(row: SessionEdits, path: string): void {
    if (!Object.hasOwn(row.files, path)) return
    const at = claimTime(row, path, this.now)
    if (at === null) {
      this.invalid.add(path)
      return
    }
    const owner = this.latest.get(path)
    if (owner === undefined || at > owner.at) {
      this.latest.set(path, { task: row.task, at })
      this.ambiguous.delete(path)
    } else if (at === owner.at && row.task !== owner.task) this.ambiguous.add(path)
    const times = row.task === this.task ? this.ours : this.theirs
    if (at > (times.get(path) ?? -1)) times.set(path, at)
    if (row.task !== this.task && typeof row.contents?.[path] === "string") this.witnessed.add(path)
  }

  foreign(path: string, exact: boolean): boolean {
    if (this.invalid.has(path) || this.ambiguous.has(path)) return false
    if (exact) return true
    const own = this.ours.get(path)
    const ownLater = own !== undefined && own >= (this.theirs.get(path) ?? 0)
    return !this.witnessed.has(path) && !ownLater
  }
}

export async function foreignLooseEdits(
  ctx: Ctx,
  repo: { id: string; root: string },
  task: string,
  paths: string[],
  standing: { lasting?: boolean; ownAt?: Map<string, number> } = {},
): Promise<string[]> {
  if (paths.length === 0) return []
  const claimed = await foreignEdits(ctx, repo, task, paths, standing.lasting === true)
  const candidates = paths.filter((path) => claimed[path] !== undefined)
  if (candidates.length === 0) return []
  // The bytes are matched a bounded group at a time (`matchingForeignEdits` reads at most 32 files
  // and four megabytes a call). A shared checkout holds more changed files than that: asked for
  // all at once, none was matched, and no file counted as another task's.
  const exact: Record<string, { task: string; digest: string }> = Object.create(null)
  for (let from = 0; from < Math.min(candidates.length, 512); from += 32)
    Object.assign(
      exact,
      await matchingForeignEdits(
        ctx,
        repo,
        task,
        candidates.slice(from, from + 32),
        standing.lasting === true,
      ),
    )
  let names: string[] = []
  try {
    names = await ctx.fs.readdir(editsDir(ctx, repo.id))
  } catch {
    return []
  }
  // The latest edit of each file by this task's sessions, and by the others'.
  const claims = new LooseClaims(task, ctx.clock.now(), standing.ownAt)
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const edits = await readEdits(ctx, join(editsDir(ctx, repo.id), name))
    if (edits === null) continue
    for (const path of candidates) claims.observe(edits, path)
  }
  return candidates.filter((path) => claims.foreign(path, exact[path] !== undefined))
}
