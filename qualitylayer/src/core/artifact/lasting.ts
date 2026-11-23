// A project's lasting artifacts: artifacts every task builds on, kept in the repository as
// `.qualitylayer/artifacts/<name>/artifact.json` (`{ v: 1, title, purpose, entry?, source?,
// claudeDesign? }`). Its files are the folder itself, or the repository folder `source` names (the
// App Model stays in `qualitylayer/artifacts/app/app-model` and is registered, not moved).
//
// What the guard refuses: a `source` that is absolute, climbs out, starts in `.git`, is a link or
// goes through one, or whose real path is not strictly inside the repository; an artifact folder or
// `artifact.json` that is a link; a link to anything but https; a `artifact.json` that is too big or does
// not read. An artifact that does not read is listed as broken with its reason, never breaking the list.
// Plain node file access, like the packer: a real path needs `realpath`, which the harness's
// file system does not offer.

import type { Dirent } from "node:fs"
import { lstat, readdir, readFile, realpath } from "node:fs/promises"
import { join, sep } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import {
  ARTIFACT_NAME,
  ARTIFACT_PAGE_NAME,
  LASTING_ARTIFACTS,
  LASTING_CONFIG,
  LASTING_CONFIG_MAX_BYTES,
  LASTING_NAME_MAX,
  STORED_LASTING_CONFIG,
  STORED_LASTING_DESIGNS,
} from "./format.ts"
import { type LastingConfig, parseLastingConfig } from "./lasting-config.ts"
import { adoptLibraryRecords } from "./library-adoption.ts"

export { blobId, fileBlobId, pageTitle } from "./lasting-cache.ts"
export {
  cleanLink,
  cleanSource,
  type LastingConfig,
  parseLastingConfig,
} from "./lasting-config.ts"
export { type LastingEntry, listLasting } from "./lasting-list.ts"

/** A lasting artifact read from the repository: where it is and its pages. */
export type LastingRead = {
  name: string
  config: LastingConfig
  /** `<root>/.qualitylayer/artifacts/<name>`: where `artifact.json` is. */
  configDir: string
  /** `artifact.json`, or `design.json` of a design stored before the rename. */
  configPath: string
  /** The existing registration stamp, also when the source files live elsewhere. */
  configUpdatedAt: number
  /** Where the files are: `configDir`, or the source folder as a real path. */
  dir: string
  /** The files' folder from the repository's root, with forward slashes. */
  folder: string
  /** The pages (the `.html` files at the top of the folder), the entry first. */
  pages: string[]
  /** Read from where a design was stored before the rename; the next save goes to the artifact folder. */
  stored?: true
}

const bad = (message: string): Result<never> => err({ code: "bad_args", message })

/** The first of these path parts (below `root`) that is missing, a link, or not a folder; else null. */
export async function foldersOnly(root: string, parts: string[]): Promise<string | null> {
  let at = root
  for (const [index, part] of parts.entries()) {
    at = join(at, part)
    const info = await lstat(at).catch(() => null)
    const shown = parts.slice(0, index + 1).join("/")
    if (info === null) return `${shown} does not exist`
    if (info.isSymbolicLink()) return `${shown} is a symbolic link`
    if (!info.isDirectory()) return `${shown} is not a folder`
  }
  return null
}

async function pagesOf(dir: string, entry: string | undefined): Promise<Result<string[]>> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return bad("its folder cannot be read")
  }
  const pages = entries
    .filter((e) => e.isFile() && ARTIFACT_PAGE_NAME.test(e.name))
    .map((e) => e.name)
    .sort()
  if (pages.length === 0) return bad("its folder holds no page (an .html file)")
  const first = entry ?? (pages.includes("index.html") ? "index.html" : (pages[0] as string))
  if (!pages.includes(first)) return bad(`the entry page ${first} is not in its folder`)
  return ok([first, ...pages.filter((page) => page !== first)])
}

async function readConfigFile(
  configPath: string,
  configName: string,
  includeDeleted: boolean | undefined,
): Promise<Result<{ config: LastingConfig; mtimeMs: number }>> {
  const info = await lstat(configPath).catch(() => null)
  if (info === null) return bad(`${configName} is missing`)
  if (!info.isFile()) return bad(`${configName} is not a plain file`)
  if (info.size > LASTING_CONFIG_MAX_BYTES) return bad(`${configName} is too big`)
  const config = parseLastingConfig(await readFile(configPath, "utf8"))
  if (!config.ok) return config
  return config.data.deletedAt !== undefined && !includeDeleted
    ? bad("This artifact was deleted. Restore it from its Library viewer before using it.")
    : ok({ config: config.data, mtimeMs: info.mtimeMs })
}

async function resolveLastingDir(
  root: string,
  source: string | undefined,
  configDir: string,
  defaultFolder: string,
): Promise<Result<{ dir: string; folder: string }>> {
  if (source === undefined) return ok({ dir: configDir, folder: defaultFolder })
  const parts = source.split("/")
  const problem = await foldersOnly(root, parts)
  if (problem !== null) return bad(`source: ${problem}`)
  try {
    const realRoot = await realpath(root)
    const real = await realpath(join(root, ...parts))
    return real.startsWith(`${realRoot}${sep}`)
      ? ok({ dir: real, folder: source })
      : bad("source leaves the repository")
  } catch {
    return bad("source cannot be resolved")
  }
}

/** A lasting artifact read and guarded; the reason it cannot be used when it is not. */
export async function readLasting(
  root: string,
  name: string,
  options: { includeDeleted?: boolean } = {},
): Promise<Result<LastingRead>> {
  const here = join(root, ...LASTING_ARTIFACTS.split("/"), name)
  if ((await lstat(here).catch(() => null)) === null) {
    const stored = join(root, ...STORED_LASTING_DESIGNS.split("/"), name)
    if ((await lstat(stored).catch(() => null)) !== null)
      return readLastingIn(root, name, options, STORED_LASTING_DESIGNS, STORED_LASTING_CONFIG)
  }
  return readLastingIn(root, name, options, LASTING_ARTIFACTS, LASTING_CONFIG)
}

async function readLastingIn(
  root: string,
  name: string,
  options: { includeDeleted?: boolean },
  registry: string,
  configName: string,
): Promise<Result<LastingRead>> {
  if (!ARTIFACT_NAME.test(name) || name.length > LASTING_NAME_MAX)
    return bad(`"${name}" is not an artifact name (lower-case letters, digits and dashes)`)
  const base = registry.split("/")
  const walked = await foldersOnly(root, [...base, name])
  if (walked !== null) return bad(walked)
  const configDir = join(root, ...base, name)
  const configPath = join(configDir, configName)
  const loaded = await readConfigFile(configPath, configName, options.includeDeleted)
  if (!loaded.ok) return loaded
  const resolved = await resolveLastingDir(
    root,
    loaded.data.config.source,
    configDir,
    `${registry}/${name}`,
  )
  if (!resolved.ok) return resolved
  const pages = await pagesOf(resolved.data.dir, loaded.data.config.entry)
  return pages.ok
    ? ok({
        name,
        config: loaded.data.config,
        configDir,
        configPath,
        configUpdatedAt: loaded.data.mtimeMs,
        dir: resolved.data.dir,
        folder: resolved.data.folder,
        pages: pages.data,
        ...(registry === STORED_LASTING_DESIGNS ? { stored: true as const } : {}),
      })
    : pages
}

/**
 * Before a save, a stored design gets its artifact folder through a witnessed native copy.
 * `design.json` becomes `artifact.json`; the original folder and its bytes stay as they were.
 * Where the registration names a `source` folder the files stay there and only the config is written.
 */
export async function adoptStored(root: string, name: string, ctx: Ctx): Promise<Result<void>> {
  const read = await readLasting(root, name, { includeDeleted: true })
  if (!read.ok) return read
  if (read.data.stored !== true) return ok(undefined)
  try {
    await adoptLibraryRecords(ctx, root, read.data)
    return ok(undefined)
  } catch (cause) {
    return bad(cause instanceof Error ? cause.message : "Could not copy the stored design")
  }
}
