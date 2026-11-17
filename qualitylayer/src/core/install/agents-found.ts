// Where Claude Code and Codex are, for an App started from Finder, the Start menu or a desktop
// launcher: its PATH is minimal, so the answer cannot come from PATH alone. Looked up in order:
// PATH, the login shell's PATH, the places agents install to, the npm global prefix.

import { readdirSync, statSync } from "node:fs"
import { delimiter, dirname, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Reviewer } from "../agents/binary.ts"
import { AGENT_NAMES, BINARIES } from "../agents/ids.ts"
import { nativeCommand, pickEnv, windows } from "../platform.ts"
import { probe, versionFromOutput, versionTextOf } from "../probe.ts"
import type { DiscoveryObservation } from "../run/launch-diagnostics.ts"
import { userHome } from "./manifest.ts"

export type FoundAgent = {
  agent: Reviewer
  label: string
  /** The command's file, or null when none was found. */
  path: string | null
  version: string | null
}

const LABELS = AGENT_NAMES

/** What a shell or an agent's own command needs of the caller's environment, and nothing else. */
export const PASSED = [
  "HOME",
  "USERPROFILE",
  "PATH",
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "TERM",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
]

/**
 * `env` with the command's own folder first on PATH. An npm or version-manager install starts
 * with `#!/usr/bin/env node`, and that node sits beside it, off the PATH a Dock launch has (and the one that installed it, not another).
 */
export function withCommandFolder(
  env: Record<string, string | undefined>,
  path: string,
): Record<string, string | undefined> {
  const folder = dirname(path)
  const current = env.PATH ?? ""
  if (current.split(delimiter)[0] === folder) return env
  return { ...env, PATH: current === "" ? folder : `${folder}${delimiter}${current}` }
}

/** A command's standard output, or "" when it failed, timed out or does not exist. */
async function output(ctx: Ctx, command: string[]): Promise<string> {
  const run = await probe(command, { env: pickEnv(ctx.env, PASSED), timeoutMs: 5_000 })
  return run.status === 0 ? run.stdout : ""
}

/** Whether `path` is a file; one that cannot be read (an app execution alias on Windows) is not. */
function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true
  } catch {
    return false
  }
}

/** The command in `dir`: `claude`, or `claude.exe` and `claude.cmd` on Windows. */
function inFolder(dir: string, command: string): string | null {
  const names = windows ? [`${command}.exe`, `${command}.cmd`] : [command]
  return names.map((name) => join(dir, name)).find(isFile) ?? null
}

/** The shell's own answer, as a login shell would give it: where `command` is, or null. */
async function loginShell(ctx: Ctx, command: string): Promise<string | null> {
  const first = (
    windows
      ? await output(ctx, ["where", command])
      : await output(ctx, [ctx.env.get("SHELL") ?? "/bin/sh", "-lc", `command -v ${command}`])
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "")
  const absolute = windows ? /^[A-Za-z]:\\/ : /^\//
  return first !== undefined && absolute.test(first) && isFile(first) ? first : null
}

/** The subfolders of `dir` that exist, newest version name first; none when `dir` is not a folder. */
function versionFolders(dir: string): string[] {
  try {
    return readdirSync(dir)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

/**
 * A system folder such as `/usr/local/bin`. `QUALITYLAYER_SYSTEM_ROOT` is put in front of it, so a
 * test searches a fixture tree and never the programs of the machine that runs it.
 */
const systemFolder = (ctx: Ctx, path: string): string =>
  join(ctx.env.get("QUALITYLAYER_SYSTEM_ROOT") ?? "/", path)

/**
 * Where the desktop apps keep the Codex command they ship: ChatGPT's `codex-cli/bin/codex` and the
 * Codex app's own `Resources/codex`, in the system and the user's Applications folder.
 */
function codexAppFolders(ctx: Ctx, user: string | null): string[] {
  const roots = [
    systemFolder(ctx, "Applications"),
    ...(user === null ? [] : [join(user, "Applications")]),
  ]
  return roots.flatMap((root) =>
    ["ChatGPT", "Codex"].flatMap((app) => {
      const resources = join(root, `${app}.app`, "Contents", "Resources")
      return [join(resources, "codex-cli", "bin"), resources]
    }),
  )
}

/**
 * Where agents commonly install to, besides what a shell's PATH names: each agent's own folder, the
 * standalone Codex installer's, Homebrew, the usual npm, Bun, Volta, pnpm and Node-version-manager
 * folders (a version manager is set up in `.zshrc`, which a login shell does not read) and the
 * desktop apps that ship Codex.
 */
function knownFolders(ctx: Ctx): string[] {
  const home = userHome(ctx)
  const user = home.ok ? home.home : null
  const inHome = (...parts: string[]) => (user === null ? null : join(user, ...parts))
  if (windows) {
    return [
      ctx.env.get("LOCALAPPDATA") !== undefined
        ? join(ctx.env.get("LOCALAPPDATA") as string, "Programs")
        : null,
      ctx.env.get("APPDATA") !== undefined ? join(ctx.env.get("APPDATA") as string, "npm") : null,
      inHome(".local", "bin"),
      inHome(".opencode", "bin"),
      inHome(".pi", "agent", "bin"),
      inHome(".grok", "bin"),
      inHome(".codex", "packages", "standalone", "current", "bin"),
    ].filter((dir): dir is string => dir !== null)
  }
  const nvm = ctx.env.get("NVM_DIR") ?? inHome(".nvm")
  const brew = ctx.env.get("HOMEBREW_PREFIX")
  return [
    inHome(".local", "bin"),
    inHome(".codex", "packages", "standalone", "current", "bin"),
    inHome(".claude", "local"),
    inHome(".opencode", "bin"),
    inHome(".pi", "agent", "bin"),
    inHome(".grok", "bin"),
    brew === undefined || brew === "" ? null : join(brew, "bin"),
    systemFolder(ctx, "opt/homebrew/bin"),
    systemFolder(ctx, "usr/local/bin"),
    systemFolder(ctx, "home/linuxbrew/.linuxbrew/bin"),
    inHome(".npm-global", "bin"),
    inHome(".volta", "bin"),
    inHome(".bun", "bin"),
    inHome(".yarn", "bin"),
    inHome("Library", "pnpm"),
    inHome(".local", "share", "pnpm"),
    inHome(".asdf", "shims"),
    inHome(".local", "share", "mise", "shims"),
    inHome(".nix-profile", "bin"),
    ...(nvm === null || nvm === undefined
      ? []
      : versionFolders(join(nvm, "versions", "node")).map((d) => join(d, "bin"))),
    ...(user === null
      ? []
      : [
          join(user, ".local", "share", "fnm", "node-versions"),
          join(user, "Library", "Application Support", "fnm", "node-versions"),
        ].flatMap((dir) => versionFolders(dir).map((d) => join(d, "installation", "bin")))),
    ...codexAppFolders(ctx, user),
  ].filter((dir): dir is string => dir !== null)
}

const PREFIX_KEPT_MS = 20_000
const prefixes = new WeakMap<Ctx["env"], { at: number; answer: Promise<string> }>()

/**
 * npm's global prefix, asked once for every agent searched in the same few seconds: a list that
 * looks for seven agents starts one shell, not seven.
 */
function npmPrefix(ctx: Ctx): Promise<string> {
  const kept = prefixes.get(ctx.env)
  if (kept !== undefined && ctx.clock.now() - kept.at < PREFIX_KEPT_MS) return kept.answer
  const answer = output(
    ctx,
    windows ? ["npm", "prefix", "-g"] : [ctx.env.get("SHELL") ?? "/bin/sh", "-lc", "npm prefix -g"],
  ).then((text) => text.trim())
  prefixes.set(ctx.env, { at: ctx.clock.now(), answer })
  return answer
}

/**
 * A command, found without relying on the PATH this process was started with: PATH, the login
 * shell, `folders` (where the command is known to install itself), then npm's global folder.
 */
export async function findCommand(
  ctx: Ctx,
  command: string,
  folders: string[] = [],
  observe?: (observation: DiscoveryObservation) => void,
): Promise<string | null> {
  let knownFoldersChecked = 0
  const foundAt = (source: DiscoveryObservation["source"], path: string | null) => {
    observe?.({ source, knownFoldersChecked })
    return path
  }
  const onPath = Bun.which(command, { PATH: ctx.env.get("PATH") ?? "" })
  if (onPath !== null) return foundAt("path", onPath)
  const shell = await loginShell(ctx, command)
  if (shell !== null) return foundAt("login-shell", shell)
  for (const dir of folders) {
    knownFoldersChecked++
    const found = inFolder(dir, command)
    if (found !== null) return foundAt("known-folder", found)
  }
  // npm's global folder, asked as the login shell would, so npm is found where the shell finds it.
  const prefix = await npmPrefix(ctx)
  const found = prefix === "" ? null : inFolder(windows ? prefix : join(prefix, "bin"), command)
  return foundAt(found === null ? "missing" : "npm", found)
}

/** The agent's command, found without relying on the PATH this process was started with. */
export const findAgentBinary = (
  ctx: Ctx,
  agent: Reviewer,
  observe?: (observation: DiscoveryObservation) => void,
): Promise<string | null> => findCommand(ctx, BINARIES[agent], knownFolders(ctx), observe)

/** Claude Code's or Codex's version, as its own `--version` prints it. */
async function versionOf(ctx: Ctx, path: string): Promise<string | null> {
  // A Windows command shim that cannot be run directly leaves the version unknown. It must not
  // take the whole list with it: the Setup page asks for every agent at once.
  let command: string[]
  try {
    command = nativeCommand(path, ["--version"])
  } catch {
    return null
  }
  const text = await versionTextOf(path, command, {
    env: withCommandFolder(pickEnv(ctx.env, PASSED), path),
    timeoutMs: 5_000,
  })
  return versionFromOutput(text)
}

/** Both agents, with the version of each that was found. */
export async function findAgents(ctx: Ctx): Promise<FoundAgent[]> {
  return Promise.all(
    (Object.keys(LABELS) as Reviewer[]).map(async (agent) => {
      const path = await findAgentBinary(ctx, agent)
      return {
        agent,
        label: LABELS[agent],
        path,
        version: path === null ? null : await versionOf(ctx, path),
      }
    }),
  )
}
