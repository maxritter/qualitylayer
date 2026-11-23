// What a task's commit receipts (`slice-commits.json`, a flat list of hashes) cannot say by
// themselves: which slice a commit was registered for, and whether two entries hold the same work.
// A slice whose commit was reworded and registered again must replace its entry, never sit beside it.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"

const OWNERS = "slice-commit-owners.json"
const full = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
type Runtime = Pick<Task, "runtimeDir" | "repoRoot">

/** The slices each recorded commit was registered for, by full hash; empty when none is recorded. */
export async function readCommitOwners(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<Record<string, number[]>> {
  try {
    const parsed: unknown = JSON.parse(await ctx.fs.readFile(join(task.runtimeDir, OWNERS)))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const owners: Record<string, number[]> = {}
    for (const [sha, slices] of Object.entries(parsed)) {
      if (
        full.test(sha) &&
        Array.isArray(slices) &&
        slices.every((n) => Number.isSafeInteger(n) && n > 0)
      )
        owners[sha] = slices
    }
    return owners
  } catch {
    return {}
  }
}

export async function writeCommitOwners(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  owners: Record<string, number[]>,
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(join(task.runtimeDir, OWNERS), `${JSON.stringify(owners)}\n`)
}

/**
 * What a commit changes, as the files it touches and the content each ends with: the same for two
 * commits that differ only in their message, parent or date. Null for a commit that changes nothing
 * or cannot be read, which is never taken for a duplicate of another.
 */
export async function commitContent(
  ctx: Ctx,
  task: Pick<Task, "repoRoot">,
  sha: string,
): Promise<string | null> {
  const result = await ctx.git.run(task.repoRoot, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--no-renames",
    "-r",
    "-z",
    "--raw",
    "--abbrev=64",
    sha,
  ])
  if (result.code !== 0 || result.stdout === "" || result.stdout.length > 2 * 1024 * 1024)
    return null
  const fields = result.stdout.split("\0")
  const rows: string[] = []
  // ":mode mode oldsha newsha status" then the path, as separate NUL fields.
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = (fields[i] ?? "").split(" ")
    if (meta.length < 5) return null
    rows.push(`${meta[1]} ${meta[3]} ${fields[i + 1]}`)
  }
  return rows.length > 0 ? rows.sort().join("\n") : null
}

export type ReceiptDuplicate = {
  /** The entry that goes: a copy of work another entry already holds. */
  drop: string
  keep: string
  /** Why this one is the copy. */
  reason: "off-history" | "earlier-registration"
}

async function groupCommitsByContent(
  ctx: Ctx,
  task: Runtime,
  commits: string[],
): Promise<Map<string, string[]>> {
  const byContent = new Map<string, string[]>()
  for (const sha of commits.slice(0, 512)) {
    const content = await commitContent(ctx, task, sha)
    if (content === null) continue
    byContent.set(content, [...(byContent.get(content) ?? []), sha])
  }
  return byContent
}

async function classifyDuplicateGroup(
  group: string[],
  onHead: (sha: string) => Promise<boolean>,
  duplicates: ReceiptDuplicate[],
  ambiguous: [string, string][],
): Promise<void> {
  const dropped = new Set<string>()
  // Within one group, walk the entries in the order they were registered.
  for (let i = 1; i < group.length; i++) {
    const later = group[i] as string
    const earlier = group.slice(0, i).find((sha) => !dropped.has(sha))
    if (earlier === undefined) continue
    const [earlierCurrent, laterCurrent] = [await onHead(earlier), await onHead(later)]
    if (earlierCurrent && laterCurrent) {
      ambiguous.push([earlier, later])
      continue
    }
    const drop = earlierCurrent ? later : earlier
    const keep = earlierCurrent ? earlier : later
    const reason = earlierCurrent || laterCurrent ? "off-history" : "earlier-registration"
    duplicates.push({ drop, keep, reason })
    dropped.add(drop)
  }
}

/** Entries that hold the same work twice, and which one of each pair is the leftover. */
export async function duplicateReceipts(
  ctx: Ctx,
  task: Runtime,
  commits: string[],
): Promise<{ duplicates: ReceiptDuplicate[]; ambiguous: [string, string][] }> {
  const head = await ctx.git.run(task.repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"])
  const current = new Map<string, boolean>()
  const onHead = async (sha: string) => {
    let known = current.get(sha)
    if (known === undefined) {
      const result = await ctx.git.run(task.repoRoot, [
        "merge-base",
        "--is-ancestor",
        sha,
        head.stdout.trim(),
      ])
      known = head.code === 0 && result.code === 0
      current.set(sha, known)
    }
    return known
  }
  const byContent = await groupCommitsByContent(ctx, task, commits)
  const duplicates: ReceiptDuplicate[] = []
  const ambiguous: [string, string][] = []
  for (const group of byContent.values()) {
    if (group.length >= 2) await classifyDuplicateGroup(group, onHead, duplicates, ambiguous)
  }
  return { duplicates, ambiguous }
}

/** The sentence `doctor` and a refused judge admission share. */
export function duplicateReceiptsText(duplicates: ReceiptDuplicate[], repaired: boolean): string {
  const short = (sha: string) => sha.slice(0, 9)
  const pairs = duplicates
    .map(
      (d) =>
        `${short(d.drop)} repeats ${short(d.keep)} (${d.reason === "off-history" ? "it is no longer on this branch" : "the earlier registration"})`,
    )
    .join("; ")
  return repaired
    ? `Removed ${duplicates.length} commit receipt${duplicates.length === 1 ? "" : "s"} that repeated work another receipt holds: ${pairs}. No commit was changed.`
    : `The task's commit receipts hold the same work twice: ${pairs}. Run \`qualitylayer doctor --repair\` to remove the repeat${duplicates.length === 1 ? "" : "s"}; no commit is changed.`
}
