// Installs one pinned scanner the way Qlty is installed: download the pinned asset, compare its
// SHA-256, take the executable out of its archive, stage it with its licence and a receipt, check its
// version, then move the stage into place. A finished target is never rewritten in place; a folder
// QualityLayer does not recognise is left untouched. Hooks and checks only read what this wrote.

import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import { configIsolationProblem } from "../../install/config-isolation.ts"
import { unsafePath, userHome } from "../../install/manifest.ts"
import { assertSafeDirectory, windows, windowsSystemCommand } from "../../platform.ts"
import { fetchPinned, sha256Of } from "../pinned-download.ts"
import {
  commandBytes,
  placeStage,
  type QualityToolPlatform,
  type StagePlacement,
  setupEnvironment,
  stageMove,
  targetFor,
  toolHome,
} from "../setup.ts"
import {
  SCANNER_IDS,
  SCANNERS,
  type ScannerAsset,
  type ScannerId,
  type ScannerSpec,
} from "./registry.ts"

const DOWNLOAD_LIMIT = 96 * 1024 * 1024
const BINARY_LIMIT = 128 * 1024 * 1024
const LISTING_LIMIT = 64 * 1024
const DOWNLOAD_TIMEOUT_MS = 120_000

export type ScannerSetup = {
  id: ScannerId
  status: "ready" | "unsupported" | "failed"
  version: string
  binary?: string
  files?: { path: string; sha256: string }[]
  dirs?: string[]
  reason?: string
}

export type ScannerSetupDeps = StagePlacement & {
  /** Test release metadata; production uses the pinned registry. */
  specs?: Readonly<Partial<Record<ScannerId, ScannerSpec>>>
  version?: (binary: string, spec: ScannerSpec) => Promise<string>
  extract?: (archive: string, spec: ScannerSpec) => Promise<Uint8Array>
  downloadTimeoutMs?: number
}

const exe = (target: string, name: string) => (target.includes("windows") ? `${name}.exe` : name)

/** Where a scanner's executable lives once installed, or null where it has no build. */
export function scannerPath(
  ctx: Ctx,
  id: ScannerId,
  options: QualityToolPlatform = {},
  spec: ScannerSpec = SCANNERS[id],
): string | null {
  const target = targetFor(options)
  if (target === null || spec.assets[target] === undefined) return null
  return join(toolHome(ctx), "tools", id, spec.version, target, exe(target, spec.binary))
}

type Receipt = {
  schema: 1
  id: ScannerId
  version: string
  target: string
  assetSha256: string
  binarySha256: string
  licenceSha256: string
}

async function receiptAt(dir: string, spec: ScannerSpec, target: string): Promise<Receipt | null> {
  const path = join(dir, "receipt.json")
  const entry = await lstat(path).catch(() => null)
  if (!entry?.isFile() || entry.isSymbolicLink() || entry.size > 4096) return null
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Receipt
    return value.schema === 1 &&
      value.id === spec.id &&
      value.version === spec.version &&
      value.target === target &&
      value.assetSha256 === spec.assets[target]?.sha256 &&
      /^[a-f0-9]{64}$/.test(value.binarySha256) &&
      /^[a-f0-9]{64}$/.test(value.licenceSha256)
      ? value
      : null
  } catch {
    return null
  }
}

async function regularBytes(path: string, limit: number): Promise<Uint8Array> {
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > limit)
    throw new Error("Invalid managed scanner file")
  return readFile(path)
}

/**
 * Direct conventional scanner config, cache and data paths to managed state, with metrics off.
 * This is environment routing, not a filesystem sandbox: native OS runtime caches can use known
 * folders independently of these variables.
 */
export async function scannerEnvironment(
  ctx: Ctx,
  id: ScannerId,
  cwd: string,
): Promise<Record<string, string>> {
  const state = join(toolHome(ctx), "tools", id, "state")
  const env = setupEnvironment(ctx, cwd)
  const folders = {
    XDG_CONFIG_HOME: "config",
    XDG_CACHE_HOME: "cache",
    XDG_DATA_HOME: "data",
    ...(windows
      ? { HOME: "home", USERPROFILE: "home", APPDATA: "data", LOCALAPPDATA: "cache" }
      : {}),
  }
  for (const [name, folder] of Object.entries(folders)) {
    await mkdir(join(state, folder), { recursive: true, mode: 0o700 })
    env[name] = join(state, folder)
  }
  // OpenGrep's Windows onefile bootstrap resolves Local AppData through the shell.
  if (windows && id === "opengrep")
    await mkdir(join(state, "home", "AppData", "Local"), { recursive: true, mode: 0o700 })
  return { ...env, SEMGREP_SEND_METRICS: "off", OPENGREP_SEND_METRICS: "off", NO_COLOR: "1" }
}

function versionOf(ctx: Ctx) {
  return async (binary: string, spec: ScannerSpec) =>
    (
      await commandBytes(
        binary,
        [...spec.versionArgs],
        4096,
        dirname(binary),
        await scannerEnvironment(ctx, spec.id, dirname(binary)),
        60_000,
      )
    ).toString("utf8")
}

/** Whether `dir` holds exactly the receipt's executable and licence, and the executable says its version. */
async function ready(
  dir: string,
  binary: string,
  spec: ScannerSpec,
  target: string,
  version: (binary: string, spec: ScannerSpec) => Promise<string>,
): Promise<boolean> {
  const receipt = await receiptAt(dir, spec, target)
  if (receipt === null) return false
  try {
    const bytes = await regularBytes(binary, BINARY_LIMIT)
    const licence = await regularBytes(join(dir, "LICENSE.txt"), 1024 * 1024)
    return (
      sha256Of(bytes) === receipt.binarySha256 &&
      sha256Of(licence) === receipt.licenceSha256 &&
      (await version(binary, spec)).includes(spec.versionText)
    )
  } catch {
    return false
  }
}

/** The executable from a tar.gz or zip: exactly one member named like the scanner, among known files. */
function extractWith(ctx: Ctx) {
  return async (archive: string, spec: ScannerSpec): Promise<Uint8Array> => {
    const tool = windows
      ? windowsSystemCommand("tar.exe")
      : existsSync("/usr/bin/tar")
        ? "/usr/bin/tar"
        : "/bin/tar"
    const cwd = dirname(archive)
    const env = setupEnvironment(ctx, cwd)
    const names = (await commandBytes(tool, ["-tf", archive], LISTING_LIMIT, cwd, env))
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((name) => name.replace(/\r$/, ""))
    const allowed = new Set([spec.binary, `${spec.binary}.exe`, "LICENSE", "README.md"])
    if (
      names.length === 0 ||
      names.length > 8 ||
      names.some((name) => !allowed.has(name) || name.includes("/") || name.includes("\\"))
    )
      throw new Error(`Unexpected ${spec.name} archive layout`)
    const member = names.filter((name) => name === spec.binary || name === `${spec.binary}.exe`)
    if (member.length !== 1) throw new Error(`${spec.name} archive has no single executable`)
    return commandBytes(tool, ["-xOf", archive, member[0] as string], BINARY_LIMIT, cwd, env)
  }
}

async function installedResult(
  id: ScannerId,
  spec: ScannerSpec,
  binary: string,
  dirs: string[],
): Promise<ScannerSetup> {
  const files = []
  for (const path of [
    binary,
    join(dirname(binary), "LICENSE.txt"),
    join(dirname(binary), "receipt.json"),
  ])
    files.push({ path, sha256: sha256Of(await readFile(path)) })
  // The scanner's own three folders are always recorded, so an uninstall after a reinstall removes them too.
  const target = dirname(binary)
  const own = [dirname(dirname(target)), dirname(target), target]
  return {
    id,
    status: "ready",
    version: spec.version,
    binary,
    files,
    dirs: [...new Set([...dirs, ...own])],
  }
}

/** Installs one scanner, or confirms the installed one; never throws. */
/** The tools home is absolute, inside the person's home and isolated from their agents' folders. */
function assertOwnedHome(ctx: Ctx): void {
  if (!isAbsolute(ctx.home)) throw new Error("The tools home must be absolute")
  const home = userHome(ctx)
  if (!home.ok) throw new Error(home.reason)
  const problem = configIsolationProblem(ctx, home.home) ?? unsafePath(home.home, ctx.home)
  if (problem !== null) throw new Error(problem)
}

/** Creates each missing folder (recording it in `created`) and refuses one that is not a plain folder. */
async function makeFolders(paths: readonly string[], created: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await mkdir(path, { mode: 0o700 })
      created.push(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    await assertSafeDirectory(path)
  }
}

/** The installed folder to replace, if any; anything QualityLayer did not write there is left untouched. */
async function replaceable(dir: string, spec: ScannerSpec, target: string) {
  const previous = await lstat(dir).catch(() => null)
  if (previous === null) return null
  const owned = [exe(target, spec.binary), "LICENSE.txt", "receipt.json"]
  if (
    !previous.isDirectory() ||
    previous.isSymbolicLink() ||
    (await readdir(dir)).some((name) => !owned.includes(name))
  )
    throw new Error(`Existing ${spec.name} folder is not a recognised installation; left untouched`)
  return previous
}

/** Writes the executable, its licence and the receipt into `stage`; returns the staged executable. */
async function stageScanner(
  stage: string,
  bytes: Uint8Array,
  pin: { spec: ScannerSpec; asset: ScannerAsset; target: string },
  extract: (archive: string) => Promise<Uint8Array>,
): Promise<string> {
  const { spec, asset, target } = pin
  let data: Uint8Array = bytes
  if (asset.kind !== "raw") {
    const archive = join(stage, asset.file)
    await writeFile(archive, bytes, { mode: 0o600, flag: "wx" })
    data = await extract(archive)
    await rm(archive)
  }
  if (!data.length || data.length > BINARY_LIMIT)
    throw new Error(`${spec.name} executable is missing or oversized`)
  const stagedBinary = join(stage, exe(target, spec.binary))
  await writeFile(stagedBinary, data, { mode: 0o700, flag: "wx" })
  await writeFile(join(stage, "LICENSE.txt"), spec.licence, { mode: 0o600, flag: "wx" })
  const receipt: Receipt = {
    schema: 1,
    id: spec.id,
    version: spec.version,
    target,
    assetSha256: asset.sha256,
    binarySha256: sha256Of(data),
    licenceSha256: sha256Of(spec.licence),
  }
  await writeFile(join(stage, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  })
  return stagedBinary
}

export async function ensureScanner(
  given: Ctx,
  id: ScannerId,
  options: QualityToolPlatform = {},
  deps: ScannerSetupDeps = {},
): Promise<ScannerSetup> {
  const spec = deps.specs?.[id] ?? SCANNERS[id]
  const ctx = { ...given, home: toolHome(given) }
  const target = targetFor(options)
  const asset = target === null ? undefined : spec.assets[target]
  const binary = scannerPath(ctx, id, options, spec)
  if (target === null || asset === undefined || binary === null)
    return {
      id,
      status: "unsupported",
      version: spec.version,
      reason: `${spec.name} has no build for this operating system and architecture`,
    }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256) || asset.file.includes("/"))
    return {
      id,
      status: "failed",
      version: spec.version,
      reason: `Invalid pinned ${spec.name} release`,
    }
  const dir = dirname(binary)
  const parent = dirname(dir)
  const created: string[] = []
  const version = deps.version ?? versionOf(ctx)
  let stage: string | undefined
  let published = false
  try {
    assertOwnedHome(ctx)
    await makeFolders(
      [ctx.home, join(ctx.home, "tools"), join(ctx.home, "tools", id), parent],
      created,
    )
    return await ctx.fs.withLock(join(parent, `${target}.setup.lock`), async () => {
      if (await ready(dir, binary, spec, target, version)) {
        published = true
        return installedResult(id, spec, binary, created)
      }
      const previous = await replaceable(dir, spec, target)
      const bytes = await fetchPinned(ctx, {
        release: spec.release,
        overrideEnv: "QUALITYLAYER_SCANNER_RELEASE_BASE",
        file: asset.file,
        sha256: asset.sha256,
        limit: DOWNLOAD_LIMIT,
        timeoutMs: deps.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS,
        label: spec.name,
      })
      stage = await mkdtemp(join(parent, `.${target}-`))
      await chmod(stage, 0o700)
      const stagedBinary = await stageScanner(stage, bytes, { spec, asset, target }, (archive) =>
        (deps.extract ?? extractWith(ctx))(archive, spec),
      )
      if (!(await ready(stage, stagedBinary, spec, target, version)))
        throw new Error(`Staged ${spec.name} failed integrity or version verification`)
      const move = stageMove(deps)
      const retired = `${dir}.retired-${randomUUID()}`
      if (previous) await move(dir, retired)
      let placed: { stageLeft: boolean }
      try {
        placed = await placeStage(stage, dir, deps)
      } catch (error) {
        if (previous) await move(retired, dir)
        throw error
      }
      const left = placed.stageLeft ? stage : undefined
      stage = undefined
      published = true
      const result = await installedResult(id, spec, binary, [...created, dir])
      if (left !== undefined)
        result.reason = `${spec.name} is ready; its temporary setup folder ${left} could not be removed yet`
      if (previous) await rm(retired, { recursive: true, force: true }).catch(() => {})
      return result
    })
  } catch (error) {
    return {
      id,
      status: "failed",
      version: spec.version,
      reason: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (stage !== undefined) await rm(stage, { recursive: true, force: true }).catch(() => {})
    if (!published) for (const path of [...created].reverse()) await rmdir(path).catch(() => {})
  }
}

/** Installs every scanner, one after another so one slow download never starves the others. */
export async function ensureScanners(
  ctx: Ctx,
  options: QualityToolPlatform = {},
  deps: ScannerSetupDeps = {},
  progress?: (spec: ScannerSpec) => void,
): Promise<ScannerSetup[]> {
  const out: ScannerSetup[] = []
  for (const id of SCANNER_IDS) {
    progress?.(deps.specs?.[id] ?? SCANNERS[id])
    out.push(await ensureScanner(ctx, id, options, deps))
  }
  return out
}

/** Which scanners are installed and current, without touching the network. */
export async function scannerStatus(
  ctx: Ctx,
  options: QualityToolPlatform = {},
): Promise<
  {
    id: ScannerId
    name: string
    version: string
    state: "ready" | "missing" | "unsupported"
    binary: string | null
  }[]
> {
  const out = []
  const target = targetFor(options)
  for (const id of SCANNER_IDS) {
    const spec = SCANNERS[id]
    const binary = scannerPath(ctx, id, options)
    const state =
      binary === null || target === null
        ? ("unsupported" as const)
        : (await receiptAt(dirname(binary), spec, target)) !== null && existsSync(binary)
          ? ("ready" as const)
          : ("missing" as const)
    out.push({ id, name: spec.name, version: spec.version, state, binary })
  }
  return out
}
