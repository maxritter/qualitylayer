// install · update · uninstall. What install writes is exactly what the
// manifest lists. User settings, shell rc files and skills stay; the shipped
// executable mod is refreshed with the binary on every install.

import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, lstatSync, readdirSync, readlinkSync, rmdirSync } from "node:fs"
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { loadWorkflow } from "#workflow"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { memoryEmbedNotices } from "../../memory-embed/notices.ts"
import {
  memoryEngineInstallationInfo,
  memoryEngineNotices,
  prepareMemoryEngineHome,
} from "../../memory-engine/index.ts"
import { memoryService } from "../../memory-runtime.ts"
import { liveLock, retireServersOf } from "../../server/lock.ts"
import { renderModFiles } from "../../workflow/mod-files.ts"
import { agentBinary } from "../agents/binary.ts"
import { AGENT_NAMES, type NativeAgent } from "../agents/ids.ts"
import { SCANNER_IDS, SCANNERS } from "../code-quality/scanners/registry.ts"
import {
  ensureScanners,
  type ScannerSetup,
  type ScannerSetupDeps,
  scannerPath,
} from "../code-quality/scanners/setup.ts"
import {
  ensureQualityTool,
  QLTY_VERSION,
  type QualityToolPlatform,
  type QualityToolSetup,
  type QualityToolSetupDeps,
  qualityToolPath,
} from "../code-quality/setup.ts"
import { logInstallerSetup } from "../code-quality/setup-log.ts"
import { readConfig } from "../config.ts"
import { verify } from "../licence/verify.ts"
import {
  assertSafeDirectory,
  insidePath,
  nativeCommand,
  removeAfterExit,
  removeFileOrRetire,
  renameWithRetry,
  windows,
} from "../platform.ts"
import { versionFromOutput, versionTextOfSync } from "../probe.ts"
import { effectiveChannel } from "../update/channel.ts"
import { readUpdate } from "../update/state.ts"
import { VERSION } from "../version.ts"
import { withAgentFolders } from "./agent-folders.ts"
import { configureAgents, modFolder, revertAgentSettings, roots } from "./agent-settings.ts"
import { findAgentBinary } from "./agents-found.ts"
import { configIsolationProblem } from "./config-isolation.ts"
import {
  assetName,
  compareVersions,
  downloadBinary,
  latestVersion,
  releaseNotes,
} from "./download.ts"
import { type IntegrationHealth, integrationHealth } from "./integration.ts"
import { clearLauncherProblem } from "./launcher-problem.ts"
import {
  checkManifest,
  type Entry,
  type Manifest,
  manifestPath,
  readManifest,
  realDir,
  realLocation,
  sha256,
  unsafePath,
  userHome,
} from "./manifest.ts"
import { type MemoryMcpRow, registerMemoryMcp, unregisterMemoryMcp } from "./memory-mcp.ts"
import { nativeIntegrationFiles } from "./native-integrations.ts"
import { configurePiSkillDiscovery, revertPiSkillDiscovery } from "./pi-skill-discovery.ts"
import { type AgentTarget, detectAgents, renderSkills } from "./skills.ts"
import { agentEntry, appMain, appPointer, appPrograms, startApp } from "./where.ts"

const skillCopy = (ctx: Ctx) => join(ctx.home, "skill")

/** The same context with its state folder at its real path, so recorded paths always match HOME. */
function canonical(ctx: Ctx): Ctx {
  return { ...ctx, home: join(realLocation(dirname(ctx.home)), basename(ctx.home)) }
}

async function checkedManifest(ctx: Ctx, home: string): Promise<Result<Manifest | null>> {
  const entry = lstatSync(manifestPath(ctx), { throwIfNoEntry: false })
  if (entry && (!entry.isFile() || entry.isSymbolicLink()))
    return err({
      code: "bad_args",
      message: "the installation manifest is not a regular file; left untouched",
    })
  const manifest = await readManifest(ctx)
  if (entry && manifest === null)
    return err({
      code: "bad_args",
      message: "the installation manifest cannot be read; left untouched",
    })
  const problem = manifest === null ? null : checkManifest(home, manifest)
  return problem === null
    ? ok(manifest)
    : err({ code: "bad_args", message: `the manifest is unsafe: ${problem}` })
}

async function persistManifest(ctx: Ctx, manifest: Manifest): Promise<void> {
  await ctx.fs.atomicWrite(manifestPath(ctx), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function installerTransaction<T>(
  given: Ctx,
  action: (ctx: Ctx, home: string) => Promise<Result<T>>,
): Promise<Result<T>> {
  const ctx = canonical(given)
  const homeCheck = userHome(ctx)
  if (!homeCheck.ok) return err({ code: "bad_args", message: homeCheck.reason })
  const home = homeCheck.home
  const problem = configIsolationProblem(ctx, home) ?? unsafePath(home, ctx.home)
  if (problem !== null) return err({ code: "bad_args", message: problem })
  try {
    await assertSafeDirectory(home)
    await assertSafeDirectory(ctx.home)
    return await ctx.fs.withLock(
      join(home, ".qualitylayer-install.lock"),
      async () => {
        await assertSafeDirectory(ctx.home)
        return action(ctx, home)
      },
      { label: "QualityLayer installation", waitMs: 120_000, createParent: false },
    )
  } catch (cause) {
    return err({
      code: "bad_args",
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

async function qualityToolEntries(
  ctx: Ctx,
  previous: Manifest | null,
  setup: Pick<QualityToolSetup, "status" | "files">,
  tool = "qlty",
) {
  const entries: Entry[] = (setup.files ?? []).map((file) => ({ kind: "file", ...file }))
  const kept: string[] = []
  const root = join(ctx.home, "tools", tool)
  for (const old of previous?.entries ?? []) {
    if (!insidePath(root, old.path) || entries.some((next) => next.path === old.path)) continue
    try {
      await assertSafeDirectory(dirname(old.path))
    } catch {
      entries.push(old)
      kept.push(old.path)
      continue
    }
    const entry = lstatSync(old.path, { throwIfNoEntry: false })
    if (!entry) continue
    if (
      setup.status === "ready" &&
      old.kind === "file" &&
      entry.isFile() &&
      !entry.isSymbolicLink() &&
      (await fileHash(old.path)) === old.sha256
    ) {
      try {
        await rm(old.path, { force: true })
        continue
      } catch {
        kept.push(old.path)
      }
    } else if (setup.status === "ready") kept.push(old.path)
    entries.push(old)
  }
  return { entries, kept }
}

/** Register an explicit quality setup without replacing the base installation's ownership. */
export async function recordQualityToolSetup(
  given: Ctx,
  setup: QualityToolSetup,
): Promise<Result<{ manifest: string }>> {
  return installerTransaction(given, async (ctx, home) => {
    const read = await checkedManifest(ctx, home)
    if (!read.ok) return read
    if (setup.status !== "ready")
      return err({
        code: "bad_args",
        message: `Qlty is not ready: ${setup.reason ?? setup.status}`,
      })
    const supplied = [
      setup.binary ?? "",
      ...(setup.files ?? []).map((file) => file.path),
      ...(setup.dirs ?? []),
    ]
    if (supplied.some((path) => unsafePath(home, path) !== null))
      return err({
        code: "bad_args",
        message: "Qlty setup has paths outside the installation HOME",
      })
    const managed: QualityToolSetup = {
      ...setup,
      binary:
        setup.binary === undefined
          ? undefined
          : join(realLocation(dirname(setup.binary)), basename(setup.binary)),
      files: setup.files?.map((file) => ({
        ...file,
        path: join(realLocation(dirname(file.path)), basename(file.path)),
      })),
      dirs: setup.dirs?.map((dir) => realDir(dir)),
    }
    const expected = qualityToolPath(ctx)
    if (expected === null || managed.version !== QLTY_VERSION || managed.binary !== expected)
      return err({
        code: "bad_args",
        message: "Qlty setup does not name this platform's pinned private executable",
      })
    const toolRoot = join(ctx.home, "tools", "qlty")
    const current = dirname(expected)
    const files = managed.files ?? []
    const seen = new Set<string>()
    for (const file of files) {
      await assertSafeDirectory(dirname(file.path))
      const parent = dirname(file.path)
      const isRetired =
        parent.startsWith(`${current}.retired-`) &&
        /^[a-f0-9-]{36}$/.test(parent.slice(`${current}.retired-`.length))
      const entry = lstatSync(file.path, { throwIfNoEntry: false })
      if (
        unsafePath(home, file.path) !== null ||
        !insidePath(toolRoot, file.path) ||
        (parent !== current && !isRetired) ||
        ![basename(expected), "LICENSE.md", "receipt.json"].includes(basename(file.path)) ||
        seen.has(file.path) ||
        !entry?.isFile() ||
        entry.isSymbolicLink() ||
        entry.size > 128 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        (await fileHash(file.path)) !== file.sha256
      )
        return err({
          code: "bad_args",
          message:
            "Qlty setup has unsafe, duplicate or unverified managed files; manifest left untouched",
        })
      seen.add(file.path)
    }
    if (
      [expected, join(current, "LICENSE.md"), join(current, "receipt.json")].some(
        (path) => !seen.has(path),
      )
    )
      return err({
        code: "bad_args",
        message: "Qlty setup has no complete binary/license/receipt ownership record",
      })
    for (const dir of managed.dirs ?? []) {
      if (
        unsafePath(home, dir) !== null ||
        (![ctx.home, join(ctx.home, "tools"), toolRoot].includes(dir) && !insidePath(toolRoot, dir))
      )
        return err({
          code: "bad_args",
          message: "Qlty setup has unsafe managed directories; manifest left untouched",
        })
      await assertSafeDirectory(dir)
      if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory())
        return err({ code: "bad_args", message: "Qlty setup records a missing managed directory" })
    }
    const previous = read.data
    const quality = await qualityToolEntries(ctx, previous, managed)
    const manifest: Manifest = {
      ...(previous ?? {
        schema: 2,
        version: VERSION,
        installed: ctx.clock.now(),
        kind: "standalone",
      }),
      entries: [
        ...(previous?.entries ?? []).filter((entry) => !insidePath(toolRoot, entry.path)),
        ...quality.entries,
      ],
      dirs: [...new Set([...(previous?.dirs ?? []), ...(managed.dirs ?? [])])],
    }
    await persistManifest(ctx, manifest)
    return ok({ manifest: manifestPath(ctx) })
  })
}

/**
 * Register the scanners `quality setup` installed, as the installer would: each ready scanner's
 * executable, licence and receipt, inside its own pinned folder and with the hashes on disk. Anything
 * else leaves the manifest untouched.
 */
export async function recordScannerSetups(
  given: Ctx,
  setups: readonly ScannerSetup[],
): Promise<Result<{ manifest: string }>> {
  return installerTransaction(given, async (ctx, home) => {
    const read = await checkedManifest(ctx, home)
    if (!read.ok) return read
    let previous = read.data
    for (const setup of setups.filter((s) => s.status === "ready")) {
      const expected = scannerPath(ctx, setup.id)
      const spec = SCANNERS[setup.id]
      const root = join(ctx.home, "tools", setup.id)
      if (expected === null || setup.version !== spec.version || setup.binary !== expected)
        return err({
          code: "bad_args",
          message: `${spec.name} setup does not name its pinned executable`,
        })
      const current = dirname(expected)
      const names = [basename(expected), "LICENSE.txt", "receipt.json"]
      const files = setup.files ?? []
      for (const file of files) {
        const entry = lstatSync(file.path, { throwIfNoEntry: false })
        if (
          unsafePath(home, file.path) !== null ||
          dirname(file.path) !== current ||
          !names.includes(basename(file.path)) ||
          !entry?.isFile() ||
          entry.isSymbolicLink() ||
          (await fileHash(file.path)) !== file.sha256
        )
          return err({
            code: "bad_args",
            message: `${spec.name} setup has unsafe or unverified files; manifest left untouched`,
          })
      }
      if (names.some((name) => !files.some((file) => file.path === join(current, name))))
        return err({ code: "bad_args", message: `${spec.name} setup is incomplete` })
      const owned = await qualityToolEntries(ctx, previous, setup, setup.id)
      previous = {
        ...(previous ?? {
          schema: 2,
          version: VERSION,
          installed: ctx.clock.now(),
          kind: "standalone",
        }),
        entries: [
          ...(previous?.entries ?? []).filter((entry) => !insidePath(root, entry.path)),
          ...owned.entries,
        ],
        dirs: [
          ...new Set([
            ...(previous?.dirs ?? []),
            ...(setup.dirs ?? []).filter((dir) => unsafePath(home, dir) === null),
          ]),
        ],
      }
    }
    if (previous !== null) await persistManifest(ctx, previous)
    return ok({ manifest: manifestPath(ctx) })
  })
}

export type InstallReport = {
  version: string
  binary: string
  skills: { label: string; path: string }[]
  kept: string[]
  linked: string | null
  pathLine: string | null
  licence: string
  /** The agent settings this install set, one line each. */
  configured: string[]
  /** The same settings by agent and name, for the install screen. */
  settings: { agent: string; label: string }[]
  /** Settings left as the user has them, each with its reason. */
  declined: string[]
  /** Fixed outcome for setup; installation notes are not a client readiness contract. */
  codexHooks?: "ready" | "pending"
  /** One line per agent: the memory tools registered, already there, or why not. */
  memoryTools: MemoryMcpRow[]
  qualityTool?: QualityToolSetup
  /** The security scanners, one setup each: ready, unsupported on this platform, or failed. */
  scanners?: ScannerSetup[]
  /** The folder another agent copies into its skills folder. */
  skillCopy: string
  /** `ql`, the short command, where it is linked; null when another command holds the name. */
  shortcut: string | null
  /** The place where another `ql` was found and kept. */
  shortcutTaken: string | null
  message: string
}

async function fileHash(path: string): Promise<string | null> {
  try {
    return sha256(new Uint8Array(await readFile(path)))
  } catch {
    return null
  }
}

/** Create `dir` and any missing parents inside HOME, recording the ones created. */
async function ensureDir(home: string, dir: string, created: string[]): Promise<void> {
  const missing: string[] = []
  for (let current = dir; insidePath(home, current); current = dirname(current)) {
    if (existsSync(current)) break
    missing.unshift(current)
  }
  for (const path of missing) {
    await mkdir(path)
    if (!created.includes(path)) created.push(path)
  }
}

/** Windows holds loaded executable files open. Rename the old one before replacing it. */
async function replaceBinary(temporary: string, binary: string): Promise<string | null> {
  if (!windows || !existsSync(binary)) {
    await rename(temporary, binary)
    return null
  }
  const old = `${binary}.old-${randomUUID()}.exe`
  await renameWithRetry(binary, old)
  try {
    await renameWithRetry(temporary, binary)
  } catch (cause) {
    await renameWithRetry(old, binary)
    throw cause
  }
  try {
    await rm(old, { force: true })
  } catch {
    removeAfterExit(old)
    return old
  }
  return null
}

type Plan = {
  home: string
  previous: Manifest | null
  entries: Entry[]
  dirs: string[]
  kept: string[]
}

/** Write one file we own. User changes stay unless this is shipped executable mod code. */
async function place(
  plan: Plan,
  path: string,
  content: string | Uint8Array,
  mode?: number,
  replace = false,
): Promise<boolean> {
  const problem = unsafePath(plan.home, path)
  if (problem !== null) throw new Error(problem)
  const before = plan.previous?.entries.find((e) => e.path === path && e.kind === "file")
  const current = await fileHash(path)
  if (current !== null) {
    const ours = before !== undefined && before.kind === "file" && before.sha256 === current
    const same = current === sha256(content)
    if (!replace && !ours && !same) {
      plan.kept.push(path)
      // Keep listing a file that was ours, so uninstall still reports it rather than forgetting it.
      if (before !== undefined) plan.entries.push(before)
      return false
    }
  }
  await ensureDir(plan.home, dirname(path), plan.dirs)
  const temporary = `${path}.qualitylayer-new`
  await writeFile(temporary, content)
  if (mode !== undefined) await chmod(temporary, mode)
  await rename(temporary, path)
  plan.entries.push({ kind: "file", path, sha256: sha256(content) })
  return true
}

/**
 * The skills, commands and plugin files of every agent started on this machine, or of `only`.
 * Agents that read the same skill folder (Cursor and Grok read Claude Code's and Codex's) share one
 * copy. One line per file placed.
 */
async function placeAgentSkills(
  ctx: Ctx,
  plan: Plan,
  binary: string,
  home: string,
  only?: NativeAgent,
): Promise<InstallReport["skills"]> {
  const skills: InstallReport["skills"] = []
  const placed = new Set<string>()
  for (const target of detectAgents(ctx.env, home)) {
    if (only === undefined || target.agent === only)
      skills.push(...(await placeTarget(plan, binary, target, placed)))
  }
  return skills
}

/** One agent's files, leaving out any whose path `placed` already holds. */
async function placeTarget(
  plan: Plan,
  binary: string,
  target: AgentTarget,
  placed: Set<string>,
): Promise<InstallReport["skills"]> {
  const skills: InstallReport["skills"] = []
  for (const file of renderSkills(binary, target.agent)) {
    const path = join(target.skills, file.name, file.path)
    if (placed.has(path)) continue
    placed.add(path)
    if (await place(plan, path, file.text)) skills.push({ label: target.label, path })
  }
  for (const file of nativeIntegrationFiles(binary, target)) await place(plan, file.path, file.text)
  return skills
}

/** Copy the App's CLI and launcher to `lasting`, owner-only, each checked against its original. */
async function keepPrograms(
  plan: Plan,
  programs: { cli: string; launcher: string },
  lasting: string,
): Promise<{ cli: string; launcher: string }> {
  const problem = unsafePath(plan.home, lasting)
  if (problem !== null) throw new Error(problem)
  await ensureDir(plan.home, lasting, plan.dirs)
  await chmod(lasting, 0o700)
  const copy = async (from: string): Promise<string> => {
    const to = join(lasting, basename(from))
    await copyFile(from, to)
    await chmod(to, 0o700)
    const hash = await fileHash(to)
    if (hash === null || hash !== (await fileHash(from))) {
      throw new Error(`the copy of ${basename(from)} does not match the App's`)
    }
    plan.entries.push({ kind: "file", path: to, sha256: hash })
    return to
  }
  return { cli: await copy(programs.cli), launcher: await copy(programs.launcher) }
}

/** The first Claude Code that loads mods. */
const MOD_MIN_VERSION = "2.1.287"

/**
 * Set to `1` in an install's environment when the person's licence key is activated right after
 * it, as when this computer adds a machine: the install then starts no trial there.
 */
export const KEY_FOLLOWS = "QUALITYLAYER_KEY_FOLLOWS"

/** The version of the native Claude command when its config folder exists. */
function installedClaudeVersion(ctx: Ctx, claude: string | null): string | null {
  const root = roots(ctx)?.claude
  if (claude === null || root === undefined || !existsSync(root)) return null
  let command: string[]
  try {
    command = nativeCommand(claude, ["--version"])
  } catch {
    // A Windows shim that cannot be run directly leaves the version unknown.
    return null
  }
  const text = versionTextOfSync(claude, command, { timeoutMs: 5_000 })
  return versionFromOutput(text)
}

function onPath(ctx: Ctx, dir: string): boolean {
  const wanted = realDir(dir)
  return (ctx.env.get("PATH") ?? "")
    .split(delimiter)
    .some((entry) => entry !== "" && realDir(entry) === wanted)
}

export type InstallOptions = {
  /** The binary to install: the running one. */
  source: string
  /** Re-run by `update` from the new binary: no licence step, shorter report. */
  refresh?: boolean
  /** Told the step that starts now, for a live view ("Checking your licence"). */
  progress?: (step: string) => void
  /**
   * An App install: the folder holding the App's CLI and launcher. The launcher goes where agents
   * call; `lasting` is the folder the programs are copied to when the App's own is temporary.
   */
  app?: { folder: string; lasting?: string }
}

/** Internal provision seams; public install/update arguments stay unchanged. */
export type InstallInternals = {
  qualityTool?: QualityToolSetupDeps
  qualityToolPlatform?: QualityToolPlatform
  scanners?: ScannerSetupDeps
}

/** One install line for the security scanners: which are ready, and why any other is not. */
function scannerLine(setups: readonly ScannerSetup[]): string {
  const ready = setups
    .filter((s) => s.status === "ready")
    .map((s) => `${SCANNERS[s.id].name} ${s.version}`)
  const other = setups
    .filter((s) => s.status !== "ready")
    .map(
      (s) =>
        `${SCANNERS[s.id].name}: ${s.status === "unsupported" ? "no build for this computer" : (s.reason ?? s.status)}`,
    )
  return other.length === 0
    ? `Security scans: ${ready.join(", ")} are ready.`
    : `Security scans: ${ready.length ? `${ready.join(", ")} ready; ` : ""}${other.join("; ")}. Run qualitylayer quality setup to retry.`
}

export async function install(
  given: Ctx,
  options: InstallOptions,
  internal: InstallInternals = {},
): Promise<Result<InstallReport>> {
  return installerTransaction(given, (ctx) => installLocked(ctx, options, internal))
}

async function installLocked(
  given: Ctx,
  options: InstallOptions,
  internal: InstallInternals,
): Promise<Result<InstallReport>> {
  const ctx = await withAgentFolders(canonical(given))
  const homeCheck = userHome(ctx)
  if (!homeCheck.ok) return err({ code: "bad_args", message: homeCheck.reason })
  const home = homeCheck.home
  const isolationProblem = configIsolationProblem(ctx, home)
  if (isolationProblem !== null) return err({ code: "bad_args", message: isolationProblem })
  const stateProblem = unsafePath(home, ctx.home)
  if (stateProblem !== null) return err({ code: "bad_args", message: stateProblem })
  const read = await checkedManifest(ctx, home)
  if (!read.ok) return read
  const previous = read.data
  const plan: Plan = { home, previous, entries: [], dirs: [...(previous?.dirs ?? [])], kept: [] }
  let programs = options.app === undefined ? null : appPrograms(options.app.folder)
  if (options.app !== undefined && programs === null) {
    return err({
      code: "bad_args",
      message: `${options.app.folder} holds no QualityLayer App: qualitylayer-cli and qualitylayer-launcher are missing`,
    })
  }

  // ~/.qualitylayer itself: created here when it did not exist yet.
  await ensureDir(home, ctx.home, plan.dirs)
  options.progress?.("Preparing project memory")
  const engineInfo = memoryEngineInstallationInfo()
  await ensureDir(home, join(ctx.home, "memory", "engine", engineInfo.sha256), plan.dirs)
  const memory = await prepareMemoryEngineHome(ctx.home)
  plan.entries.push({ kind: "file", path: memory.path, sha256: memory.sha256 })
  await place(plan, join(ctx.home, "notices", "engram.txt"), memoryEngineNotices())
  await place(plan, join(ctx.home, "notices", "minilm.txt"), memoryEmbedNotices())
  options.progress?.("Preparing code-quality checks")
  const qualityTool = await ensureQualityTool(
    ctx,
    internal.qualityToolPlatform,
    internal.qualityTool,
  )
  const quality = await qualityToolEntries(ctx, previous, qualityTool)
  plan.entries.push(...quality.entries)
  plan.kept.push(...quality.kept)
  for (const dir of qualityTool.dirs ?? []) if (!plan.dirs.includes(dir)) plan.dirs.push(dir)
  // The security scanners, pinned like Qlty; one that fails or has no build here leaves its scan not checked.
  const scanners = await ensureScanners(
    ctx,
    internal.qualityToolPlatform,
    internal.scanners,
    (spec) => options.progress?.(`Preparing ${spec.name} ${spec.version} (${spec.scans})`),
  )
  for (const setup of scanners) {
    const owned = await qualityToolEntries(ctx, previous, setup, setup.id)
    plan.entries.push(...owned.entries)
    plan.kept.push(...owned.kept)
    for (const dir of setup.dirs ?? []) if (!plan.dirs.includes(dir)) plan.dirs.push(dir)
  }
  // The installer's setup is a setup run like `quality setup`: `quality status` names its error too.
  await logInstallerSetup(ctx, qualityTool, scanners)
  if (programs !== null && options.app?.lasting !== undefined) {
    programs = await keepPrograms(plan, programs, options.app.lasting)
  }

  // Servers that run from what is being replaced, or are another build, go now: the App starts the
  // new one. Otherwise a new App attaches to an old server and shows its old page.
  await retireServersOf(ctx, [options.app?.folder ?? dirname(agentEntry(ctx))])

  options.progress?.("Placing the binary")
  const binary = agentEntry(ctx)
  const source = programs?.launcher ?? options.source
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

  options.progress?.("Adding the skills")
  for (const file of renderSkills(binary, "claude-code"))
    await place(plan, join(skillCopy(ctx), file.name, file.path), file.text)
  const skills = await placeAgentSkills(ctx, plan, binary, home)
  await configurePiSkillDiscovery(ctx, home)

  // The Claude Code mod: its files beside the binary, running the binary by its path. Claude Code
  // finds it through CLAUDE_CODE_PLUGIN_DIRS, which configureAgents sets once the files are there.
  // An install may run without a shell's PATH (an App started from Finder, a dev container's
  // postCreateCommand, where ~/.local/bin is not on it yet), so it looks further.
  const claude =
    (options.app === undefined ? await agentBinary(ctx, "claude-code") : null) ??
    (await findAgentBinary(ctx, "claude-code"))
  const claudeVersion = installedClaudeVersion(ctx, claude)
  const modPlaced = claudeVersion !== null && compareVersions(claudeVersion, MOD_MIN_VERSION) >= 0
  if (modPlaced || existsSync(modFolder(ctx))) {
    for (const file of renderModFiles(binary)) {
      await place(plan, join(modFolder(ctx), file.path), file.text, undefined, true)
    }
  }

  /** A link to the binary at `link`, unless something else already holds that name. */
  const linkBinary = async (link: string): Promise<boolean> => {
    let existing: string | null = null
    try {
      existing = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : "not a link"
    } catch {
      existing = null
    }
    if (existing === null) await symlink(binary, link)
    if (existing !== null && existing !== binary) return false
    plan.entries.push({ kind: "symlink", path: link, target: binary })
    return true
  }

  // On PATH when ~/.local/bin already is; nothing is added to a shell rc file.
  let linked: string | null = null
  let pathLine: string | null = null
  // `ql`, the short command (T82): beside the binary, and in ~/.local/bin when that is on PATH,
  // unless another command already answers to the name there.
  let shortcut: string | null = null
  let shortcutTaken: string | null = null
  const besideBinary = join(dirname(binary), windows ? "ql.cmd" : "ql")
  const shortcutPlaced = windows
    ? await place(plan, besideBinary, '@echo off\r\n"%~dp0qualitylayer.exe" %*\r\n')
    : await linkBinary(besideBinary)
  if (shortcutPlaced) shortcut = besideBinary
  else shortcutTaken = besideBinary
  const localBin = join(home, ".local", "bin")
  if (!windows && onPath(ctx, localBin) && existsSync(localBin)) {
    const link = join(localBin, "qualitylayer")
    if (await linkBinary(link)) linked = link
    else plan.kept.push(link)
    const short = join(localBin, "ql")
    if (await linkBinary(short)) shortcut = short
    else {
      shortcut = null
      shortcutTaken = short
    }
  }
  if (linked === null && !onPath(ctx, dirname(binary))) {
    pathLine = windows
      ? `$env:Path = '${dirname(binary).replaceAll("'", "''")};' + $env:Path`
      : `export PATH="$HOME/.qualitylayer/bin:$PATH"`
  }

  // Files that were ours and are not any more (an agent removed, say) go when unchanged,
  // and with them the folders that held only them: a renamed skill leaves no folder behind.
  // The walk goes by what is empty.
  const ownedRoots = [home, ...plan.dirs]
  for (const old of previous?.entries ?? []) {
    if (plan.entries.some((e) => e.path === old.path)) continue
    if (old.kind !== "file") continue
    const current = await fileHash(old.path)
    if (current === null) continue
    if (current !== old.sha256) {
      if (
        /\/(?:(?:skills|skill)\/(?:ql|agent-peers)\/(?:SKILL\.md|agents\/openai\.yaml)|commands\/ql\.md)$/.test(
          old.path.replaceAll("\\", "/"),
        )
      ) {
        // Preserve edits outside skill discovery; keeping SKILL.md would activate both names.
        const preserved = `${old.path}.qualitylayer-backup-${randomUUID()}`
        await rename(old.path, preserved)
        plan.kept.push(preserved)
        continue
      }
      plan.entries.push(old)
      plan.kept.push(old.path)
      continue
    }
    try {
      await rm(old.path, { force: true })
    } catch (cause) {
      if (windows && old.path.startsWith(`${binary}.old-`) && old.path.endsWith(".exe")) {
        // An existing Cockpit/stand-in may still be running the previous executable.
        plan.entries.push(old)
        continue
      }
      throw cause
    }
    for (let dir = dirname(old.path); insidePath(home, dir); dir = dirname(dir)) {
      const ours = ownedRoots.some((root) => dir === root || insidePath(root, dir))
      if (!ours || !existsSync(dir) || readdirSync(dir).length > 0) break
      rmdirSync(dir)
      if (plan.dirs.includes(dir)) plan.dirs.splice(plan.dirs.indexOf(dir), 1)
    }
  }
  for (const dir of [...plan.dirs].reverse()) {
    if (insidePath(join(ctx.home, "tools", "qlty"), dir)) {
      try {
        await assertSafeDirectory(dir)
      } catch {
        continue
      }
    }
    if (dir === home || !existsSync(dir) || readdirSync(dir).length > 0) continue
    rmdirSync(dir)
    plan.dirs.splice(plan.dirs.indexOf(dir), 1)
  }

  // The lesson tools for Claude Code and Codex, through their own `mcp` commands: only where the
  // agent shows no entry or another one. The launcher is the path they keep, so an update needs none.
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

  // Lessons saved before search by meaning, or under an older model, get their vectors now, so the
  // first search after an upgrade already finds them. Nothing here can fail the install.
  if (existsSync(join(ctx.home, "memory", "catalog.sqlite"))) {
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

  let licence = ""
  // A refresh looks without starting a trial; a first install may start one, unless the person's
  // key is activated here right after (an added machine), which would make that trial for nothing.
  options.progress?.("Checking your licence")
  const entitled = await verify(ctx, {
    passive: options.refresh === true || ctx.env.get(KEY_FOLLOWS) === "1",
  })
  if (options.refresh !== true) {
    licence = entitled.ok
      ? entitled.data.tier === "trial"
        ? `Trial: ${entitled.data.daysLeft} day(s) left.`
        : `Licensed (${entitled.data.tier}).`
      : `No licence yet: ${entitled.error.message}`
  }
  // A release build holds no phase text. Fetch this version's once now, so the first
  // command works offline; when this cannot reach qualitylayer.dev, the first command asks again.
  if (entitled.ok) {
    options.progress?.("Fetching the workflow")
    await loadWorkflow(ctx)
  }

  // An install repairs what the launcher noted (the App's command line gone or blocked).
  await clearLauncherProblem(ctx)

  // The agent settings the workflow relies on: only what is missing, and said.
  options.progress?.("Setting up your agents")
  const results = await configureAgents(ctx, { mod: modPlaced, claudeVersion })
  const configured = results.filter((r) => r.done)
  const declined = results.filter((r) => !r.done)

  const lines = [
    `QualityLayer ${VERSION} is installed at ${binary}.`,
    ...(programs !== null
      ? [`  It runs the QualityLayer App's command line: ${programs.cli}`]
      : []),
    ...skills.map((s) => `  ${s.label}: ${s.path}`),
    ...(skills.length === 0
      ? [
          "  No initialized coding agent was found: start Claude Code, Codex, Cursor, Grok, GitHub Copilot, Antigravity, Pi or OpenCode once, then run install again.",
        ]
      : []),
    `Another agent: copy the skill folders from ${skillCopy(ctx)} into its skills directory.`,
    ...plan.kept.map((path) => `  Kept, not ours or changed by you: ${path}`),
    ...(configured.length > 0
      ? [
          "Set for QualityLayer in your agent settings (uninstall puts them back):",
          ...configured.map((r) => `  ${r.message}`),
        ]
      : []),
    ...declined.map((r) => r.message),
    "Memory tools for your agents:",
    ...tools.rows.map((row) => `  ${row.message}`),
    qualityTool.status === "ready"
      ? `Code health: Qlty ${qualityTool.version} is ready.`
      : `Code health is not ready: ${qualityTool.reason ?? qualityTool.status}. Run qualitylayer quality setup to retry.`,
    scannerLine(scanners),
    ...(pathLine !== null ? [`Add the binary to PATH in your shell profile: ${pathLine}`] : []),
    ...(licence !== "" ? [licence] : []),
    'Next: ask your coding agent naturally, for example: "Using QualityLayer, plan a CSV export."',
  ]
  return ok({
    version: VERSION,
    binary,
    skills,
    kept: plan.kept,
    linked,
    pathLine,
    licence,
    configured: configured.map((r) => r.message),
    settings: configured.map((r) => ({
      agent: AGENT_NAMES[r.id.split(":")[0] as NativeAgent],
      label: r.message.slice(0, r.message.indexOf(": ")),
    })),
    declined: declined.map((r) => r.message),
    ...(results.some((r) => r.id === "codex:hook-trust")
      ? {
          codexHooks: results.find((r) => r.id === "codex:hook-trust")?.done
            ? ("ready" as const)
            : ("pending" as const),
        }
      : {}),
    memoryTools: tools.rows,
    qualityTool,
    scanners,
    skillCopy: skillCopy(ctx),
    shortcut,
    shortcutTaken,
    message: lines.join("\n"),
  })
}

export type RepairReport = {
  agent: NativeAgent
  /** The agent's integration after the repair. */
  health: IntegrationHealth
  /** What was set again, one line each. */
  changed: string[]
  /** What stayed as the person has it, one line each. */
  kept: string[]
}

/**
 * Put one agent's QualityLayer integration back: its skills and command files where they are gone
 * or ours and out of date, and its hooks where the person took them out. A file or setting the
 * person changed stays as it is, and so does every hook of their own. The manifest records the
 * files, so uninstall still removes exactly what QualityLayer put there.
 */
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
    const plan: Plan = { home, previous: manifest, entries: [], dirs: [...manifest.dirs], kept: [] }
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

export type UninstallReport = {
  removed: string[]
  kept: string[]
  purged: boolean
  message: string
}

export async function uninstall(
  given: Ctx,
  options: { purge: boolean },
): Promise<Result<UninstallReport>> {
  return installerTransaction(given, (ctx) => uninstallLocked(ctx, options))
}

async function uninstallLocked(
  given: Ctx,
  options: { purge: boolean },
): Promise<Result<UninstallReport>> {
  const ctx = canonical(given)
  const homeCheck = userHome(ctx)
  if (!homeCheck.ok) return err({ code: "bad_args", message: homeCheck.reason })
  const home = homeCheck.home
  const isolationProblem = configIsolationProblem(ctx, home)
  if (isolationProblem !== null) return err({ code: "bad_args", message: isolationProblem })
  const stateProblem = unsafePath(home, ctx.home)
  if (stateProblem !== null) return err({ code: "bad_args", message: stateProblem })

  const read = await checkedManifest(ctx, home)
  if (!read.ok) return read
  const manifest = read.data
  if (manifest === null && !options.purge) {
    return err({
      code: "bad_args",
      message: "QualityLayer is not installed here: there is no manifest",
    })
  }
  if (manifest !== null) {
    const problem = checkManifest(home, manifest)
    if (problem !== null) {
      return err({
        code: "bad_args",
        message: `the manifest is unsafe, nothing was removed: ${problem}`,
      })
    }
  }

  // A running Cockpit holds files open under ~/.qualitylayer.
  if (windows && existsSync(join(ctx.home, "peers"))) {
    // Stop only QualityLayer's owned stand-ins, never the coding agents they bridge.
    const stopped = spawnSync(process.execPath, ["peers", "down"], {
      env: { ...process.env, HOME: home, USERPROFILE: home, QUALITYLAYER_HOME: ctx.home },
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    })
    if (stopped.status !== 0)
      return err({
        code: "bad_args",
        message:
          "could not stop QualityLayer peer processes: " +
          (stopped.error?.message ?? stopped.stderr),
      })
  }
  const cockpit = await liveLock(ctx)
  if (cockpit !== null) {
    try {
      process.kill(cockpit.pid, "SIGTERM")
    } catch {
      // gone already
    }
    if (windows) {
      for (let i = 0; i < 50 && (await liveLock(ctx)) !== null; i++) await ctx.clock.sleep(100)
      if ((await liveLock(ctx)) !== null)
        return err({
          code: "bad_args",
          message: "the QualityLayer App's server has not stopped; retry uninstall",
        })
    }
  }

  // The agent settings the installer set go back first, while their records exist.
  const reverted = existsSync(join(ctx.home, "agent-settings.json"))
    ? await revertAgentSettings(ctx)
    : []
  await revertPiSkillDiscovery(ctx, home)
  // The memory server install registered with each agent goes through the same commands.
  const unregistered = await unregisterMemoryMcp(ctx, manifest?.mcp ?? [])

  const removed: string[] = []
  const kept: string[] = []
  for (const entry of manifest?.entries ?? []) {
    if (insidePath(join(ctx.home, "tools", "qlty"), entry.path)) {
      try {
        await assertSafeDirectory(dirname(entry.path))
      } catch {
        kept.push(entry.path)
        continue
      }
    }
    if (entry.kind === "file") {
      const current = await fileHash(entry.path)
      if (current === null) continue
      if (current === entry.sha256) {
        if (
          windows &&
          realDir(entry.path).toLowerCase() === realDir(process.execPath).toLowerCase()
        ) {
          // Outside the state folder (same volume), so --purge can finish before this process exits.
          const retired = join(home, `.qualitylayer-uninstall-${process.pid}.exe`)
          await renameWithRetry(entry.path, retired)
          removeAfterExit(retired)
        } else {
          // An App install's launcher is still running (it waits for the CLI that runs this), so
          // Windows refuses to delete it: it is renamed away and deleted once it exits.
          await removeFileOrRetire(
            entry.path,
            join(home, `.qualitylayer-uninstall-${process.pid}-${randomUUID()}.exe`),
          )
        }
        removed.push(entry.path)
      } else {
        kept.push(entry.path)
      }
    } else {
      try {
        if (lstatSync(entry.path).isSymbolicLink() && readlinkSync(entry.path) === entry.target) {
          await unlink(entry.path)
          removed.push(entry.path)
        } else {
          kept.push(entry.path)
        }
      } catch {
        // already gone
      }
    }
  }
  // Claude Code writes its type declarations into a mod it loads: they go with the mod's folder,
  // unless a file of ours in it was changed by the user.
  const mod = modFolder(ctx)
  const ownsMod =
    manifest?.entries.some((entry) => insidePath(mod, entry.path)) || manifest?.dirs.includes(mod)
  if (ownsMod && !kept.some((path) => insidePath(mod, path))) {
    await rm(mod, { recursive: true, force: true })
  }
  if (manifest !== null) await rm(manifestPath(ctx), { force: true })
  // Each scanner's private config and cache (OpenGrep unpacks its runtime there) goes with it.
  for (const id of SCANNER_IDS) {
    const state = join(ctx.home, "tools", id, "state")
    try {
      await assertSafeDirectory(state)
      await rm(state, { recursive: true, force: true })
    } catch {
      // never created, or not a folder QualityLayer made
    }
  }

  if (options.purge) {
    // Licence, settings and every task's runtime state; the plans in repositories stay.
    const inside = kept.filter((path) => insidePath(ctx.home, path))
    if (inside.length === 0) await rm(ctx.home, { recursive: true, force: true })
  }
  for (const dir of [...(manifest?.dirs ?? [])].reverse()) {
    try {
      if (insidePath(join(ctx.home, "tools", "qlty"), dir)) await assertSafeDirectory(dir)
      await rmdir(dir)
    } catch {
      // not empty: something else lives there now
    }
  }

  const leftover = existsSync(ctx.home)
  const lines = [
    ...reverted.map((r) => r.message),
    ...unregistered,
    `Removed ${removed.length} file(s).`,
    ...kept.map((path) => `  Kept, changed since install: ${path}`),
    leftover
      ? `Kept ${ctx.home} (licence, settings and task state). Remove it too with \`qualitylayer uninstall --purge\`.`
      : "No QualityLayer files remain. Plans in your repositories (docs/plans) are untouched.",
  ]
  return ok({ removed, kept, purged: !leftover, message: lines.join("\n") })
}

export type UpdateReport = {
  from: string
  to: string
  updated: boolean
  message: string
  /** The release's notes (its CHANGELOG section), when they could be read. */
  notes?: string | null
  /** The App is doing the update. */
  app?: boolean
}

/**
 * Where the App lives for good. A Linux AppImage runs from a temporary mount that vanishes with
 * it; its runtime names the AppImage file itself in APPIMAGE, which is what is started again.
 */
function appBundlePath(ctx: Ctx, folder: string): string {
  const image = process.platform === "linux" ? ctx.env.get("APPIMAGE")?.trim() : undefined
  return image !== undefined && image !== "" && existsSync(image) ? resolve(image) : resolve(folder)
}

/** The new binary writes its own skill (the text travels with the version); on failure the kept one returns. */
async function refreshOrRestore(
  binary: string,
  previous: string,
  kept: boolean,
  version: string,
): Promise<Result<void>> {
  // The new binary writes its own skill: the text travels with the version.
  const refreshed = spawnSync(binary, ["install", "--refresh", "--json"], {
    env: process.env,
    encoding: "utf8",
  })
  if (refreshed.status !== 0) {
    // Back to the binary that matches the manifest, skills and hooks, so nothing is half updated.
    const restored = kept
      ? await replaceBinary(previous, binary).then(
          () => true,
          () => false,
        )
      : false
    return err({
      code: "bad_args",
      message: restored
        ? `QualityLayer ${version} could not set up its skills and hooks, so ${VERSION} was kept: ${refreshed.stderr || refreshed.stdout}`
        : `updated the binary, but refreshing the skills failed: ${refreshed.stderr || refreshed.stdout}`,
    })
  }
  return ok(undefined)
}

/**
 * Put the downloaded binary in place, then let it set up its own skills and hooks. The binary that
 * works now is kept until that succeeds and put back when it fails, so nothing is half updated.
 */
async function swapBinary(ctx: Ctx, version: string, bytes: Uint8Array): Promise<Result<void>> {
  const binary = agentEntry(ctx)
  // The binary that works now, kept until the new one has refreshed its skills and hooks.
  const previous = `${binary}.qualitylayer-previous`
  const kept = existsSync(binary) ? await copyFile(binary, previous).then(() => true) : false
  const replaced = await installerTransaction(ctx, async (locked, home) => {
    const latest = await checkedManifest(locked, home)
    if (!latest.ok) return latest
    if (latest.data === null)
      return err({
        code: "bad_args",
        message: "the installation was removed during update; retry install",
      })
    const temporary = `${binary}.qualitylayer-new`
    await mkdir(dirname(binary), { recursive: true })
    await writeFile(temporary, bytes)
    await chmod(temporary, 0o755)
    const retired = await replaceBinary(temporary, binary)
    const retiredHash = retired === null ? null : await fileHash(retired)
    if (retired !== null && retiredHash !== null)
      await persistManifest(locked, {
        ...latest.data,
        entries: [...latest.data.entries, { kind: "file", path: retired, sha256: retiredHash }],
      })
    return ok(undefined)
  })
  if (!replaced.ok) {
    if (kept) await rm(previous, { force: true })
    return replaced
  }

  const refreshed = await refreshOrRestore(binary, previous, kept, version)
  if (!refreshed.ok) return refreshed
  if (kept) await rm(previous, { force: true }).catch(() => removeAfterExit(previous))
  return ok(undefined)
}

export async function update(
  given: Ctx,
  options: { version?: string; force?: boolean },
  internal: InstallInternals = {},
): Promise<Result<UpdateReport>> {
  const ctx = canonical(given)
  const homeCheck = userHome(ctx)
  if (!homeCheck.ok) return err({ code: "bad_args", message: homeCheck.reason })
  const isolationProblem = configIsolationProblem(ctx, homeCheck.home)
  if (isolationProblem !== null) return err({ code: "bad_args", message: isolationProblem })
  const stateProblem = unsafePath(homeCheck.home, ctx.home)
  if (stateProblem !== null) return err({ code: "bad_args", message: stateProblem })
  const read = await checkedManifest(ctx, homeCheck.home)
  if (!read.ok) return read
  const manifest = read.data
  if (manifest === null) {
    return err({
      code: "bad_args",
      message: windows
        ? "QualityLayer is not installed here; run install.ps1 first"
        : "QualityLayer is not installed here; run install.sh first",
    })
  }
  const problem = checkManifest(homeCheck.home, manifest)
  if (problem !== null)
    return err({ code: "bad_args", message: `the manifest is unsafe: ${problem}` })
  // An App install has one updater, the App: two choosing different versions is the failure to avoid.
  const main = await appMain(ctx)
  if (main !== null && !existsSync(main))
    return err({
      code: "bad_args",
      message: `The QualityLayer App is no longer at ${main}. Open the App to update it, or download the latest from https://qualitylayer.dev/download.`,
    })
  if (main !== null) {
    startApp(main, ["--update"])
    // What the App found at its last check, when it has one: the same notes its sheet shows.
    const known = await readUpdate(ctx)
    const pending = known.available !== null && compareVersions(known.available, VERSION) > 0
    return ok({
      from: VERSION,
      to: pending ? (known.available as string) : VERSION,
      updated: false,
      app: pending,
      notes: pending ? known.notes : null,
      message: "The QualityLayer App updates itself.",
    })
  }
  const asset = assetName()
  if (asset === null) {
    return err({ code: "bad_args", message: `no release for ${process.platform}-${process.arch}` })
  }
  let version = options.version?.replace(/^v/, "")
  if (version === undefined) {
    const channel = effectiveChannel((await readConfig(ctx)).updates.channel, VERSION)
    const latest = await latestVersion(ctx, asset, channel)
    if (!latest.ok) return latest
    version = latest.data
  }
  if (options.force !== true && compareVersions(version, VERSION) <= 0) {
    const refreshed = await install(ctx, { source: agentEntry(ctx), refresh: true }, internal)
    if (!refreshed.ok) return refreshed
    return ok({
      from: VERSION,
      to: version,
      updated: false,
      message: `QualityLayer ${VERSION} is up to date.`,
    })
  }

  const downloaded = await downloadBinary(ctx, version, asset)
  if (!downloaded.ok) return downloaded
  const swapped = await swapBinary(ctx, version, downloaded.data.bytes)
  if (!swapped.ok) return swapped
  return ok({
    from: VERSION,
    to: version,
    updated: true,
    notes: await releaseNotes(ctx, version),
    message: `Updated QualityLayer ${VERSION} → ${version}.`,
  })
}

export { manifestPath }
