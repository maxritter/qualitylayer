// A slice's commit, built in a temporary index from HEAD plus the slice's own changes, so edits
// someone staged before the build never go into it and are still staged afterwards.
//
// For a file that also holds staged edits, three versions meet, each as the work tree shows it
// (through the repository's smudge filter): HEAD (`head`), the index (`staged`) and the work tree
// (`work`), which is the staged version plus the slice's edits.
//   committed = head + (work - staged)      what the slice's commit holds
//   index     = committed + (staged - head) what the index holds afterwards
// Each is cleaned (the repository's clean filter, as `git add` does) before it is stored.
//
// The commit is made from a checkout of the temporary index in a temporary folder, so the
// repository's hooks see exactly the tree that is committed and half-written files of another
// session in the working copy are neither read by them nor in the way. A hook that only
// reformatted the slice's own files gets them staged again and one more try. The commit runs no
// typecheck or verify command of its own: the repository's hooks are its only gate.
//
// The hooks are run as `git commit` runs them (pre-commit, prepare-commit-msg, commit-msg, then
// post-commit), but the commit itself is made with `commit-tree` and a compare-and-swap of HEAD
// (slice-land.ts), and its message lives in a file of its own. `git commit` would keep the message
// in the one `.git/COMMIT_EDITMSG`, where two commits made at the same moment in one checkout read
// each other's.
// Model: qualitylayer/artifacts/app/workflow/commit-ownership-contract.md

import { createHash } from "node:crypto"
import { constants, existsSync } from "node:fs"
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { err, ok, type Result } from "../../ctx.ts"
import { LOGS, NAMES } from "../docs/names.ts"
import { commitScopeError } from "./commit-scope.ts"
import { foreignRefusal } from "./foreign-refusal.ts"
import { type Entry, git, infoLine, type Run } from "./slice-git.ts"
import { sliceInputFile } from "./slice-input-file.ts"
import {
  currentRef,
  followToHead,
  operationInProgress,
  placeOnHead,
  type Rebase,
  runHook,
  runPostCommit,
} from "./slice-land.ts"

async function headEntry(root: string, base: string, path: string): Promise<Entry | null> {
  const run = await git(root, ["ls-tree", "-z", base, "--", path])
  const match = run.text.match(/^(\d+) \w+ (\w+)\t/)
  return run.code === 0 && match !== null ? { mode: match[1] ?? "", sha: match[2] ?? "" } : null
}

async function indexEntry(
  root: string,
  path: string,
  env?: Record<string, string | undefined>,
): Promise<Entry | null> {
  const run = await git(root, ["ls-files", "-s", "-z", "--", path], env ? { env } : {})
  const match = run.text.match(/^(\d+) (\w+) 0\t/)
  return run.code === 0 && match !== null ? { mode: match[1] ?? "", sha: match[2] ?? "" } : null
}

const same = (a: Entry | null, b: Entry | null) =>
  a === null || b === null ? a === b : a.mode === b.mode && a.sha === b.sha

const equal = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0

/** What a path would look like checked out: the stored blob through the smudge filter. */
async function smudged(root: string, spec: string, path?: string): Promise<Uint8Array | null> {
  const run = await git(root, ["cat-file", "--filters", ...(path ? [`--path=${path}`] : []), spec])
  return run.code === 0 ? run.out : null
}

/** The blob a file's content would be stored as: `git add`'s own clean filter, chosen by its path. */
async function stored(root: string, path: string, content: Uint8Array): Promise<string | null> {
  const run = await git(root, ["hash-object", "-w", `--path=${path}`, "--stdin"], {
    input: content,
  })
  return run.code === 0 ? run.text.trim() : null
}

/** `git merge-file`: the changes from `base` to `other` laid onto `current`; null when they overlap. */
async function merge3(
  dir: string,
  current: Uint8Array,
  base: Uint8Array,
  other: Uint8Array,
): Promise<Uint8Array | null> {
  const paths = ["current", "base", "other"].map((name) => join(dir, name))
  await Promise.all([writeFile(paths[0] as string, current), writeFile(paths[1] as string, base)])
  await writeFile(paths[2] as string, other)
  const run = await git(dir, ["merge-file", "-p", ...paths])
  return run.code === 0 ? run.out : null
}

/**
 * The commits another session made to a slice file since the build began, kept: a slice commit
 * takes the file whole, so a working copy that lacks such a commit's change would undo it. A change
 * that does not overlap the slice's is merged into the working file (the slice goes on the moved
 * HEAD); one that does is the commit that conflicts, and nothing is changed.
 */
async function keepOthersCommits(
  root: string,
  scratch: string,
  path: string,
  o: { from: string | undefined; to: string; own: readonly string[] },
): Promise<{ conflict: string } | { unreadable: string } | null> {
  if (o.from === undefined) return null
  if (!/^[0-9a-f]{40,64}$/.test(o.from) || o.from.trim() !== o.from)
    return { unreadable: "the recorded build-start history is invalid" }
  const log = await git(root, ["log", "--format=%H", `${o.from}..${o.to}`, "--", path])
  if (log.code !== 0) return { unreadable: "Git could not read the history since the build began" }
  const own = new Set(o.own)
  const others = log.text
    .split("\n")
    .filter((sha) => sha !== "" && !own.has(sha))
    .reverse()
  if (others.length === 0) return null
  const file = join(root, path)
  const before = await sliceInputFile(root, file, HASH_LIMIT).catch(() => null)
  if (before === null) return { unreadable: "the current file could not be read safely" }
  let work: Uint8Array = before
  for (const sha of others) {
    const [parent, landed] = await Promise.all([
      smudged(root, `${sha}^:${path}`, path),
      smudged(root, `${sha}:${path}`, path),
    ])
    if (parent === null || landed === null)
      return { unreadable: `the file versions for commit ${sha.slice(0, 9)} could not be compared` }
    if (equal(parent, landed)) continue
    const merged = await merge3(scratch, work, parent, landed)
    if (merged === null) return { conflict: sha }
    work = merged
  }
  // Written only over the bytes it was merged from: a writer that came in between keeps its own.
  if (!equal(work, before)) {
    const current = await sliceInputFile(root, file, HASH_LIMIT).catch(() => null)
    if (current === null || !equal(current, before))
      return {
        unreadable: "the file changed or could not be read before its merged bytes were saved",
      }
    await writeFile(file, work)
  }
  return null
}

/**
 * The paths git reports as changed in the work tree or the index, each with its two status letters
 * (the index's, then the work tree's), renames as both their paths.
 */
export async function statusEntries(
  root: string,
  env?: Record<string, string | undefined>,
): Promise<Map<string, string> | null> {
  const progress = setTimeout(
    () =>
      process.stderr.write(
        "Reading checkout changes for this commit; preserving unrelated work and staging…\n",
      ),
    1000,
  )
  let run: Run
  try {
    run = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { env })
  } finally {
    clearTimeout(progress)
  }
  if (run.code !== 0) return null
  const changed = new Map<string, string>()
  const parts = run.text.split("\0")
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? ""
    if (entry.length < 4) continue
    changed.set(entry.slice(3), entry.slice(0, 2))
    if (entry[0] === "R" || entry[0] === "C") changed.set(parts[++i] ?? "", entry.slice(0, 2))
  }
  return changed
}

/** The paths git reports as changed in the work tree or the index, renames as both their paths. */
async function changedPaths(
  root: string,
  env?: Record<string, string | undefined>,
): Promise<Set<string> | null> {
  const entries = await statusEntries(root, env)
  return entries === null ? null : new Set(entries.keys())
}

/** The paths staged in the index that HEAD does not hold as they are; null when git cannot say. */
export async function stagedPaths(root: string): Promise<string[] | null> {
  const run = await git(root, ["diff", "--cached", "--name-only", "-z"])
  return run.code === 0 ? run.text.split("\0").filter((path) => path !== "") : null
}

/** Whether a path a card names (a folder stands for every file below it) covers `path`. */
export function covers(entry: string, path: string): boolean {
  const name = entry.replace(/^\.\//, "")
  return path === name || path.startsWith(name.endsWith("/") ? name : `${name}/`)
}

type Change = {
  path: string
  /** The entry the index held when the slice was planned: the index is brought on only where it still does. */
  stagedBefore: Entry | null
  /** The entry the commit holds; null removes the file. */
  committed: Entry | null
  /** The entry the index holds afterwards; null removes the file. */
  index: Entry | null
  /** The file also holds edits staged before the build. */
  keptStaged: boolean
  /** Another commit changed the file meanwhile and the slice's edits were merged onto it: the entry it left. */
  rebasedFrom?: Entry
}

export type SliceCommit = {
  parentRetries?: number
  /** HEAD moved while the slice was checked; the commit went on this one without running the hooks again. */
  placed_on?: string
  /** Null when the slice had nothing git takes; task-card completion is recorded separately. */
  commit: string | null
  subject: string | null
  files: string[]
  /** Files whose earlier staged edits are still staged. */
  kept_staged: string[]
  /** Explicitly claimed pre-build content, identified by its captured Git blob. */
  taken_prebuild?: { path: string; blob: string }[]
  /** Changed files no card names: they stayed in the working copy, and said so. */
  left_out: string[]
  /** Installed dependencies linked into the checkout the hooks run in. */
  borrowed: string[]
  message: string
}

/** The installed dependencies a checked-out tree borrows from the checkout, where it has them. */
const DEPENDENCY_FOLDERS = [
  "node_modules",
  "qualitylayer/node_modules",
  "docs/site/node_modules",
  "qualitylayer/dist/app/binaries",
]

/**
 * Git settings under which a file copied from the checkout with its time kept counts as the file
 * the index recorded there: its size and whole-second time decide, not its inode or change time.
 * Given as environment so the repository's hooks and every git they start read them too.
 */
function copiedStatTrust(): Record<string, string> {
  const at = Number(process.env.GIT_CONFIG_COUNT ?? 0) || 0
  return {
    GIT_CONFIG_COUNT: String(at + 2),
    [`GIT_CONFIG_KEY_${at}`]: "core.checkStat",
    [`GIT_CONFIG_VALUE_${at}`]: "minimal",
    [`GIT_CONFIG_KEY_${at + 1}`]: "core.trustctime",
    [`GIT_CONFIG_VALUE_${at + 1}`]: "false",
  }
}

/**
 * Start the private index as a copy of the checkout's own, so it knows the checkout's unchanged
 * files by their recorded stat and git need not read them again through the repository's filters
 * (git-crypt runs once per file). False when there is no plain index to copy: one with entries
 * marked skip-worktree or assume-unchanged, or unmerged ones, would hide files from the hooks.
 */
async function seedIndex(root: string, index: string): Promise<boolean> {
  const where = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
  const live = where.text.trim()
  if (where.code !== 0 || live === "") return false
  const marks = await git(root, ["ls-files", "-v", "-z"])
  if (marks.code !== 0) return false
  if (marks.text.split("\0").some((entry) => entry !== "" && !entry.startsWith("H "))) return false
  try {
    const info = await stat(live)
    await writeFile(index, await readFile(live))
    // The copy keeps the live index's time: git's check for files changed within the index's own second still holds.
    await utimes(index, info.atime, info.mtime)
    return true
  } catch {
    await rm(index, { force: true })
    return false
  }
}

/** The regular files the index holds, by path. */
async function regularFiles(
  root: string,
  env: Record<string, string | undefined>,
): Promise<string[] | null> {
  const listed = await git(root, ["ls-files", "-s", "-z"], { env })
  if (listed.code !== 0) return null
  const files: string[] = []
  for (const entry of listed.text.split("\0")) {
    const match = entry.match(/^(\d+) \w+ 0\t([\s\S]+)$/)
    if (match !== null && (match[1] === "100644" || match[1] === "100755"))
      files.push(match[2] as string)
  }
  return files
}

/**
 * Copy the checkout's unchanged files into `dir` with their times kept, so the seeded index knows
 * them. Returns the paths copied; one that is no plain file, or was written while it was copied,
 * is left for git to check out.
 */
async function copyUnchanged(root: string, dir: string, paths: string[]): Promise<Set<string>> {
  const copied = new Set<string>()
  // A folder is made once, and every file in it waits for that same call.
  const made = new Map<string, Promise<unknown>>()
  for (let at = 0; at < paths.length; at += 32)
    await Promise.all(
      paths.slice(at, at + 32).map(async (path) => {
        const [from, to] = [join(root, path), join(dir, path)]
        try {
          const before = await lstat(from)
          if (!before.isFile()) return
          let folder = made.get(dirname(to))
          if (folder === undefined) {
            folder = mkdir(dirname(to), { recursive: true })
            made.set(dirname(to), folder)
          }
          await folder
          await copyFile(from, to, constants.COPYFILE_FICLONE)
          await utimes(to, before.atime, before.mtime)
          const after = await lstat(from)
          if (after.mtimeMs === before.mtimeMs && after.size === before.size) copied.add(path)
          else await rm(to, { force: true })
        } catch {
          await rm(to, { force: true }).catch(() => undefined)
        }
      }),
    )
  return copied
}

/** Write these paths of the index into the tree through git, which records their stat in the index. */
async function checkOutPaths(
  tree: string,
  env: Record<string, string | undefined>,
  paths: string[],
): Promise<Run | null> {
  if (paths.length === 0) return null
  return git(tree, ["checkout-index", "-f", "-u", "-z", "--stdin"], {
    env,
    input: paths.map((path) => `${path}\0`).join(""),
  })
}

/**
 * Check the index's tree out into `dir`, as a checkout does, and link the installed dependencies
 * in. With `fast` (the index was seeded from the checkout's own) the files the checkout holds
 * unchanged are copied from it and only the others pass through git and its smudge filters; the
 * tree is the same either way, and `fast.settle` puts right any copy git then finds different.
 */
async function checkOut(
  root: string,
  index: string,
  dir: string,
  fast?: {
    /** The git environment of the tree: its index, git directory and work tree. */
    env: Record<string, string | undefined>
    /** The paths git reported as changed in the checkout: never copied from it. */
    changed: Set<string>
  },
): Promise<{ ok: true; borrowed: string[]; copied: Set<string> } | { ok: false; why: string }> {
  await mkdir(dir, { recursive: true })
  let copied = new Set<string>()
  const files = fast === undefined ? null : await regularFiles(root, { GIT_INDEX_FILE: index })
  if (fast !== undefined && files !== null) {
    copied = await copyUnchanged(
      root,
      dir,
      files.filter((path) => !fast.changed.has(path)),
    )
    const all = await git(root, ["ls-files", "-z"], { env: { GIT_INDEX_FILE: index } })
    if (all.code !== 0) return { ok: false, why: all.stderr.trim() }
    const rest = all.text.split("\0").filter((path) => path !== "" && !copied.has(path))
    const out = await checkOutPaths(dir, fast.env, rest)
    if (out !== null && out.code !== 0) return { ok: false, why: out.stderr.trim() }
  } else {
    const out = await git(root, ["checkout-index", "-a", `--prefix=${dir}/`], {
      env: { GIT_INDEX_FILE: index },
    })
    if (out.code !== 0) return { ok: false, why: out.stderr.trim() }
  }
  const packages = await git(root, ["ls-files", "-z", "--", "package.json", "**/package.json"], {
    env: { GIT_INDEX_FILE: index },
    pathspecs: true,
  })
  if (packages.code !== 0) return { ok: false, why: packages.stderr.trim() }
  const dependencies = new Set(DEPENDENCY_FOLDERS)
  for (const manifest of packages.text.split("\0")) {
    if (manifest === "" || manifest.split("/").includes("node_modules")) continue
    dependencies.add(join(dirname(manifest), "node_modules"))
  }
  const borrowed: string[] = []
  for (const folder of dependencies) {
    if (!existsSync(join(root, folder))) continue
    await mkdir(dirname(join(dir, folder)), { recursive: true })
    try {
      await symlink(join(root, folder), join(dir, folder), "dir")
      borrowed.push(folder)
    } catch {
      // A tracked folder already present belongs to the committed tree.
    }
  }
  return { ok: true, borrowed, copied }
}

/** A coordinator's binary is not evidence of this tree. Ordinary checks retain their override. */
function snapshotEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const env = { ...process.env, ...overrides }
  // Explicitly mask it: git's environment merge must not inherit it again.
  env.QUALITYLAYER_TEST_BINARY = undefined
  env.QUALITYLAYER_TEST_UI_ROOT = undefined
  env.QUALITYLAYER_TEST_TRIAL_KEY_FILE = undefined
  return env
}

/** How long the index is locked and compared again when another git writer holds its lock or the update fails. */
const INDEX_WAIT_MS = 8_000

/**
 * What a commit whose shared-index update failed says: the commit, why the index stayed behind, and
 * the stale entries with the reset that clears them, or, when none is stale, that nothing needs one.
 */
export function indexNotBroughtOn(
  sha: string,
  why: string,
  stale: readonly string[],
  total: number,
): string {
  const failed = `committed ${sha.slice(0, 8)}, but the index could not be brought on: ${why}.`
  if (stale.length === 0)
    return `${failed} No index entry was left stale, so there is nothing to reset.`
  return `${failed} ${stale.length} of ${total} index ${total === 1 ? "entry is" : "entries are"} stale: ${stale.join(", ")}. Run git reset -q -- ${stale.join(" ")}`
}

/**
 * Bring the live index on from the slice's commit: each path goes to the entry the index holds
 * afterwards, but only where the index still holds what the slice was planned on; an entry someone
 * staged since is theirs. Comparison and update happen under one hold of git's own index lock
 * (`index.lock`, created exclusively, which every git writer respects): the update is made on a
 * copy of the live index taken under the lock and moved into place, as git itself writes the index.
 * Every attempt takes the lock anew and compares again, so staging that lands between attempts or
 * while another writer holds the lock is never overwritten with an entry computed earlier.
 */
async function bringIndexOn(
  root: string,
  changes: Change[],
): Promise<{ ok: true } | { ok: false; why: string; stale: string[] }> {
  const where = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
  const index = where.text.trim()
  if (where.code !== 0 || index === "")
    return {
      ok: false,
      why: where.stderr.trim() || "git could not name its index",
      stale: changes.map((c) => c.path),
    }
  const lock = `${index}.lock`
  let why = "the index stayed locked by another git command"
  const until = Date.now() + INDEX_WAIT_MS
  for (let attempt = 0; attempt === 0 || Date.now() < until; attempt++) {
    if (attempt > 0) await Bun.sleep(250)
    const held = await open(lock, "wx").catch(() => null)
    if (held === null) continue
    let moved = false
    try {
      const live = await stat(index).catch(() => null)
      if (live === null) {
        await held.close()
        const empty = await git(root, ["read-tree", "--empty"], { env: { GIT_INDEX_FILE: lock } })
        if (empty.code !== 0) {
          why = empty.stderr.trim()
          continue
        }
      } else {
        await held.writeFile(await readFile(index))
        await held.close()
        // The copy keeps the live index's time, so git's check for files changed within the index's own second still holds.
        await utimes(lock, live.atime, live.mtime)
      }
      const env = { GIT_INDEX_FILE: lock }
      const settled: Change[] = []
      for (const c of changes) {
        const live = await indexEntry(root, c.path, env)
        // The commit the slice was merged onto may have brought the index to its own entry.
        if (
          same(live, c.stagedBefore) ||
          (c.rebasedFrom !== undefined && same(live, c.rebasedFrom))
        )
          settled.push(c)
      }
      const put = await git(root, ["update-index", "--index-info"], {
        env,
        input: settled.map((c) => infoLine(c.path, c.index)).join(""),
      })
      if (put.code !== 0) {
        why = put.stderr.trim()
        continue
      }
      await rename(lock, index)
      moved = true
      return { ok: true }
    } catch (cause) {
      why = String(cause)
    } finally {
      if (!moved) await rm(lock, { force: true })
    }
  }
  // The entries still at what they were before the commit: staged by nobody since, so stale.
  const stale: string[] = []
  for (const c of changes)
    if (!same(c.index, c.stagedBefore) && same(await indexEntry(root, c.path), c.stagedBefore))
      stale.push(c.path)
  return { ok: false, why, stale }
}

/** How many times a slice is planned again because another writer moved HEAD onto its own files while it was committing. */
const ATTEMPTS = 3

/**
 * `commitOnce` stopped to plan the slice again: the commits that landed change the slice's own
 * files (`moved`; empty when the branch changed), or a hook refused a tree HEAD had left (`refused`
 * is its output, said if the last attempt ends so).
 */
type Moved = { moved: string[]; refused?: string; hint?: string }

/**
 * Whether two refusals say the same thing, colour codes and run times aside. A hook that refuses
 * the slice with the same words on the new HEAD judged the slice, not the HEAD that moved under it.
 */
function precedingDigits(text: string, end: number, minimum: number): number {
  let start = end
  while (start > minimum && /\d/.test(text[start - 1] ?? "")) start--
  return start
}

function withoutRunTimes(text: string): string {
  const parts: string[] = []
  let copied = 0
  for (const unit of text.matchAll(/(?:ms|s|sec|secs|seconds|min)\b/g)) {
    const end = unit.index ?? 0
    let digits = end
    while (digits > copied && /\s/.test(text[digits - 1] ?? "")) digits--
    let start = precedingDigits(text, digits, copied)
    if (start === digits) continue
    if (text[start - 1] === "." || text[start - 1] === ",") {
      const whole = precedingDigits(text, start - 1, copied)
      if (whole < start - 1) start = whole
    }
    parts.push(text.slice(copied, start), "<time>")
    copied = end + unit[0].length
  }
  return parts.join("") + text.slice(copied)
}

export function sameRefusal(a: string, b: string): boolean {
  const plain = (text: string) =>
    withoutRunTimes(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips the colour codes of a hook's output
      text.replace(/\u001b\[[0-9;]*m/g, ""),
    )
      .replace(/\s+/g, " ")
      .trim()
  return plain(a) === plain(b)
}

/** What the check for changed files no card names needs to know. */
export type UnnamedCheck = {
  /** Every path the Plan's cards name, of every slice: another slice's file is not left behind. */
  named: string[]
  /** Other uncommitted slices retain the paths declared by their cards. */
  otherSlices?: { n: number; files: string[] }[]
  /** Folders of the task's own records (its plan folder), which go in by their own rules. */
  records: string[]
  /** What the checkout held when the build started (`workState`); null when it was not recorded. */
  start: Record<string, string> | null
  /** The content of each tracked file that was already changed then, as stored blobs: `startBlobs`. */
  blobs?: Record<string, string>
  /** HEAD when the dirty baseline was recorded; without it the overlap guard stays. */
  baselineHead?: string
  /** This task's own commits since the build began: every other commit's change to a slice file is kept. */
  ownCommits?: string[]
  /** Approved card paths and staged paths captured with the build-start blobs; absent in legacy records. */
  approvedFiles?: string[]
  stagedBeforeBuild?: string[]
  /** Changed repository-relative paths outside this selection; an overlapping slice path is refused. */
  leave: string[]
  /**
   * Of the slice's changed paths, those a session building another task changed after their
   * latest commit, each with that task: its uncommitted edits may sit in the same file.
   */
  foreign?: (paths: string[]) => Promise<Record<string, string>>
  /**
   * For a commit whose files are not fixed by a card (a fix): the command that commits the rest
   * without such a file, said before the refusal's other ways.
   */
  foreignMove?: (path: string) => string
  /** Exact working bytes written by this operation; a retry must not take a replacement writer's input. */
  written?: Record<string, string>
}

/**
 * The changed files the slice's commit would leave behind although no card names them: neither
 * the slice's own, another slice's, the task's records, left out by name, staged and left as
 * staged (someone's own staging), nor there before the build and untouched since.
 */
async function leftBehind(
  root: string,
  taken: string[],
  check: UnnamedCheck,
): Promise<string[] | null> {
  const entries = await statusEntries(root)
  if (entries === null) return null
  const known = [...check.named, ...check.records, ...check.leave]
  const left: string[] = []
  for (const [path, letters] of entries) {
    if (taken.includes(path) || known.some((entry) => covers(entry, path))) continue
    if (letters[1] === " " && letters[0] !== " " && letters[0] !== "?") continue
    const before = check.start?.[path]
    if (before !== undefined && before === (await fileState(root, path))) continue
    left.push(path)
  }
  return left.sort()
}

/** The reply's one line about changed files no card names: they stay in the working copy. left_out names them. */
function leftBehindMessage(left: string[]): string {
  return ` ${left.length} changed file${left.length === 1 ? "" : "s"} no card names stayed in the working copy. Check the full left_out list for helper or test files this task needs. Add missing task-owned paths to their cards with qualitylayer plan amend --by agent --for T<n> --add-file <path> --note "<why>", then commit the missing changes. Keep other sessions' edits out.`
}

/** Whether output names a file by the module name an import of it carries: `./records` for `src/records.ts`. */
function importedIn(output: string, path: string): boolean {
  const stem = (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "")
  if (stem.length < 3) return false
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`[/'"\`]${escaped}(?![\\w-])`).test(output)
}

/** What a hook's refusal adds when its output names a changed file that is not in the commit's tree. */
function unnamedHint(left: string[], output: string, others: OtherSliceFile[] = []): string {
  return `${otherSliceHint(others, output)}${noCardHint(left, output)}`
}

/** A changed file of another slice that is not committed yet. */
type OtherSliceFile = { n: number; path: string }

/**
 * The hook output names a changed file of another slice that is not committed yet (an import of
 * it, say): the commit's tree holds HEAD's version of it, or none. Committing that slice first, or
 * the two together, puts it there.
 */
function otherSliceHint(others: OtherSliceFile[], output: string): string {
  const named = others.filter(({ path }) => output.includes(path) || importedIn(output, path))
  const first = named[0]
  if (first === undefined) return ""
  const files = named.filter(({ n }) => n === first.n).map(({ path }) => path)
  const one = files.length === 1
  return `\nThe hook output names ${files.slice(0, 5).join(", ")}, ${one ? "a changed file" : "changed files"} of slice ${first.n}, which is not committed yet, so ${one ? "its change is" : "their changes are"} not in the tree the hook checked. Commit slice ${first.n} first: \`qualitylayer commit slice ${first.n}\`. If the two slices only pass together, commit them in one commit with \`qualitylayer commit slices <n> <m>\`.`
}

/**
 * The hook output names a changed file no card names (an import it could not resolve, say): that
 * file stayed out of the commit's tree, which is why the hook failed. Say how to add it to a card.
 */
function noCardHint(left: string[], output: string): string {
  const named = left.filter((path) => output.includes(path) || importedIn(output, path))
  if (named.length === 0) return ""
  const one = named.length === 1
  return `\nThe hook output names ${named.slice(0, 5).join(", ")}, changed ${one ? "a file" : "files"} no card names, so ${one ? "it is" : "they are"} not in the tree the hook checked. If ${one ? "it is" : "they are"} this task's own, add ${one ? "it" : "them"} to ${one ? "its" : "their"} card with qualitylayer plan amend --by agent --for T<n> --add-file <path> --note "<why>", then commit again. Other sessions' files stay out.`
}

/**
 * Commit the slice's files: `listed` are the paths its cards name (a folder stands for every
 * changed file below it), `alsoIfTracked` ones such as the build log go in only when git tracks
 * them. Refuses, naming the file, when a file's staged edits and the slice's edits cannot be told
 * apart; then nothing has changed. The commit is built on the HEAD it was planned from: when
 * another commit lands meanwhile, it is planned again on the new HEAD rather than reverting it.
 */
export async function commitSlice(
  root: string,
  listed: string[],
  alsoIfTracked: string[],
  message: string,
  /** Refuse while a changed file no card names would be left behind; no check without it. */
  unnamed?: UnnamedCheck,
  /** Exact files whose staged edits the session explicitly owns. */
  takeStaged: string[] = [],
  /** A validated group; its commands are read from the Plan rather than passed as shell text. */
  selectedSlices?: number[],
  /** Exact files whose captured unstaged pre-build content the caller explicitly claims. */
  take: string[] = [],
  /** A closing approval's authority must still hold on every parent replan and hook retry. */
  authority?: (candidate: string) => Promise<Result<true>>,
): Promise<Result<SliceCommit>> {
  // A merge or another operation under way is refused before anything is read or written.
  const pending = await operationInProgress(root)
  if (pending !== null) return err({ code: "bad_args", message: pending })
  const scopeError = await commitScopeError(root, listed)
  if (scopeError) return err({ code: "bad_args", message: scopeError })
  // Another commit landing on HEAD does not start a slice over unless it changed the slice's own
  // files (see slice-land.ts); only that is planned and checked again, on the HEAD it finds.
  // A hook's refusal while HEAD moved is tried once more, since the hook may have compared the tree
  // with a HEAD it had left. The same refusal on the new HEAD is the hook's own word on the slice:
  // no further try changes it, so it is reported at once.
  let collided: string[] = []
  let refused: string | undefined
  let hint = ""
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const made = await commitOnce(
      root,
      listed,
      alsoIfTracked,
      message,
      unnamed,
      takeStaged,
      selectedSlices,
      take,
      authority,
    )
    if (!("moved" in made))
      return made.ok && attempt > 1 ? ok({ ...made.data, parentRetries: attempt - 1 }) : made
    collided = made.moved
    if (made.refused !== undefined && refused !== undefined && sameRefusal(made.refused, refused))
      return err({
        code: "commit_rejected",
        message: `git commit refused the slice's commit; nothing was committed. HEAD moved while the hooks ran, so the slice was checked again on the new HEAD and got the same refusal: it is about the slice or its message, and running the command again will not change it. Fix what it names, then commit again:\n${made.refused}${made.hint ?? ""}`,
      })
    refused = made.refused
    hint = made.hint ?? ""
    if (attempt < ATTEMPTS)
      process.stderr.write(
        `Commit parent changed${collided.length > 0 ? ` in ${collided.slice(0, 5).join(", ")}` : " while the hooks ran"}; preparing and checking the new tree (attempt ${attempt + 1} of ${ATTEMPTS}). Other commits are kept.\n`,
      )
  }
  if (refused !== undefined)
    return err({
      code: "commit_rejected",
      message: `git commit refused the slice's commit; nothing was committed. HEAD moved while the hooks ran, ${ATTEMPTS} times in a row, and the hooks' refusals differed, so they may come from the HEAD that moved. If the last one, below, names the slice's own files or message, fix that; otherwise run the command again:\n${refused}${hint}`,
    })
  return err({ code: "bad_args", message: movedRefusal(collided) })
}

/** The refusal when HEAD moved onto the slice's own files on every attempt: it names the move left. */
function movedRefusal(collided: string[]): string {
  const files = collided.slice(0, 5).join(", ") + (collided.length > 5 ? " and more" : "")
  const what =
    collided.length > 0 ? `commits that change ${files}` : "other commits or a change of branch"
  return `HEAD moved onto ${what} on each of ${ATTEMPTS} tries, with edits that overlap the slice's, so nothing was committed. Run the same command again: it plans the slice on the HEAD it finds.`
}

/**
 * A commit someone made by hand that holds a slice's work: it must exist, be an ancestor of HEAD
 * and touch at least one file the slice's cards name. Nothing is committed or changed; the caller
 * releases the slice on the hash returned.
 */
export async function existingSliceCommit(
  root: string,
  hash: string,
  listed: string[],
): Promise<Result<{ commit: string; subject: string; files: string[] }>> {
  const scopeError = await commitScopeError(root, listed)
  if (scopeError) return err({ code: "bad_args", message: scopeError })
  if (!/^[0-9a-f]{4,64}$/i.test(hash))
    return err({ code: "bad_args", message: "--commit needs a commit hash (hex digits only)" })
  const found = await git(root, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`])
  const commit = found.text.trim()
  if (found.code !== 0 || commit === "")
    return err({ code: "bad_args", message: `no commit ${hash} in this repository` })
  const ancestor = await git(root, ["merge-base", "--is-ancestor", commit, "HEAD"])
  if (ancestor.code !== 0)
    return err({
      code: "bad_args",
      message: `commit ${commit.slice(0, 9)} is not an ancestor of HEAD: it is not on the branch this checkout is on, so the slice cannot be released on it`,
    })
  const touched = await git(root, [
    "diff-tree",
    "--root",
    "-m",
    "--no-commit-id",
    "--name-only",
    "-r",
    "-z",
    commit,
  ])
  const files = [...new Set(touched.text.split("\0").filter((path) => path !== ""))]
  const own = files.filter((path) => listed.some((entry) => covers(entry, path)))
  if (own.length === 0)
    return err({
      code: "bad_args",
      message: `commit ${commit.slice(0, 9)} touches none of the files this slice's cards name (${listed.join(", ") || "none"}); it is not the slice's work`,
    })
  const subject = (await git(root, ["log", "-1", "--format=%s", commit])).text.trim()
  return ok({ commit, subject, files: own })
}

/**
 * What the slice's commit does with one changed path, planned on `base`: the change, null when the
 * slice made no edit of its own there, or why it cannot be split (a link, overlapping hunks).
 */
async function planPath(
  root: string,
  base: string,
  scratch: string,
  path: string,
  takeStaged = false,
  /** The blob of this file as the build found it, when another session's edits were already in it. */
  startBlob?: string,
  takePrebuild = false,
  written?: string,
): Promise<Change | null | string> {
  const head = await headEntry(root, base, path)
  const staged = await indexEntry(root, path)
  // Ownership names the staged entry exactly; further working-copy edits remain unstaged.
  if (takeStaged)
    return { path, stagedBefore: staged, committed: staged, index: staged, keptStaged: false }
  const place = join(root, path)
  const info = await lstat(place).catch(() => null)
  if (info?.isSymbolicLink() === true) return "is a link, which a slice commit does not split"
  const work = info === null ? null : new Uint8Array(await readFile(place))
  if (
    written !== undefined &&
    (work === null || createHash("sha256").update(work).digest("hex") !== written)
  )
    return "changed after this operation wrote it; its current bytes were kept"
  if (same(head, staged)) {
    // Nobody staged anything here: the file goes in as the work tree has it.
    if (work === null)
      return head === null
        ? null
        : { path, stagedBefore: staged, committed: null, index: null, keptStaged: false }
    // Edits another session left in this file before the build are not the slice's: only what the
    // build added on top of them goes in, laid onto HEAD, and the rest stays in the work tree.
    let content: Uint8Array = work
    if (startBlob !== undefined && !takePrebuild && head !== null) {
      const atStart = await smudged(root, startBlob, path)
      const atHead = await smudged(root, `${base}:${path}`)
      if (atStart !== null && atHead !== null && !equal(atStart, atHead)) {
        if (equal(atStart, work)) return null
        const own = await merge3(scratch, atHead, atStart, work)
        if (own === null)
          return "has edits from before the build that overlap the slice's: if they are this task's own, run `qualitylayer commit slice <n> --take <file>` (never claim unknown ownership)"
        content = own
      }
    }
    const sha = await stored(root, path, content)
    if (sha === null) return "could not be stored"
    const entry = {
      mode: head?.mode ?? (info !== null && (info.mode & 0o111) !== 0 ? "100755" : "100644"),
      sha,
    }
    return same(head, entry)
      ? null
      : { path, stagedBefore: staged, committed: entry, index: entry, keptStaged: false }
  }
  // Earlier staged edits: only what the slice added on top of them goes in.
  if (work === null && staged === null)
    return `has only staged changes with unknown ownership: if they are this task's, commit again with \`--take-staged ${path}\``
  if (work === null || staged === null) return "has a staged deletion or was deleted after staging"
  const atHead = head === null ? new Uint8Array() : await smudged(root, `${base}:${path}`)
  const atIndex = await smudged(root, `:${path}`)
  if (atHead === null || atIndex === null) return "could not be read through its filter"
  // The slice made no edit of its own here: the staged edits stay as they are.
  if (equal(work, atIndex))
    return `has only staged changes with unknown ownership: if they are this task's, commit again with \`--take-staged ${path}\``
  const committed = await merge3(scratch, atHead, atIndex, work)
  if (committed === null) return "has staged edits that overlap the slice's edits"
  const after = await merge3(scratch, committed, atHead, atIndex)
  if (after === null) return "has staged edits that overlap the slice's edits"
  const [committedSha, indexSha] = [
    await stored(root, path, committed),
    await stored(root, path, after),
  ]
  if (committedSha === null || indexSha === null) return "could not be stored"
  return {
    path,
    stagedBefore: staged,
    committed: { mode: head?.mode ?? staged.mode, sha: committedSha },
    index: { mode: staged.mode, sha: indexSha },
    keptStaged: true,
  }
}

/** Equal-position byte lines prove retained edits without Git's adjacent-hunk merge ambiguity. */
function retainsLineChanges(before: Uint8Array, applied: Uint8Array, holder: Uint8Array): boolean {
  const rows = [before, applied, holder].map((bytes) =>
    Buffer.from(bytes).toString("latin1").split("\n"),
  )
  const [old, changed, current] = rows as [string[], string[], string[]]
  return (
    old.length === changed.length &&
    changed.length === current.length &&
    changed.every((line, index) => line === old[index] || line === current[index])
  )
}

/** Current HEAD must contain the baseline; an earlier commit may have been reverted. */
async function baselineCommitted(
  root: string,
  from: string | undefined,
  to: string,
  path: string,
  blob: string,
): Promise<boolean> {
  if (from === undefined || !/^[0-9a-f]{40,64}$/.test(from)) return false
  if ((await git(root, ["merge-base", "--is-ancestor", from, to])).code !== 0) return false
  const [captured, current, original] = await Promise.all([
    smudged(root, blob, path),
    smudged(root, `${to}:${path}`),
    smudged(root, `${from}:${path}`),
  ])
  if (captured === null || current === null || original === null) return false
  if (equal(captured, current)) return true
  if (retainsLineChanges(original, captured, current)) return true
  const dir = await mkdtemp(join(tmpdir(), "qualitylayer-baseline-"))
  try {
    const applied = await merge3(dir, current, original, captured)
    return applied !== null && equal(applied, current)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Whether every hunk the build start captured (original → captured) is in HEAD's file, each added
 * block present whole and each removed block gone. Unlike a three-way merge it accepts hunks that
 * sit next to the task's own committed lines; only an explicit --take relies on it.
 */
async function capturedHunksInHead(
  root: string,
  from: string | undefined,
  to: string,
  path: string,
  blob: string,
): Promise<boolean> {
  if (from === undefined || !/^[0-9a-f]{40,64}$/.test(from)) return false
  if ((await git(root, ["merge-base", "--is-ancestor", from, to])).code !== 0) return false
  const [captured, current, original] = await Promise.all([
    smudged(root, blob, path),
    smudged(root, `${to}:${path}`),
    smudged(root, `${from}:${path}`),
  ])
  if (captured === null || current === null || original === null) return false
  const dir = await mkdtemp(join(tmpdir(), "qualitylayer-hunks-"))
  try {
    await Promise.all([writeFile(join(dir, "a"), original), writeFile(join(dir, "b"), captured)])
    const diff = await git(dir, ["diff", "--no-index", "--no-color", "-U0", "a", "b"])
    const now = `\n${Buffer.from(current).toString("utf8")}`
    // Each hunk is the lines after an `@@ … @@` header up to the next header.
    const hunks: string[] = []
    for (const line of diff.text.split("\n")) {
      if (line.startsWith("@@")) hunks.push("")
      else if (hunks.length > 0) hunks[hunks.length - 1] += `${line}\n`
    }
    if (hunks.length === 0) return false
    return hunks.every((hunk) => {
      const lines = hunk.split("\n")
      const added = lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1))
      const removed = lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1))
      const block = (rows: string[]) => `\n${rows.join("\n")}\n`
      if (added.length > 0 && !now.includes(block(added))) return false
      return removed.length === 0 || added.length > 0 || !now.includes(block(removed))
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Above this size a file is told apart by its size and time rather than read whole. */
const HASH_LIMIT = 64 * 1024 * 1024

/** What one path holds in the work tree, in a word that changes when its content does. */
async function fileState(root: string, path: string): Promise<string> {
  const info = await lstat(join(root, path)).catch(() => null)
  return info === null
    ? "gone"
    : info.isFile() && info.size <= HASH_LIMIT
      ? String(Bun.hash(await readFile(join(root, path))))
      : `${info.size}:${info.mtimeMs}`
}

/**
 * What each path git reports as changed holds in the work tree: to see what a hook rewrote, and,
 * recorded when the build starts, which changes were there before it.
 */
export async function workState(
  root: string,
  env?: Record<string, string | undefined>,
): Promise<Map<string, string> | null> {
  const changed = await changedPaths(root, env)
  if (changed === null) return null
  const seen = new Map<string, string>()
  for (const path of changed) seen.set(path, await fileState(root, path))
  return seen
}

/** A changed file larger than this is not kept as a blob when the build starts. */
const BLOB_LIMIT = 1024 * 1024

/**
 * The content of each of these tracked files as the build finds it, stored as a git blob through
 * the file's clean filter (git-crypt's for an encrypted path). `commit slice` later lays only what
 * the build added on top of it onto HEAD, so another session's earlier edits in the same file
 * are not committed with the slice.
 */
export async function startBlobs(
  root: string,
  paths: Iterable<string>,
): Promise<Record<string, string>> {
  const blobs: Record<string, string> = {}
  for (const path of paths) {
    const info = await lstat(join(root, path)).catch(() => null)
    if (info === null || !info.isFile() || info.size > BLOB_LIMIT) continue
    if ((await headEntry(root, "HEAD", path)) === null) continue
    const sha = await stored(root, path, new Uint8Array(await readFile(join(root, path))))
    if (sha !== null) blobs[path] = sha
  }
  return blobs
}

/** The paths whose work-tree content differs between two looks. */
function rewritten(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort()
}

/**
 * After a commit its hook refused: the slice's files the hook rewrote, planned again and staged in
 * the temporary index, when those are all it changed (a formatter). Null when anything else changed,
 * nothing did, or a rewritten file can no longer be planned: then the refusal stands.
 */
async function restageReformatted(
  root: string,
  tree: string,
  scratch: string,
  env: Record<string, string | undefined>,
  changes: Change[],
  before: Map<string, string>,
): Promise<string[] | null> {
  const after = await workState(tree, env)
  if (after === null) return null
  const touched = rewritten(before, after)
  const own = new Set(changes.filter((c) => c.committed !== null).map((c) => c.path))
  if (touched.length === 0 || !touched.every((path) => own.has(path))) return null
  const replanned: Change[] = []
  for (const path of touched) {
    const change = changes.find((c) => c.path === path)
    if (change?.committed === null || change === undefined) return null
    const before = await smudged(root, change.committed.sha, path)
    const priorIndex = change.index === null ? null : await smudged(root, change.index.sha, path)
    const formatted = await readFile(join(tree, path)).catch(() => null)
    if (before === null || priorIndex === null || formatted === null) return null
    const index = await merge3(scratch, priorIndex, before, formatted)
    if (index === null) return null
    const sha = await stored(root, path, formatted)
    const indexSha = await stored(root, path, index)
    if (sha === null || indexSha === null) return null
    replanned.push({
      ...change,
      committed: { ...change.committed, sha },
      index: { mode: change.index?.mode ?? change.committed.mode, sha: indexSha },
    })
  }
  const put = await git(root, ["update-index", "--index-info"], {
    env,
    input: replanned.map((c) => infoLine(c.path, c.committed)).join(""),
  })
  if (put.code !== 0) return null
  for (const change of replanned) changes[changes.findIndex((c) => c.path === change.path)] = change
  return touched
}

/**
 * Apply a successful hook's formatting to the checkout only where it still holds the content the
 * commit started with. Concurrent edits keep their own work, and earlier staging stays in the index.
 */
async function applyFormatting(
  root: string,
  scratch: string,
  reformatted: string[],
  o: {
    changes: Change[]
    original: Map<string, Uint8Array>
    beforeFormatting: Map<string, Entry | null>
  },
): Promise<void> {
  for (const path of reformatted) {
    const held = o.original.get(path)
    const current = await readFile(join(root, path)).catch(() => null)
    if (held === undefined || current === null || !equal(held, current)) continue
    const change = o.changes.find((c) => c.path === path)
    const priorEntry = o.beforeFormatting.get(path)
    if (change?.committed === null || change === undefined || priorEntry == null) continue
    const prior = await smudged(root, priorEntry.sha, path)
    if (prior === null) continue
    const formatted = await smudged(root, change.committed.sha, path)
    if (formatted === null) continue
    const merged = await merge3(scratch, held, prior, formatted)
    if (merged !== null) await writeFile(join(root, path), merged)
  }
}

/**
 * After hooks that passed: the slice's own files a hook staged again in the private index (a
 * generator or formatter that ran `git add`). The commit holds what the hook staged, so the plan
 * follows it: the checkout's index is brought on to that content and its work tree gets it where
 * it still holds what the commit started with, as for a file a failing hook reformatted. A file
 * whose staged content cannot be laid under earlier staged edits keeps its planned index entry.
 */
async function adoptRestaged(
  root: string,
  scratch: string,
  index: string,
  changes: Change[],
): Promise<string[]> {
  const adopted: string[] = []
  for (const [at, change] of changes.entries()) {
    if (change.committed === null) continue
    const staged = await indexEntry(root, change.path, { GIT_INDEX_FILE: index })
    if (staged === null || same(staged, change.committed)) continue
    let after: Entry | null = staged
    if (change.keptStaged && change.index !== null) {
      const [planned, kept, hooked] = await Promise.all([
        smudged(root, change.committed.sha, change.path),
        smudged(root, change.index.sha, change.path),
        smudged(root, staged.sha, change.path),
      ])
      const merged = planned && kept && hooked ? await merge3(scratch, kept, planned, hooked) : null
      const sha = merged === null ? null : await stored(root, change.path, merged)
      after = sha === null ? change.index : { mode: change.index.mode, sha }
    }
    changes[at] = { ...change, committed: staged, index: after }
    adopted.push(change.path)
  }
  return adopted
}

/** What `commitThroughHooks` needs of the plan and the checked snapshot. */
type HookRun = {
  root: string
  scratch: string
  tree: string
  /** The temporary index the commit is made from. */
  index: string
  hookEnv: Record<string, string | undefined>
  message: string
  changes: Change[]
  /** The checkout's changed paths before the hooks ran; null when git could not say. */
  before: Map<string, string> | null
  authority: ((candidate: string) => Promise<Result<true>>) | undefined
  ref: string | null
  /** The HEAD the snapshot stands on. */
  from: string
  /** Changed files no card names, for a refusal's hint. */
  left: string[]
  /** Changed files of other slices that are not committed yet, for a refusal's hint. */
  others: OtherSliceFile[]
  /** The last check of the selected inputs; null when none are guarded. */
  inputs: (() => Promise<boolean>) | null
  rebase: Rebase
}

/** Why a selected input no longer stands, for the refusal. */
const INPUTS_CHANGED =
  "A selected input gained foreign edits or its index changed during checks. Nothing was committed."

/**
 * The hooks `git commit` runs before it makes a commit, in its order: pre-commit, then
 * prepare-commit-msg and commit-msg on the message. The message is in a file of this commit's own
 * (`file`), never git's shared `COMMIT_EDITMSG`, which a commit another session makes at the same
 * moment writes and reads too. Returns the first hook's run that refused, or the message as the
 * hooks left it, cleaned as `git commit -m` cleans it.
 */
async function runCommitHooks(
  tree: string,
  hookEnv: Record<string, string | undefined>,
  file: string,
  message: string,
): Promise<{ refused: Run } | { message: string; author: Record<string, string> }> {
  // As git has it for a commit that opens no editor.
  const env = { ...hookEnv, GIT_EDITOR: ":" }
  await writeFile(file, `${message.trimEnd()}\n`)
  const first = await runHook(tree, env, "pre-commit")
  if (first.code !== 0) return { refused: first }
  // Git settles the author once pre-commit has passed and names it to the hooks that follow; the
  // commit is made with the same name and time.
  const ident = await git(tree, ["var", "GIT_AUTHOR_IDENT"], { env })
  const parts = ident.text.trim().match(/^(.*) <([^>]*)> (\d+ [+-]\d{4})$/)
  const author: Record<string, string> =
    ident.code === 0 && parts !== null
      ? {
          GIT_AUTHOR_NAME: parts[1] ?? "",
          GIT_AUTHOR_EMAIL: parts[2] ?? "",
          GIT_AUTHOR_DATE: `@${parts[3]}`,
        }
      : {}
  for (const [name, args] of [
    ["prepare-commit-msg", [file, "message"]],
    ["commit-msg", [file]],
  ] as const) {
    const run = await runHook(tree, { ...env, ...author }, name, [...args])
    if (run.code !== 0) return { refused: run }
  }
  const cleaned = await git(tree, ["stripspace"], { input: await readFile(file) })
  if (cleaned.code !== 0) return { refused: cleaned }
  if (cleaned.text.trim() === "")
    return {
      refused: { ...cleaned, code: 1, stderr: "Aborting commit due to empty commit message." },
    }
  return { message: cleaned.text, author }
}

/**
 * Run the repository's hooks once on the checked tree, and end with the slice's commit on HEAD:
 * made from the checked snapshot with the message the hooks left, and moved into place only if
 * HEAD is still the commit it was made on (slice-land.ts). When HEAD moved while the hooks ran,
 * the checked commit is put on the new HEAD without running them again; `Moved` when a commit
 * that landed changes the slice's own files, or a hook refused a tree HEAD had left.
 */
async function commitThroughHooks(
  o: HookRun,
): Promise<Result<{ sha: string; reformatted: string[] | null; placedOn?: string }> | Moved> {
  const { root, tree, hookEnv, message, authority, from } = o
  const admit = async (): Promise<Result<true>> => (authority ? authority(tree) : ok(true))
  const admitted = await admit()
  if (!admitted.ok) return admitted
  const said = (run: Run) => `${run.text}${run.stderr}`.trim()
  const messageFile = join(o.scratch, "COMMIT_EDITMSG")
  let hooked = await runCommitHooks(tree, hookEnv, messageFile, message)
  // A hook that reformatted the slice's own files and failed for that alone: they are staged
  // again and the commit is tried once more. Any other refusal stands.
  const reformatted =
    "refused" in hooked && o.before !== null
      ? await restageReformatted(root, tree, o.scratch, hookEnv, o.changes, o.before)
      : null
  if (reformatted !== null) {
    const again = await admit()
    if (!again.ok) return again
    hooked = await runCommitHooks(tree, hookEnv, messageFile, message)
  }
  if ("refused" in hooked) {
    const output = said(hooked.refused)
    const hint = unnamedHint(o.left, output, o.others)
    // A hook that ran while HEAD moved may have judged a tree HEAD had left: planned again.
    const head = await git(root, ["rev-parse", "--verify", "HEAD"])
    if (head.code === 0 && head.text.trim() !== from) return { moved: [], refused: output, hint }
    return err({
      code: "commit_rejected",
      message: `git commit refused the slice's commit; nothing was committed:\n${output}${hint}`,
    })
  }
  // As `git commit` refuses a commit that changes nothing, when a hook took the slice's change back.
  const same = await git(root, ["diff-index", "--cached", "--quiet", from], {
    env: { GIT_INDEX_FILE: o.index },
  })
  if (same.code === 0)
    return err({
      code: "commit_rejected",
      message:
        "git commit refused the slice's commit; nothing was committed:\nnothing to commit: after the hooks ran, the slice's tree holds no change.",
    })
  const placed = await placeOnHead(root, {
    from,
    ref: o.ref,
    index: o.index,
    tree: authority ? tree : undefined,
    message: hooked.message,
    author: hooked.author,
    rebase: o.rebase,
    // The last checks on a HEAD that moved, on the snapshot as it will be committed there.
    ready: async (head) => {
      if (head === from) return ok(true)
      return o.inputs !== null && !(await o.inputs())
        ? err({ code: "bad_args", message: INPUTS_CHANGED })
        : admit()
    },
  })
  if ("replan" in placed) return { moved: placed.replan }
  if (!placed.ok) return placed
  await runPostCommit(tree, { ...hookEnv, ...hooked.author, GIT_EDITOR: ":" })
  // What a hook staged again of the slice's own files is in the commit: the checkout follows it.
  const restaged = await adoptRestaged(root, o.scratch, o.index, o.changes)
  const rewritten = [...new Set([...(reformatted ?? []), ...restaged])]
  const reformattedAll = rewritten.length > 0 ? rewritten : reformatted
  if (placed.data.parent === from) return ok({ sha: placed.data.sha, reformatted: reformattedAll })
  process.stderr.write(
    "HEAD moved while the hooks ran; the checked commit went on top of the commits that landed without running the hooks again.\n",
  )
  return ok({ sha: placed.data.sha, reformatted: reformattedAll, placedOn: placed.data.parent })
}

/** An explicit claim (`--take`) on a file's captured pre-build content, validated against HEAD and the index. */
type Claim = { path: string; blob: string; staged: Entry | null }

/**
 * The `--take` claims that still stand (an obsolete one is dropped), or why one is refused; and
 * whether each `--take-staged` file is staged and the slice's. Nothing is committed on a refusal.
 */
async function validatedClaims(
  root: string,
  base: string,
  o: {
    take: string[]
    takeStaged: string[]
    wanted: (path: string) => boolean
    changed: Set<string>
    unnamed: UnnamedCheck | undefined
  },
): Promise<Result<Claim[]>> {
  const { take, takeStaged, wanted, changed, unnamed } = o
  const claims: Claim[] = []
  for (const path of new Set(take)) {
    const blob = unnamed?.blobs?.[path]
    const before = unnamed?.baselineHead
    const head = await headEntry(root, base, path)
    const staged = await indexEntry(root, path)
    const regular = await lstat(join(root, path)).catch(() => null)
    if (
      !wanted(path) ||
      !changed.has(path) ||
      path.startsWith("/") ||
      path.split(/[\\/]/).some((part) => part === ".." || part === "." || part === "") ||
      !blob ||
      !/^[0-9a-f]{40,64}$/.test(blob) ||
      !before ||
      !/^[0-9a-f]{40,64}$/.test(before) ||
      !unnamed?.approvedFiles?.some((entry) => covers(entry, path)) ||
      !unnamed.stagedBeforeBuild ||
      unnamed.stagedBeforeBuild.includes(path) ||
      takeStaged.includes(path) ||
      !regular?.isFile() ||
      regular.isSymbolicLink() ||
      !head ||
      !same(head, staged) ||
      !(await smudged(root, blob, path))
    )
      return err({
        code: "bad_args",
        message: `--take ${path} needs an exact unstaged pre-build blob and approved card file, with unchanged HEAD/index ownership. Nothing was committed; use --take-staged for explicitly owned staged content or inspect the exact hunks with a private index.`,
      })
    // An obsolete explicit claim never grants ownership of later uncommitted hunks.
    if (
      (await baselineCommitted(root, before, base, path, blob)) ||
      (await capturedHunksInHead(root, before, base, path, blob))
    )
      continue
    if (!same(head, await headEntry(root, before, path)))
      return err({
        code: "bad_args",
        message: `--take ${path} cannot claim pre-build content after an unproven same-file HEAD change. Nothing was committed; inspect the exact hunks with a private index.`,
      })
    claims.push({ path, blob, staged })
  }
  for (const path of takeStaged)
    if (
      !wanted(path) ||
      !changed.has(path) ||
      same(await headEntry(root, base, path), await indexEntry(root, path))
    )
      return err({
        code: "bad_args",
        message: `--take-staged names an exact staged file of this slice; ${path} is not one. Nothing was committed.`,
      })
  return ok(claims)
}

/**
 * One plan and commit from the HEAD it starts at. A HEAD that moves on while it is checked is
 * followed (slice-land.ts), so the hooks run once; `Moved` when the slice has to be planned again.
 */
async function commitOnce(
  root: string,
  listed: string[],
  alsoIfTracked: string[],
  message: string,
  unnamed: UnnamedCheck | undefined,
  takeStaged: string[],
  selectedSlices: number[] | undefined,
  take: string[],
  authority: ((candidate: string) => Promise<Result<true>>) | undefined,
): Promise<Result<SliceCommit> | Moved> {
  const headRun = await git(root, ["rev-parse", "--verify", "HEAD"])
  if (headRun.code !== 0)
    return err({ code: "bad_args", message: "this repository has no commit to build on yet" })
  const base = headRun.text.trim()
  const changed = await changedPaths(root)
  if (changed === null)
    return err({ code: "bad_args", message: "git could not read the state of this checkout" })
  const wanted = (path: string) => listed.some((entry) => covers(entry, path))
  const claimed = await validatedClaims(root, base, { take, takeStaged, wanted, changed, unnamed })
  if (!claimed.ok) return claimed
  const claims = claimed.data
  const paths = [...changed].filter(wanted).sort()
  for (const extra of alsoIfTracked) {
    const tracked = (await git(root, ["ls-files", "--error-unmatch", "--", extra])).code === 0
    const newLog =
      Object.values(LOGS).includes(basename(extra)) &&
      (await git(root, ["check-ignore", "--quiet", "--", extra], { pathspecs: true })).code === 1 &&
      (await git(root, ["ls-files", "--error-unmatch", "--", join(dirname(extra), NAMES.plan)]))
        .code === 0
    if (changed.has(extra) && !paths.includes(extra) && (tracked || newLog)) paths.push(extra)
  }
  for (const entry of unnamed?.leave ?? []) {
    const matches = [...changed].filter((path) => covers(entry, path))
    if (matches.length === 0)
      return err({
        code: "bad_args",
        message: `--leave ${entry} matches no changed path. Give paths relative to the repository root, even from a subfolder; nothing was committed.`,
      })
    const selected = matches.find((path) => paths.includes(path))
    if (selected !== undefined)
      return err({
        code: "bad_args",
        message: `--leave ${entry} overlaps a selected slice file or required record: ${selected}. Nothing was committed: a slice cannot be partially committed by excluding one of its files. If it holds another session's work, commit only this slice's intended hunks with a temporary index, then record that commit: a slice's with \`qualitylayer commit slice <n> --commit <hash>\`, a fix's with \`qualitylayer commit fix --commit <hash>\`.`,
      })
  }
  // Another session's changes never stop the slice: the files no card names are said, not refused.
  const firstLeft =
    unnamed === undefined ? [] : await leftBehind(root, [...paths, ...alsoIfTracked], unnamed)
  if (firstLeft === null)
    return err({ code: "bad_args", message: "git could not read the state of this checkout" })
  let left: string[] = firstLeft

  // A file another task's session changed and has not committed holds its half-done edits too: a
  // slice commit takes a file whole, so it is refused by name rather than carried into this commit.
  const foreign = (await unnamed?.foreign?.(paths)) ?? {}
  const shared = paths.find((path) => foreign[path] !== undefined)
  if (shared !== undefined)
    return err({
      code: "bad_args",
      message: `${unnamed?.foreignMove?.(shared) ?? ""}${foreignRefusal(shared, foreign[shared] as string)}`,
    })

  const scratch = await mkdtemp(join(tmpdir(), "qualitylayer-slice-commit-"))
  try {
    const changes: Change[] = []
    for (const path of paths) {
      // A file already changed when the build began keeps its captured baseline's own rules below.
      const kept =
        unnamed?.blobs?.[path] === undefined
          ? await keepOthersCommits(root, scratch, path, {
              from: unnamed?.baselineHead,
              to: base,
              own: unnamed?.ownCommits ?? [],
            })
          : null
      if (kept !== null) {
        if ("unreadable" in kept)
          return err({
            code: "bad_args",
            message: `${path}: ${kept.unreadable}; nothing was committed. Inspect the committed and working versions. Commit only this task's reviewed hunks using a temporary index on HEAD, then record that commit.`,
          })
        const short = kept.conflict.slice(0, 9)
        return err({
          code: "bad_args",
          message: `${path}: commit ${short}, made since the build began, changed the lines this slice changed, and committing the file as it is would undo it; nothing was committed. Bring that change into ${path} (\`git show ${short} -- ${path}\`), then run the same command again.`,
        })
      }
      let startBlob = unnamed?.blobs?.[path]
      const baselineInHead =
        startBlob !== undefined &&
        ((await baselineCommitted(root, unnamed?.baselineHead, base, path, startBlob)) ||
          (take.includes(path) &&
            (await capturedHunksInHead(root, unnamed?.baselineHead, base, path, startBlob))))
      if (startBlob && baselineInHead) {
        const [captured, current, work] = await Promise.all([
          smudged(root, startBlob, path),
          smudged(root, `${base}:${path}`),
          sliceInputFile(root, join(root, path), HASH_LIMIT).catch(() => null),
        ])
        // A stale working copy must still merge newer HEAD hunks instead of restoring old bytes.
        const retained =
          captured && current && work
            ? retainsLineChanges(captured, current, work)
              ? work
              : await merge3(scratch, work, captured, current)
            : null
        if (retained && work && equal(retained, work)) startBlob = undefined
      }
      const plan = (from: string | undefined) =>
        planPath(
          root,
          base,
          scratch,
          path,
          takeStaged.includes(path),
          from,
          claims.some((claim) => claim.path === path),
          unnamed?.written?.[path],
        )
      let planned = await plan(startBlob)
      // The captured pre-build edits are in HEAD, and the agent claims the file with --take: when its
      // later edits overlap them, the file is its own and goes in as the work tree has it.
      if (typeof planned === "string" && baselineInHead && take.includes(path))
        planned = await plan(undefined)
      if (typeof planned === "string")
        return err({
          code: "bad_args",
          // A reason that names its own flag is the move; any other is committed by hand.
          message: `${path} ${planned}; nothing was committed.${
            /--take/.test(planned)
              ? ""
              : " Commit only this slice's reviewed hunks using a temporary index on HEAD, then record the result with `qualitylayer commit slice <n> --commit <hash>` (a fix: `qualitylayer commit fix --commit <hash>`)."
          }`,
        })
      const claimed = claims.find((claim) => claim.path === path)
      if (claimed && planned !== null && !same(planned.stagedBefore, claimed.staged))
        return err({
          code: "bad_args",
          message: `${path}'s index changed after its pre-build claim was validated. Nothing was committed.`,
        })
      if (planned !== null) changes.push(planned)
    }
    const claimsCurrent = async () => {
      for (const claim of claims)
        if (!same(claim.staged, await indexEntry(root, claim.path))) return false
      return (
        Object.keys((await unnamed?.foreign?.(claims.map((claim) => claim.path))) ?? {}).length ===
        0
      )
    }
    const guardedInputs = claims.length > 0 || unnamed?.written !== undefined
    if (guardedInputs && !(await claimsCurrent()))
      return err({
        code: "bad_args",
        message:
          "A selected input gained foreign edits or its index changed. Nothing was committed.",
      })
    // A review-only slice can have no source change. Its receipt does not complete unchecked cards.
    if (changes.length === 0)
      if (selectedSlices !== undefined)
        return err({
          code: "bad_args",
          message:
            "the selected group has no changes git takes; use single-slice no-change receipts instead. Nothing was committed.",
        })
      else
        return ok({
          commit: null,
          subject: null,
          files: [],
          kept_staged: [],
          left_out: left,
          borrowed: [],
          message: `nothing to commit: the slice's files hold no change git takes (a review-only slice, or work kept in a plan folder the repository ignores). This records only the commit outcome; any unchecked work still remains open.${left.length > 0 ? leftBehindMessage(left) : ""}`,
        })

    const env = { GIT_INDEX_FILE: join(scratch, "index") }
    // Seeded from the checkout's own index, the private one knows the unchanged files by their
    // stat; `--reset` then sets every entry to HEAD's and drops whatever anyone had staged.
    let seeded = await seedIndex(root, env.GIT_INDEX_FILE)
    let built = await git(root, ["read-tree", ...(seeded ? ["--reset"] : []), base], { env })
    if (built.code !== 0 && seeded) {
      seeded = false
      await rm(env.GIT_INDEX_FILE, { force: true })
      built = await git(root, ["read-tree", base], { env })
    }
    if (built.code !== 0)
      return err({ code: "bad_args", message: `git read-tree failed: ${built.stderr.trim()}` })
    const put = await git(root, ["update-index", "--index-info"], {
      env,
      input: changes.map((c) => infoLine(c.path, c.committed)).join(""),
    })
    if (put.code !== 0)
      return err({ code: "bad_args", message: `git update-index failed: ${put.stderr.trim()}` })
    // Another writer may have committed since the plan. The checked snapshot (this index, then its
    // checkout) follows HEAD while it is made and checked, so a slice that is busy for minutes is
    // carried over the others' commits rather than started again; it is planned again only when
    // those commits changed its own files (slice-land.ts).
    const ref = await currentRef(root)
    let stands = base
    // A slice file another commit changed meanwhile: that commit and the slice's edits, merged by
    // `git merge-file` as the work tree shows them. Only the slice's own files are merged; an
    // overlap, a staged edit kept beside the slice's or a link is planned again instead.
    const rebase: Rebase = async (path, { base: before, head, slice }) => {
      const change = changes.find((c) => c.path === path)
      if (change === undefined || change.keptStaged || before === null || head === null) return null
      if (slice === null || slice.mode !== head.mode || !/^1006|^1007/.test(slice.mode)) return null
      if (slice.sha === head.sha) return slice
      const [atBase, atHead, atSlice] = await Promise.all([
        smudged(root, before.sha, path),
        smudged(root, head.sha, path),
        smudged(root, slice.sha, path),
      ])
      if (atBase === null || atHead === null || atSlice === null) return null
      const merged = await merge3(await mkdtemp(join(scratch, "rebase-")), atSlice, atBase, atHead)
      const sha = merged === null ? null : await stored(root, path, merged)
      if (sha === null) return null
      const entry = { mode: slice.mode, sha }
      Object.assign(change, { committed: entry, index: entry, rebasedFrom: head })
      return entry
    }
    const catchUp = async (at?: string): Promise<Moved | Result<never> | null> => {
      const followed = await followToHead(root, {
        from: stands,
        ref,
        index: env.GIT_INDEX_FILE,
        tree: at,
        rebase,
      })
      if (!followed.ok) return followed
      if ("replan" in followed.data) return { moved: followed.data.replan }
      stands = followed.data.head
      return null
    }
    const early = await catchUp()
    if (early) return early
    // The hooks see the tree the commit holds, not the working copy.
    const tree = join(scratch, "tree")
    const gitDir = await git(root, ["rev-parse", "--absolute-git-dir"])
    if (gitDir.code !== 0)
      return err({ code: "bad_args", message: "git could not name its directory" })
    // Ignored interpreters may live in the original checkout; tracked inputs still resolve in tree.
    const hookEnv = snapshotEnv({
      ...env,
      ...(seeded ? copiedStatTrust() : {}),
      GIT_DIR: gitDir.text.trim(),
      GIT_WORK_TREE: tree,
      QL_REPO_ROOT: root,
    })
    const out = await checkOut(
      root,
      env.GIT_INDEX_FILE,
      tree,
      seeded ? { env: hookEnv, changed } : undefined,
    )
    if (!out.ok)
      return err({
        code: "bad_args",
        message: `git could not check out the slice's tree for the hooks: ${out.why}`,
      })
    // Both Git's root and the hook's working directory resolve to the committed snapshot.
    // The git directory remains the real one: all configured hooks, filters and refs are retained.
    const original = new Map<string, Uint8Array>()
    const beforeFormatting = new Map(changes.map((c) => [c.path, c.committed]))
    for (const c of changes)
      if (c.committed !== null) {
        const content = await readFile(join(root, c.path)).catch(() => null)
        if (content !== null) original.set(c.path, content)
      }
    let before = await workState(tree, hookEnv)
    // A copied file git finds different from the commit's tree was written in the checkout after
    // its state was read: git checks it out instead, so the hooks see the tree that is committed.
    const stale = [...(before?.keys() ?? [])].filter((path) => out.copied.has(path))
    if (stale.length > 0) {
      const fixed = await checkOutPaths(tree, hookEnv, stale)
      if (fixed !== null && fixed.code !== 0)
        return err({
          code: "bad_args",
          message: `git could not check out the slice's tree for the hooks: ${fixed.stderr.trim()}`,
        })
      before = await workState(tree, hookEnv)
    }
    if (guardedInputs && !(await claimsCurrent()))
      return err({ code: "bad_args", message: INPUTS_CHANGED })
    // The snapshot catches up once more right before git reads HEAD for the commit's parent, so the
    // hooks judge the tree on top of whatever landed during the checkout and the reads above.
    const late = await catchUp(tree)
    if (late) return late
    const hooked = await commitThroughHooks({
      root,
      scratch,
      tree,
      index: env.GIT_INDEX_FILE,
      hookEnv,
      message,
      changes,
      before,
      authority,
      ref,
      from: stands,
      left,
      others: [...changed].flatMap((path) => {
        if (paths.includes(path)) return []
        const slice = unnamed?.otherSlices?.find((s) => s.files.some((f) => covers(f, path)))
        return slice === undefined ? [] : [{ n: slice.n, path }]
      }),
      inputs: guardedInputs ? claimsCurrent : null,
      rebase,
    })
    if ("moved" in hooked) return hooked
    if (!hooked.ok) return hooked
    const { sha, reformatted, placedOn } = hooked.data
    if (placedOn !== undefined && unnamed !== undefined) {
      // Files changed since the plan, and those the other sessions committed meanwhile, are not left behind now.
      const lately = await leftBehind(root, [...paths, ...alsoIfTracked], unnamed)
      if (lately !== null) left = lately
    }

    // The index goes on from the new commit with the earlier staged edits on top of it, for the
    // paths nobody staged anew meanwhile: an edit staged since the plan is theirs and stays.
    const updated = await bringIndexOn(root, changes)
    if (!updated.ok)
      return err({
        code: "bad_args",
        message: indexNotBroughtOn(sha, updated.why, updated.stale, changes.length),
      })
    await applyFormatting(root, scratch, reformatted ?? [], { changes, original, beforeFormatting })
    const subject = (await git(root, ["log", "-1", "--format=%s", sha])).text.trim()
    const files = changes.map((c) => c.path)
    const merged = changes.filter((c) => c.rebasedFrom !== undefined).map((c) => c.path)
    const behind =
      placedOn === undefined
        ? ""
        : (await git(root, ["rev-list", "--count", `${base}..${placedOn}`])).text.trim()
    const carried =
      (placedOn === undefined
        ? ""
        : ` HEAD moved while the hooks ran${behind === "" ? "" : ` (${behind} commit${behind === "1" ? "" : "s"} by others)`}; ${merged.length === 0 ? "none changes this slice's files, so " : ""}the checked commit went on top of ${placedOn.slice(0, 8)} without running the hooks again.`) +
      (merged.length === 0
        ? ""
        : ` Another commit changed ${merged.join(", ")} meanwhile; the slice's edits were merged onto it.`)
    const formatted =
      reformatted === null
        ? ""
        : ` The repository's hook reformatted ${reformatted.length} file${reformatted.length === 1 ? "" : "s"}, which went in as it left ${reformatted.length === 1 ? "it" : "them"}.`
    const extras = `${formatted}${carried}${left.length > 0 ? leftBehindMessage(left) : ""}`
    return ok({
      commit: sha,
      subject,
      files,
      kept_staged: changes.filter((c) => c.keptStaged).map((c) => c.path),
      ...(claims.length
        ? { taken_prebuild: claims.map(({ path, blob }) => ({ path, blob })) }
        : {}),
      left_out: left,
      borrowed: out.borrowed,
      ...(reformatted !== null ? { reformatted } : {}),
      ...(placedOn !== undefined ? { placed_on: placedOn } : {}),
      message: `Committed ${files.length} file${files.length === 1 ? "" : "s"} as ${sha.slice(0, 8)}: ${subject}${extras === "" || /[.!?]$/.test(subject) ? "" : "."}${extras}`,
    })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
