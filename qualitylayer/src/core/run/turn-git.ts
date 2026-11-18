// The git side of a turn snapshot (turn-snapshots.ts): a bounded git call, and the worktree written as a
// tree id through an index of our own (turn-index.ts). Nothing is written into the person's repository:
// the index, refs, stash, working tree and `.git` stay as they were, and `.gitignore` decides what is in
// the tree. The objects a snapshot creates go to an object store of our own (`GIT_OBJECT_DIRECTORY`).
// The calls that create objects (`add`, `write-tree`) cannot see the repository's objects, because git
// would refresh the modification time of an object it finds there; the calls that only read (`read-tree`,
// `diff-tree`) see them as alternates. A file over the size cap is never added: it is left out of the
// index and recorded by size and time (turn-large.ts). The chain per snapshot is `rev-parse`, the store
// size, a file listing, `add -A` and `write-tree` on our index, all inside one time cap.

import { mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import {
  TURN_SNAPSHOT_FILE_MAX_BYTES,
  TURN_SNAPSHOT_FILES_MAX,
  TURN_SNAPSHOT_LARGE_LISTED,
  TURN_SNAPSHOT_MS,
  TURN_STORE_MAX_BYTES,
} from "../home-caps.ts"
import {
  type Call,
  type Out,
  printed,
  readyIndex,
  type SnapshotSkip,
  Stopped,
  stage,
  storeBytes,
} from "./turn-index.ts"
import { findLargeFiles, type LargeFile } from "./turn-large.ts"

export type { SnapshotSkip }

export type SnapshotOptions = {
  timeoutMs?: number
  maxFiles?: number
  /** Byte cap of the run's object store, as the disk counts it. */
  storeMaxBytes?: number
  kept?: number
  signal?: AbortSignal
}

export type Limit = {
  until: number
  signal?: AbortSignal
  maxBytes?: number
  input?: string | Promise<string>
}

/** A split index would put a shared index file into the person's `.git`; ours is always a whole file. */
const GIT = [
  "git",
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.splitIndex=false",
]
const TREE_ID = /^[0-9a-f]{40,64}$/

/** Variables that would send git to another repository or index than the one asked about. */
const ROUTING = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_NAMESPACE",
]

/** The run's own object store, and the object directory of the person's repository, read-only. */
export type ObjectStore = { dir: string; personal: string }

/**
 * The environment of one git call. With a store, objects are created in it; only a call that `reads`
 * also sees the repository's objects.
 */
export function gitEnv(index?: string, store?: ObjectStore, reads = false): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of ROUTING) delete env[name]
  if (index) env.GIT_INDEX_FILE = index
  if (store) {
    env.GIT_OBJECT_DIRECTORY = store.dir
    if (reads) env.GIT_ALTERNATE_OBJECT_DIRECTORIES = store.personal
  }
  return env
}

/** The object store at `dir` for the repository `cwd` is in; null when `cwd` is in none. */
export async function openObjectStore(cwd: string, dir: string): Promise<ObjectStore | null> {
  const out = await gitCall(cwd, ["rev-parse", "--git-path", "objects"], gitEnv(), {
    until: Date.now() + 5000,
  })
  if (typeof out === "string" || out.code !== 0) return null
  const objects = out.stdout.trim().split("\n")[0] ?? ""
  return objects === "" ? null : { dir, personal: resolve(cwd, objects) }
}

type GitProcess = Bun.Subprocess<"ignore" | "pipe" | Buffer, "pipe", "ignore">
type StopGit = (why: "timeout" | "too-large" | "aborted") => void

function gitStdin(input: Limit["input"]) {
  if (typeof input === "string") return Buffer.from(input)
  return input === undefined ? "ignore" : "pipe"
}

function feedGit(proc: GitProcess, limit: Limit, stopped: () => boolean, stop: StopGit) {
  const stdin = proc.stdin
  if (typeof limit.input !== "object" || !stdin || typeof stdin === "number") return
  void limit.input
    .then(async (input) => {
      if (stopped() || proc.exitCode !== null) return
      if (limit.until <= Date.now()) return stop("timeout")
      await stdin.write(input)
      if (!stopped() && proc.exitCode === null) await stdin.end()
    })
    .catch(() => stop("aborted"))
}

/**
 * One git call that ends within its limit: killed and reaped at the deadline, when its output passes
 * the byte cap, or when the signal aborts. It never throws; a git that cannot start has exit code 127.
 */
export async function gitCall(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  limit: Limit,
): Promise<Out> {
  const left = limit.until - Date.now()
  if (limit.signal?.aborted) return "aborted"
  if (left <= 0) return "timeout"
  let proc: GitProcess
  try {
    proc = Bun.spawn([...GIT, ...args], {
      cwd,
      env,
      stdin: gitStdin(limit.input),
      stdout: "pipe",
      stderr: "ignore",
    })
  } catch {
    return { code: 127, stdout: "" }
  }
  let stopped: Out | undefined
  const stop: StopGit = (why) => {
    stopped ??= why
    proc.kill()
  }
  const timer = setTimeout(() => stop("timeout"), left)
  const abort = () => stop("aborted")
  limit.signal?.addEventListener("abort", abort, { once: true })
  feedGit(proc, limit, () => stopped !== undefined, stop)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for await (const chunk of proc.stdout) {
      bytes += chunk.length
      if (limit.maxBytes !== undefined && bytes > limit.maxBytes) {
        stop("too-large")
        break
      }
      chunks.push(chunk)
    }
  } catch {
    // A killed process ends its output stream early.
  }
  const code = await proc.exited
  clearTimeout(timer)
  limit.signal?.removeEventListener("abort", abort)
  return stopped ?? { code, stdout: Buffer.concat(chunks).toString("utf8") }
}

export type Capture = {
  head: string | null
  tree: string | null
  skipped?: SnapshotSkip
  /** The files over the size cap at that moment: not in the tree, so only their size and time are known. */
  large?: LargeFile[]
}

export type SnapshotPlace = { index: string; objects: string }

/** What one snapshot works with: its git calls, the repository's root, where its files go, and its limits. */
type Work = {
  call: Call
  root: string
  place: SnapshotPlace
  options: SnapshotOptions
  check: () => void
}

/** The tree of the worktree, and the files left out of it because they are over the size cap. */
async function snapshotTree(
  work: Work,
  personalIndex: string,
): Promise<{ tree: string; large: LargeFile[] }> {
  const { call, root, place, options, check } = work
  const used = await storeBytes(call)
  if (used >= (options.storeMaxBytes ?? TURN_STORE_MAX_BYTES)) throw new Stopped("too-large")
  const files = await readyIndex(call, place.index, personalIndex)
  if (files.length > (options.maxFiles ?? TURN_SNAPSHOT_FILES_MAX)) throw new Stopped("too-large")
  const large = await findLargeFiles(root, files, TURN_SNAPSHOT_FILE_MAX_BYTES, check)
  await stage(
    call,
    place.index,
    large.map((file) => file.path),
  )
  const tree = printed(await call(["write-tree", "--missing-ok"], { index: place.index })).trim()
  if (!TREE_ID.test(tree)) throw new Stopped("git-failed")
  return { tree, large }
}

/**
 * The worktree at `cwd` as a tree id, or null when there is nothing to record: a folder that is not a
 * repository, a repository without a commit, or a snapshot that was aborted. A snapshot that could not be
 * taken has no tree and says why. The tree and its blobs are objects of the store at `place.objects`.
 */
export async function captureWorktree(
  cwd: string,
  place: SnapshotPlace,
  options: SnapshotOptions = {},
): Promise<Capture | null> {
  const until = Date.now() + (options.timeoutMs ?? TURN_SNAPSHOT_MS)
  const { signal } = options
  const check = () => {
    if (signal?.aborted) throw new Stopped("aborted")
    if (Date.now() >= until) throw new Stopped("timeout")
  }
  let head: string | null = null
  try {
    const probed = await gitCall(
      cwd,
      ["rev-parse", "--show-toplevel", "--git-path", "index", "--git-path", "objects", "HEAD"],
      gitEnv(),
      { until, signal },
    )
    if (typeof probed === "string") throw new Stopped(probed)
    if (probed.code !== 0) return null
    const [root = "", personalIndex = "", objects = "", sha = ""] = probed.stdout.trim().split("\n")
    head = sha
    mkdirSync(place.objects, { recursive: true, mode: 0o700 })
    const store: ObjectStore = { dir: place.objects, personal: resolve(cwd, objects) }
    const call: Call = (args, use = {}) =>
      gitCall(root, args, gitEnv(use.index, store, use.reads), {
        until,
        signal,
        maxBytes: use.maxBytes,
        input: use.input,
      })
    const taken = await snapshotTree(
      { call, root, place, options, check },
      resolve(cwd, personalIndex),
    )
    const large = taken.large.slice(0, TURN_SNAPSHOT_LARGE_LISTED)
    return { head, tree: taken.tree, ...(large.length > 0 ? { large } : {}) }
  } catch (cause) {
    if (!(cause instanceof Stopped)) throw cause
    // An index that names objects git no longer has would fail every later snapshot too.
    if (cause.why === "git-failed") rmSync(place.index, { force: true })
    return cause.why === "aborted" ? null : { head, tree: null, skipped: cause.why }
  } finally {
    rmSync(`${place.index}.lock`, { force: true })
    rmSync(`${place.index}.paths`, { force: true })
  }
}
