// The diff of the build branch against its base: the document of the final gate.

import { createHash } from "node:crypto"
import { lstat, stat } from "node:fs/promises"
import { join } from "node:path"
import { type Ctx, err, type GitResult, ok, type Result } from "../../ctx.ts"
import { type FileIdentity, fileIdentity } from "../../regular-file.ts"
import type { ChangeHistory, ChangePart } from "../review/walkthrough.ts"
import { BUILD_COMMITS } from "./base.ts"
import { DIFF_PREFIXES, newFileDiff, untrackedFiles } from "./repo.ts"
import { beginSourceInventory, rememberSource } from "./source-witness.ts"

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

const MAX_DIFF_BYTES = 2 * 1024 * 1024
const COUNTED_NEW_FILES = 200
const COUNTED_NEW_FILE_BYTES = 1024 * 1024

/** The task's own plan folder, its documents and evidence: reviewed at their own gates. */
export const isPlanPath = (path: string) => path.startsWith("docs/plans/")

/** numstat writes a rename as `src/{old => new}/x.ts` or `old => new`: the new path and the old one. */
function renamedPaths(shown: string): { to: string; from: string } | null {
  const line = shown
  if (/[\r\n\u2028\u2029]/.test(line)) return null
  const close = line.lastIndexOf("}")
  const arrow = close < 0 ? -1 : line.lastIndexOf(" => ", close - 4)
  const open = arrow < 0 ? -1 : line.lastIndexOf("{", arrow)
  if (open >= 0) {
    const head = line.slice(0, open)
    const tail = line.slice(close + 1)
    const join = (middle: string) => `${head}${middle}${tail}`.replace("//", "/")
    return { to: join(line.slice(arrow + 4, close)), from: join(line.slice(open + 1, arrow)) }
  }
  const split = line.lastIndexOf(" => ")
  return split >= 0 ? { to: line.slice(split + 4), from: line.slice(0, split) } : null
}

/** Added and deleted lines per file of a patch; a binary file has no hunk lines, so it counts 0 and 0. */
function countLines(patch: string): Map<string, [number, number]> {
  const counts = new Map<string, [number, number]>()
  let current: [number, number] | null = null
  let inHunk = false
  for (const line of readablePatch(patch).split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.match(/ b\/(.+)$/)?.[1]
      current = path !== undefined ? [0, 0] : null
      if (path !== undefined && current !== null) counts.set(path, current)
      inHunk = false
    } else if (line.startsWith("@@")) {
      inHunk = true
    } else if (current !== null && inHunk) {
      if (line.startsWith("+")) current[0]++
      else if (line.startsWith("-")) current[1]++
    }
  }
  return counts
}

/** One changed file as `git diff --raw` names it, in git's own order, and what both its sides are. */
type RawEntry = {
  old: { mode: string; blob: string }
  source?: FileIdentity
  /** The file's own path, for a pathspec. */
  path: string
  /** The path as numstat lists it: quoted, the way git writes a name with other than plain ASCII. */
  shown: string
  /** A rename's or copy's old path. */
  from?: string
  /** Listed as modified without git having read it: it may hold just what the base holds. */
  unhashed?: true
  status: string
  key: string
  /** Its place in git's own order, the order git writes a patch of several files in. */
  order: number
}

const ESCAPES: Record<number, string> = {
  7: "\\a",
  8: "\\b",
  9: "\\t",
  10: "\\n",
  11: "\\v",
  12: "\\f",
  13: "\\r",
  34: '\\"',
  92: "\\\\",
}

/** A path the way git writes it with core.quotePath on: in quotes, with escapes, when it needs them. */
function quoted(path: string): string {
  let out = ""
  let needs = false
  for (const byte of Buffer.from(path, "utf8")) {
    const escaped =
      ESCAPES[byte] ??
      (byte < 0x20 || byte >= 0x7f ? `\\${byte.toString(8).padStart(3, "0")}` : null)
    if (escaped === null) out += String.fromCharCode(byte)
    else {
      out += escaped
      needs = true
    }
  }
  return needs ? `"${out}"` : path
}

/**
 * Each file's patch by what both its sides were, so a file that did not change is never diffed
 * again: git-crypt's textconv starts a process per file and side, seconds for a whole build.
 */
const PATCHES_KEPT = 5000
const PATCH_KEPT_BYTES = 1024 * 1024
/**
 * All kept patches together, in characters. A working-tree side is keyed by its size and times, so
 * every save of a file an agent edits keeps one more patch: with only the count bounding them, a
 * server that watched a long build held gigabytes of old patches.
 */
const PATCHES_KEPT_CHARS = 8 * 1024 * 1024
/** Oversized text patches already counted may serve this request's preview, then are released. */
const REQUEST_PATCH_BYTES = 4 * 1024 * 1024
type KeptPatches = Map<string, string> & { chars?: number }
const keptPatches = new WeakMap<Ctx["git"], KeptPatches>()

/** Keep a patch, dropping the oldest while the count or the characters are over their bound. */
function keepPatch(kept: KeptPatches, key: string, text: string): void {
  const before = kept.get(key)
  if (before !== undefined) {
    kept.delete(key)
    kept.chars = (kept.chars ?? 0) - before.length
  }
  kept.set(key, text)
  kept.chars = (kept.chars ?? 0) + text.length
  for (const [oldest, patch] of kept) {
    if (kept.size <= PATCHES_KEPT && kept.chars <= PATCHES_KEPT_CHARS) break
    kept.delete(oldest)
    kept.chars -= patch.length
  }
}
/**
 * Each counted file's added and deleted lines by the same key: a patch too large to keep (a
 * screenshot or a recording behind git-crypt) is otherwise diffed again on every read only to be
 * counted. Two numbers a file, so many more are kept than patches.
 */
const COUNTS_KEPT = 50_000
/** Files whose content is binary by their kind: never counted through a diff. */
const BINARY_NAME =
  /\.(?:png|jpe?g|gif|webp|avif|heic|ico|icns|bmp|tiff?|mp4|m4v|mov|webm|mkv|avi|mp3|wav|m4a|aac|ogg|flac|zip|gz|tgz|bz2|xz|zst|7z|rar|jar|woff2?|ttf|otf|eot|dmg|exe|dll|so|dylib|wasm|psd|sketch)$/i
const keptCounts = new WeakMap<Ctx["git"], Map<string, [number, number]>>()
/** Diffs of files not kept run side by side, a few files to each git. */
const DIFF_RUNS = 8
const DIFF_PATHS_PER_RUN = 40
const UNHASHED = /^0+$/

/**
 * The changed files of the working tree against `base`. A side git names by blob is that blob; a
 * working-tree side it has not hashed is known by its size, times and inode.
 */
async function rawEntries(ctx: Ctx, checkout: string, base: string): Promise<RawEntry[] | null> {
  // -z: each path as it is, whatever its characters, so every file can be diffed on its own.
  // Asked without git's refresh of the index (see below); when what that leaves in cannot be told
  // apart, `git diff` answers as it always did.
  const tree = await worktreeDiff(ctx, checkout)
  const fast = await parseRaw(
    checkout,
    base,
    await ctx.git.run(checkout, [...tree.diff, "--raw", "-z", "--abbrev=40", base]),
  )
  if (fast !== null) {
    const same = await untouchedOf(ctx, checkout, fast.entries)
    if (same !== null) {
      const entries = fast.entries.filter((entry) => !same.has(entry))
      return entries.length > 0 ? entries : null
    }
  }
  const slow = await parseRaw(
    checkout,
    base,
    await ctx.git.run(checkout, ["diff", "--raw", "-z", "--abbrev=40", base]),
  )
  // Nothing listed: the whole diffs say so just as cheaply, and stay right if --raw missed something.
  return slow !== null && slow.entries.length > 0 ? slow.entries : null
}

/**
 * `git diff <base>` against the working tree, as the plumbing command that does not first refresh
 * the index. `git diff` reads every file whose stamp differs from the index again on each call,
 * through its clean filter: with many edited files (several agents in one checkout, a git-crypt
 * repository) that is seconds per call, and a page makes dozens. The output is the same, but for a
 * file that was only touched: `untouchedOf` takes those out.
 */
type WorktreeDiff = { diff: string[]; patch: string[]; plain: string[] }

const FLAGS_FRESH_MS = 2000
const keptFlags = new WeakMap<Ctx["git"], Map<string, { at: number; flags: WorktreeDiff }>>()

/**
 * The plumbing command with what `git diff` takes from the repository's settings and it does not:
 * rename detection (`diff.renames`: off, or copies too), the lines of context of a patch
 * (`diff.context`) and which submodule changes count (`diff.ignoreSubmodules`). `plain` is the
 * same without rename detection, for counting files that are no rename by their names alone.
 */
async function worktreeDiff(ctx: Ctx, checkout: string): Promise<WorktreeDiff> {
  const byCheckout =
    keptFlags.get(ctx.git) ?? new Map<string, { at: number; flags: WorktreeDiff }>()
  keptFlags.set(ctx.git, byCheckout)
  const known = byCheckout.get(checkout)
  if (known !== undefined && Date.now() - known.at < FLAGS_FRESH_MS) return known.flags
  const read = await ctx.git.run(checkout, [
    "config",
    "--get-regexp",
    "^diff\\.(renames|context|ignoresubmodules)$",
  ])
  const set = new Map<string, string>()
  // No such setting is exit 1 and no line.
  for (const line of read.code === 0 ? read.stdout.split("\n") : []) {
    const at = line.indexOf(" ")
    if (at > 0)
      set.set(
        line.slice(0, at).toLowerCase(),
        line
          .slice(at + 1)
          .trim()
          .toLowerCase(),
      )
  }
  const renames = set.get("diff.renames")
  const rename = ["false", "no", "off", "0"].includes(renames ?? "")
    ? "--no-renames"
    : renames === "copies" || renames === "copy"
      ? "-C"
      : "-M"
  const submodules = set.get("diff.ignoresubmodules")
  const ignore =
    submodules !== undefined && /^[a-z]+$/.test(submodules)
      ? [`--ignore-submodules=${submodules}`]
      : []
  const context = set.get("diff.context")
  const lines = context !== undefined && /^\d+$/.test(context) ? [`-U${context}`] : []
  const diff = ["diff-index", rename, ...ignore]
  const flags: WorktreeDiff = {
    diff,
    patch: [...diff, "-p", "--textconv", ...lines],
    plain: ["diff-index", "--no-renames", ...ignore],
  }
  byCheckout.set(checkout, { at: Date.now(), flags })
  return flags
}

/** What a working file hashes to as git would store it, by its path, size, times and inode. */
const HASHES_KEPT = 50_000
const keptHashes = new WeakMap<Ctx["git"], Map<string, string>>()

/**
 * The entries whose working file holds exactly what the base holds: touched, or written again with
 * the same content. Without the index refresh git lists them as modified. Each such file is hashed
 * once per state it is in; null when git could not hash.
 */
async function untouchedOf(
  ctx: Ctx,
  checkout: string,
  entries: RawEntry[],
): Promise<Set<RawEntry> | null> {
  const hashes = keptHashes.get(ctx.git) ?? new Map<string, string>()
  keptHashes.set(ctx.git, hashes)
  const stateOf = (entry: RawEntry) => `${checkout}\0${entry.path}\0${JSON.stringify(entry.source)}`
  const suspects = entries.filter((entry) => entry.unhashed === true && entry.source !== undefined)
  const unknown = suspects.filter((entry) => !hashes.has(stateOf(entry)))
  const size = Math.min(DIFF_PATHS_PER_RUN, Math.max(1, Math.ceil(unknown.length / DIFF_RUNS)))
  const runs: RawEntry[][] = []
  for (let i = 0; i < unknown.length; i += size) runs.push(unknown.slice(i, i + size))
  let failed = false
  let next = 0
  const worker = async () => {
    for (let run = runs[next++]; run !== undefined; run = runs[next++]) {
      const hashed = await ctx.git.run(checkout, [
        "hash-object",
        "--",
        ...run.map((entry) => entry.path),
      ])
      const ids = hashed.code === 0 ? hashed.stdout.split("\n").filter((id) => id !== "") : []
      if (ids.length !== run.length) {
        failed = true
        continue
      }
      run.forEach((entry, i) => {
        if (hashes.size >= HASHES_KEPT) hashes.delete(hashes.keys().next().value as string)
        hashes.set(stateOf(entry), ids[i] as string)
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(DIFF_RUNS, runs.length) }, worker))
  if (failed) return null
  return new Set(suspects.filter((entry) => hashes.get(stateOf(entry)) === entry.old.blob))
}

async function parseRaw(
  checkout: string,
  base: string,
  raw: GitResult,
): Promise<{ entries: RawEntry[] } | null> {
  if (raw.code !== 0) return null
  const fields = raw.stdout.split("\0")
  const entries: RawEntry[] = []
  for (let i = 0; i < fields.length; i++) {
    const meta = fields[i] ?? ""
    if (!meta.startsWith(":")) continue
    const [mode = "", newMode = "", before = "", after = "", status = ""] = meta.split(" ")
    // A rename or copy names the old path and then the new one.
    const paths = /^[RC]/.test(status)
      ? [fields[i + 1] ?? "", fields[i + 2] ?? ""]
      : [fields[i + 1] ?? ""]
    i += paths.length
    const path = paths[paths.length - 1] ?? ""
    const file = await lstat(join(checkout, path)).catch(() => null)
    const source = file?.isFile() ? fileIdentity(file) : undefined
    const identity = source === undefined ? "gone" : JSON.stringify(source)
    const side = UNHASHED.test(after) ? identity : `${after}:${identity}`
    entries.push({
      order: entries.length,
      path,
      shown: quoted(path),
      ...(paths.length === 2 ? { from: paths[0] } : {}),
      status,
      old: { mode: mode.slice(1), blob: before },
      ...(source === undefined ? {} : { source }),
      // Modified in place, same mode, and not hashed by git: it may only have been touched.
      ...(status === "M" && UNHASHED.test(after) && newMode === mode.slice(1)
        ? { unhashed: true as const }
        : {}),
      key: `${checkout}\0${base}\0${paths.join("\0")}\0${status}\0${before}\0${side}`,
    })
  }
  return { entries }
}

/** A patch cut into its files, each starting at its `diff --git` line (a base85 line has no space). */
function splitPatch(text: string): string[] {
  const starts = [...text.matchAll(/^diff --git /gm)].map((m) => m.index ?? 0)
  return starts.map((start, i) => text.slice(start, starts[i + 1] ?? text.length))
}

/** The first line of a file's patch: its path on both sides, quoted the way git quotes it. */
function headerOf(entry: RawEntry): string {
  if (entry.shown === entry.path) return `diff --git a/${entry.path} b/${entry.path}\n`
  const inner = entry.shown.slice(1, -1)
  return `diff --git "a/${inner}" "b/${inner}"\n`
}

/** What git writes for a binary file without --binary, in place of its bytes. */
const BINARY_STUB = /^Binary files .* differ$/m

/** A textconv driver can emit decrypted binary bytes as a hunk. Never count or draw those as text. */
function readablePatch(patch: string): string {
  return splitPatch(patch)
    .map((file) => {
      if (!file.includes("\0")) return file
      const at = file.indexOf("\n--- ")
      const header = at < 0 ? file.split("\n")[0] : file.slice(0, at)
      const before = file.match(/^--- (.+)$/m)?.[1] ?? "a/file"
      const after = file.match(/^\+\+\+ (.+)$/m)?.[1] ?? "b/file"
      return `${header}\nBinary files ${before} and ${after} differ\n`
    })
    .join("")
}

/** A rename or copy pairs two paths in one patch: it is not cut per file. */
const cuttable = (entry: RawEntry) => !/^[RC]/.test(entry.status)

/**
 * The complete patch of each entry, kept ones from memory and the rest read a few files to a git,
 * side by side. Null when a git failed. `binary`: binary files as `--binary` writes them, for the
 * preview; without it a binary file is one line, all a count needs. Entries that cannot be cut
 * per file come back missing, for the caller to diff whole.
 */
async function patchesOf(
  ctx: Ctx,
  checkout: string,
  base: string,
  entries: RawEntry[],
  binary: boolean,
  requestPatches?: ReadonlyMap<string, string>,
): Promise<Map<RawEntry, string> | null> {
  const kept: KeptPatches = keptPatches.get(ctx.git) ?? new Map<string, string>()
  keptPatches.set(ctx.git, kept)
  // A text file's patch is the same with --binary or without, so counts and the preview share it;
  // only a binary file's one-line patch without --binary is kept apart, for counts alone.
  const stubOf = (entry: RawEntry) => `stub\0${entry.key}`
  const patches = new Map<RawEntry, string>()
  const missing: RawEntry[] = []
  for (const entry of entries) {
    if (!cuttable(entry) && entry.from === undefined) continue
    const known =
      requestPatches?.get(entry.key) ??
      kept.get(entry.key) ??
      (binary ? undefined : kept.get(stubOf(entry)))
    if (known !== undefined) patches.set(entry, known)
    else missing.push(entry)
  }
  // Asked in git's order, so the patches come back in the order of the run.
  missing.sort((a, b) => a.order - b.order)
  const singles = missing.filter(cuttable)
  const size = Math.min(DIFF_PATHS_PER_RUN, Math.max(1, Math.ceil(singles.length / DIFF_RUNS)))
  const runs: RawEntry[][] = []
  for (let i = 0; i < singles.length; i += size) runs.push(singles.slice(i, i + size))
  // A rename or copy is diffed on its own, by both its paths: one patch that names the two.
  for (const pair of missing) if (!cuttable(pair)) runs.push([pair])
  let failed = false
  let next = 0
  const tree = await worktreeDiff(ctx, checkout)
  const worker = async () => {
    for (let run = runs[next++]; run !== undefined; run = runs[next++]) {
      const pair = run.length === 1 && run[0] !== undefined && !cuttable(run[0]) ? run[0] : null
      const patch = await ctx.git.run(checkout, [
        ...tree.patch,
        ...DIFF_PREFIXES,
        "--no-ext-diff",
        // --binary uses full blob IDs even for text; counted text must match the preview.
        ...(binary ? ["--binary"] : ["--full-index"]),
        base,
        "--",
        ...(pair !== null
          ? [`:(literal)${pair.from}`, `:(literal)${pair.path}`]
          : run.map((entry) => `:(literal)${entry.path}`)),
      ])
      const files = patch.code === 0 ? splitPatch(patch.stdout) : []
      // Each patch must be its file's; anything else is not trusted, and the caller diffs whole.
      if (
        pair !== null
          ? files.length !== 1 || !/^(?:rename|copy) to /m.test(files[0] ?? "")
          : files.length !== run.length ||
            run.some((entry, i) => !(files[i] ?? "").startsWith(headerOf(entry)))
      ) {
        failed = true
        continue
      }
      run.forEach((entry, i) => {
        const text = readablePatch(files[i] ?? "")
        patches.set(entry, text)
        if (text.length > PATCH_KEPT_BYTES) return
        keepPatch(kept, !binary && BINARY_STUB.test(text) ? stubOf(entry) : entry.key, text)
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(DIFF_RUNS, runs.length) }, worker))
  return failed ? null : patches
}

/**
 * Files asked for at a time while the preview is put together: a few first, then twice as many each
 * round, so a change of huge files stops soon after the limit and a change of small ones takes few rounds.
 */
const PREVIEW_FIRST = 8
const PREVIEW_MOST = 256

type Preview =
  /** Put together from kept per-file patches, up to the preview's size limit; `complete` when every file is in. */
  | { assembled: true; code: string; plan: string; complete: boolean; revision: string }
  | { assembled: false; code: GitResult; plan: GitResult }

/**
 * The code's patch and the plan's, without the files in `hidden`. Put together from per-file patches
 * when every file can be cut on its own, code first, and only until the preview's limit is passed:
 * a change of hundreds of megabytes is not read whole for the first two. Else (a rename, a quoted
 * path, a git that failed) two whole diffs, as git alone would write them.
 */
async function previewDiffs(
  ctx: Ctx,
  checkout: string,
  base: string,
  entries: RawEntry[] | null,
  hidden: Set<string>,
  requestPatches: ReadonlyMap<string, string>,
): Promise<Preview> {
  const shown = (entries ?? []).filter((e) => !hidden.has(e.path))
  const ordered = [
    ...shown.filter((e) => !isPlanPath(e.path)),
    ...shown.filter((e) => isPlanPath(e.path)),
  ]
  const texts = new Map<RawEntry, string>()
  // A rename is diffed by its two paths, so it no longer turns the preview into one whole diff:
  // that ran every file of an old task's change through git-crypt, half a minute and gigabytes.
  let usable = entries !== null && ordered.every((e) => cuttable(e) || e.from !== undefined)
  let bytes = 0
  for (
    let i = 0, size = PREVIEW_FIRST;
    usable && i < ordered.length && bytes <= MAX_DIFF_BYTES;
    i += size, size = Math.min(size * 2, PREVIEW_MOST)
  ) {
    const window = ordered.slice(i, i + size)
    const patches = await patchesOf(ctx, checkout, base, window, true, requestPatches)
    if (patches === null || !window.every((e) => patches.has(e))) usable = false
    else
      for (const entry of window) {
        const text = patches.get(entry) ?? ""
        texts.set(entry, text)
        bytes += Buffer.byteLength(text, "utf8")
      }
  }
  if (usable) {
    const joined = (plan: boolean) =>
      ordered
        .filter((e) => isPlanPath(e.path) === plan && texts.has(e))
        .map((e) => texts.get(e))
        .join("")
    // What every file's both sides are, so the revision changes whenever the change does.
    const revision = createHash("sha256")
      .update(ordered.map((e) => e.key).join("\n"))
      .digest("hex")
    return {
      assembled: true,
      code: joined(false),
      plan: joined(true),
      complete: texts.size === ordered.length,
      revision,
    }
  }
  const excluded = [...hidden].map((path) => `:(exclude,literal)${path}`)
  const tree = await worktreeDiff(ctx, checkout)
  const whole = (pathspec: string[]) =>
    ctx.git.run(checkout, [
      ...tree.patch,
      ...DIFF_PREFIXES,
      "--no-ext-diff",
      "--binary",
      base,
      "--",
      ...pathspec,
    ])
  const [code, plan] = await Promise.all([
    whole([".", ":(exclude)docs/plans", ...excluded]),
    whole(["docs/plans", ...excluded]),
  ])
  return { assembled: false, code, plan }
}

/** The lines a new file adds; a binary file, like in a patch, adds none. */
function lineCount(text: string): number {
  if (text === "" || text.includes("\0")) return 0
  const lines = text.split("\n").length
  return text.endsWith("\n") ? lines - 1 : lines
}

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
    const ok = await ctx.git.run(checkout, ["cat-file", "-e", `${recorded}^{commit}`])
    if (ok.code === 0) return recorded
  }
  for (const candidate of ["main", "master", "dev"]) {
    const base = await ctx.git.run(checkout, ["merge-base", "HEAD", candidate])
    if (base.code === 0 && base.stdout.trim() !== "") return base.stdout.trim()
  }
  return null
}

/**
 * The uncommitted files nobody has touched since `since` (their modification time is older) that no
 * commit of the build holds: another session's work, there before the build began. A file with no
 * time (deleted) stays, since nothing says when it went.
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

/** Each listed file's numstat line by what both its sides were: a file is counted once per state. */
const keptStats = new WeakMap<Ctx["git"], Map<string, string>>()

/**
 * `git diff --numstat <base>` for the listed entries. Counting reads both sides of every changed
 * file, seconds for a large change, so a line is kept by its file's key and git is asked only when
 * a file is new or changed. Without entries (nothing listed, or the listing failed) git's own
 * numstat says what there is.
 */
async function numstatOf(
  ctx: Ctx,
  checkout: string,
  base: string,
  entries: RawEntry[] | null,
): Promise<Pick<GitResult, "code" | "stdout" | "stderr">> {
  if (entries === null) return ctx.git.run(checkout, ["diff", "--numstat", base])
  const stats = keptStats.get(ctx.git) ?? new Map<string, string>()
  keptStats.set(ctx.git, stats)
  const unknown = entries.filter((entry) => !stats.has(entry.key))
  if (unknown.length > 0) {
    const tree = await worktreeDiff(ctx, checkout)
    // Many new or changed files are counted whole, as the listing was made. A few are counted by
    // name: a rename by both its names, every other file with no rename detection, or git would
    // pair a deleted and an added file among the few that the whole listing kept apart.
    const literal = (path: string) => `:(literal)${path}`
    const few = unknown.length <= DIFF_PATHS_PER_RUN
    const singles = unknown.filter((entry) => entry.from === undefined)
    const asked = !few
      ? [[...tree.diff, "--numstat", base]]
      : [
          ...(singles.length > 0
            ? [[...tree.plain, "--numstat", base, "--", ...singles.map((e) => literal(e.path))]]
            : []),
          ...unknown
            .filter((entry) => entry.from !== undefined)
            .map((entry) => [
              ...tree.diff,
              "--numstat",
              base,
              "--",
              literal(entry.from as string),
              literal(entry.path),
            ]),
        ]
    const counted = await Promise.all(asked.map((args) => ctx.git.run(checkout, args)))
    const failed = counted.find((result) => result.code !== 0)
    if (failed !== undefined) return failed
    const byShown = new Map(entries.map((entry) => [entry.shown, entry]))
    const byPath = new Map(entries.map((entry) => [entry.path, entry]))
    for (const line of counted.flatMap((result) => result.stdout.split("\n"))) {
      const path = line.split("\t").slice(2).join("\t")
      if (path === "") continue
      const moved = renamedPaths(path)
      const renamed = moved !== null ? byPath.get(moved.to) : undefined
      // A line of no listed entry is a file that was only touched: it is left out. A rename line
      // counts only for the entry that is that rename.
      const entry = byShown.get(path) ?? (renamed?.from === moved?.from ? renamed : undefined)
      if (entry === undefined) continue
      if (stats.size >= COUNTS_KEPT) stats.delete(stats.keys().next().value as string)
      stats.set(entry.key, line)
    }
  }
  const lines = entries.map((entry) => stats.get(entry.key))
  // A listed file git did not count: its own numstat is the answer, as before.
  if (lines.some((line) => line === undefined))
    return ctx.git.run(checkout, ["diff", "--numstat", base])
  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" }
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

  // Working tree against the base, so uncommitted work shows up before ship too.
  const entries = await rawEntries(ctx, checkout, base)
  const numstat = await numstatOf(ctx, checkout, base, entries)
  const status = new Map((entries ?? []).map((e) => [e.shown, e.status.charAt(0)]))
  const requestPatches = new Map<string, string>()
  let requestBytes = 0
  if (numstat.code !== 0) {
    result.error = numstat.stderr.trim().split("\n")[0] || `git diff exited with ${numstat.code}`
  } else {
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
    // numstat reads the stored blobs, so every git-crypt file is "binary" (`-  -`) to it: those
    // are counted from the patch, which goes through the diff driver's textconv.
    const stored = new Set(
      numstat.stdout
        .split("\n")
        .filter((line) => line.startsWith("-\t-\t"))
        .map((line) => line.split("\t").slice(2).join("\t")),
    )
    if (stored.size > 0) {
      const wanted = (entries ?? []).filter((e) => stored.has(e.shown))
      const counts = keptCounts.get(ctx.git) ?? new Map<string, [number, number]>()
      keptCounts.set(ctx.git, counts)
      // A picture, a recording or an archive counts no lines however it is diffed: behind
      // git-crypt it was decrypted by a process per side only to come back "Binary files differ".
      for (const entry of wanted)
        if (BINARY_NAME.test(entry.path) && !counts.has(entry.key)) {
          if (counts.size >= COUNTS_KEPT) counts.delete(counts.keys().next().value as string)
          counts.set(entry.key, [0, 0])
        }
      const unknown = wanted.filter((e) => !counts.has(e.key))
      const patches = entries !== null ? await patchesOf(ctx, checkout, base, unknown, false) : null
      if (patches !== null) {
        for (const entry of unknown) {
          const patch = patches.get(entry)
          if (patch === undefined) continue
          if (counts.size >= COUNTS_KEPT) counts.delete(counts.keys().next().value as string)
          // Each patch is one file's: its counts, whatever its header says the path is.
          counts.set(entry.key, [...countLines(patch).values()][0] ?? [0, 0])
          if (
            options.withDiff === true &&
            patch.length > PATCH_KEPT_BYTES &&
            !BINARY_STUB.test(patch)
          ) {
            const bytes = Buffer.byteLength(patch, "utf8")
            if (requestBytes + bytes <= REQUEST_PATCH_BYTES) {
              requestPatches.set(entry.key, patch)
              requestBytes += bytes
            }
          }
        }
      }
      const counted =
        patches !== null
          ? new Map(wanted.map((e) => [e.shown, counts.get(e.key) ?? [0, 0]]))
          : await ctx.git
              .run(checkout, [
                ...(await worktreeDiff(ctx, checkout)).patch,
                ...DIFF_PREFIXES,
                "--no-ext-diff",
                base,
              ])
              .then((patch) => (patch.code === 0 ? countLines(patch.stdout) : new Map()))
      for (const file of result.files) {
        const counts = stored.has(file.path) ? counted.get(file.path) : undefined
        if (counts !== undefined) [file.additions, file.deletions] = counts
      }
    }
    // A rename is its new path, with the old one kept: a card that names the old file still owns it.
    for (const file of result.files) {
      const moved = renamedPaths(file.path)
      if (moved === null) continue
      file.path = moved.to
      file.from = moved.from
      file.status = (entries ?? []).find((e) => e.path === moved.to)?.status.charAt(0) ?? "R"
    }
    // A Viewed mark holds the stamp: a fix that edits a line in place keeps the counts, not the stamp.
    const stamps = new Map((entries ?? []).map((e) => [e.path, e]))
    for (const file of result.files) {
      const entry = stamps.get(file.path)
      if (entry !== undefined) {
        file.stamp = createHash("sha256").update(entry.key).digest("hex").slice(0, 16)
        rememberSource(ctx, checkout, file.path, file.stamp, {
          old: entry.old,
          ...(entry.source ? { file: entry.source } : {}),
        })
      }
    }
    // The code first: the reviewer came for it, the plan was approved at its own gates.
    result.files.sort((a, b) => Number(isPlanPath(a.path)) - Number(isPlanPath(b.path)))
  }

  // The build's own commits: a main line merged into the branch is not one.
  const log = await ctx.git.run(checkout, [
    "log",
    "--reverse",
    ...BUILD_COMMITS,
    "--name-only",
    "--format=%x1e%h%x09%s",
    `${base}..HEAD`,
  ])
  if (log.code === 0) {
    for (const entry of log.stdout.split("\x1e")) {
      const [header = "", ...names] = entry.split("\n")
      const [sha, subject] = header.split("\t")
      if (sha !== undefined && sha !== "") {
        result.commits.push({ sha, subject: subject ?? "", files: names.filter((n) => n !== "") })
      }
    }
  }
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

  if (options.withDiff === true) {
    // Code before plan, so the preview's size limit never spends itself on the
    // plan's documents and screenshots before the code is shown.
    const preview = await previewDiffs(ctx, checkout, base, entries, earlier, requestPatches)
    const whole = !preview.assembled && preview.code.code === 0 && preview.plan.code === 0
    if (preview.assembled || whole) {
      const combined = preview.assembled
        ? preview.code + preview.plan
        : readablePatch(preview.code.stdout + preview.plan.stdout)
      const bytes = Buffer.from(combined, "utf8")
      // A preview put together stops past its limit, so its size is known only when it is complete.
      if (!preview.assembled || preview.complete) result.diffBytes = bytes.byteLength
      result.revision = preview.assembled
        ? preview.revision
        : createHash("sha256").update(bytes).digest("hex")
      result.truncated =
        bytes.byteLength > MAX_DIFF_BYTES || (preview.assembled && !preview.complete)
      result.diff = result.truncated
        ? `${new TextDecoder().decode(bytes.subarray(0, MAX_DIFF_BYTES))}\n… diff truncated …\n`
        : combined
    }
    result.untracked = ((await untrackedFiles(ctx, checkout)) ?? []).filter(
      (path) => !earlier.has(path),
    )
    result.untrackedLines = {}
    // The Cockpit asks again on every file event, and a build folder nobody ignored can hold
    // thousands of files or one of gigabytes: only the first small ones are counted, the rest
    // show no line count (fileDiff still opens any of them).
    for (const path of result.untracked.slice(0, COUNTED_NEW_FILES)) {
      const file = join(checkout, path)
      const size = await stat(file).then(
        (s) => s.size,
        () => null,
      )
      if (size === null || size > COUNTED_NEW_FILE_BYTES) continue
      const text = await ctx.fs.readFile(file).catch(() => "")
      result.untrackedLines[path] = lineCount(text)
    }
  }
  return result
}

/** Retrieve one complete changed-file diff after the user opts to inspect it. */
export async function fileDiff(
  ctx: Ctx,
  checkout: string,
  recordedBase: string | null,
  path: string,
): Promise<Result<string>> {
  const listing = await changes(ctx, checkout, recordedBase)
  if (listing.base === null) {
    return err({ code: "bad_args", message: "The task has no diff base" })
  }
  const fresh = await untrackedFiles(ctx, checkout)
  if (fresh === null)
    return err({ code: "bad_args", message: "Cannot list new files in the task diff" })
  if (fresh.includes(path)) {
    const result = await newFileDiff(ctx, checkout, path)
    if (result.code !== 1)
      return err({
        code: "bad_args",
        message: `Cannot inspect ${path}: ${result.stderr.trim() || "git failed"}`,
      })
    return ok(readablePatch(result.stdout))
  }
  if (!listing.files.some((file) => file.path === path)) {
    return err({ code: "bad_args", message: "This path is not a changed file in the task diff" })
  }
  const result = await ctx.git.run(checkout, [
    ...(await worktreeDiff(ctx, checkout)).patch,
    ...DIFF_PREFIXES,
    "--no-ext-diff",
    "--binary",
    listing.base,
    "--",
    `:(literal)${path}`,
  ])
  if (result.code !== 0)
    return err({
      code: "bad_args",
      message: `Cannot inspect ${path}: ${result.stderr.trim() || "git failed"}`,
    })
  return ok(readablePatch(result.stdout))
}
