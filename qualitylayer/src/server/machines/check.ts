/**
 * A look at a machine before it is added: its system, the QualityLayer on it and the licence it
 * holds. Only questions are asked; nothing on the machine changes. What the machine prints is
 * read as text here and never passed on to a shell.
 */

import { compareVersions } from "../../core/update/versions.ts"
import type { Failure } from "./connection.ts"
import { type Failed, qualitylayer, type Ssh } from "./ssh.ts"

/** The first QualityLayer that can be served to another computer (`app ensure --for-machine`). */
export const FIRST_WITH_MACHINES = "13.1.0"

/** What adding the machine needs done there. */
export type Verdict = "install" | "update" | "ready" | "unsupported"

/** The licence a machine holds, as its own `licence status` says. */
export type MachineLicence = { state: string; tier: string | null }

export type Looked =
  | {
      reach: "ok"
      /** `uname -sm` ("Linux aarch64"); "Windows" or the system's name when it is not supported. */
      system: string
      verdict: Verdict
      /** The QualityLayer installed there, or null. */
      version: string | null
      licence: MachineLicence | null
    }
  | { reach: Failure; reason: string }

const QUICK = { timeoutMs: 20_000 }
const VERSION_LINE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/** What `uname` calls a Windows machine with a unix shell on it (Git Bash, MSYS, Cygwin). */
const WINDOWS_KERNEL = /^(MINGW|MSYS|CYGWIN|Windows_NT)/i
const SUPPORTED_KERNELS = new Set(["Linux", "Darwin"])

const failure = (failed: Failed): Looked => ({ reach: failed.failure, reason: failed.reason })

/** The version `qualitylayer --version` printed, when it printed one. */
export function versionIn(out: string): string | null {
  const line = out.trim().split("\n")[0]?.trim() ?? ""
  return line.length <= 40 && VERSION_LINE.test(line) ? line : null
}

/** QualityLayer's version on the machine: null when it is not there; a failed connection is a failure. */
export async function versionOn(ssh: Ssh, target: string): Promise<string | null | Failed> {
  const said = await ssh.run(target, qualitylayer(["--version"]), QUICK)
  if (!said.ok) return said
  return said.code === 0 ? versionIn(said.out) : null
}

/** Whether a version can be served to another computer; a beta of the first such version can. */
export const hasMachines = (version: string): boolean =>
  compareVersions(version.split("-")[0] ?? version, FIRST_WITH_MACHINES) >= 0

function licenceIn(out: string): MachineLicence | null {
  try {
    const said = JSON.parse(out) as { ok?: unknown; state?: unknown; tier?: unknown }
    if (said.ok !== true || typeof said.state !== "string") return null
    return {
      state: said.state.slice(0, 40),
      tier: typeof said.tier === "string" ? said.tier : null,
    }
  } catch {
    return null
  }
}

const unsupported = (system: string): Looked => ({
  reach: "ok",
  system,
  verdict: "unsupported",
  version: null,
  licence: null,
})

/** A machine without `uname` is Windows when its own `ver` says so. */
async function withoutUname(ssh: Ssh, target: string): Promise<Looked> {
  const ver = await ssh.run(target, ["cmd", "/c", "ver"], { ...QUICK, asIs: true })
  if (!ver.ok) return failure(ver)
  return unsupported(ver.code === 0 && /windows/i.test(ver.out) ? "Windows" : "an unknown system")
}

async function lookAtSupported(ssh: Ssh, target: string, system: string): Promise<Looked> {
  const version = await versionOn(ssh, target)
  if (version !== null && typeof version === "object") return failure(version)
  if (version === null) return { reach: "ok", system, verdict: "install", version, licence: null }
  const held = await ssh.run(target, qualitylayer(["licence", "status", "--json"]), QUICK)
  return {
    reach: "ok",
    system,
    verdict: hasMachines(version) ? "ready" : "update",
    version,
    licence: held.ok && held.code === 0 ? licenceIn(held.out) : null,
  }
}

/** Reach the machine and say what runs there. */
export async function lookAt(ssh: Ssh, target: string): Promise<Looked> {
  const named = await ssh.run(target, ["uname", "-sm"], QUICK)
  if (!named.ok) return failure(named)
  const system = named.code === 0 ? named.out.trim().slice(0, 60) : ""
  if (system === "") return withoutUname(ssh, target)
  const kernel = system.split(/\s+/)[0] ?? ""
  if (WINDOWS_KERNEL.test(kernel)) return unsupported("Windows")
  if (!SUPPORTED_KERNELS.has(kernel)) return unsupported(system)
  return lookAtSupported(ssh, target, system)
}
