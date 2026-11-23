// install · update · uninstall. What install writes is exactly what the
// manifest lists. User settings, shell rc files and skills stay; the shipped
// executable mod is refreshed with the binary on every install.

import { existsSync } from "node:fs"
import { chmod, copyFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { loadWorkflow } from "#workflow"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { memoryEmbedNotices } from "../../memory-embed/notices.ts"
import {
  memoryEngineInstallationInfo,
  memoryEngineNotices,
  prepareMemoryEngineHome,
} from "../../memory-engine/index.ts"
import { memoryService } from "../../memory-runtime.ts"
import { retireServersOf } from "../../server/lock.ts"
import { renderModFiles } from "../../workflow/mod-files.ts"
import { agentBinary } from "../agents/binary.ts"
import type { NativeAgent } from "../agents/ids.ts"
import {
  ensureScanners,
  type ScannerSetup,
  type ScannerSetupDeps,
} from "../code-quality/scanners/setup.ts"
import {
  ensureQualityTool,
  type QualityToolPlatform,
  type QualityToolSetup,
  type QualityToolSetupDeps,
} from "../code-quality/setup.ts"
import { logInstallerSetup } from "../code-quality/setup-log.ts"
import { verify } from "../licence/verify.ts"
import { nativeCommand } from "../platform.ts"
import { versionFromOutput, versionTextOfSync } from "../probe.ts"
import { VERSION } from "../version.ts"
import { withAgentFolders } from "./agent-folders.ts"
import { configureAgents, modFolder, roots } from "./agent-settings.ts"
import { findAgentBinary } from "./agents-found.ts"
import { configIsolationProblem } from "./config-isolation.ts"
import { compareVersions } from "./download.ts"
import { placeShortcuts, pruneRetiredEntries } from "./install-cleanup.ts"
import {
  canonical,
  checkedManifest,
  ensureDir,
  fileHash,
  type InstallPlan,
  installerTransaction,
  keepPrograms,
  persistManifest,
  place,
  placeAgentSkills,
  replaceBinary,
  skillCopy,
  validateInstallHome,
} from "./install-common.ts"
import { appBundlePath, buildInstallReport } from "./install-report.ts"
import { qualityToolEntries } from "./install-tools.ts"
import { type IntegrationHealth, integrationHealth } from "./integration.ts"
import { clearLauncherProblem } from "./launcher-problem.ts"
import { manifestPath } from "./manifest.ts"
import { type MemoryMcpRow, registerMemoryMcp } from "./memory-mcp.ts"
import { configurePiSkillDiscovery } from "./pi-skill-discovery.ts"
import { renderSkills } from "./skills.ts"
import { agentEntry, appPointer, appPrograms } from "./where.ts"

export { recordScannerSetups } from "./install-scanners.ts"
export { recordQualityToolSetup } from "./install-tools.ts"
export { type UninstallReport, uninstall } from "./install-uninstall.ts"
export { type UpdateReport, update } from "./install-update.ts"
export { manifestPath }

export type InstallReport = {
  version: string
  binary: string
  skills: { label: string; path: string }[]
  kept: string[]
  linked: string | null
  pathLine: string | null
  licence: string
  configured: string[]
  settings: { agent: string; label: string }[]
  declined: string[]
  codexHooks?: "ready" | "pending"
  memoryTools: MemoryMcpRow[]
  qualityTool?: QualityToolSetup
  scanners?: ScannerSetup[]
  skillCopy: string
  shortcut: string | null
  shortcutTaken: string | null
  message: string
}

export type InstallOptions = {
  source: string
  refresh?: boolean
  progress?: (step: string) => void
  app?: { folder: string; lasting?: string }
}

/** Internal provision seams; public install/update arguments stay unchanged. */
export type InstallInternals = {
  qualityTool?: QualityToolSetupDeps
  qualityToolPlatform?: QualityToolPlatform
  scanners?: ScannerSetupDeps
}

/** The first Claude Code that loads mods. */
const MOD_MIN_VERSION = "2.1.287"

/**
 * Set to `1` in an install's environment when the person's licence key is activated right after
 * it, as when this computer adds a machine: the install then starts no trial there.
 */
export const KEY_FOLLOWS = "QUALITYLAYER_KEY_FOLLOWS"

function claudeLoadsMods(ctx: Ctx, claude: string | null): boolean {
  const root = roots(ctx)?.claude
  if (claude === null || root === undefined || !existsSync(root)) return false
  let command: string[]
  try {
    command = nativeCommand(claude, ["--version"])
  } catch {
    return false
  }
  const version = versionFromOutput(versionTextOfSync(claude, command, { timeoutMs: 5_000 }))
  return version !== null && compareVersions(version, MOD_MIN_VERSION) >= 0
}

async function provisionManagedTools(
  ctx: Ctx,
  plan: InstallPlan,
  options: InstallOptions,
  internal: InstallInternals,
): Promise<{ qualityTool: QualityToolSetup; scanners: ScannerSetup[] }> {
  options.progress?.("Preparing code-quality checks")
  const qualityTool = await ensureQualityTool(
    ctx,
    internal.qualityToolPlatform,
    internal.qualityTool,
  )
  const quality = await qualityToolEntries(ctx, plan.previous, qualityTool)
  plan.entries.push(...quality.entries)
  plan.kept.push(...quality.kept)
  for (const dir of qualityTool.dirs ?? []) if (!plan.dirs.includes(dir)) plan.dirs.push(dir)
  const scanners = await ensureScanners(
    ctx,
    internal.qualityToolPlatform,
    internal.scanners,
    (spec) => options.progress?.(`Preparing ${spec.name} ${spec.version} (${spec.scans})`),
  )
  for (const setup of scanners) {
    const owned = await qualityToolEntries(ctx, plan.previous, setup, setup.id)
    plan.entries.push(...owned.entries)
    plan.kept.push(...owned.kept)
    for (const dir of setup.dirs ?? []) if (!plan.dirs.includes(dir)) plan.dirs.push(dir)
  }
  await logInstallerSetup(ctx, qualityTool, scanners)
  return { qualityTool, scanners }
}

async function installBinaryAndPointer(
  ctx: Ctx,
  plan: InstallPlan,
  home: string,
  source: string,
  programs: { cli: string; launcher: string } | null,
): Promise<Result<string>> {
  const binary = agentEntry(ctx)
  if (source !== binary) {
    await ensureDir(home, dirname(binary), plan.dirs)
    const temporary = `${binary}.qualitylayer-new`
    await copyFile(source, temporary)
    await chmod(temporary, 0o755)
    const retired = await replaceBinary(temporary, binary)
    const retiredHash = retired === null ? null : await fileHash(retired)
    if (retired !== null && retiredHash !== null)
      plan.entries.push({ kind: "file", path: retired, sha256: retiredHash })
  }
  const binaryHash = await fileHash(binary)
  if (binaryHash === null) return err({ code: "bad_args", message: `cannot read ${binary}` })
  plan.entries.push({ kind: "file", path: binary, sha256: binaryHash })
  if (programs !== null) {
    const pointer = { cli: programs.cli, version: VERSION }
    await place(plan, appPointer(ctx), `${JSON.stringify(pointer, null, 2)}\n`)
  }
  return ok(binary)
}

async function placeModIfSupported(
  ctx: Ctx,
  plan: InstallPlan,
  binary: string,
  isAppInstall: boolean,
): Promise<boolean> {
  const claude =
    (!isAppInstall ? await agentBinary(ctx, "claude-code") : null) ??
    (await findAgentBinary(ctx, "claude-code"))
  const modPlaced = claudeLoadsMods(ctx, claude)
  if (modPlaced || existsSync(modFolder(ctx))) {
    for (const file of renderModFiles(binary))
      await place(plan, join(modFolder(ctx), file.path), file.text, undefined, true)
  }
  return modPlaced
}

async function reindexLessonsIfPresent(ctx: Ctx, options: InstallOptions): Promise<void> {
  if (!existsSync(join(ctx.home, "memory", "catalog.sqlite"))) return
  options.progress?.("Preparing lesson search")
  const lessons = memoryService(ctx)
  try {
    await lessons.reindex()
  } catch {
    // The lessons stay searchable by words; a search embeds a few more each time it runs.
  } finally {
    await lessons.close().catch(() => {})
  }
}

async function verifyLicenceAndWorkflow(ctx: Ctx, options: InstallOptions): Promise<string> {
  options.progress?.("Checking your licence")
  const entitled = await verify(ctx, {
    passive: options.refresh === true || ctx.env.get(KEY_FOLLOWS) === "1",
  })
  if (entitled.ok) {
    options.progress?.("Fetching the workflow")
    await loadWorkflow(ctx)
  }
  if (options.refresh === true) return ""
  if (!entitled.ok) return `No licence yet: ${entitled.error.message}`
  return entitled.data.tier === "trial"
    ? `Trial: ${entitled.data.daysLeft} day(s) left.`
    : `Licensed (${entitled.data.tier}).`
}

async function installLocked(
  given: Ctx,
  options: InstallOptions,
  internal: InstallInternals,
): Promise<Result<InstallReport>> {
  const ctx = await withAgentFolders(canonical(given))
  const home = validateInstallHome(ctx)
  if (!home.ok) return home
  const read = await checkedManifest(ctx, home.data)
  if (!read.ok) return read
  const previous = read.data
  let programs = options.app === undefined ? null : appPrograms(options.app.folder)
  if (options.app !== undefined && programs === null)
    return err({
      code: "bad_args",
      message: `${options.app.folder} holds no QualityLayer App: qualitylayer-cli and qualitylayer-launcher are missing`,
    })
  const plan: InstallPlan = {
    home: home.data,
    previous,
    entries: [],
    dirs: [...(previous?.dirs ?? [])],
    kept: [],
  }
  await ensureDir(home.data, ctx.home, plan.dirs)
  options.progress?.("Preparing project memory")
  const engineInfo = memoryEngineInstallationInfo()
  await ensureDir(home.data, join(ctx.home, "memory", "engine", engineInfo.sha256), plan.dirs)
  const memory = await prepareMemoryEngineHome(ctx.home)
  plan.entries.push({ kind: "file", path: memory.path, sha256: memory.sha256 })
  await place(plan, join(ctx.home, "notices", "engram.txt"), memoryEngineNotices())
  await place(plan, join(ctx.home, "notices", "minilm.txt"), memoryEmbedNotices())
  const { qualityTool, scanners } = await provisionManagedTools(ctx, plan, options, internal)
  if (programs !== null && options.app?.lasting !== undefined)
    programs = await keepPrograms(plan, programs, options.app.lasting)
  await retireServersOf(ctx, [options.app?.folder ?? dirname(agentEntry(ctx))])
  options.progress?.("Placing the binary")
  const placedBinary = await installBinaryAndPointer(
    ctx,
    plan,
    home.data,
    programs?.launcher ?? options.source,
    programs,
  )
  if (!placedBinary.ok) return placedBinary
  const binary = placedBinary.data
  options.progress?.("Adding the skills")
  for (const file of renderSkills(binary, "claude-code"))
    await place(plan, join(skillCopy(ctx), file.name, file.path), file.text)
  const skills = await placeAgentSkills(ctx, plan, binary, home.data)
  await configurePiSkillDiscovery(ctx, home.data)
  const modPlaced = await placeModIfSupported(ctx, plan, binary, options.app !== undefined)
  const shortcuts = await placeShortcuts(ctx, plan, binary, home.data)
  await pruneRetiredEntries(ctx, plan, binary, home.data)
  options.progress?.("Registering the memory tools")
  const tools = await registerMemoryMcp(ctx, binary, previous?.mcp)
  await persistManifest(ctx, {
    schema: 2,
    version: VERSION,
    installed: ctx.clock.now(),
    kind: programs === null ? "standalone" : "app",
    memory,
    ...(tools.records.length > 0 ? { mcp: tools.records } : {}),
    ...(programs !== null && options.app !== undefined
      ? { app: { path: appBundlePath(ctx, options.app.folder), cli: programs.cli } }
      : {}),
    entries: plan.entries,
    dirs: plan.dirs,
  })
  await reindexLessonsIfPresent(ctx, options)
  const licence = await verifyLicenceAndWorkflow(ctx, options)
  await clearLauncherProblem(ctx)
  options.progress?.("Setting up your agents")
  const results = await configureAgents(ctx, { mod: modPlaced })
  return ok(
    buildInstallReport(ctx, {
      binary,
      programs,
      skills,
      plan,
      shortcuts,
      results,
      toolsRows: tools.rows,
      qualityTool,
      scanners,
      licence,
    }),
  )
}

export async function install(
  given: Ctx,
  options: InstallOptions,
  internal: InstallInternals = {},
): Promise<Result<InstallReport>> {
  return installerTransaction(given, (ctx) => installLocked(ctx, options, internal))
}

export type RepairReport = {
  agent: NativeAgent
  health: IntegrationHealth
  changed: string[]
  kept: string[]
}

export async function repairAgent(given: Ctx, agent: NativeAgent): Promise<Result<RepairReport>> {
  return installerTransaction(given, async (base, home) => {
    const ctx = await withAgentFolders(base)
    const isolationProblem = configIsolationProblem(ctx, home)
    if (isolationProblem !== null) return err({ code: "bad_args", message: isolationProblem })
    const read = await checkedManifest(ctx, home)
    if (!read.ok) return read
    const manifest = read.data
    if (manifest === null)
      return err({
        code: "bad_args",
        message: "QualityLayer is not installed here: there is nothing to repair",
      })
    const plan: InstallPlan = {
      home,
      previous: manifest,
      entries: [],
      dirs: [...manifest.dirs],
      kept: [],
    }
    await placeAgentSkills(ctx, plan, agentEntry(ctx), home, agent)
    const replaced = new Set(plan.entries.map((entry) => entry.path))
    await persistManifest(ctx, {
      ...manifest,
      entries: [...manifest.entries.filter((entry) => !replaced.has(entry.path)), ...plan.entries],
      dirs: plan.dirs,
    })
    const results = await configureAgents(ctx, { repair: agent })
    const [health] = await integrationHealth(ctx, [agent])
    return ok({
      agent,
      health: health as IntegrationHealth,
      changed: results.filter((result) => result.done).map((result) => result.message),
      kept: [
        ...plan.kept.map((path) => `Kept, not ours or changed by you: ${path}`),
        ...results.filter((result) => !result.done).map((result) => result.message),
      ],
    })
  })
}
