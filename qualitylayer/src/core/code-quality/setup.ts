import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, rmdir } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { configIsolationProblem } from "../install/config-isolation.ts"
import { realLocation, unsafePath, userHome } from "../install/manifest.ts"
import { assertSafeDirectory } from "../platform.ts"
import { fetchPinned } from "./pinned-download.ts"
import { placeStage, stageMove } from "./setup-command.ts"
import {
  cleanupRetiredTarget,
  QLTY_VERSION,
  qltyInstalledResult,
  qltyReady,
  qltyVersionOf,
  stageQltyArchive,
  verifyReplaceableTarget,
} from "./setup-verify.ts"

export { commandBytes, placeStage, setupEnvironment, stageMove } from "./setup-command.ts"
export { QLTY_VERSION } from "./setup-verify.ts"

const RELEASE = `https://github.com/qltysh/qlty/releases/download/v${QLTY_VERSION}`
const ARCHIVE_LIMIT = 32 * 1024 * 1024

export type QualityToolPlatform = { platform?: string; arch?: string; libc?: "gnu" | "musl" }
export type QualityToolAsset = { target: string; sha256: string; archive: string }

// v0.657.0 GitHub release asset digests and the release's .sha256 files agree.
// Source packaging: https://github.com/qltysh/qlty/blob/v0.657.0/.github/workflows/build.yml
export const QLTY_ASSETS: Readonly<Record<string, QualityToolAsset>> = Object.freeze(
  Object.fromEntries(
    [
      ["aarch64-apple-darwin", "c3aa842a956d79aa3073f2e621b260eb9f5fdbbcec42b544e6cd0baf4ab6e2a1"],
      ["x86_64-apple-darwin", "1e197ef81212efb17a93e0b96ecae92d2a8d62ab91c46a728d2fa614bb07decb"],
      [
        "aarch64-unknown-linux-gnu",
        "0d62fe65994e2d306873fd70febf0cccfa01bfb6c0f113380084c58d65b71cae",
      ],
      [
        "x86_64-unknown-linux-gnu",
        "25a37d639c73468267cbb86abeed7d39199b416e3e3288afdb24edcb967c02c5",
      ],
      [
        "aarch64-unknown-linux-musl",
        "070978dc46d8b8ee84d0bcda227aac8504ce9ea47fb931af467a9c0897725060",
      ],
      [
        "x86_64-unknown-linux-musl",
        "5ab73b0f8c67cf48ba90040f5a8829de7c383f69d9385c181a6ecf885d1e60c0",
      ],
      [
        "x86_64-pc-windows-msvc",
        "071bf94a171230fa70703b26704ea64044cb0aa8dc45e30c2298dbeacd2cd3e1",
      ],
    ].map(([target, sha256]) => [
      target,
      Object.freeze({
        target,
        sha256,
        archive: `qlty-${target}.${target?.includes("windows") ? "zip" : "tar.xz"}`,
      }),
    ]),
  ) as Record<string, QualityToolAsset>,
)

export type QualityToolSetup = {
  status: "ready" | "unsupported" | "failed"
  version: string
  binary?: string
  files?: { path: string; sha256: string }[]
  dirs?: string[]
  reason?: string
}

export type QualityArchiveEntry = {
  path: string
  kind: "file" | "directory" | "other"
  bytes?: Uint8Array
}

/** How a finished stage folder is moved into place; tests inject the refusals Windows gives. */
export type StagePlacement = {
  rename?: (from: string, to: string) => Promise<void>
  /** The fallback when Windows keeps refusing the rename: copy the stage into place. */
  copy?: (from: string, to: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  windows?: boolean
}

export type QualityToolSetupDeps = StagePlacement & {
  /** Test release metadata: production callers use only the pinned release above. */
  assets?: Readonly<Record<string, QualityToolAsset>>
  extract?: (archive: string, asset: QualityToolAsset) => Promise<QualityArchiveEntry[]>
  version?: (binary: string) => Promise<string>
  removeRetired?: (dir: string) => Promise<void>
  downloadTimeoutMs?: number
}

/** The platform's release target (`aarch64-apple-darwin`, …), or null where no pinned tool runs. */
export function targetFor(options: QualityToolPlatform): string | null {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : null
  if (cpu === null) return null
  if (platform === "darwin") return `${cpu}-apple-darwin`
  if (platform === "win32") return arch === "x64" ? "x86_64-pc-windows-msvc" : null
  if (platform !== "linux") return null
  const libc = options.libc ?? (existsSync(`/lib/ld-musl-${cpu}.so.1`) ? "musl" : "gnu")
  return `${cpu}-unknown-linux-${libc}`
}

/** Resolves the private executable; checks and hooks never install or contact the network. */
export function qualityToolPath(ctx: Ctx, options: QualityToolPlatform = {}): string | null {
  const target = targetFor(options)
  return target === null
    ? null
    : join(
        toolHome(ctx),
        "tools",
        "qlty",
        QLTY_VERSION,
        target,
        target.includes("windows") ? "qlty.exe" : "qlty",
      )
}

export function toolHome(ctx: Ctx): string {
  // Resolve HOME ancestor aliases, retaining the state root's leaf for symlink refusal.
  return isAbsolute(ctx.home) ? join(realLocation(dirname(ctx.home)), basename(ctx.home)) : ctx.home
}

async function downloadQlty(
  ctx: Ctx,
  asset: QualityToolAsset,
  timeoutMs: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error("Qlty download deadline must be between 1 and 30000ms")
  return fetchPinned(ctx, {
    release: RELEASE,
    overrideEnv: "QUALITYLAYER_QLTY_RELEASE_BASE",
    file: asset.archive,
    sha256: asset.sha256,
    limit: ARCHIVE_LIMIT,
    timeoutMs,
    label: "Qlty",
  })
}

function isValidQltyAsset(
  asset: QualityToolAsset | undefined,
  target: string,
): asset is QualityToolAsset {
  if (!asset || asset.target !== target || !/^[a-f0-9]{64}$/.test(asset.sha256)) return false
  return asset.archive === `qlty-${target}.${target.includes("windows") ? "zip" : "tar.xz"}`
}

async function prepareQltyParents(
  ctx: Ctx,
  dir: string,
  parent: string,
  created: string[],
): Promise<void> {
  if (!isAbsolute(ctx.home)) throw new Error("Qlty tools home must be absolute")
  const home = userHome(ctx)
  if (!home.ok) throw new Error(home.reason)
  const problem = configIsolationProblem(ctx, home.home) ?? unsafePath(home.home, ctx.home)
  if (problem !== null) throw new Error(problem)
  await assertSafeDirectory(dir)
  for (const path of [ctx.home, join(ctx.home, "tools"), join(ctx.home, "tools", "qlty"), parent]) {
    try {
      await mkdir(path, { mode: 0o700 })
      created.push(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    await assertSafeDirectory(path)
  }
}

type QltyInstallState = {
  ctx: Ctx
  target: string
  asset: QualityToolAsset
  binary: string
  dir: string
  parent: string
  created: string[]
  deps: QualityToolSetupDeps
  version: (path: string) => Promise<string>
  stage?: string
  published: boolean
}

async function installQltyLocked(state: QltyInstallState): Promise<QualityToolSetup> {
  const { ctx, target, asset, binary, dir, parent, created, deps, version } = state
  await assertSafeDirectory(dir)
  if (await qltyReady(dir, binary, asset, version)) {
    state.published = true
    return qltyInstalledResult(binary, created)
  }
  const hasPrevious = await verifyReplaceableTarget(dir, target, asset)
  const bytes = await downloadQlty(ctx, asset, deps.downloadTimeoutMs ?? 30_000)
  const stage = await mkdtemp(join(parent, `.${target}-`))
  state.stage = stage
  await chmod(stage, 0o700)
  const stagedBinary = await stageQltyArchive(ctx, stage, bytes, asset, deps)
  if (!(await qltyReady(stage, stagedBinary, asset, version)))
    throw new Error("Staged Qlty executable failed integrity or version verification")
  const move = stageMove(deps)
  const retired = `${dir}.retired-${randomUUID()}`
  if (hasPrevious) await move(dir, retired)
  let placed: { stageLeft: boolean }
  try {
    placed = await placeStage(stage, dir, deps)
  } catch (error) {
    if (hasPrevious) await move(retired, dir)
    throw error
  }
  state.stage = undefined
  state.published = true
  const result = await qltyInstalledResult(binary, [...created, dir])
  if (placed.stageLeft)
    result.reason = `Qlty is ready; its temporary setup folder ${stage} could not be removed yet`
  if (hasPrevious) await cleanupRetiredTarget(retired, result, deps)
  return result
}

export async function ensureQualityTool(
  given: Ctx,
  options: QualityToolPlatform = {},
  deps: QualityToolSetupDeps = {},
): Promise<QualityToolSetup> {
  const ctx = { ...given, home: toolHome(given) }
  const target = targetFor(options)
  const binary = qualityToolPath(ctx, options)
  if (target === null || binary === null)
    return {
      status: "unsupported",
      version: QLTY_VERSION,
      reason: "Qlty has no pinned native release for this operating system and architecture",
    }
  const asset = (deps.assets ?? QLTY_ASSETS)[target]
  if (!isValidQltyAsset(asset, target))
    return {
      status: "failed",
      version: QLTY_VERSION,
      reason: "Invalid pinned Qlty release metadata",
    }
  const dir = dirname(binary)
  const parent = dirname(dir)
  const state: QltyInstallState = {
    ctx,
    target,
    asset,
    binary,
    dir,
    parent,
    created: [],
    deps,
    version: deps.version ?? ((path: string) => qltyVersionOf(ctx, path)),
    published: false,
  }
  let result: QualityToolSetup
  let cleanupFailure: string | undefined
  try {
    await prepareQltyParents(ctx, dir, parent, state.created)
    result = await ctx.fs.withLock(join(parent, `${target}.setup.lock`), () =>
      installQltyLocked(state),
    )
  } catch (error) {
    result = {
      status: "failed",
      version: QLTY_VERSION,
      reason: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (state.stage !== undefined) {
      await rm(state.stage, { recursive: true, force: true }).catch(() => {
        cleanupFailure = `Cannot remove owned Qlty staging directory: ${state.stage}`
      })
    }
    if (!state.published)
      for (const path of [...state.created].reverse()) await rmdir(path).catch(() => {})
  }
  return cleanupFailure
    ? { status: "failed", version: QLTY_VERSION, reason: cleanupFailure }
    : result
}
