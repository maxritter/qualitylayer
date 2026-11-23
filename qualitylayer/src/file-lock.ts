// Process-shared filesystem operations for the real Ctx. Core tests substitute
// an in-memory implementation; core never acquires an OS resource directly.
import { randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, join } from "node:path"
import { WorkflowStateBusy } from "./core/lock-busy.ts"
import { renameWithRetry, writePrivateFile } from "./core/platform.ts"

export async function atomicWrite(
  path: string,
  content: string,
  options?: { mode?: number; followSymlink?: boolean },
): Promise<void> {
  const target = options?.followSymlink
    ? await realpath(path).catch(async (cause: NodeJS.ErrnoException) => {
        if (cause.code !== "ENOENT" || (await lstat(path).catch(() => null))?.isSymbolicLink())
          throw cause
        return path
      })
    : path
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writePrivateFile(temporary, content, true)
    if (options?.mode !== undefined) await chmod(temporary, options.mode & 0o777)
    // On Windows a file another process is reading, or a scanner has just opened, refuses to be
    // replaced for a moment (EPERM, EBUSY): the write waits a few seconds instead of failing the
    // command, which killed a detached review worker mid-run.
    await renameWithRetry(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

async function releaseOwnedLock(path: string, owner: string): Promise<void> {
  // A waiter reading the owner file or listing the lock makes Windows refuse the removal for a
  // moment: the file is tried again, and a folder left empty is removed by the next caller.
  await rm(owner, { force: true, maxRetries: 10, retryDelay: 20 })
  try {
    await rmdir(path)
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? ""
    const inUse = process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(code)
    if (!["ENOENT", "ENOTEMPTY"].includes(code) && !inUse) throw cause
  }
}

export type LockOptions = {
  /** How long to wait for a live holder before failing. Default 10 seconds. */
  waitMs?: number
  /** Written into the lock so a waiter can name what holds it. */
  label?: string
  /** Called once, with one line, when a live process holds the lock. */
  onWait?: (line: string) => void
  /** False: the lock's folder must already exist, and a missing one fails with ENOENT. Default true. */
  createParent?: boolean
}

const WINDOWS_BUSY_CODES = ["EPERM", "EACCES", "EBUSY"]

function isWindowsBusy(code: string): boolean {
  return process.platform === "win32" && WINDOWS_BUSY_CODES.includes(code)
}

function isDeadOwnerPid(pid: unknown): pid is number {
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 && !processExists(pid)
}

async function tryAcquireLock(candidate: string, path: string): Promise<boolean> {
  try {
    await rename(candidate, path)
    return true
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? ""
    // Windows refuses the rename while another process holds the lock directory or has just
    // released it (EPERM, EACCES, EBUSY): that is contention, tried again until `waitMs`. A lock
    // that vanished between the refusal and the look is the same: its holder has just let go.
    const windowsContention =
      isWindowsBusy(code) &&
      (await stat(path).then(
        (entry) => entry.isDirectory(),
        () => true,
      ))
    if (!["EEXIST", "ENOTEMPTY"].includes(code) && !windowsContention) throw cause
    return false
  }
}

async function inspectSingleOwner(
  path: string,
  ownerFile: string,
  options: LockOptions,
  announced: boolean,
): Promise<{ retryNow: boolean; announced: boolean }> {
  const oldOwner = join(path, ownerFile)
  const held = JSON.parse(await readFile(oldOwner, "utf8")) as {
    pid?: unknown
    label?: unknown
  }
  if (isDeadOwnerPid(held.pid)) {
    await rm(oldOwner, { force: true })
    await rmdir(path)
    return { retryNow: true, announced }
  }
  if (options.onWait && !announced && typeof held.pid === "number") {
    const what = typeof held.label === "string" ? held.label : "another QualityLayer process"
    options.onWait(`Waiting for ${what} (pid ${held.pid}) to finish.`)
    return { retryNow: false, announced: true }
  }
  return { retryNow: false, announced }
}

async function reapOrAnnounceHolder(
  path: string,
  options: LockOptions,
  announced: boolean,
): Promise<{ retryNow: boolean; announced: boolean }> {
  // Remove only a dead owner's unique file, then rmdir the EMPTY directory.
  // A second reaper cannot remove a new owner's populated lock directory.
  let result = { retryNow: false, announced }
  try {
    const owners = await readdir(path)
    if (owners.length === 0) {
      await rmdir(path)
      result = { retryNow: true, announced }
    } else {
      const singleOwner = owners.length === 1 ? owners[0] : undefined
      if (singleOwner && /^[a-f0-9-]+\.json$/.test(singleOwner)) {
        result = await inspectSingleOwner(path, singleOwner, options, announced)
      }
    }
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? ""
    // Windows refuses to read or remove a lock its holder is deleting at that moment (EPERM,
    // EACCES, EBUSY): the holder is letting go, so the waiter looks again until `waitMs`.
    if (!["ENOENT", "ENOTEMPTY"].includes(code) && !isWindowsBusy(code)) throw cause
  }
  return result
}

/** Serialize short state transactions across the CLI and Cockpit processes. */
export async function withFileLock<T>(
  path: string,
  action: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const waitMs = options.waitMs ?? 10_000
  let announced = false
  if (options.createParent !== false) await mkdir(dirname(path), { recursive: true })
  const start = Date.now()
  const token = randomUUID()
  const name = `${token}.json`
  const owner = join(path, name)
  const candidate = `${path}.candidate-${token}`
  // Publish a populated directory atomically. There is no empty-lock window
  // in which another contender could mistake an active acquisition for a crash.
  await mkdir(candidate)
  let acquired = false
  try {
    await writeFile(
      join(candidate, name),
      JSON.stringify({ pid: process.pid, label: options.label }),
      { mode: 0o600 },
    )
    for (;;) {
      if (await tryAcquireLock(candidate, path)) {
        acquired = true
        break
      }
      const next = await reapOrAnnounceHolder(path, options, announced)
      announced = next.announced
      if (next.retryNow) continue
      if (Date.now() - start > waitMs)
        throw new WorkflowStateBusy(`Workflow state is busy at ${path}; retry the command`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return await action()
  } finally {
    await rm(candidate, { recursive: true, force: true })
    if (acquired) {
      await releaseOwnedLock(path, owner)
    }
  }
}
