import { dlopen, ptr } from "bun:ffi"
import { randomBytes } from "node:crypto"
import { pidDomain } from "../peers/claude.ts"
import { windowsUserSid } from "../platform.ts"
import type { ProcessIdentity } from "./contracts.ts"

export {
  cleanupWindowsJob,
  protectWindowsObject,
  terminateWindowsMember,
  type WindowsProcessWitness,
  windowsJobContains,
  windowsRunCapability,
} from "./windows-job-ops.ts"

// HANDLEs and FILETIMEs are 64-bit integers on both native Windows targets.
function loadKernel() {
  return dlopen("kernel32.dll", {
    CreateJobObjectW: { args: ["ptr", "ptr"], returns: "u64" },
    OpenJobObjectW: { args: ["u32", "i32", "ptr"], returns: "u64" },
    SetInformationJobObject: { args: ["u64", "i32", "ptr", "u32"], returns: "i32" },
    QueryInformationJobObject: { args: ["u64", "i32", "ptr", "u32", "ptr"], returns: "i32" },
    AssignProcessToJobObject: { args: ["u64", "u64"], returns: "i32" },
    IsProcessInJob: { args: ["u64", "u64", "ptr"], returns: "i32" },
    OpenProcess: { args: ["u32", "i32", "u32"], returns: "u64" },
    GetCurrentProcess: { args: [], returns: "u64" },
    GetProcessTimes: { args: ["u64", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
    GetExitCodeProcess: { args: ["u64", "ptr"], returns: "i32" },
    QueryFullProcessImageNameW: { args: ["u64", "u32", "ptr", "ptr"], returns: "i32" },
    TerminateProcess: { args: ["u64", "u32"], returns: "i32" },
    CloseHandle: { args: ["u64"], returns: "i32" },
    LocalFree: { args: ["u64"], returns: "u64" },
    GetLastError: { args: [], returns: "u32" },
    GetTickCount64: { args: [], returns: "u64" },
  })
}
let library: ReturnType<typeof loadKernel> | undefined
export const windowsKernel = () => {
  if (process.platform !== "win32") throw new Error("Windows run ownership requires native Windows")
  library ??= loadKernel()
  return library.symbols
}
export const windowsWide = (value: string) => Buffer.from(`${value}\0`, "utf16le")
export const windowsFailed = (operation: string) =>
  new Error(`${operation} failed (Win32 ${windowsKernel().GetLastError()})`)
export function windowsBirth(handle: number | bigint): string {
  const times = new BigUint64Array(4)
  if (
    !windowsKernel().GetProcessTimes(
      handle,
      ptr(times),
      ptr(times) + 8,
      ptr(times) + 16,
      ptr(times) + 24,
    )
  )
    throw windowsFailed("GetProcessTimes")
  return new DataView(times.buffer).getBigUint64(0, true).toString()
}
export function windowsProcessBirth(pid: number): string | null {
  const api = windowsKernel(),
    handle = BigInt(api.OpenProcess(0x1000, 0, pid))
  if (!handle) {
    const code = api.GetLastError()
    if (code === 87) return null
    // The last error is read by a call of its own, and this runtime can overwrite it in between: a
    // process that is not there is asked again, in a way that does not rely on it (ESRCH).
    try {
      process.kill(pid, 0)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ESRCH") return null
    }
    throw new Error(`OpenProcess ${pid} failed (Win32 ${code})`)
  }
  try {
    const code = new Uint32Array(1)
    if (!api.GetExitCodeProcess(handle, ptr(code))) throw windowsFailed("GetExitCodeProcess")
    return code[0] === 259 ? windowsBirth(handle) : null
  } finally {
    api.CloseHandle(handle)
  }
}
/** A recorded birth (FILETIME) before this boot names a process that is gone, whoever holds its PID. */
export function windowsStartedBeforeBoot(processStart: string, marginSeconds: number): boolean {
  try {
    if (!/^\d+$/.test(processStart)) return false
    const uptimeMs = Number(windowsKernel().GetTickCount64())
    // FILETIME counts 100 ns intervals since 1601; the Unix epoch is 11644473600 s later.
    const bootMs = Date.now() - uptimeMs + 11_644_473_600_000
    return BigInt(processStart) < BigInt(Math.floor(bootMs - marginSeconds * 1000)) * 10_000n
  } catch {
    return false
  }
}
let ownJob: { name: string; handle: number | bigint } | undefined
export function windowsKillOnClose(job: number | bigint): void {
  const limits = new Uint8Array(144)
  new DataView(limits.buffer).setUint32(16, 0x2000, true)
  if (!windowsKernel().SetInformationJobObject(job, 9, ptr(limits), limits.length))
    throw windowsFailed("SetInformationJobObject")
}
/**
 * The host has finished: a later host in this process may own a Job. Only a process that hosts runs
 * one after another needs it (the test runner does); a host process exits after its one run. The Job
 * stays, with this process in it, and the lifetime handle stays open until the process exits.
 */
export function releaseOwnWindowsJob(): void {
  ownJob = undefined
}
export function ownWindowsJob(run: string, generation: number): string {
  if (ownJob) throw new Error("This host already owns a Windows Job")
  const api = windowsKernel()
  const name = `Local\\QualityLayer-${process.pid}-${run}-${generation}-${randomBytes(24).toString("hex")}`
  const security = dlopen("advapi32.dll", {
    ConvertStringSecurityDescriptorToSecurityDescriptorW: {
      args: ["ptr", "u32", "ptr", "ptr"],
      returns: "i32",
    },
  })
  const descriptor = new BigUint64Array(1)
  try {
    const sddl = windowsWide(`D:P(A;;GA;;;${windowsUserSid()})`)
    if (
      !security.symbols.ConvertStringSecurityDescriptorToSecurityDescriptorW(
        ptr(sddl),
        1,
        ptr(descriptor),
        null,
      )
    )
      throw windowsFailed("Job security descriptor")
    const attributes = new Uint8Array(24),
      view = new DataView(attributes.buffer)
    view.setUint32(0, 24, true)
    view.setBigUint64(8, new DataView(descriptor.buffer).getBigUint64(0, true), true)
    const encodedName = windowsWide(name)
    const job = BigInt(api.CreateJobObjectW(ptr(attributes), ptr(encodedName)))
    if (!job) throw windowsFailed("CreateJobObjectW")
    try {
      windowsKillOnClose(job)
      if (!api.AssignProcessToJobObject(job, api.GetCurrentProcess()))
        throw windowsFailed("AssignProcessToJobObject")
      // The host keeps the sole lifetime handle until process exit; closing it here kills itself.
      ownJob = { name, handle: job }
      return name
    } catch (cause) {
      api.CloseHandle(job)
      throw cause
    }
  } finally {
    if (descriptor[0]) api.LocalFree(descriptor[0])
    security.close()
  }
}
export function withWindowsJob<T>(name: string, action: (handle: number | bigint) => T): T {
  const api = windowsKernel()
  if (ownJob?.name === name) return action(ownJob.handle)
  const encodedName = windowsWide(name)
  // QUERY only; never let a peer terminate the host. A Job that is not there says Win32 2; the last
  // error is read by a call of its own that this runtime can overwrite, so an answer other than 2 is
  // asked for again before it is believed.
  let job = 0n
  let code = 0
  for (let attempt = 0; attempt < 3 && !job; attempt++) {
    job = BigInt(api.OpenJobObjectW(4, 0, ptr(encodedName)))
    if (!job) {
      code = api.GetLastError()
      if (code === 2) break
    }
  }
  if (!job) throw new Error(`OpenJobObjectW failed (Win32 ${code})`)
  try {
    return action(job)
  } finally {
    api.CloseHandle(job)
  }
}
export function windowsJobMembers(name: string): ProcessIdentity[] {
  return withWindowsJob(name, (job) => {
    const api = windowsKernel(),
      bytes = new Uint8Array(8 + 8 * 4096)
    if (!api.QueryInformationJobObject(job, 3, ptr(bytes), bytes.length, null))
      throw windowsFailed("QueryInformationJobObject")
    const view = new DataView(bytes.buffer),
      count = view.getUint32(4, true)
    if (count > 4096 || view.getUint32(0, true) !== count)
      throw new Error("Windows Job roster exceeds its bound")
    const result: ProcessIdentity[] = []
    for (let i = 0; i < count; i++) {
      const pid = Number(view.getBigUint64(8 + i * 8, true)),
        started = windowsProcessBirth(pid)
      if (started)
        result.push({
          pid,
          processStart: started,
          nativeStart: started,
          pidDomain: pidDomain(),
          knownBy: "descendant",
          windowsJob: name,
        })
    }
    return result
  })
}
