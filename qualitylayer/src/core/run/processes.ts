import { dlopen, FFIType } from "bun:ffi"
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs"
import { pidAlive } from "../self.ts"
import {
  darwinBootSeconds,
  darwinEnvironment,
  darwinExecutable,
  darwinPidList,
  parseDarwinProcess,
  queryDarwinProcess,
  readDarwinProcess,
} from "./processes-darwin.ts"
import { procFileHolders } from "./processes-files.ts"
import {
  environmentOwnerHash,
  InvalidOwnershipEnvironment,
  OWNER_ENV,
  ownerHash,
  processOwnerHash,
  readNativeOwnerHash,
} from "./processes-owner.ts"

export {
  darwinEnvironment,
  environmentOwnerHash,
  InvalidOwnershipEnvironment,
  OWNER_ENV,
  ownerHash,
  parseDarwinProcess,
  processOwnerHash,
  procFileHolders,
  readDarwinProcess,
}

export function nativeOwnerHash(pid: number): string | null {
  return readNativeOwnerHash(pid)
}

export const PROCESS_LIMITS = { pids: 32768, argumentBytes: 1024 * 1024, scanMs: 2000, owned: 4096 }
export type NativeProcess = {
  pid: number
  parent: number
  pgid: number
  uid: number
  nativeStart: string
  processStart: string
  zombie: boolean
  exiting?: boolean
}

export function utcStart(seconds: number): string {
  const date = new Date(Math.floor(seconds) * 1000)
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()]
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][date.getUTCMonth()]
  const time = date.toISOString().slice(11, 19)
  return `${day} ${month} ${String(date.getUTCDate()).padStart(2, " ")} ${time} ${date.getUTCFullYear()}`
}

export function parseLinuxStat(text: string) {
  const split = text.lastIndexOf(") ")
  const prefix = /^(\d+) \(/.exec(text)
  const fields = text
    .slice(split + 2)
    .trim()
    .split(/\s+/)
  if (!prefix || split < 0 || fields.length < 20 || !/^\d+$/.test(fields[19] ?? ""))
    throw new Error("invalid native process record")
  return {
    pid: Number(prefix[1]),
    parent: Number(fields[1]),
    pgid: Number(fields[2]),
    ticks: fields[19] as string,
    zombie: fields[0] === "Z" || fields[0] === "X" || fields[0] === "x",
  }
}

let linuxClock: { ticks: number; boot: number; id: string } | undefined
function linuxTimes() {
  if (linuxClock) return linuxClock
  let ticks = 0
  const libraries = [
    "libc.so.6",
    `/lib/ld-musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`,
  ]
  for (const path of libraries) {
    try {
      const library = dlopen(path, { sysconf: { args: [FFIType.i32], returns: FFIType.i64 } })
      try {
        ticks = Number(library.symbols.sysconf(2)) // Linux _SC_CLK_TCK.
      } finally {
        library.close()
      }
      if (ticks > 0) break
    } catch {}
  }
  const boot = Number(/^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"))?.[1])
  const id = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
  if (!Number.isFinite(boot) || boot <= 0 || ticks <= 0 || !id)
    throw new Error("native process clock unavailable")
  linuxClock = { ticks, boot, id }
  return linuxClock
}

/** Wall-clock boot times shift when the clock is set; a live process never looks older than this. */
export const BOOT_MARGIN_SECONDS = 120

/**
 * A recorded process that started before this machine's current boot is gone, whatever holds its
 * PID now. After a crash or restart the PID often belongs to another user's process that cannot be
 * read, and without this proof every run of the previous boot stayed unverified and unrecoverable.
 */
export function startedBeforeBoot(nativeStart: string | undefined): boolean {
  try {
    const darwin = /^darwin:(\d+):\d+$/.exec(nativeStart ?? "")
    if (darwin && process.platform === "darwin") {
      const boot = darwinBootSeconds()
      return boot !== null && Number(darwin[1]) < boot - BOOT_MARGIN_SECONDS
    }
    const linux = /^linux:([^:]+):\d+$/.exec(nativeStart ?? "")
    if (linux && process.platform === "linux") return linux[1] !== linuxTimes().id
  } catch {}
  return false
}

function readLinuxProcess(pid: number): NativeProcess | null {
  const path = `/proc/${pid}`
  const row = parseLinuxStat(readFileSync(`${path}/stat`, "utf8"))
  if (row.zombie) return null
  const clock = linuxTimes()
  return {
    ...row,
    uid: statSync(path).uid,
    nativeStart: `linux:${clock.id}:${row.ticks}`,
    processStart: utcStart(clock.boot + Number(row.ticks) / clock.ticks),
  }
}

export function nativeProcess(pid: number, deadline?: number): NativeProcess | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("invalid process id")
  try {
    if (process.platform === "darwin") return queryDarwinProcess(pid, deadline)
    if (process.platform === "linux") return readLinuxProcess(pid)
    throw new Error("native run ownership is unsupported on this platform")
  } catch (cause) {
    if (!pidAlive(pid)) return null
    throw cause
  }
}

/** The kernel's executable path, rather than a process title or an inherited environment value. */
export function nativeExecutable(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try {
    if (process.platform === "linux") return readlinkSync(`/proc/${pid}/exe`)
    if (process.platform === "darwin") return darwinExecutable(pid)
  } catch {
    // An exited or unreadable process cannot establish native lead authority.
  }
  return null
}

function linuxOwnedPid(pid: number): boolean {
  try {
    return statSync(`/proc/${pid}`).uid === process.getuid?.()
  } catch (cause) {
    if (!pidAlive(pid)) return false
    throw cause
  }
}

function platformPidList(): number[] {
  if (process.platform === "darwin") return darwinPidList()
  if (process.platform === "linux")
    return readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .map(Number)
  throw new Error("native run ownership is unsupported on this platform")
}

export function nativeProcesses(): NativeProcess[] {
  const deadline = Date.now() + PROCESS_LIMITS.scanMs
  const pids = platformPidList()
  if (pids.length > PROCESS_LIMITS.pids) throw new Error("native process table exceeds its bound")
  const rows: NativeProcess[] = []
  for (const pid of pids) {
    if (Date.now() > deadline) throw new Error("native process scan exceeded its time bound")
    if (process.platform === "linux" && !linuxOwnedPid(pid)) continue
    const row = nativeProcess(pid, deadline)
    if (row) rows.push(row)
  }
  return rows
}
