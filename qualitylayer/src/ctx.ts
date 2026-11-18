// The seam every layer builds on: core functions receive their world through
// a Ctx, and every outcome is data (Result<T>). Nothing under core/ touches
// process, the network or the real clock directly.

import { constants } from "node:fs"
import {
  appendFile,
  chmod,
  mkdir as fsMkdir,
  lstat,
  open,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { boundedText } from "./bounded-stream.ts"
import { findCommand } from "./core/install/agents-found.ts"
import { queryCodexHooks } from "./core/install/codex-hook-trust.ts"
import type { Env } from "./core/platform/environment.ts"
import {
  assertSafeDirectory,
  canonicalPath,
  homeVariable,
  stopOwnedSubprocess,
  windows,
  writePrivateFile,
} from "./core/platform.ts"
import type { RecordOwner } from "./core/records/contract.ts"
import { atomicWrite, type LockOptions, withFileLock } from "./file-lock.ts"
import { readAt } from "./files.ts"
import { publicationFs } from "./publication-fs.ts"
import { boundedRegularFile, type FileIdentity } from "./regular-file.ts"

export type RecordIO = {
  /** Read-only source validation and runtime presence; standalone artifact owners only. */
  inspect?(): Promise<"present" | "missing">
  /** Captured through the same held native owner; fixtures supply synthetic identities only. */
  snapshot?(
    file: string,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; identity: string; version: string } | null>
  validate(): Promise<void>
  read(file: string, maxBytes: number): Promise<Uint8Array>
  write(file: string, bytes: Uint8Array, replace: boolean): Promise<void>
  lock<T>(name: string, action: () => Promise<T>): Promise<T>
}
export type RecordIOPort = {
  readonly home: string
  owner(owner: RecordOwner): Promise<RecordIO>
  project(projectId: string): Promise<Uint8Array>
}

export type Fs = {
  /** Trusted context binding; a request or environment flag cannot select a record implementation. */
  recordIO?: RecordIOPort
  /** Read-only ownership/permission/ACL and symlink checks of every existing directory ancestor. */
  assertSafeDirectory?(path: string): Promise<void>
  readFile(path: string): Promise<string>
  /** UTF-8 transcript bytes starting at an already indexed offset. */
  readRange?(path: string, offset: number, length?: number): Promise<string>
  /** A byte range of a file, undecoded: offsets stay exact where a torn character would shift a text read. */
  readByteRange?(path: string, offset: number, length: number): Promise<Buffer>
  /** Raw bytes, for evidence images; optional so test file systems can leave it out. */
  readBytes?(path: string): Promise<Uint8Array>
  /** Bounded nonblocking read of one regular file, refusing a linked final component. */
  readRegularFile?(path: string, maxBytes: number, expected?: FileIdentity): Promise<Uint8Array>
  writeFile(
    path: string,
    content: string,
    options?: { mode?: number; exclusive?: boolean },
  ): Promise<void>
  atomicWrite(
    path: string,
    content: string,
    options?: { mode?: number; followSymlink?: boolean },
  ): Promise<void>
  withLock<T>(path: string, action: () => Promise<T>, options?: LockOptions): Promise<T>
  append(path: string, content: string): Promise<void>
  mkdir(path: string, options?: { mode?: number }): Promise<void>
  /** A filesystem view that refuses symlinks in task publication inputs. */
  forPublication?(anchor: string, folder: string): Fs
  exists(path: string): Promise<boolean>
  readdir(path: string): Promise<string[]>
  /** Entry types without following links, for readers that need files rather than folders. */
  entries(path: string): Promise<{ name: string; kind: "file" | "directory" | "other" }[]>
  /** Remove a file or a folder with everything in it; missing paths are fine. */
  remove(path: string): Promise<void>
  /** When a file last changed and how big it is; null when it is missing. Optional, like readBytes. */
  stat?(path: string): Promise<{ mtimeMs: number; size: number; mode?: number } | null>
  /** The entry itself, without following a link; null only when the path is missing. */
  lstat?(
    path: string,
  ): Promise<{ kind: "file" | "directory" | "symlink" | "other"; mode: number } | null>
  /** Literal link text, without resolving it. */
  readlink?(path: string): Promise<string>
  /** Set a file's change time, as `touch` does: an artifact shown again counts as updated. */
  touch?(path: string, atMs: number): Promise<void>
}

export type GitResult = { code: number; stdout: string; stderr: string }

export type Git = {
  /** Commit only owned paths through the product's private-index writer, retaining normal hooks. */
  commitPaths(
    cwd: string,
    paths: string[],
    message: string,
    authority?: (candidate: string) => Promise<Result<true>>,
  ): Promise<Result<{ commit: string | null }>>
  /** Run git in a checkout; never throws, the exit code is data. */
  run(
    cwd: string,
    args: string[],
    options?: { childRepository?: true; maxOutputBytes?: number; fresh?: true },
  ): Promise<GitResult>
  /** Absolute path of the repository's common git dir, or null outside a repository. */
  commonDir(cwd: string): Promise<string | null>
  /** Absolute path of the working tree's top level, or null outside a repository. */
  topLevel(cwd: string): Promise<string | null>
}

export type Clock = {
  now(): number
  sleep(ms: number): Promise<void>
}

export type Http = {
  fetch(url: string, init?: RequestInit): Promise<Response>
}

export type { Env } from "./core/platform/environment.ts"

export type Ctx = {
  fs: Fs
  git: Git
  clock: Clock
  http: Http
  env: Env
  /** Current executable runtime, resolved in the same checkout and environment as checks. */
  runtime?: {
    bunVersion(cwd: string): Promise<string | null>
    codexHooks?(codexHome: string, cwd: string): Promise<unknown>
  }
  /** The task explicitly named in this CLI invocation's argv, before global flags are consumed. */
  invocationTask?: string
  /** The named task is only asked about, answered or waited on: the session is not bound to it. */
  visitsTask?: boolean
  /** Set by the validated managed-run wrapper; selecting its task alone does not imply a build. */
  managedRunPurpose?: "new-task" | "task" | "terminal"
  /** Server-recorded task role, projected only after managed native identity validation. */
  managedRunPhase?: "planning"
  /** Explicit build entry for the validated native session's already bound task, for this call only. */
  managedBuildEntry?: boolean
  /** Generated inputs for this run, set only after its native lead and session are validated. */
  managedBriefsDir?: string
  /** Resolved ~/.qualitylayer root. */
  home: string
}

export type ValidationError = {
  line: number
  rule: string
  message: string
  fix_hint: string
  severity: "error" | "warning"
}

export type HarnessError =
  | { code: "illegal_transition"; message: string; from: string; event: string }
  | { code: "state_mismatch"; message: string; stored: string; found: string; fix: string }
  | { code: "validation_failed"; message: string; errors: ValidationError[] }
  | { code: "licence_required"; message: string; url: string }
  /** The licence check itself failed on this machine (a file it cannot read): the message says how to mend it. */
  | { code: "licence_unchecked"; message: string }
  | { code: "workflow_unavailable"; message: string }
  | { code: "no_task"; message: string }
  | { code: "task_unreadable"; message: string }
  /** The task was made before the two-file layout: it opens read-only and cannot advance. */
  | { code: "earlier_layout"; message: string }
  | { code: "not_a_repo"; message: string }
  | { code: "wrong_checkout"; message: string }
  | { code: "no_gate"; message: string }
  /** A resource another party already holds. */
  | { code: "held"; message: string }
  /** Another session holds the machine for heavy work (`qualitylayer heavy`); `check all` does not start. */
  | { code: "machine_held"; message: string }
  | { code: "review_pending"; message: string }
  | { code: "bad_args"; message: string }
  | { code: "commit_rejected"; message: string }
  | { code: "batch_step_closed" | "batch_too_large" | "batch_count"; message: string }
  | { code: "open_failed"; message: string }
  | { code: "rate_limited"; message: string }
  | { code: "not_owner"; message: string }
  | { code: "group_required"; message: string }
  | { code: "groups_changed"; message: string }
  /** A member turned email on while the team's email is off. */
  | { code: "team_email_off"; message: string }
  | { code: "not_implemented"; message: string }

export type Result<T> =
  | { ok: true; data: T; terminalText?: string }
  | { ok: false; error: HarnessError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function err(error: HarnessError): Result<never> {
  return { ok: false, error }
}

async function execGit(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  maxOutputBytes?: number,
): Promise<GitResult> {
  let proc: ReturnType<typeof Bun.spawn> | undefined
  try {
    // The live environment: Bun hands a child the one the process started with unless told, so the
    // server's login-shell PATH would never reach git.
    // App polling reads must not refresh the index under an optional lock while the session commits.
    // Required write locks (add/commit) still apply with this global Git option.
    const child = Bun.spawn(["git", "--no-optional-locks", ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    proc = child
    const stdoutRead =
      maxOutputBytes === undefined
        ? new Response(child.stdout).arrayBuffer().then((bytes) => ({
            text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
            exceeded: false,
          }))
        : boundedText(child.stdout, maxOutputBytes, () => child.kill("SIGKILL"))
    const [stdout, stderr, code] = await Promise.all([
      stdoutRead,
      maxOutputBytes === undefined
        ? new Response(child.stderr).text().then((text) => ({ text, exceeded: false }))
        : boundedText(child.stderr, maxOutputBytes, () => child.kill("SIGKILL")),
      child.exited,
    ])
    if (stdout.exceeded || stderr.exceeded)
      return { code: 125, stdout: "", stderr: "File exceeds the source reading limit" }
    return { code, stdout: stdout.text, stderr: stderr.text }
  } catch (cause) {
    if (proc) await stopOwnedSubprocess(proc)
    return { code: 127, stdout: "", stderr: String(cause) }
  }
}

async function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  const { code, stdout } = await execGit(cwd, args, env)
  if (code !== 0) return null
  const line = stdout.trim()
  return line.length > 0 ? line : null
}

/**
 * The variables that point git at one repository, index or work tree (a hook's or a script's routing).
 * User config, credentials and the editor stay; only these decide which repository git touches.
 */
export const REPOSITORY_GIT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_SHALLOW_FILE",
  "GIT_GRAFT_FILE",
  "GIT_INTERNAL_SUPER_PREFIX",
] as const

/**
 * Drop the repository routing a process was started with (in place). The local server serves every
 * project and starts their agents: started from a git hook or a script that set GIT_DIR, it would
 * otherwise read and write that one repository for all of them. Returns the names it removed.
 */
export function withoutRepositoryGit(env: NodeJS.ProcessEnv): string[] {
  const removed = REPOSITORY_GIT_ENV.filter((key) => env[key] !== undefined)
  for (const key of removed) delete env[key]
  return removed
}

export type RealCtxOptions = { env?: Record<string, string | undefined>; cwd?: string }

function lazyRecordIO(home: string): RecordIOPort {
  let recordPort: Promise<RecordIOPort> | undefined
  const records = () =>
    (recordPort ??= import("./core/records/io.ts").then((module) => module.nativeRecordPort(home)))
  return {
    home: resolve(home),
    owner: async (owner) => (await records()).owner(owner),
    project: async (projectId) => (await records()).project(projectId),
  }
}

export function realCtx(options: RealCtxOptions = {}): Ctx {
  for (const key of Reflect.ownKeys(options))
    if (key !== "env" && key !== "cwd")
      throw new TypeError(
        `Unsupported realCtx option: ${String(key)}. Use env.QUALITYLAYER_HOME to select the state home.`,
      )
  const vars = options.env ?? process.env
  const gitEnvironment = (childRepository = false): NodeJS.ProcessEnv => {
    const child = { ...process.env, ...vars }
    // A supplied environment owns its Git namespace. Ambient hook routing must never direct a
    // fixture's add/commit at another repository, while normal contexts keep the user's routing.
    if (options.env !== undefined)
      for (const key of Object.keys(process.env))
        if (key.startsWith("GIT_") && !(key in vars)) delete child[key]
    // A submodule has its own index/work tree/object store. Preserve user config and credentials,
    // but never carry the parent's hook/snapshot namespace into the child's queries.
    if (childRepository) withoutRepositoryGit(child)
    return child
  }
  const env: Env = {
    get: (name) => vars[name],
    cwd: () => options.cwd ?? process.cwd(),
  }
  // One command asks "which repository is this?" about twenty times, each a git process. A found
  // answer is kept for two seconds, so a command spawns git for it once; a miss is never kept.
  const repoAnswers = new Map<string, { at: number; answer: Promise<string | null> }>()
  const recentRepoAnswer = (
    key: string,
    load: () => Promise<string | null>,
  ): Promise<string | null> => {
    const now = Date.now()
    const kept = repoAnswers.get(key)
    if (kept !== undefined && now - kept.at < 2000) return kept.answer
    const answer = load()
    repoAnswers.set(key, { at: now, answer })
    const forget = () => {
      if (repoAnswers.get(key)?.answer === answer) repoAnswers.delete(key)
    }
    answer.then((found) => (found === null ? forget() : undefined), forget)
    return answer
  }
  const runtime = {
    codexHooks: async (codexHome: string, cwd: string): Promise<unknown> => {
      const command = await findCommand(ctx, "codex")
      return command === null ? null : queryCodexHooks(command, { codexHome, cwd, env: vars })
    },
    bunVersion: async (cwd: string): Promise<string | null> => {
      try {
        const child = Bun.spawn(["bun", "--version"], {
          cwd,
          env: { ...process.env, ...vars },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        })
        let expired = false
        const timer = setTimeout(() => {
          expired = true
          child.kill()
        }, 10_000)
        try {
          const [code, output] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
          ])
          return !expired && code === 0 && output.trim() ? output.trim() : null
        } finally {
          clearTimeout(timer)
        }
      } catch {
        return null
      }
    },
  }
  // QUALITYLAYER_HOME moves all runtime state (tasks, licence, config, the
  // Cockpit lock) elsewhere, e.g. for a release-gate run next to a real agent.
  const override = env.get("QUALITYLAYER_HOME")
  const home =
    override !== undefined && isAbsolute(override)
      ? override
      : join(homeVariable(env) ?? homedir(), ".qualitylayer")
  const fs: Fs = {
    recordIO: lazyRecordIO(home),
    assertSafeDirectory,
    atomicWrite,
    withLock: withFileLock,
    readFile: (path) => readAt(path, () => readFile(path, "utf8")),
    readRange: async (path, offset, length) => {
      const file = await open(path, "r")
      try {
        const size = (await file.stat()).size
        const bytes = Buffer.alloc(Math.max(0, Math.min(size - offset, length ?? size)))
        const { bytesRead } = await file.read(bytes, 0, bytes.length, offset)
        return bytes.subarray(0, bytesRead).toString("utf8")
      } finally {
        await file.close()
      }
    },
    readByteRange: async (path, offset, length) => {
      const file = await open(path, "r")
      try {
        const size = (await file.stat()).size
        const bytes = Buffer.alloc(Math.max(0, Math.min(size - offset, length)))
        const { bytesRead } = await file.read(bytes, 0, bytes.length, offset)
        return bytes.subarray(0, bytesRead)
      } finally {
        await file.close()
      }
    },
    readBytes: (path) => readAt(path, async () => new Uint8Array(await readFile(path))),
    readRegularFile: async (path, maxBytes, expected) => {
      const file = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      )
      try {
        return await boundedRegularFile(file, path, maxBytes, expected)
      } finally {
        await file.close()
      }
    },
    writeFile: async (path, content, options) => {
      if (windows && options?.mode === 0o600) {
        await writePrivateFile(path, content, options.exclusive)
        return
      }
      await writeFile(path, content, {
        encoding: "utf8",
        mode: options?.mode,
        flag: options?.exclusive ? "wx" : "w",
      })
    },
    append: async (path, content) => {
      await appendFile(path, content, "utf8")
    },
    mkdir: async (path, options) => {
      await fsMkdir(path, { recursive: true, mode: options?.mode })
      if (options?.mode !== undefined) await chmod(path, options.mode)
    },
    exists: async (path) => {
      try {
        await Bun.file(path).stat()
        return true
      } catch {
        try {
          await readdir(path)
          return true
        } catch {
          return false
        }
      }
    },
    readdir: (path) => readAt(path, () => readdir(path)),
    entries: (path) =>
      readAt(path, async () =>
        (await readdir(path, { withFileTypes: true })).map((entry) => ({
          name: entry.name,
          kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
        })),
      ),
    remove: (path) => rm(path, { recursive: true, force: true }),
    stat: async (path) => {
      try {
        const seen = await stat(path)
        return { mtimeMs: seen.mtimeMs, size: seen.size, mode: seen.mode }
      } catch {
        return null
      }
    },
    lstat: async (path) => {
      try {
        const seen = await lstat(path)
        return {
          kind: seen.isSymbolicLink()
            ? "symlink"
            : seen.isFile()
              ? "file"
              : seen.isDirectory()
                ? "directory"
                : "other",
          mode: seen.mode,
        }
      } catch (cause) {
        if (
          (cause as NodeJS.ErrnoException).code === "ENOENT" ||
          (cause as NodeJS.ErrnoException).code === "ENOTDIR"
        )
          return null
        throw cause
      }
    },
    readlink,
    touch: async (path, atMs) => {
      const at = new Date(atMs)
      await utimes(path, at, at)
    },
  }
  fs.forPublication = (anchor, folder) => publicationFs(fs, anchor, folder)
  const ctx: Ctx = {
    fs,
    runtime,
    git: {
      commitPaths: async (cwd, paths, message, authority) =>
        (await import("./core/git/slice-commit.ts")).commitSlice(
          cwd,
          paths,
          [],
          message,
          undefined,
          [],
          undefined,
          [],
          authority,
        ),
      run: (cwd, args, options) =>
        execGit(cwd, args, gitEnvironment(options?.childRepository), options?.maxOutputBytes),
      commonDir: (cwd) =>
        recentRepoAnswer(`common:${cwd}`, async () => {
          const dir = await runGit(cwd, ["rev-parse", "--git-common-dir"], gitEnvironment())
          if (dir === null) return null
          return canonicalPath(isAbsolute(dir) ? resolve(dir) : resolve(cwd, dir))
        }),
      topLevel: (cwd) =>
        recentRepoAnswer(`top:${cwd}`, async () => {
          const dir = await runGit(cwd, ["rev-parse", "--show-toplevel"], gitEnvironment())
          return dir === null ? null : canonicalPath(resolve(dir))
        }),
    },
    clock: {
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    http: {
      fetch: (url, init) => fetch(url, init),
    },
    env,
    home,
  }
  return ctx
}
