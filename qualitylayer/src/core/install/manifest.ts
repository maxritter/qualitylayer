// Everything `install` puts on the machine is listed here, with its hash, so
// `uninstall` removes exactly that and nothing else. Every path is checked
// before anything is deleted, and the check fails closed.

import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { unsafePath } from "./manifest-paths.ts"

export { realDir, realLocation, unsafeLexicalPath, unsafePath, userHome } from "./manifest-paths.ts"

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
