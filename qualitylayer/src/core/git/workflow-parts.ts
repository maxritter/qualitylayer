import type { Ctx } from "../../ctx.ts"
import type { ChangePart } from "../review/walkthrough.ts"
import type { Task } from "../task/store.ts"
import { taskCommitDiff } from "./task-diff.ts"
import type { VerifyRange } from "./verify-range.ts"
import { commitParts, type RawFile } from "./workflow-parts-git.ts"
import type { WorkingOperation } from "./working-records.ts"
import { digest, workingTaskKey } from "./working-records.ts"

export type PartSource =
  | { kind: "git"; hash: string; path: string; mode: string }
  | { kind: "working"; hash: string }

export type OwnedPart = {
  commit?: string
  base?: string
  head?: string
  unavailable?: true
  native?: { id: string; operation: WorkingOperation }
  view: ChangePart
  patch: string
  before: PartSource | null
  after: PartSource | null
}

const MAX_PATCH_BYTES = 8 * 1024 * 1024
const cached = new Map<string, { parts: OwnedPart[]; commits: string[]; bytes: number }>()

export const patchCounts = (patch: string) => {
  let hunk = false,
    additions = 0,
    deletions = 0
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git")) hunk = false
    else if (line.startsWith("@@")) hunk = true
    else if (hunk && line.startsWith("+")) additions++
    else if (hunk && line.startsWith("-")) deletions++
  }
  return { additions, deletions }
}

export function buildOwnedPart(
  task: Task,
  commit: string,
  file: RawFile,
  rawText: string,
  options: { metadata: boolean; base?: string },
): OwnedPart {
  let text = options.metadata ? "" : rawText
  if (text.includes("\0")) text = `${text.split("\n")[0]}\nBinary files differ\n`
  const stamp = digest(
    JSON.stringify([
      workingTaskKey(task),
      ...(options.base ? [options.base] : []),
      commit,
      file.path,
      file.from,
      file.before,
      file.after,
    ]),
  )
  return {
    commit,
    ...(options.base ? { base: options.base } : {}),
    view: {
      id: stamp,
      stamp,
      path: file.path,
      ...(file.from ? { from: file.from } : {}),
      status: file.status,
      ...(options.metadata ? { additions: null, deletions: null } : patchCounts(text)),
      kind: "commit",
      label: commit.slice(0, 8),
    },
    patch: text,
    before: file.before,
    after: file.after,
  }
}

function remember(key: string, parts: OwnedPart[], bytes: number, metadata = false) {
  if (!metadata) bytes += Buffer.byteLength(JSON.stringify(parts.map((part) => part.view)))
  while (
    cached.size &&
    (cached.size >= 16 ||
      [...cached.values()].reduce((total, row) => total + row.bytes, 0) + bytes > MAX_PATCH_BYTES)
  ) {
    const oldest = cached.keys().next().value
    if (oldest !== undefined) cached.delete(oldest)
  }
  const commits = [...new Set(parts.flatMap((part) => (part.commit ? [part.commit] : [])))]
  if (bytes <= MAX_PATCH_BYTES) cached.set(key, { parts, commits, bytes })
  return commits
}

/** Registered metadata and patches have identical identities; only selected reads generate patches. */
export async function committedParts(
  ctx: Ctx,
  task: Task,
  options: { metadata?: boolean; browse?: boolean } = {},
): Promise<{
  parts: OwnedPart[]
  commits: string[]
  recorded: boolean
  staleCommits?: string[]
  unavailableCommits?: string[]
  historical?: true
}> {
  const owned = await taskCommitDiff(ctx, task, { history: options.browse ? "browse" : "report" })
  if (!owned) return { parts: [], commits: [], recorded: false }
  const { staleCommits, unavailableCommits, historical } = owned
  const history = {
    ...(staleCommits ? { staleCommits } : {}),
    ...(unavailableCommits ? { unavailableCommits } : {}),
    ...(historical ? { historical } : {}),
  }
  // Historical browsing inventories first and reads only the selected immutable patch.
  const metadata = options.metadata === true || historical === true
  const key = JSON.stringify([
    task.repoRoot,
    workingTaskKey(task),
    owned.commits,
    historical === true,
    metadata,
  ])
  const found = cached.get(key)
  if (found) return { parts: found.parts, commits: found.commits, recorded: true, ...history }
  const parts: OwnedPart[] = []
  let bytes = 0
  for (const commit of owned.commits) {
    const read = await commitParts(ctx, task, commit, { metadata, limit: MAX_PATCH_BYTES - bytes })
    for (const part of read.parts) {
      if (historical) part.view.label = `Historical · ${part.view.label}`
      parts.push(part)
    }
    bytes += read.bytes
  }
  return {
    parts,
    commits: remember(key, parts, bytes, metadata),
    recorded: true,
    ...history,
  }
}

export async function readCommittedPart(ctx: Ctx, task: Task, part: OwnedPart): Promise<OwnedPart> {
  if (!part.commit) throw new Error("The requested committed file version is unavailable")
  const paths = part.view.from ? [part.view.path, part.view.from] : [part.view.path]
  const key = JSON.stringify([task.repoRoot, workingTaskKey(task), part.commit, paths, part.base])
  const found = cached.get(key)
  const read =
    found ??
    (await commitParts(ctx, task, part.commit, {
      metadata: false,
      limit: MAX_PATCH_BYTES,
      paths,
      base: part.base,
    }))
  if (!found) remember(key, read.parts, read.bytes)
  const exact = read.parts.find((row) => row.view.stamp === part.view.stamp)
  if (!exact) throw new Error("The committed file inventory changed")
  return exact
}

export async function candidateParts(
  ctx: Ctx,
  task: Task,
  range: VerifyRange,
): Promise<OwnedPart[]> {
  const key = JSON.stringify([
    task.repoRoot,
    workingTaskKey(task),
    range.base,
    range.head,
    "candidate",
  ])
  const known = cached.get(key)
  if (known) return known.parts
  const read = await commitParts(ctx, task, range.head, {
    metadata: true,
    limit: MAX_PATCH_BYTES,
    base: range.base,
  })
  remember(key, read.parts, read.bytes, true)
  return read.parts
}

/** Immutable Git source, with both size and regular-file mode checked before textconv. */
export async function committedSource(
  ctx: Ctx,
  task: Task,
  source: Extract<PartSource, { kind: "git" }>,
  maxBytes = 2 * 1024 * 1024,
): Promise<string> {
  if (!/^100[0-7]{3}$/.test(source.mode) || !/^[a-f0-9]{40,64}$/.test(source.hash))
    throw new Error("This source is not a regular file")
  const size = await ctx.git.run(task.repoRoot, ["cat-file", "-s", source.hash], {
    maxOutputBytes: 128,
  })
  if (size.code !== 0 || !/^\d+\s*$/.test(size.stdout) || Number(size.stdout) > maxBytes)
    throw new Error("This source exceeds the reading limit")
  const result = await ctx.git.run(
    task.repoRoot,
    ["cat-file", "--filters", `--path=${source.path}`, source.hash],
    { maxOutputBytes: maxBytes },
  )
  if (result.code !== 0 || result.stdout.includes("\0"))
    throw new Error("This source is unavailable")
  return result.stdout
}
