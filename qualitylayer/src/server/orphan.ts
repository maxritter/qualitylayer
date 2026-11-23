// A server that nothing points at any more ends itself. Quitting the App never stops the server
// (agent commands may be running), and a replaced App, a deleted temp folder or a second server
// that took over the lock leave one behind. The rule is two facts the server can check by itself:
//
//   - the lock in its state folder names it. Missing for two checks in a row (the folder was
//     deleted) or naming another live process (that one took over): it is not the Cockpit.
//   - its own program is still the build it started as. Gone for two checks in a row, or replaced
//     by a file of another build: whatever it serves is stale, and the App starts a fresh one.
//
// Both checks run every `intervalMs`, and a server ends at once, through the same path as SIGTERM.

import { stat } from "node:fs/promises"
import { buildId, fileBuildId, UNREADABLE_BUILD } from "../core/build-id.ts"
import { pidAlive } from "../core/self.ts"
import type { Ctx } from "../ctx.ts"
import { lockPath, readLock } from "./lock.ts"

export const ORPHAN_CHECK_MS = 15_000

type Print = { ino: number; size: number; mtimeMs: number }

async function printOf(path: string): Promise<Print | null> {
  try {
    const { ino, size, mtimeMs } = await stat(path)
    return { ino, size, mtimeMs }
  } catch {
    return null
  }
}

// Taken when this module loads, at the start of the process: a server is watched against the file
// it started from, so a program deleted right after the lock appears (before the watcher is set up,
// which a loaded Linux machine makes likely) is still seen as gone, not as never watched.
const programAtStart: Promise<Print | null> = printOf(process.execPath)

const same = (a: Print, b: Print) => a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs

type OrphanState = {
  print: Print | null
  lockMissing: number
  programGone: number
}

async function checkLock(ctx: Ctx, self: number, state: OrphanState): Promise<string | null> {
  if (!(await ctx.fs.exists(lockPath(ctx)))) {
    return ++state.lockMissing >= 2 ? "its lock was removed" : null
  }
  state.lockMissing = 0
  const lock = await readLock(ctx)
  if (lock !== null && lock.pid !== self && pidAlive(lock.pid))
    return `the lock names another server (pid ${lock.pid})`
  return null
}

async function checkProgram(
  program: string,
  ownBuild: string,
  state: OrphanState,
): Promise<string | null> {
  const now = await printOf(program)
  if (now === null) return ++state.programGone >= 2 ? "its program was deleted" : null
  state.programGone = 0
  // No fingerprint at the start (the file was already unreadable): the first sight is the baseline.
  if (state.print === null) {
    state.print = now
    return null
  }
  if (same(now, state.print)) return null
  // A server that could not read its own program at start has nothing to compare the file to.
  if (
    ownBuild !== UNREADABLE_BUILD &&
    (await fileBuildId(program).catch(() => ownBuild)) !== ownBuild
  )
    return "its program was replaced by another build"
  state.print = now
  return null
}

/** Why a server no longer belongs to anyone, or null while it does. One call per check. */
export async function orphanChecker(ctx: Ctx): Promise<() => Promise<string | null>> {
  const self = process.pid
  const program = process.execPath
  const script = process.argv[1] ?? ""
  // A source run has no program of its own, and a named build (the suites) stands apart from the file.
  const watchProgram = !script.endsWith(".ts") && !script.endsWith(".js")
  const named = ctx.env.get("QUALITYLAYER_BUILD_ID")
  const ownBuild = await buildId(ctx.env).catch(() => "")
  const state: OrphanState = {
    print: watchProgram ? await programAtStart : null,
    lockMissing: 0,
    programGone: 0,
  }
  const checkBinary = watchProgram && (named === undefined || named === "")

  return async () => {
    const lockReason = await checkLock(ctx, self, state)
    if (lockReason !== null) return lockReason
    return checkBinary ? checkProgram(program, ownBuild, state) : null
  }
}

/** Check now and then; `onOrphan` gets the reason once. Returns what stops the checks. */
export async function watchOrphan(
  ctx: Ctx,
  onOrphan: (reason: string) => void,
  intervalMs = ORPHAN_CHECK_MS,
): Promise<() => void> {
  const check = await orphanChecker(ctx)
  let busy = false
  let done = false
  const timer = setInterval(async () => {
    if (busy || done) return
    busy = true
    try {
      const reason = await check()
      if (reason !== null && !done) {
        done = true
        onOrphan(reason)
      }
    } catch {
      // a failed look is not a reason
    } finally {
      busy = false
    }
  }, intervalMs)
  // The checks never keep a stopped server's process alive.
  timer.unref()
  return () => {
    done = true
    clearInterval(timer)
  }
}
