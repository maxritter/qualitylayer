import type { Ctx } from "../../ctx.ts"
import type { ChangePart } from "../review/walkthrough.ts"
import type { Task } from "../task/store.ts"
import { GIT_AT_ONCE, mapBounded } from "./bounded.ts"
import { taskCommitDiff, taskDiffArgs } from "./task-diff.ts"
import type { WorkingOperation } from "./working-records.ts"
import { digest, workingTaskKey } from "./working-records.ts"

export type PartSource =
  | { kind: "git"; hash: string; path: string; mode: string }
  | { kind: "working"; hash: string }
export type OwnedPart = {
  commit?: string
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

type RawFile = {
  path: string
  from?: string
  status: string
  before: PartSource | null
  after: PartSource | null
}
function rawFiles(raw: string): RawFile[] {
  const fields = raw.split("\0")
  const files: RawFile[] = []
  for (let i = 0; i < fields.length; i++) {
    const meta = fields[i] ?? ""
    if (!meta.startsWith(":")) continue
    const [oldMode = "", newMode = "", oldHash = "", newHash = "", status = ""] = meta
      .slice(1)
      .split(" ")
    const oldPath = fields[++i] ?? ""
    const path = /^[RC]/.test(status) ? (fields[++i] ?? "") : oldPath
    if (!path || path.startsWith("docs/plans/")) {
      files.push({ path, status, before: null, after: null })
      continue
    }
    const side = (hash: string, mode: string, path: string): PartSource | null =>
      /^0+$/.test(hash) ? null : { kind: "git", hash, mode, path }
    files.push({
      path,
      ...(oldPath !== path ? { from: oldPath } : {}),
      status: status[0] ?? "M",
      before: side(oldHash, oldMode, oldPath),
      after: side(newHash, newMode, path),
    })
  }
  return files
}

const showArgs = (commit: string, paths?: string[]) => [
  "show",
  "-M",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  ...taskDiffArgs([commit], paths).slice(1),
  ":(exclude)docs/plans/**",
]
const PATCH_LIMIT = "The workflow patch exceeds the reading limit"
const PATCH_INVENTORY = "The workflow patch inventory changed"
const PATCH_UNREADABLE = "The workflow's registered patches could not be read"

/**
 * The most pathspec bytes one run names: well inside Windows' 32,767-character command line once
 * git's own arguments and quoting are added, and as safe on POSIX.
 */
const RUN_PATH_BYTES = 20 * 1024

/** A file's pathspecs as a run names them: its path, and a rename's old path beside it. */
const runPaths = (file: RawFile): string[] => (file.from ? [file.path, file.from] : [file.path])

/** What a file adds to a run's command line: each literal pathspec and its separator. */
const pathBytes = (file: RawFile): number =>
  runPaths(file).reduce((sum, path) => sum + Buffer.byteLength(`:(literal)${path}`) + 1, 0)

/**
 * The files in runs that keep their order: about `count` runs as even as they divide, each split
 * again where its paths would pass RUN_PATH_BYTES. A file never splits, so one very long path is a
 * run of its own, as readable as before. Only `count` runs go at once (mapBounded).
 */
function batches(files: readonly RawFile[], count: number): RawFile[][] {
  const size = Math.ceil(files.length / Math.min(count, files.length))
  const runs: RawFile[][] = []
  for (let at = 0; at < files.length; at += size) {
    let run: RawFile[] = []
    let cost = 0
    for (const file of files.slice(at, at + size)) {
      const add = pathBytes(file)
      if (run.length > 0 && cost + add > RUN_PATH_BYTES) {
        runs.push(run)
        run = []
        cost = 0
      }
      run.push(file)
      cost += add
    }
    if (run.length > 0) runs.push(run)
  }
  return runs
}

/**
 * A whole commit's patches, read GIT_AT_ONCE `git show` processes at a time: a diff
 * driver (git-crypt's textconv) runs once per file, and in one process those runs follow each
 * other, while a process per file would start thousands for a wide commit. Each run names its
 * files in the inventory's order (a rename with both paths) and must return exactly one patch per
 * file. The bytes count as in one output (the commit header once, then each patch); a run is kept
 * only while the total stays under the limit, and no further run starts once it does not.
 */
async function filePatches(
  ctx: Ctx,
  task: Task,
  commit: string,
  files: readonly RawFile[],
  limit: number,
): Promise<{ texts: string[]; bytes: number }> {
  let bytes = 0
  let header = false
  const runs = await mapBounded(batches(files, GIT_AT_ONCE), async (run) => {
    const read = await ctx.git.run(
      task.repoRoot,
      showArgs(commit, run.flatMap(runPaths)),
      // Each run repeats the commit header, so one run may use the whole limit; the total
      // (header once) is checked as each run completes.
      { maxOutputBytes: limit },
    )
    if (read.code !== 0) throw new Error(PATCH_UNREADABLE)
    const starts = [...read.stdout.matchAll(/^diff --git /gm)].map((match) => match.index!)
    if (starts.length !== run.length) throw new Error(PATCH_INVENTORY)
    const texts = starts.map((start, index) =>
      read.stdout.slice(start, starts[index + 1] ?? read.stdout.length),
    )
    for (const text of texts) bytes += Buffer.byteLength(text)
    if (!header) {
      header = true
      bytes += Buffer.byteLength(read.stdout.slice(0, starts[0]))
    }
    if (bytes >= limit) throw new Error(PATCH_LIMIT)
    return texts
  })
  return { texts: runs.flat(), bytes }
}

async function commitParts(
  ctx: Ctx,
  task: Task,
  commit: string,
  metadata: boolean,
  limit: number,
  paths?: string[],
): Promise<{ parts: OwnedPart[]; bytes: number }> {
  const raw = await ctx.git.run(
    task.repoRoot,
    [
      "diff-tree",
      "--root",
      "--first-parent",
      "--diff-merges=first-parent",
      "--no-commit-id",
      "--raw",
      "--abbrev=64",
      "-M",
      "-r",
      "-z",
      commit,
      ...(paths ? ["--", ...paths.map((path) => `:(literal)${path}`)] : []),
    ],
    { maxOutputBytes: 1024 * 1024 },
  )
  if (raw.code !== 0) throw new Error(PATCH_UNREADABLE)
  const files = rawFiles(raw.stdout)
  const visible = files.filter((file) => file.path && !file.path.startsWith("docs/plans/"))
  let patches: string[] = []
  let bytes = 0
  if (!metadata && paths === undefined && visible.length > 1) {
    // A whole commit's files: at most GIT_AT_ONCE processes side by side.
    const read = await filePatches(ctx, task, commit, visible, limit)
    patches = read.texts
    bytes = read.bytes
  } else if (!metadata) {
    const patch = await ctx.git.run(task.repoRoot, showArgs(commit, paths), {
      maxOutputBytes: limit,
    })
    if (patch.code !== 0) throw new Error(PATCH_UNREADABLE)
    bytes = Buffer.byteLength(patch.stdout)
    if (bytes >= limit) throw new Error(PATCH_LIMIT)
    const starts = [...patch.stdout.matchAll(/^diff --git /gm)].map((match) => match.index!)
    patches = starts.map((start, index) =>
      patch.stdout.slice(start, starts[index + 1] ?? patch.stdout.length),
    )
  }
  if (!metadata && patches.length !== visible.length) throw new Error(PATCH_INVENTORY)
  const parts: OwnedPart[] = []
  for (const [index, file] of visible.entries()) {
    let text = metadata ? "" : patches[index]!
    if (text.includes("\0")) text = `${text.split("\n")[0]}\nBinary files differ\n`
    const stamp = digest(
      JSON.stringify([workingTaskKey(task), commit, file.path, file.from, file.before, file.after]),
    )
    parts.push({
      commit,
      view: {
        id: stamp,
        stamp,
        path: file.path,
        ...(file.from ? { from: file.from } : {}),
        status: file.status,
        ...(metadata ? { additions: null, deletions: null } : patchCounts(text)),
        kind: "commit",
        label: commit.slice(0, 8),
      },
      patch: text,
      before: file.before,
      after: file.after,
    })
  }
  const size = metadata ? Buffer.byteLength(JSON.stringify(parts.map((part) => part.view))) : bytes
  if (size > limit) throw new Error("The workflow inventory exceeds the reading limit")
  return { parts, bytes: size }
}

function remember(key: string, parts: OwnedPart[], bytes: number, metadata = false) {
  if (!metadata) bytes += Buffer.byteLength(JSON.stringify(parts.map((part) => part.view)))
  while (
    cached.size &&
    (cached.size >= 16 ||
      [...cached.values()].reduce((total, row) => total + row.bytes, 0) + bytes > MAX_PATCH_BYTES)
  )
    cached.delete(cached.keys().next().value!)
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
    const read = await commitParts(ctx, task, commit, metadata, MAX_PATCH_BYTES - bytes)
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
  const key = JSON.stringify([task.repoRoot, workingTaskKey(task), part.commit, paths])
  const found = cached.get(key)
  const read = found ?? (await commitParts(ctx, task, part.commit, false, MAX_PATCH_BYTES, paths))
  if (!found) remember(key, read.parts, read.bytes)
  const exact = read.parts.find((row) => row.view.stamp === part.view.stamp)
  if (!exact) throw new Error("The committed file inventory changed")
  return exact
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
