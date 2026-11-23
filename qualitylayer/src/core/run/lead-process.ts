import { codexLauncherChild } from "./codex-launcher.ts"
import type { RunRecord } from "./contracts.ts"
import { nativeProcess, processOwnerHash } from "./processes.ts"
import { identityState, readHost } from "./registry.ts"
import { type LeadCaller, windowsLeadCaller } from "./windows-lead-process.ts"

function unixHostMatchesCaller(home: string, run: RunRecord, pid: number): boolean {
  const host = readHost(home, run.id)
  if (!host) return true
  if (host.generation !== run.generation) return false
  return !host.ownerHash || processOwnerHash(pid) === host.ownerHash
}

function unixLeadCaller(home: string, run: RunRecord, pid: number): LeadCaller | null {
  if (!run.lead || identityState(run.lead) !== "live" || !unixHostMatchesCaller(home, run, pid))
    return null
  const visited = new Set<number>()
  let current = pid
  let nativeParent = 0
  for (let depth = 0; depth < 128 && current > 0 && !visited.has(current); depth++) {
    if (current === run.lead.pid) {
      const direct =
        visited.size === 1 || (visited.size === 2 && codexLauncherChild(run, nativeParent))
      return identityState(run.lead) === "live" ? { direct } : null
    }
    visited.add(current)
    const row = nativeProcess(current)
    if (!row) return null
    if (depth === 0) nativeParent = row.parent
    current = row.parent
  }
  return null
}

/** Recheck process authority at each binding/lease boundary; no environment marker grants it. */
export function leadCaller(home: string, run: RunRecord, pid: number): LeadCaller | null {
  try {
    return process.platform === "win32"
      ? windowsLeadCaller(home, run, pid)
      : unixLeadCaller(home, run, pid)
  } catch {
    return null
  }
}
