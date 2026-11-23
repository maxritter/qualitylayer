import { spawnSync } from "node:child_process"
import { isAbsolute, relative } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { insidePath, powershellCommand } from "../platform.ts"
import { roots } from "./agent-settings.ts"
import { realLocation } from "./manifest.ts"

const OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "PI_CODING_AGENT_DIR",
  "OPENCODE_CONFIG_DIR",
  "GROK_HOME",
  "COPILOT_HOME",
  "XDG_CONFIG_HOME",
] as const

/** Query the current OS account, independent of HOME/USERPROFILE (including Bun's userInfo). */
export function nativeAccountHome(): string {
  const command =
    process.platform === "win32"
      ? powershellCommand(
          '$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if (-not $sid) { throw "No current account SID" }; [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)',
        )
      : process.platform === "darwin"
        ? ["/usr/bin/dscacheutil", "-q", "user", "-a", "uid", String(process.getuid?.())]
        : ["/usr/bin/getent", "passwd", String(process.getuid?.())]
  if (process.platform !== "win32" && !Number.isSafeInteger(process.getuid?.()))
    throw new Error("No current account UID")
  const result = spawnSync(command[0] as string, command.slice(1), {
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    env: { ...process.env, HOME: undefined, USERPROFILE: undefined },
  })
  if (result.error || result.status !== 0) throw new Error("Cannot query the OS account home")
  if (
    process.platform === "darwin" &&
    /^uid: (\d+)$/m.exec(result.stdout)?.[1] !== String(process.getuid?.())
  )
    throw new Error("The OS account UID did not match")
  if (
    process.platform !== "win32" &&
    process.platform !== "darwin" &&
    result.stdout.trim().split(":")[2] !== String(process.getuid?.())
  )
    throw new Error("The OS account UID did not match")
  const home =
    process.platform === "win32"
      ? result.stdout.trim()
      : process.platform === "darwin"
        ? /^dir: (.+)$/m.exec(result.stdout)?.[1]
        : result.stdout.trim().split(":")[5]
  if (!home || !isAbsolute(home)) throw new Error("The OS account has no absolute home")
  return home
}

function overrideOutsideHome(ctx: Ctx, contains: (path: string) => boolean): string | null {
  for (const name of OVERRIDES) {
    const value = ctx.env.get(name)
    if (value === undefined || value === "") continue
    if (!isAbsolute(value) || !contains(value))
      return `Refusing changes: ${name} is outside isolated HOME. Set ${name} to an absolute path inside HOME or unset it before install, update or uninstall.`
  }
  return null
}

function agentRootOutsideHome(ctx: Ctx, contains: (path: string) => boolean): string | null {
  for (const [agent, path] of Object.entries(roots(ctx) ?? {})) {
    if (!contains(path))
      return `Refusing changes: ${agent}'s configuration resolves outside isolated HOME. Use a configuration directory inside HOME before install, update or uninstall.`
  }
  return null
}

/** An overridden HOME must isolate native configuration too; normal custom profiles stay valid. */
export function configIsolationProblem(ctx: Ctx, home: string, nativeHome?: string): string | null {
  try {
    const isolated = realLocation(home)
    const contains = (path: string) => {
      const location = realLocation(path)
      return relative(isolated, location) === "" || insidePath(isolated, location)
    }
    // An inherited override is not the only escape: a default config directory can be a symlink.
    const problem = overrideOutsideHome(ctx, contains) ?? agentRootOutsideHome(ctx, contains)
    if (problem === null) return null
    const accountHome = nativeHome ?? nativeAccountHome()
    if (!isAbsolute(accountHome)) throw new Error("the OS account has no absolute home")
    return relative(realLocation(accountHome), isolated) === "" ? null : problem
  } catch {
    return "Cannot verify native configuration inside isolated HOME; nothing was changed. Check HOME and the native configuration directory overrides before trying again."
  }
}
