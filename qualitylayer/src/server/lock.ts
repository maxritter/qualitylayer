// One Cockpit per machine. ~/.qualitylayer/cockpit.lock names the live server;
// a stale lock (dead pid) is replaced. The CLI never depends on the server:
// when it cannot be started, the workflow continues without a URL.

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, realpathSync, unlinkSync } from "node:fs"
import { chmod, stat } from "node:fs/promises"
import { join } from "node:path"
import { buildId, UNREADABLE_BUILD } from "../core/build-id.ts"
import { compareVersions } from "../core/install/download.ts"
import { ownerOnlyFile } from "../core/platform.ts"
import { type NativeProcess, nativeProcess } from "../core/run/processes.ts"
import { pidAlive, selfCommand } from "../core/self.ts"
import { VERSION } from "../core/version.ts"
import type { Ctx } from "../ctx.ts"
import { commandOf, endServer, isInside, isServerCommand, leftoverServers } from "./processes.ts"
import { Sessions } from "./sessions.ts"

/**
 * `version` is the CLI that started the server, `build` its identity (the executable's content) and
 * `exe` the program it runs from.
 */
export type Lock = {
  pid: number
  port: number
  token: string
  started: number
  version: string
  build: string
  exe: string
  /** The first port the server tried; it differs from `port` when that one was taken. */
  wanted?: number
}

export function lockPath(ctx: Ctx): string {
  return join(ctx.home, "cockpit.lock")
}

export async function readLock(ctx: Ctx): Promise<Lock | null> {
  const path = lockPath(ctx)
  if (!(await ctx.fs.exists(path))) return null
  try {
    const lock = JSON.parse(await ctx.fs.readFile(path)) as Lock
    return typeof lock.pid === "number" &&
      typeof lock.port === "number" &&
      typeof lock.version === "string" &&
      typeof lock.build === "string" &&
      typeof lock.exe === "string"
      ? lock
      : null
  } catch {
    return null
  }
}

/** The lock of a server that is actually running, or null. */
export async function liveLock(
  ctx: Ctx,
  readProcess?: (pid: number) => NativeProcess | null,
): Promise<Lock | null> {
  const lock = await readLock(ctx)
  if (lock === null) return null
  if (process.platform === "win32" && readProcess === undefined)
    return pidAlive(lock.pid) ? lock : null
  const identity = (readProcess ?? nativeProcess)(lock.pid)
  const uid = process.getuid?.()
  return identity !== null &&
    identity.pid === lock.pid &&
    (uid === undefined || identity.uid === uid) &&
    identity.nativeStart !== "" &&
    !identity.zombie &&
    !identity.exiting
    ? lock
    : null
}

/**
 * The Cockpit's access token, kept across restarts so a page left open keeps
 * working: made once, owner-only, like the lock. Delete the file to rotate it.
 */
export async function cockpitToken(ctx: Ctx): Promise<string> {
  const path = join(ctx.home, "cockpit.token")
  if (await ctx.fs.exists(path)) {
    const kept = (await ctx.fs.readFile(path)).trim()
    if (/^[A-Za-z0-9_-]{24,}$/.test(kept)) {
      ownerOnlyFile(path)
      return kept
    }
  }
  const token = randomBytes(24).toString("base64url")
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.writeFile(path, `${token}\n`, { mode: 0o600 })
  await chmod(path, 0o600).catch(() => {})
  return token
}

export async function writeLock(ctx: Ctx, lock: Lock): Promise<void> {
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.writeFile(lockPath(ctx), `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 })
  // The token in the lock is what lets a page approve gates: owner-only.
  await chmod(lockPath(ctx), 0o600).catch(() => {})
}

export async function clearLock(ctx: Ctx, pid: number): Promise<void> {
  const lock = await readLock(ctx)
  if (lock !== null && lock.pid === pid) await ctx.fs.remove(lockPath(ctx))
}

/**
 * `clearLock` without waiting, for a process that is about to exit. A lock it cannot remove names
 * a dead pid, which `liveLock` already counts as no server. Never throws.
 */
export function clearLockSync(home: string, pid: number): void {
  try {
    const path = join(home, "cockpit.lock")
    if ((JSON.parse(readFileSync(path, "utf8")) as Lock).pid === pid) unlinkSync(path)
  } catch {
    // Missing, damaged or not ours: nothing to remove.
  }
}

/** The page's plain address: it carries no key. A browser pairs once through `qualitylayer app`. */
export function cockpitUrl(lock: Pick<Lock, "port">, taskId?: string): string {
  const route = taskId !== undefined ? `#/task/${encodeURIComponent(taskId)}` : ""
  return `http://127.0.0.1:${lock.port}/${route}`
}

/** A call to the running server with the key, for the CLI's own use; null when it does not answer. */
async function callServer(
  lock: Lock,
  path: string,
  init: RequestInit,
  timeoutMs = 3000,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${lock.port}${path}`, {
      ...init,
      headers: { "x-qualitylayer-token": lock.token, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * A reusable local link: its pairing capability replaces the server key in the address. Forget
 * browsers or a new server identity revokes it; `remember` keeps that browser signed in for
 * 30 days. Null when the server does not answer.
 */
export async function pairingUrl(
  lock: Lock,
  options: { route?: string; remember?: boolean; inApp?: boolean; browser?: boolean } = {},
): Promise<string | null> {
  // The server saves the pairing file before it answers, and on Windows that runs icacls twice while
  // the server waits. A loaded hosted runner made `app` give up here after 10 s (exit 1).
  const made = await callServer(
    lock,
    "/api/pair",
    { method: "POST", body: JSON.stringify({ remember: options.remember === true }) },
    30_000,
  )
  if (typeof made?.code !== "string") return null
  const route = options.route === undefined ? "" : `#/${options.route}`
  const destination =
    options.inApp === true ? "?in=app" : options.browser === true ? "?in=browser" : ""
  return `http://127.0.0.1:${lock.port}/pair/${made.code}${destination}${route}`
}

/** End every paired browser's cookie, in the running server and in the file it keeps. */
export async function forgetBrowsers(ctx: Ctx): Promise<boolean> {
  const lock = await liveLock(ctx)
  if (lock === null) {
    await new Sessions(ctx).forget()
    return true
  }
  return (await callServer(lock, "/api/sessions", { method: "DELETE" })) !== null
}

/** A start older than this left its file behind (the process died); the next caller takes over. */
const START_STALE_MS = 10_000

const startingPath = (ctx: Ctx) => join(ctx.home, "cockpit.starting")

/** Take the right to start the server: the file is created exclusively, so one caller holds it. */
async function claimStart(ctx: Ctx): Promise<boolean> {
  try {
    await ctx.fs.writeFile(startingPath(ctx), `${process.pid}\n`, { exclusive: true })
    return true
  } catch {
    return false
  }
}

async function startIsStale(ctx: Ctx): Promise<boolean> {
  try {
    return Date.now() - (await stat(startingPath(ctx))).mtimeMs > START_STALE_MS
  } catch {
    return false
  }
}

/**
 * How long a start waits for the new server's lock. The wait ends when the lock appears. A compiled
 * server on a loaded Windows machine took longer than 4 s to write it, and `app ensure` then answered
 * "could not be started" (the nightly, twice).
 */
export const SERVER_START_WAIT_MS = process.platform === "win32" ? 20_000 : 4000

/** The lock of the server that is live within `waitMs`, looked for every 100 ms; null when none is. */
export async function waitForLock(ctx: Ctx, waitMs: number): Promise<Lock | null> {
  for (let i = 0; i < waitMs / 100; i++) {
    await ctx.clock.sleep(100)
    const lock = await liveLock(ctx)
    if (lock !== null) return lock
  }
  return null
}

/** Ephemeral Claude Code session vars that must not leak from a caller session into the long-lived Cockpit daemon. */
const CLAUDE_SESSION_VARS = new Set([
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_PLUGIN_DATA",
])
const CLAUDE_PROXY_SESSION_VARS = new Set([
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
])

/** Build the detached server's environment without ephemeral Claude Code child-session overrides. */
export function serverEnv(ctx: Ctx, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const fromClaudeSession = (base.CLAUDECODE ?? "") !== ""
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (CLAUDE_SESSION_VARS.has(key) || key.startsWith("CLAUDE_CODE_")) continue
    if (fromClaudeSession && CLAUDE_PROXY_SESSION_VARS.has(key)) continue
    env[key] = value
  }
  env.HOME = ctx.env.get("HOME") ?? base.HOME ?? ""
  env.QUALITYLAYER_HOME = ctx.home
  return env
}

/**
 * Spawn the server and wait for its lock, `waitMs` at most; null when it never wrote one. Without a
 * `port` it takes the one the setting or QUALITYLAYER_PORT names.
 */
export async function startServer(
  ctx: Ctx,
  port: number | undefined,
  waitMs = SERVER_START_WAIT_MS,
): Promise<Lock | null> {
  try {
    const [command, ...args] = selfCommand([
      "serve",
      ...(port !== undefined ? ["--port", String(port)] : []),
    ])
    // Detached with its own session, so closing the agent's terminal does not take the Cockpit down.
    const child = spawn(command as string, args, {
      cwd: ctx.home,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: serverEnv(ctx),
    })
    child.unref()
  } catch {
    return null
  }
  return waitForLock(ctx, waitMs)
}

/**
 * Make sure a Cockpit is running and return its lock. A task's `next` and an
 * opened gate always start one; `QUALITYLAYER_NO_COCKPIT=1` (the test suites)
 * stops those two, never an explicit `qualitylayer serve`. Callers that meet
 * at the same moment start one server: the caller holding `cockpit.starting`
 * spawns it, the others wait for its lock.
 */
export async function ensureCockpit(
  ctx: Ctx,
  options: { explicit: boolean; port?: number },
): Promise<Lock | null> {
  const noServer = !options.explicit && ctx.env.get("QUALITYLAYER_NO_COCKPIT") === "1"
  let port = options.port
  if ((await liveLock(ctx)) !== null) {
    // The suites say not to start a server; one that runs is used as it is.
    if (noServer) return liveLock(ctx)
    // A server of another build is not this CLI's to reuse: it is replaced, on its port.
    const stale = await retireStaleCockpit(ctx, { version: VERSION, build: await buildId(ctx.env) })
    port = stale?.port ?? port
  }
  const live = await liveLock(ctx)
  if (live !== null) return live
  if (noServer) return null

  try {
    await ctx.fs.mkdir(ctx.home)
  } catch {
    return null
  }
  for (let i = 0; i < 150; i++) {
    if (await claimStart(ctx)) {
      try {
        // Another caller may have finished between the first look and the claim.
        return (await liveLock(ctx)) ?? (await startServer(ctx, port))
      } finally {
        await ctx.fs.remove(startingPath(ctx))
      }
    }
    const lock = await liveLock(ctx)
    if (lock !== null) return lock
    if (await startIsStale(ctx)) await ctx.fs.remove(startingPath(ctx))
    await ctx.clock.sleep(100)
  }
  return null
}

/**
 * Ask a server to stop and wait for its process to end, then end it by force after `graceMs`;
 * false when it cannot or does not. A pid that no longer runs a QualityLayer server (the system
 * reused it) is not signalled: its lock is stale, so it is cleared.
 */
export async function stopCockpit(
  ctx: Ctx,
  lock: Lock,
  options: { graceMs?: number } = {},
): Promise<boolean> {
  const command = commandOf(lock.pid)
  if (command !== null && !isServerCommand(command, lock.exe)) {
    await clearLock(ctx, lock.pid)
    return true
  }
  // Windows terminates the process rather than delivering a catchable SIGTERM, so the lock
  // the shutdown handler removes on Unix is cleared here once the process has gone.
  if (!(await endServer(lock.pid, (ms) => ctx.clock.sleep(ms), { ...options, program: lock.exe })))
    return false
  await clearLock(ctx, lock.pid)
  return true
}

/** What a CLI is, for deciding whether a running server is its own. */
export type Own = { version: string; build: string }

/**
 * Whether the server behind `lock` is not the one `own` should talk to: another build of the same
 * version, or an older version. A server of a newer version stays (an older CLI is the odd one
 * out).
 */
export function isStale(lock: Lock, own: Own): boolean {
  // A server run from source (`12.0.0-dev`) sorts above every beta by its words, but it is no
  // newer release: an installed CLI replaces it (a development CLI still keeps its own).
  const dev = (version: string) => /-dev\b/.test(version)
  if (dev(lock.version) && !dev(own.version)) return true
  const order = compareVersions(lock.version, own.version)
  if (order < 0) return true
  if (order > 0) return false
  // A program that could not be read at the time has no identity to compare; the version spoke.
  if (lock.build === UNREADABLE_BUILD || own.build === UNREADABLE_BUILD) return false
  return lock.build !== own.build
}

/**
 * Stop the running server when it is not this CLI's build, and return the port it held so its
 * replacement takes the same one. Its own build, a newer one, or none, is left alone (null).
 */
export async function retireStaleCockpit(
  ctx: Ctx,
  own: Own,
  options: { graceMs?: number } = {},
): Promise<{ port: number } | null> {
  const live = await liveLock(ctx)
  if (live === null || !isStale(live, own)) return null
  return (await stopCockpit(ctx, live, options)) ? { port: live.port } : null
}

/**
 * Stop the QualityLayer servers an install leaves behind: the one the lock names when it is not
 * this build or runs from a program in `folders` (the App or binary just replaced), and any other
 * `serve` process running from those folders or from a program that no longer exists. Servers are
 * found by their command line, never by name alone; a server of another build outside `folders`
 * is the business of whoever asks for a server next. Returns the pids stopped.
 */
export async function retireServersOf(
  ctx: Ctx,
  folders: string[],
  options: { graceMs?: number } = {},
): Promise<number[]> {
  const own: Own = { version: VERSION, build: await buildId(ctx.env) }
  const roots = [...new Set(folders.flatMap((folder) => [folder, realpathOr(folder)]))]
  const stopped: number[] = []
  const lock = await liveLock(ctx)
  // The server that runs this install (the App's Setup page) is never its own victim.
  if (lock !== null && lock.pid !== process.pid) {
    const there = roots.some((root) => isInside(root, lock.exe))
    if (
      (there || isStale(lock, own) || !existsSync(lock.exe)) &&
      (await stopCockpit(ctx, lock, options))
    )
      stopped.push(lock.pid)
  }
  const sleep = (ms: number) => ctx.clock.sleep(ms)
  for (const { pid, program } of leftoverServers(roots, [...stopped, lock?.pid ?? -1])) {
    if (await endServer(pid, sleep, { ...options, program })) stopped.push(pid)
  }
  return stopped
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
