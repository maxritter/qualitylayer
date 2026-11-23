// The diff of the build branch against its base: the document of the final gate.

import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import type { ChangeHistory, ChangePart } from "../review/walkthrough.ts"
import { BUILD_COMMITS } from "./base.ts"
import { numstatOf, recountStoredBinaryFiles } from "./changes-numstat.ts"
import { readablePatch } from "./changes-patches.ts"
import { attachPreviewAndUntracked, finalizeChangedFiles } from "./changes-preview.ts"
import { type RawEntry, rawEntries, worktreeDiff } from "./changes-raw.ts"
import { DIFF_PREFIXES, newFileDiff, untrackedFiles } from "./repo.ts"
import { beginSourceInventory } from "./source-witness.ts"

export type ChangedFile = {
  parts?: ChangePart[]
  current?: "changed" | "unavailable"
  path: string
  status: string
  additions: number
  deletions: number
  /** The old path of a renamed or copied file. */
  from?: string
  /** What both its sides are now: another value once either side's content changes. */
  stamp?: string
}

export type Changes = {
  changeScope?: {
    history?: ChangeHistory
    pending: { path: string; reason: string }[]
    workingFiles: string[]
    localOnlyFiles?: string[]
  }
  base: string | null
  head: string | null
  files: ChangedFile[]
  /** The commits since the base, oldest first, each with the files it changed. */
  commits: { sha: string; subject: string; files: string[] }[]
  /** Files with work that is not committed yet: edited, staged or new. */
  uncommitted: string[]
  diff: string
  /** The combined preview can be shortened; fileDiff retrieves a complete file. */
  truncated?: boolean
  diffBytes?: number
  revision?: string
  untracked?: string[]
  /** Lines in each untracked file: all of them are added. */
  untrackedLines?: Record<string, number>
  /** git's first line when it could not count the changes: `files` is empty because of it, not because nothing changed. */
  error?: string
}

/** The task's own plan folder, its documents and evidence: reviewed at their own gates. */
export const isPlanPath = (path: string) => path.startsWith("docs/plans/")

/** The paths in `git status --porcelain=v1 -z`: a rename lists its old path as a record of its own. */
function dirtyPaths(output: string): string[] {
  const records = output.split("\0").filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? ""
    paths.push(record.slice(3))
    if (/^[RC]/.test(record) || /^.[RC]/.test(record)) i++
  }
  return paths
}

/** Resolve the base: the recorded sha when it is still valid, else the merge-base with the default branch. */
export async function resolveBase(
  ctx: Ctx,
  checkout: string,
  recorded: string | null,
): Promise<string | null> {
  if (recorded !== null && recorded !== "") {
    const valid = await ctx.git.run(checkout, ["cat-file", "-e", `${recorded}^{commit}`])
    if (valid.code === 0) return recorded
  }
  for (const candidate of ["main", "master", "dev"]) {
    const base = await ctx.git.run(checkout, ["merge-base", "HEAD", candidate])
    if (base.code === 0 && base.stdout.trim() !== "") return base.stdout.trim()
  }
  return null
}

/**
 * The uncommitted files nobody has touched since `since` (their modification time is older) that no
 * commit of the build holds: another session's work, there before the build began.
 */
async function untouchedSince(
  checkout: string,
  dirty: string[],
  committed: Set<string>,
  since: number,
): Promise<Set<string>> {
  const older = new Set<string>()
  for (const path of dirty) {
    if (committed.has(path)) continue
    const modified = await stat(join(checkout, path)).then(
      (s) => s.mtimeMs,
      () => null,
    )
    if (modified !== null && modified < since) older.add(path)
  }
  return older
}

/** Net paths for proof links, without line counting, blob stats or text conversion. */
export async function changedPaths(
  ctx: Ctx,
  checkout: string,
  recordedBase: string | null,
  options: { since?: number } = {},
): Promise<string[] | null> {
  const base = await resolveBase(ctx, checkout, recordedBase)
  if (base === null) return null
  const names = await ctx.git.run(checkout, ["diff", "--no-renames", "--name-only", "-z", base])
  if (names.code !== 0) return null
  const paths = names.stdout.split("\0").filter((path) => path !== "" && !isPlanPath(path))
  if (options.since === undefined) return [...new Set(paths)].sort()
  const [dirty, log] = await Promise.all([
    ctx.git.run(checkout, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    ctx.git.run(checkout, ["log", ...BUILD_COMMITS, "--name-only", "--format=", `${base}..HEAD`]),
  ])
  if (dirty.code !== 0 || log.code !== 0) return null
  const earlier = await untouchedSince(
    checkout,
    dirtyPaths(dirty.stdout),
    new Set(log.stdout.split("\n").filter(Boolean)),
    options.since,
  )
  return [...new Set(paths.filter((path) => !earlier.has(path)))].sort()
}

async function populateDiffFiles(
  ctx: Ctx,
  result: Changes,
  input: {
    checkout: string
    base: string
    entries: RawEntry[] | null
    withDiff: boolean
    requestPatches: Map<string, string>
  },
): Promise<void> {
  const numstat = await numstatOf(ctx, input.checkout, input.base, input.entries)
  if (numstat.code !== 0) {
    result.error = numstat.stderr.trim().split("\n")[0] || `git diff exited with ${numstat.code}`
    return
  }
  const status = new Map((input.entries ?? []).map((e) => [e.shown, e.status.charAt(0)]))
  for (const line of numstat.stdout.split("\n")) {
    const [add, del, ...rest] = line.split("\t")
    const path = rest[rest.length - 1]
    if (path === undefined || add === undefined || del === undefined) continue
    result.files.push({
      path,
      status: status.get(path) ?? "M",
      additions: Number(add) || 0,
      deletions: Number(del) || 0,
    })
  }
  await recountStoredBinaryFiles(ctx, {
    checkout: input.checkout,
    base: input.base,
    entries: input.entries,
    numstatStdout: numstat.stdout,
    files: result.files,
    withDiff: input.withDiff,
    requestPatches: input.requestPatches,
  })
  finalizeChangedFiles(ctx, input.checkout, result.files, input.entries)
}

async function readBuildCommits(ctx: Ctx, checkout: string, base: string) {
  const log = await ctx.git.run(checkout, [
    "log",
    "--reverse",
    ...BUILD_COMMITS,
    "--name-only",
    "--format=%x1e%h%x09%s",
    `${base}..HEAD`,
  ])
  if (log.code !== 0) return []
  const commits: Changes["commits"] = []
  for (const entry of log.stdout.split("\x1e")) {
    const [header = "", ...names] = entry.split("\n")
    const [sha, subject] = header.split("\t")
    if (sha) commits.push({ sha, subject: subject ?? "", files: names.filter(Boolean) })
  }
  return commits
}

/**
 * `since`: when the build began. An uncommitted or new file that is older than that and in no commit
 * since the base was already there, so it is not listed, counted or diffed.
 */
export async function changes(
  ctx: Ctx,
  checkout: string,
  recordedBase: string | null,
  options: { withDiff?: boolean; since?: number } = {},
): Promise<Changes> {
  beginSourceInventory(ctx)
  const base = await resolveBase(ctx, checkout, recordedBase)
  const head = await ctx.git.run(checkout, ["rev-parse", "HEAD"])
  const result: Changes = {
    base,
    head: head.code === 0 ? head.stdout.trim() : null,
    files: [],
    commits: [],
    uncommitted: [],
    diff: "",
  }
  if (base === null) return result
  const entries = await rawEntries(ctx, checkout, base)
  const requestPatches = new Map<string, string>()
  await populateDiffFiles(ctx, result, {
    checkout,
    base,
    entries,
    withDiff: options.withDiff === true,
    requestPatches,
  })
  result.commits = await readBuildCommits(ctx, checkout, base)
  const dirty = await ctx.git.run(checkout, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ])
  if (dirty.code === 0) result.uncommitted = dirtyPaths(dirty.stdout)
  const earlier =
    options.since === undefined
      ? new Set<string>()
      : await untouchedSince(
          checkout,
          result.uncommitted,
          new Set(result.commits.flatMap((c) => c.files)),
          options.since,
        )
  result.uncommitted = result.uncommitted.filter((path) => !earlier.has(path))
  result.files = result.files.filter((file) => !earlier.has(file.path))
  if (options.withDiff === false) {
    const stamps = await Promise.all(
      result.uncommitted.map(async (path) => {
        const info = await stat(join(checkout, path)).catch(() => null)
        return `${path}:${info?.size}:${info?.mtimeMs}:${info?.ctimeMs}`
      }),
    )
    result.revision = createHash("sha256")
      .update((entries ?? []).map((entry) => entry.key).join("\n"))
      .update(stamps.join("\n"))
      .digest("hex")
  }
  if (options.withDiff === true)
    await attachPreviewAndUntracked(ctx, result, {
      checkout,
      base,
      entries,
      earlier,
      requestPatches,
    })
  return result
}

async function diffTrackedFile(
  ctx: Ctx,
  checkout: string,
  base: string,
  path: string,
): Promise<Result<string>> {
  const result = await ctx.git.run(checkout, [
    ...(await worktreeDiff(ctx, checkout)).patch,
    ...DIFF_PREFIXES,
    "--no-ext-diff",
    "--binary",
    base,
    "--",
    `:(literal)${path}`,
  ])
  return result.code === 0
    ? ok(readablePatch(result.stdout))
    : err({
        code: "bad_args",
        message: `Cannot inspect ${path}: ${result.stderr.trim() || "git failed"}`,
      })
}

/** Retrieve one complete changed-file diff after the user opts to inspect it. */
export async function fileDiff(
  ctx: Ctx,
  checkout: string,
  recordedBase: string | null,
  path: string,
): Promise<Result<string>> {
  const listing = await changes(ctx, checkout, recordedBase)
  if (listing.base === null) return err({ code: "bad_args", message: "The task has no diff base" })
  const fresh = await untrackedFiles(ctx, checkout)
  if (fresh === null)
    return err({ code: "bad_args", message: "Cannot list new files in the task diff" })
  if (fresh.includes(path)) {
    const result = await newFileDiff(ctx, checkout, path)
    return result.code === 1
      ? ok(readablePatch(result.stdout))
      : err({
          code: "bad_args",
          message: `Cannot inspect ${path}: ${result.stderr.trim() || "git failed"}`,
        })
  }
  if (!listing.files.some((file) => file.path === path))
    return err({ code: "bad_args", message: "This path is not a changed file in the task diff" })
  return diffTrackedFile(ctx, checkout, listing.base, path)
}
