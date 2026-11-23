import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { committedSource, type OwnedPart, type PartSource } from "./workflow-parts.ts"
import { WORKING_COMPARE_STEPS } from "./working-limits.ts"
import { digest } from "./working-records.ts"

/**
 * What one request has already read of the committed sources, so its second pass over the same
 * inventory (the check that the file did not change while it was read) asks Git for nothing twice.
 * An entry is kept for the byte allowance it was read with: the same source with another allowance
 * is read again, so a pass that differs from the first reads exactly what it would have read alone.
 */
export type SourceReads = Map<string, { bytes: number; hash: string }>
type Budget = { left: number; steps?: number; reads?: SourceReads }
type Coverage = { covered: Set<string>; withheld: Set<string>; associated: Map<string, string> }

const COMMITTED_READS_KEPT = 20_000
const committedReads = new Map<string, { bytes: number; hash: string; fits: number }>()
const ancestries = new Map<string, boolean>()

async function sourceHash(ctx: Ctx, task: Task, source: PartSource | null, budget: Budget) {
  if (source === null) return null
  if (source.kind === "working") return source.hash
  if (budget.left <= 0) return undefined
  const key = `${source.mode}\0${source.hash}\0${source.path}\0${budget.left}`
  // A committed blob never changes: what it reads as is kept for the process, so a page that is
  // read again starts no git process for it. git refuses a blob whose stored size is over the
  // budget left; `fits` is the smallest budget it was read under, so a kept read is used only
  // where git is known to have let it through, and a smaller budget asks git again as before.
  // (Kept for the process: a filter taken away meanwhile, as `git-crypt lock` does, is not seen.)
  const blob = `${task.repoRoot}\0${source.mode}\0${source.hash}\0${source.path}`
  const known = committedReads.get(blob)
  let read: { bytes: number; hash: string } | undefined =
    budget.reads?.get(key) ?? (known && known.fits <= budget.left ? known : undefined)
  if (read === undefined) {
    const text = await committedSource(ctx, task, source, budget.left)
    read = { bytes: Buffer.byteLength(text), hash: digest(text) }
    budget.reads?.set(key, read)
    if (committedReads.size >= COMMITTED_READS_KEPT)
      committedReads.delete(committedReads.keys().next().value as string)
    committedReads.set(blob, { ...read, fits: Math.min(budget.left, known?.fits ?? budget.left) })
  }
  budget.left -= read.bytes
  return budget.left < 0 ? undefined : read.hash
}

/** Only contiguous exact versions form a chain; intervening unexplained source breaks it. */
function chainEndingAt(
  candidates: OwnedPart[],
  start: number,
  after: string | null,
  budget: Budget,
): OwnedPart[] {
  const chain: OwnedPart[] = []
  let current = candidates[start]?.before?.hash ?? null
  for (const row of candidates.slice(start)) {
    budget.steps = (budget.steps ?? WORKING_COMPARE_STEPS) - 1
    if (budget.steps < 0) throw new Error("Saved change comparison limit reached")
    if ((row.before?.hash ?? null) !== current) break
    chain.push(row)
    current = row.after?.hash ?? null
    if (current === after) return chain
  }
  return []
}

async function precedesCommit(
  ctx: Ctx,
  task: Task,
  first: OwnedPart,
  commit: OwnedPart,
): Promise<boolean> {
  if (!first.head || !commit.commit) return true
  if (first.head === commit.commit) return false
  // Whether one commit comes before another never changes: asked of git once.
  const pair = `${task.repoRoot}\0${first.head}\0${commit.commit}`
  const known = ancestries.get(pair)
  if (known !== undefined) return known
  const ancestry = await ctx.git.run(task.repoRoot, [
    "merge-base",
    "--is-ancestor",
    first.head,
    commit.commit,
  ])
  if (ancestry.code > 1) throw new Error("The saved edit's history is unavailable")
  if (ancestries.size >= COMMITTED_READS_KEPT)
    ancestries.delete(ancestries.keys().next().value as string)
  ancestries.set(pair, ancestry.code === 0)
  return ancestry.code === 0
}

function recordChain(
  result: Coverage,
  commit: OwnedPart,
  chain: OwnedPart[],
  before: string | null,
) {
  if ((chain[0]?.before?.hash ?? null) === before) {
    for (const row of chain) result.covered.add(row.view.stamp)
    return
  }
  // A matching end with a different preimage proves that the whole commit includes unexplained work.
  result.withheld.add(commit.view.stamp)
  if (!chain[0]?.head || !commit.commit) return
  for (const row of chain) result.associated.set(row.view.stamp, commit.commit)
}

type CompareContext = { ctx: Ctx; task: Task; budget: Budget }

async function compareCommit(
  c: CompareContext,
  part: OwnedPart,
  candidates: OwnedPart[],
  result: Coverage,
) {
  const before = await sourceHash(c.ctx, c.task, part.before, c.budget)
  const after = await sourceHash(c.ctx, c.task, part.after, c.budget)
  if (before === undefined || after === undefined) {
    result.withheld.add(part.view.stamp)
    return
  }
  const exact = candidates.flatMap((row, index) =>
    (row.before?.hash ?? null) === before ? [index] : [],
  )
  const matched = await matchingChain(c, part, candidates, exact, after)
  if (matched) {
    recordChain(result, part, matched, before)
    return
  }
  const fallback = await matchingChain(
    c,
    part,
    candidates,
    candidates.map((_, index) => index),
    after,
  )
  if (fallback) recordChain(result, part, fallback, before)
}

async function matchingChain(
  c: CompareContext,
  commit: OwnedPart,
  candidates: OwnedPart[],
  starts: number[],
  after: string | null,
): Promise<OwnedPart[] | null> {
  for (const start of starts) {
    const chain = chainEndingAt(candidates, start, after, c.budget)
    const first = chain[0]
    if (first && (await precedesCommit(c.ctx, c.task, first, commit))) return chain
  }
  return null
}

/** Native evidence refines receipts; a budget/error never promotes a contradictory whole-file patch. */
export async function nativeCoverage(
  ctx: Ctx,
  task: Task,
  committed: OwnedPart[],
  working: OwnedPart[],
  budget: Budget,
): Promise<Coverage> {
  const result: Coverage = { covered: new Set(), withheld: new Set(), associated: new Map() }
  const c: CompareContext = { ctx, task, budget }
  for (const part of committed) {
    const candidates = working.filter((row) => row.view.path === part.view.path)
    if (!candidates.length) continue
    try {
      await compareCommit(c, part, candidates, result)
    } catch {
      result.withheld.add(part.view.stamp)
    }
  }
  return result
}
