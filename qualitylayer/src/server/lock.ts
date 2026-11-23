// One Cockpit per machine. ~/.qualitylayer/cockpit.lock names the live server;
// a stale lock (dead pid) is replaced. The CLI never depends on the server:
// when it cannot be started, the workflow continues without a URL.

import { existsSync, realpathSync } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { buildId, UNREADABLE_BUILD } from "../core/build-id.ts"
import { compareVersions } from "../core/install/download.ts"
import { VERSION } from "../core/version.ts"
import type { Ctx } from "../ctx.ts"
import { clearLock, type Lock, liveLock, startServer } from "./lock-file.ts"
import { commandOf, endServer, isInside, isServerCommand, leftoverServers } from "./processes.ts"

export {
  clearLock,
  clearLockSync,
  cockpitToken,
  cockpitUrl,
  forgetBrowsers,
  type Lock,
  liveLock,
  lockPath,
  pairingUrl,
  readLock,
  SERVER_START_WAIT_MS,
  serverEnv,
  startServer,
  waitForLock,
  writeLock,
} from "./lock-file.ts"

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

async function waitOrStartCockpit(ctx: Ctx, port: number | undefined): Promise<Lock | null> {
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
  const initial = await liveLock(ctx)
  if (initial !== null) {
    // The suites say not to start a server; one that runs is used as it is.
    if (noServer) return initial
    // A server of another build is not this CLI's to reuse: it is replaced, on its port.
    const stale = await retireStaleCockpit(ctx, { version: VERSION, build: await buildId(ctx.env) })
    port = stale?.port ?? port
  }
  const live = await liveLock(ctx)
  if (live !== null || noServer) return live

  try {
    await ctx.fs.mkdir(ctx.home)
  } catch {
    return null
  }
  return waitOrStartCockpit(ctx, port)
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
