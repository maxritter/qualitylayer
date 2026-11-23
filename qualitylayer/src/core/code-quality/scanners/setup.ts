// Installs one pinned scanner the way Qlty is installed: download the pinned asset, compare its
// SHA-256, take the executable out of its archive, stage it with its licence and a receipt, check its
// version, then move the stage into place. A finished target is never rewritten in place; a folder
// QualityLayer does not recognise is left untouched. Hooks and checks only read what this wrote.

import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, rmdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import { windows } from "../../platform.ts"
import { fetchPinned } from "../pinned-download.ts"
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
import {
  assertOwnedHome,
  extractWith,
  installedResult,
  makeFolders,
  receiptAt,
  replaceable,
  scannerExe,
  scannerReady,
  stageScanner,
} from "./setup-stage.ts"

const DOWNLOAD_LIMIT = 96 * 1024 * 1024
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

/** Where a scanner's executable lives once installed, or null where it has no build. */
export function scannerPath(
  ctx: Ctx,
  id: ScannerId,
  options: QualityToolPlatform = {},
  spec: ScannerSpec = SCANNERS[id],
): string | null {
  const target = targetFor(options)
  if (target === null || spec.assets[target] === undefined) return null
  return join(toolHome(ctx), "tools", id, spec.version, target, scannerExe(target, spec.binary))
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

type InstallState = {
  ctx: Ctx
  id: ScannerId
  spec: ScannerSpec
  asset: ScannerAsset
  target: string
  binary: string
  dir: string
  parent: string
  created: string[]
  deps: ScannerSetupDeps
  version: (binary: string, spec: ScannerSpec) => Promise<string>
  stage?: string
  published: boolean
}

async function swapStagedScanner(
  stage: string,
  dir: string,
  previous: unknown,
  deps: ScannerSetupDeps,
): Promise<{ stageLeft: boolean; retired: string }> {
  const move = stageMove(deps)
  const retired = `${dir}.retired-${randomUUID()}`
  if (previous) await move(dir, retired)
  try {
    const placed = await placeStage(stage, dir, deps)
    return { stageLeft: placed.stageLeft, retired }
  } catch (error) {
    if (previous) await move(retired, dir)
    throw error
  }
}

async function installScannerLocked(state: InstallState): Promise<ScannerSetup> {
  const { ctx, id, spec, asset, target, binary, dir, parent, created, deps, version } = state
  if (await scannerReady(dir, binary, spec, target, version)) {
    state.published = true
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
  const stage = await mkdtemp(join(parent, `.${target}-`))
  state.stage = stage
  await chmod(stage, 0o700)
  const stagedBinary = await stageScanner(stage, bytes, { spec, asset, target }, (archive) =>
    (deps.extract ?? extractWith(ctx))(archive, spec),
  )
  if (!(await scannerReady(stage, stagedBinary, spec, target, version)))
    throw new Error(`Staged ${spec.name} failed integrity or version verification`)
  const { stageLeft, retired } = await swapStagedScanner(stage, dir, previous, deps)
  state.stage = undefined
  state.published = true
  const result = await installedResult(id, spec, binary, [...created, dir])
  if (stageLeft)
    result.reason = `${spec.name} is ready; its temporary setup folder ${stage} could not be removed yet`
  if (previous) await rm(retired, { recursive: true, force: true }).catch(() => {})
  return result
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
  const state: InstallState = {
    ctx,
    id,
    spec,
    asset,
    target,
    binary,
    dir,
    parent,
    created: [],
    deps,
    version: deps.version ?? versionOf(ctx),
    published: false,
  }
  try {
    assertOwnedHome(ctx)
    await makeFolders(
      [ctx.home, join(ctx.home, "tools"), join(ctx.home, "tools", id), parent],
      state.created,
    )
    return await ctx.fs.withLock(join(parent, `${target}.setup.lock`), () =>
      installScannerLocked(state),
    )
  } catch (error) {
    return {
      id,
      status: "failed",
      version: spec.version,
      reason: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (state.stage !== undefined)
      await rm(state.stage, { recursive: true, force: true }).catch(() => {})
    if (!state.published)
      for (const path of [...state.created].reverse()) await rmdir(path).catch(() => {})
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
