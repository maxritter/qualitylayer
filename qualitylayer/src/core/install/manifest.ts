// Everything `install` puts on the machine is listed here, with its hash, so
// `uninstall` removes exactly that and nothing else. Every path is checked
// before anything is deleted, and the check fails closed.

import { createHash } from "node:crypto"
import { lstatSync, realpathSync as realpathPortable } from "node:fs"
import { basename, dirname, isAbsolute, join, normalize, parse, posix, win32 } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { homeVariable, insidePath } from "../platform.ts"
import { trimEndCharacters } from "../text-boundaries.ts"

/**
 * The real path. On Windows the portable form keeps 8.3 short names (`C:\Users\RUNNER~1`), so the
 * same folder reached by its long and its short name looked like two folders, and an install whose
 * home came through a short-named TEMP was refused as outside HOME; the system's own resolution
 * expands them.
 */
const realpathSync = (path: string): string =>
  process.platform === "win32" ? realpathPortable.native(path) : realpathPortable(path)

export type Entry =
  | { kind: "file"; path: string; sha256: string }
  | { kind: "symlink"; path: string; target: string }

/** One server in one agent: its name there, and the launcher it runs. */
export type McpRegistration = { agent: "claude-code" | "codex"; name: string; command: string }

export type Manifest = {
  /** 1 is a standalone install; 2 adds `kind` and `app`. Both are read. */
  schema: 1 | 2
  version: string
  installed: number
  /** Absent in schema 1: a standalone install. */
  kind?: "app" | "standalone"
  /** The App bundle and the CLI inside it, for an App install. */
  app?: { path: string; cli: string }
  memory?: {
    name: string
    version: string
    target: string
    sha256: string
    source: string | null
    toolchain: string | null
    path: string
  }
  /** MCP servers install registered through an agent's own command; uninstall removes the same ones. */
  mcp?: McpRegistration[]
  entries: Entry[]
  /** Directories install created, parents first; removed only when empty again. */
  dirs: string[]
}

export const manifestPath = (ctx: Ctx) => join(ctx.home, "manifest.json")

export const sha256 = (content: string | Uint8Array) =>
  createHash("sha256").update(content).digest("hex")

/** The user's home, or the reason there is none to work in. */
export function userHome(ctx: Ctx): { ok: true; home: string } | { ok: false; reason: string } {
  const home = homeVariable(ctx.env) ?? ""
  if (home === "") return { ok: false, reason: "HOME is empty" }
  if (!isAbsolute(home)) return { ok: false, reason: `HOME is not an absolute path: ${home}` }
  const normal = normalize(home)
  if (normal === parse(normal).root) return { ok: false, reason: "HOME is the filesystem root" }
  const clean = trimEndCharacters(normal, "\\/")
  // The real path, so that the same HOME reached through a symlink (macOS's /var is
  // /private/var; install.sh resolves HOME the same way) records and matches the same paths.
  let real = clean
  try {
    real = realpathSync(clean)
  } catch {
    // a HOME that does not exist yet keeps its given form
  }
  if (real === parse(real).root)
    return { ok: false, reason: "HOME resolves to the filesystem root" }
  return { ok: true, home: real }
}

/** Existing directories use their real path; virtual or absent roots keep their given form. */
export function realDir(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const clean = normalize(path)
    return clean === parse(clean).root ? clean : trimEndCharacters(clean, "\\/")
  }
}

/** Resolve missing descendants against the nearest existing ancestor for containment checks. */
export function realLocation(path: string): string {
  let current = normalize(path)
  const missing: string[] = []
  for (;;) {
    try {
      return join(realpathSync(current), ...missing)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      // A dangling link is an existing filesystem object, not a missing directory.
      try {
        if (lstatSync(current).isSymbolicLink()) throw error
      } catch (statError) {
        if (statError === error || (statError as NodeJS.ErrnoException).code !== "ENOENT")
          throw statError
      }
      const parent = dirname(current)
      if (parent === current) throw error
      missing.unshift(basename(current))
      current = parent
    }
  }
}

/** Pure path rules, including other OS syntaxes, without filesystem access. */
export function unsafeLexicalPath(
  home: string,
  path: string,
  platform: string = process.platform,
): string | null {
  const paths = platform === "win32" ? win32 : posix
  if (home === "" || !paths.isAbsolute(home) || home === paths.parse(home).root)
    return "no usable HOME"
  if (!paths.isAbsolute(path)) return `not an absolute path: ${path}`
  if (path.split(platform === "win32" ? /[\\/]/ : /\//).includes(".."))
    return `path climbs with ..: ${path}`
  if (paths.normalize(path) !== path) return `path is not in normal form: ${path}`
  if (!insidePath(home, path, platform)) return `path is outside HOME: ${path}`
  return null
}

/** Null when `path` may be written or removed; otherwise why not. */
export function unsafePath(
  home: string,
  path: string,
  platform: string = process.platform,
): string | null {
  const lexical = unsafeLexicalPath(home, path, platform)
  // Aliases may differ lexically; malformed/root paths are refused before filesystem access.
  if (lexical !== null && !lexical.startsWith("path is outside HOME:")) return lexical
  const paths = platform === "win32" ? win32 : posix
  if (platform !== process.platform) return lexical
  // Resolve parents, including /var -> /private/var and Windows junctions, but
  // keep the leaf: unlinking an owned symlink must not follow its target.
  try {
    const realHome = platform === process.platform ? realLocation(home) : home
    if (realHome === paths.parse(realHome).root) return "no usable HOME"
    const location =
      platform === process.platform ? join(realLocation(dirname(path)), basename(path)) : path
    if (!insidePath(realHome, location, platform)) return `path is outside HOME: ${path}`
  } catch {
    return `cannot verify path inside HOME: ${path}`
  }
  return null
}

export async function readManifest(ctx: Ctx): Promise<Manifest | null> {
  const path = manifestPath(ctx)
  if (!(await ctx.fs.exists(path))) return null
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(path)) as Manifest
    if ((parsed.schema !== 1 && parsed.schema !== 2) || !Array.isArray(parsed.entries)) return null
    return { ...parsed, dirs: Array.isArray(parsed.dirs) ? parsed.dirs : [] }
  } catch {
    return null
  }
}

export async function writeManifest(ctx: Ctx, manifest: Manifest): Promise<void> {
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.writeFile(manifestPath(ctx), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Refuse the whole manifest when any one of its paths is unsafe. */
export function checkManifest(home: string, manifest: Manifest): string | null {
  for (const entry of manifest.entries) {
    const problem = unsafePath(home, entry.path)
    if (problem !== null) return problem
  }
  for (const dir of manifest.dirs) {
    const problem = unsafePath(home, dir)
    if (problem !== null) return problem
  }
  return null
}
