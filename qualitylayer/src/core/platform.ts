// Native OS differences shared by installation and agent integration.
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, posix, resolve, win32 } from "node:path"
import type { Env } from "./platform/environment.ts"

export {
  endWithThisProcess,
  hideChildWindows,
  installSpawnRecorder,
  killProcessTree,
  removeFileOrRetire,
  renameWithRetry,
  stopOwnedSubprocess,
  withHiddenWindow,
} from "./platform-process.ts"
export {
  assertSafeDirectory,
  safePosixDirectory,
  safeWindowsDirectoryAcl,
  writePrivateFile,
} from "./platform-security.ts"
export {
  nativeCommand,
  ownerOnlyFile,
  powershell,
  powershellCommand,
  removeAfterExit,
  windowsHookCommand,
  windowsSystemCommand,
  windowsUserSid,
} from "./platform-windows.ts"

export const windows = process.platform === "win32"
export const executableName = windows ? "qualitylayer.exe" : "qualitylayer"

/**
 * The one spelling of an existing path. A Windows path has several: the short `RUNNER~1` form a
 * temp folder is often held in, the long form, other letter case. Git answers in the long form
 * when it prints a path and echoes the caller's spelling when it prints `.git`, so one repository
 * reached from two processes gets two ids and two runtime folders; a detached worker then
 * reports into a folder nobody reads. Elsewhere the path stays as given: a symlinked checkout
 * keeps the id it has always had. A path that cannot be resolved is returned unchanged.
 */
export function canonicalPath(path: string, native: boolean = windows): string {
  if (!native) return path
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

const ansiColour = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

/**
 * The DevTools address in what a browser wrote to stderr, or null until its line is complete.
 * A client that colours its output (FORCE_COLOR) wraps the address in escape codes, and a
 * half-read line would give a truncated port, so the line must have ended.
 */
export function devtoolsAddress(stderr: string): string | null {
  const found = stderr.replace(ansiColour, "").match(/DevTools listening on (ws:\/\/\S+)\s/)
  return found?.[1] ?? null
}

export function homeVariable(env: Env, platform: string = process.platform): string | undefined {
  return env.get("HOME") || (platform === "win32" ? env.get("USERPROFILE") : undefined)
}

/** A variable counts as set unless it is empty, "0" or "false". */
export function isSet(env: Env, name: string): boolean {
  const value = env.get(name) ?? ""
  return value !== "" && value !== "0" && value !== "false"
}

export type Screen = "desktop" | "wsl" | "container" | "ssh" | "none"

/**
 * What kind of machine this is: one answer for the installers, the link opener and the
 * hand-over page. Only `desktop` has a screen the App can open on.
 */
export function screenOf(m: {
  os: string
  release: string
  env: Env
  exists: (path: string) => boolean
}): Screen {
  const { env } = m
  if (isSet(env, "SSH_CONNECTION") || isSet(env, "SSH_TTY")) return "ssh"
  if (m.os !== "linux") return m.os === "darwin" || m.os === "win32" ? "desktop" : "none"
  if (isSet(env, "WSL_DISTRO_NAME") || isSet(env, "WSL_INTEROP") || /microsoft/i.test(m.release))
    return "wsl"
  if (
    m.exists("/.dockerenv") ||
    m.exists("/run/.containerenv") ||
    ["REMOTE_CONTAINERS", "CODESPACES", "DEVCONTAINER"].some((name) => isSet(env, name))
  )
    return "container"
  return isSet(env, "DISPLAY") || isSet(env, "WAYLAND_DISPLAY") ? "desktop" : "none"
}

/** Where a WSL server starts looking for a free port, past the Windows App's own range. */
export const WSL_FIRST_PORT = 41910

/**
 * The first port the server tries. WSL forwards its loopback ports to Windows' localhost only while
 * Windows has not taken them; the Windows App's server holds 41888, so a WSL server on 41888 would
 * hand the Windows browser a link that reaches the wrong server. A port the person set stays.
 */
export function firstPort(configured: number, screen: Screen, defaultPort: number): number {
  return screen === "wsl" && configured === defaultPort ? WSL_FIRST_PORT : configured
}

// VS Code's link helper, `$BROWSER` in a remote window's terminals (a dev container, WSL, SSH,
// Codespaces, and the editors built on VS Code): it forwards the link's port and opens the link in
// the person's own browser.
const EDITOR_BROWSER = /[/\\]bin[/\\]helpers[/\\]browser\.sh$/

/** The VS Code window's link helper this process was started from, or null. */
export function editorBrowser(env: Env, exists: (path: string) => boolean): string | null {
  const helper = env.get("BROWSER") ?? ""
  return EDITOR_BROWSER.test(helper) && exists(helper) ? helper : null
}

/**
 * The `code` command of the VS Code window this process was started from, while that window is
 * still attached: without its socket the command prints a notice and still exits 0.
 */
export function editorCli(env: Env, exists: (path: string) => boolean): string | null {
  const helper = editorBrowser(env, exists)
  const socket = env.get("VSCODE_IPC_HOOK_CLI") ?? ""
  if (helper === null || socket === "" || !exists(socket)) return null
  const code = join(dirname(dirname(helper)), "remote-cli", "code")
  return exists(code) ? code : null
}

/** The named variables of `env` that are set, as the whole environment of a child process. */
export function pickEnv(env: Env, names: string[]): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const name of names) {
    const value = env.get(name)
    if (value !== undefined) picked[name] = value
  }
  return picked
}

/** Strict containment, including drive/UNC roots, sibling prefixes and case on Windows. */
export function insidePath(
  root: string,
  file: string,
  platform: string = process.platform,
): boolean {
  const paths = platform === "win32" ? win32 : posix
  if (!paths.isAbsolute(root) || !paths.isAbsolute(file)) return false
  const rel = paths.relative(root, file)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel)
}

/** `dir` as the system spells it: the longest existing part resolved, the rest appended as given. */
function resolvedPath(dir: string): string {
  const absolute = resolve(dir)
  try {
    return realpathSync.native(absolute)
  } catch {
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(resolvedPath(parent), basename(absolute))
  }
}

/** True when `dir` resolves (realpath) inside realpath(os.tmpdir()). */
export function isUnderTempDir(dir: string): boolean {
  return insidePath(resolvedPath(tmpdir()), resolvedPath(dir))
}
