import { createHash, randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { QUALITY_PROJECTS_MAX } from "../home-caps.ts"
import { realLocation } from "../install/manifest.ts"
import { WorkflowStateBusy } from "../lock-busy.ts"
import { runQuality, runQualityProcess } from "./engine.ts"
import { scannerStatus } from "./scanners/setup.ts"
import { qualityToolPath } from "./setup.ts"

export type QualityMode = "structure" | "duplication" | "metrics" | "lint"
type Finding = Awaited<ReturnType<typeof runQuality>>["findings"][number]
export type ReviewedFinding = Finding & {
  state: "new" | "worsened" | "known" | "acknowledged"
  sourceHash: string
  acknowledgment?: { reason: string; at: number }
}
export type QualityProjectReport = {
  status:
    | "complete"
    | "unavailable"
    | "failed"
    | "timed_out"
    | "incomplete"
    | "disabled"
    | "no_files"
  mode: QualityMode
  root: string
  files: string[]
  findings: ReviewedFinding[]
  reason?: string
  metrics?: string
  cached?: boolean
  capturedAt?: number
  sourceHashes?: Record<string, string>
  configurationHash?: string
  elapsedMs?: number
  version?: string
}
export type QualityOptions = {
  paths: string[]
  all?: boolean
  mode?: QualityMode
  timeoutMs?: number
  limitFiles?: number
}
type Stored = { schema: 1; key: string; report: QualityProjectReport }
type Acknowledgment = { reason: string; sourceHash: string; actual: number | null; at: number }
type Controls = { schema: 1; enabled: boolean; acknowledgments: Record<string, Acknowledgment> }

const MAX_FILES = 2_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_RECORD_BYTES = 2 * 1024 * 1024
const OMIT = new Set([
  ".git",
  ".qlty",
  ".qualitylayer",
  "node_modules",
  "dist",
  "target",
  "build",
  "coverage",
  "generated",
  "__generated__",
  "fixtures",
  "__fixtures__",
  ".next",
  ".venv",
  "venv",
])
const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".cs",
  ".java",
  ".kt",
  ".kts",
  ".rb",
  ".php",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".ex",
  ".exs",
])
const LINT_EXTENSIONS = new Set([
  ...EXTENSIONS,
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".md",
  ".mdx",
  ".html",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".tf",
  ".tfvars",
  ".xml",
  ".vue",
  ".svelte",
  ".dart",
  ".scala",
  ".r",
])
const CONFIG =
  'config_version = "0"\ntest_patterns = ["**/tests/**", "**/test/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/test_*.py"]\n[smells]\nmode = "comment"\n'
type AnalysisConfig = {
  text: string
  excluded: string[]
  tests: string[]
  lintReady: boolean
  lintPolicyHash: string
}

async function analysisConfig(ctx: Ctx, root: string): Promise<AnalysisConfig> {
  const fallback = Bun.TOML.parse(CONFIG) as { test_patterns: string[] }
  const path = join(root, ".qlty", "qlty.toml")
  if (!(await ctx.fs.exists(path)))
    return {
      text: CONFIG,
      excluded: [],
      tests: fallback.test_patterns,
      lintReady: false,
      lintPolicyHash: digest("manual-lint:missing-config"),
    }
  const before = await ctx.fs.stat?.(path)
  if (!before || before.size > 256 * 1024)
    throw new Error("Qlty configuration must be a bounded file of at most 256 KiB")
  const raw = await ctx.fs.readFile(path)
  const after = await ctx.fs.stat?.(path)
  if (
    !after ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    Buffer.byteLength(raw) !== before.size
  )
    throw new Error("Qlty configuration changed during capture; run the check again")
  const parsed = Bun.TOML.parse(raw) as Record<string, unknown>
  const patterns = (value: unknown, defaults: string[]) => {
    if (value === undefined) return defaults
    if (
      !Array.isArray(value) ||
      value.length > 1000 ||
      value.some((part) => typeof part !== "string" || part.length > 512)
    )
      throw new Error("Qlty file patterns must be a bounded list of strings")
    return value as string[]
  }
  const excluded = patterns(parsed.exclude_patterns, [])
  const tests = patterns(parsed.test_patterns, fallback.test_patterns)
  const lines = [
    'config_version = "0"',
    `exclude_patterns = ${JSON.stringify(excluded)}`,
    `test_patterns = ${JSON.stringify(tests)}`,
  ]
  const table = (prefix: string, value: Record<string, unknown>, depth: number) => {
    if (depth > 3) throw new Error("Qlty smell configuration is nested too deeply")
    lines.push(`[${prefix}]`)
    for (const [name, item] of Object.entries(value)) {
      if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw new Error("Invalid Qlty smell setting name")
      if (
        typeof item === "string" ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))
      )
        lines.push(`${name} = ${JSON.stringify(item)}`)
    }
    for (const [name, item] of Object.entries(value))
      if (item && typeof item === "object" && !Array.isArray(item))
        table(`${prefix}.${name}`, item as Record<string, unknown>, depth + 1)
  }
  const smells =
    parsed.smells && typeof parsed.smells === "object" && !Array.isArray(parsed.smells)
      ? (parsed.smells as Record<string, unknown>)
      : {}
  table("smells", { ...smells, mode: "comment" }, 0)
  const lintReady =
    Array.isArray(parsed.plugin) &&
    parsed.plugin.some(
      (plugin) =>
        plugin &&
        typeof plugin === "object" &&
        typeof plugin.name === "string" &&
        plugin.enabled !== false,
    )
  return {
    text: `${lines.join("\n")}\n`,
    excluded,
    tests,
    lintReady,
    lintPolicyHash: digest(`manual-lint\0${raw}`),
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const slash = (value: string) => value.split(sep).join("/")
const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function qualityProject(
  ctx: Ctx,
  options: { existingHook?: string } = {},
): Promise<{ root: string; id: string; folder: string } | null> {
  const cwd = ctx.env.cwd()
  // A hook resolves the repository next (the task its session joined hangs on the common directory):
  // asking for it now runs the two git processes side by side instead of one after the other.
  const [top] = await Promise.all([
    ctx.git.topLevel(cwd),
    options.existingHook !== undefined ? ctx.git.commonDir(cwd) : null,
  ])
  if (!top) return null
  const root = await realpath(top)
  const id = digest(root).slice(0, 24)
  const home = join(realLocation(dirname(ctx.home)), basename(ctx.home))
  const base = join(home, "quality", "projects")
  const folder = join(base, id)
  if (options.existingHook !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(options.existingHook)) return null
    // An absent queue has no bytes to trust. Existing queues still pass the full ancestry check.
    if (!(await ctx.fs.exists(join(folder, "hooks", `${options.existingHook}.json`)))) return null
  }
  await ctx.fs.assertSafeDirectory?.(folder)
  if (!(await ctx.fs.exists(folder))) {
    const entries = (await ctx.fs.exists(base)) ? await ctx.fs.readdir(base) : []
    if (entries.filter((name) => /^[a-f0-9]{24}$/.test(name)).length >= QUALITY_PROJECTS_MAX)
      throw new Error(
        "Code-quality project storage has reached its limit; archive old project reports before adding another",
      )
  }
  return { root, id, folder }
}

async function readJson<T>(ctx: Ctx, path: string): Promise<T | null> {
  try {
    const stat = await ctx.fs.stat?.(path)
    if (stat && stat.size > MAX_RECORD_BYTES) return null
    const text = await ctx.fs.readFile(path)
    if (Buffer.byteLength(text) > MAX_RECORD_BYTES) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function controls(ctx: Ctx, folder: string): Promise<Controls> {
  const saved = await readJson<Controls>(ctx, join(folder, "controls.json"))
  if (saved === null && (await ctx.fs.exists(join(folder, "controls.json"))))
    throw new Error("Code-quality controls are invalid or exceed their size limit")
  return saved?.schema === 1 && typeof saved.enabled === "boolean" && saved.acknowledgments
    ? saved
    : { schema: 1, enabled: true, acknowledgments: {} }
}

async function saveJson(ctx: Ctx, path: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(text) > MAX_RECORD_BYTES)
    throw new Error("Code-quality record exceeds its 2 MiB limit")
  await ctx.fs.mkdir(dirname(path), { mode: 0o700 })
  await ctx.fs.assertSafeDirectory?.(dirname(path))
  await ctx.fs.atomicWrite(path, text)
}

export async function setQualityEnabled(ctx: Ctx, enabled: boolean): Promise<void> {
  const project = await qualityProject(ctx)
  if (!project) throw new Error("Run this command inside a Git repository")
  await ctx.fs.withLock(join(project.folder, ".controls.lock"), async () => {
    await saveJson(ctx, join(project.folder, "controls.json"), {
      ...(await controls(ctx, project.folder)),
      enabled,
    })
  })
}

export async function qualityStatus(ctx: Ctx) {
  const project = await qualityProject(ctx)
  const binary = qualityToolPath(ctx)
  return {
    engine: "qlty",
    binary,
    installed: binary !== null && (await ctx.fs.exists(binary)),
    project: project?.root ?? null,
    enabled: project ? (await controls(ctx, project.folder)).enabled : null,
    automatic: "Edited files at turn completion: structure checks and the secrets scan",
    scanners: await scannerStatus(ctx),
  }
}

/** The saved report does not hold the finding as its files stand now; a fresh check may. */
class StaleReport extends Error {
  constructor(
    readonly paths: string[] | null,
    readonly mode: QualityMode | null,
  ) {
    super("stale code-quality report")
  }
}

/**
 * Acknowledge a reviewed finding. When the saved report is older than its files (or never held the
 * ID), the check runs again here, over the finding's files or `changed()`, and the acknowledgment
 * binds to that check: an ID the fresh check no longer reports is refused.
 */
export async function acknowledgeQuality(
  ctx: Ctx,
  id: string,
  reason: string,
  dependencies: {
    binary?: string
    run?: typeof runQuality
    changed?: () => Promise<string[]>
  } = {},
): Promise<void> {
  if (!/^[a-f0-9]{24}$/.test(id) || reason.trim().length < 12 || reason.length > 1000)
    throw new Error("Name a finding ID and give a specific reason of 12–1000 characters")
  const project = await qualityProject(ctx)
  if (!project) throw new Error("Run this command inside a Git repository")
  try {
    return await acknowledgeSaved(ctx, project, id, reason)
  } catch (error) {
    if (!(error instanceof StaleReport)) throw error
    const paths = error.paths ?? (await dependencies.changed?.()) ?? []
    for (const mode of error.mode !== null ? [error.mode] : (["structure", "duplication"] as const))
      if (paths.length > 0) await checkProjectQuality(ctx, { paths, mode }, dependencies)
  }
  try {
    return await acknowledgeSaved(ctx, project, id, reason)
  } catch (error) {
    if (!(error instanceof StaleReport)) throw error
    throw new Error(
      `Finding ${id} is not in a fresh check of its files: run \`qualitylayer quality check <its file> --json\` (add --duplication for a duplication finding) and acknowledge an ID it lists`,
    )
  }
}

async function acknowledgeSaved(
  ctx: Ctx,
  project: NonNullable<Awaited<ReturnType<typeof qualityProject>>>,
  id: string,
  reason: string,
): Promise<void> {
  await ctx.fs.withLock(join(project.folder, ".controls.lock"), async () => {
    let found: ReviewedFinding | undefined
    let capturedHashes: Record<string, string> | undefined
    let configurationHash: string | undefined
    let findingMode: QualityMode | undefined
    for (const mode of ["structure", "duplication", "lint"] as const) {
      const saved = await readJson<Stored>(ctx, join(project.folder, `${mode}.json`))
      const candidate = saved?.report.findings.find((finding) => finding.id === id)
      // A retained pre-migration lint ID must not shadow a built-in review.
      if (candidate && (mode !== "lint" || found === undefined)) {
        found = candidate
        capturedHashes = saved?.report.sourceHashes
        configurationHash = saved?.report.configurationHash
        findingMode = mode
      }
    }
    if (!found) throw new StaleReport(null, null)
    if (findingMode === "lint")
      throw new Error(
        "Manual lint findings use the project linter's own review controls; QualityLayer acknowledgments cover built-in structure and duplication only",
      )
    const sources = [
      ...new Set([found.path, ...(found.related ?? []).map((location) => location.path)]),
    ]
    const stale = new StaleReport(sources, findingMode ?? null)
    for (const source of sources) {
      const path = resolve(project.root, source)
      if (!inside(project.root, path) || !inside(project.root, await realpath(path)))
        throw new Error("Finding source leaves this repository")
      const stat = await ctx.fs.stat?.(path)
      if (
        !stat ||
        stat.size > MAX_FILE_BYTES ||
        capturedHashes?.[source] !== digest(await ctx.fs.readFile(path))
      )
        throw stale
    }
    if (configurationHash !== digest((await analysisConfig(ctx, project.root)).text)) throw stale
    const saved = await controls(ctx, project.folder)
    saved.acknowledgments[id] = {
      reason: reason.trim(),
      sourceHash: found.sourceHash,
      actual: found.actual ?? null,
      at: ctx.clock.now(),
    }
    await saveJson(ctx, join(project.folder, "controls.json"), saved)
  })
}

/** Git selects project files. Capture still validates every admitted ancestor before reading it. */
async function projectInventory(ctx: Ctx, root: string): Promise<Map<string, Set<string>>> {
  const files = await ctx.git.run(
    root,
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { maxOutputBytes: 2 * 1024 * 1024 },
  )
  if (files.code !== 0)
    throw new Error("Could not read the Git source inventory; choose narrower paths")
  const inventory = new Map<string, Set<string>>()
  for (let path of files.stdout.split("\0")) {
    while (path && path !== ".") {
      const parent = slash(dirname(path))
      const children = inventory.get(parent) ?? new Set<string>()
      const child = basename(path)
      if (children.has(child)) break
      children.add(child)
      inventory.set(parent, children)
      path = parent
    }
  }
  return inventory
}

type CaptureScope = { paths: string[]; inventory?: Map<string, Set<string>> }

async function capture(
  ctx: Ctx,
  root: string,
  { paths, inventory }: CaptureScope,
  mode: QualityMode,
  limit: number,
  config: AnalysisConfig,
) {
  const result = new Map<string, { text: string; sha256: string }>()
  let bytes = 0
  let visited = 0
  const visit = async (requested: string) => {
    if (++visited > 20_000)
      throw new Error("Code-quality input walk exceeds 20000 entries; choose narrower paths")
    let full = resolve(root, requested)
    if (!inside(root, full)) {
      const canonical = await realpath(full).catch(() => full)
      if (!inside(root, canonical)) throw new Error(`Path leaves the repository: ${requested}`)
      full = canonical
    }
    const rel = slash(relative(root, full))
    if (rel.split("/").some((part) => OMIT.has(part))) return
    if (
      config.excluded.some(
        (pattern) => new Bun.Glob(pattern).match(rel) || new Bun.Glob(pattern).match(`${rel}/`),
      )
    )
      return
    if (
      mode !== "lint" &&
      config.tests.some(
        (pattern) => new Bun.Glob(pattern).match(rel) || new Bun.Glob(pattern).match(`${rel}/`),
      )
    )
      return
    const entry = await ctx.fs.lstat?.(full)
    if (!entry) return
    if (entry.kind === "symlink") throw new Error(`Code-quality input is a symbolic link: ${rel}`)
    if (entry.kind === "directory") {
      // Git keeps the indexed spelling even after a case-only rename on case-insensitive volumes.
      const children = inventory ? (inventory.get(rel || ".") ?? []) : await ctx.fs.readdir(full)
      for (const name of children) await visit(join(full, name))
      return
    }
    const extension = extname(rel).toLowerCase()
    const supported =
      mode === "lint"
        ? LINT_EXTENSIONS.has(extension) ||
          /(?:^|\/)(?:Dockerfile|Containerfile|Makefile)$/.test(rel)
        : EXTENSIONS.has(extension)
    if (entry.kind !== "file" || !supported) return
    if (mode !== "lint" && config.tests.some((pattern) => new Bun.Glob(pattern).match(rel))) return
    if (result.has(rel)) return
    if (result.size >= limit)
      throw new Error(`Code-quality scope exceeds ${limit} files; choose narrower paths`)
    const before = await ctx.fs.stat?.(full)
    if (!before || before.size > MAX_FILE_BYTES)
      throw new Error(`Code-quality input exceeds 2 MiB: ${rel}`)
    if (!inside(root, await realpath(full)))
      throw new Error(`Code-quality input leaves the repository: ${rel}`)
    const text = await ctx.fs.readFile(full)
    const after = await ctx.fs.stat?.(full)
    if (
      !after ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      Buffer.byteLength(text) !== before.size
    )
      throw new Error(`Source changed during capture: ${rel}; run the check again at a stable join`)
    bytes += Buffer.byteLength(text)
    if (bytes > MAX_SOURCE_BYTES) throw new Error("Code-quality source capture exceeds 64 MiB")
    result.set(rel, { text, sha256: digest(text) })
  }
  for (const path of paths) await visit(path)
  return result
}

function toolEnvironment(ctx: Ctx): Record<string, string> {
  const home = ctx.env.get("HOME") ?? ctx.env.get("USERPROFILE") ?? dirname(ctx.home)
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: ctx.env.get("USERPROFILE") ?? home,
    QUALITYLAYER_HOME: ctx.home,
    XDG_CONFIG_HOME: ctx.env.get("XDG_CONFIG_HOME") ?? join(home, ".config"),
    XDG_CACHE_HOME: ctx.env.get("XDG_CACHE_HOME") ?? join(home, ".cache"),
    APPDATA: ctx.env.get("APPDATA") ?? join(home, "AppData", "Roaming"),
    LOCALAPPDATA: ctx.env.get("LOCALAPPDATA") ?? join(home, "AppData", "Local"),
  }
  for (const name of ["PATH", "SystemRoot", "TMPDIR", "TMP", "TEMP"]) {
    const value = ctx.env.get(name)
    if (value !== undefined) env[name] = value
  }
  return env
}

async function prepareGit(ctx: Ctx, snapshot: string): Promise<void> {
  const git = Bun.which("git", { PATH: ctx.env.get("PATH") ?? "", cwd: dirname(ctx.home) })
  if (!git) throw new Error("Git is unavailable for the private code-quality capture")
  const emptyConfig = process.platform === "win32" ? "NUL" : "/dev/null"
  const env = {
    ...toolEnvironment(ctx),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_TERMINAL_PROMPT: "0",
  }
  const call = async (args: string[]) => {
    const result = await runQualityProcess([git, ...args], {
      cwd: snapshot,
      timeoutMs: 1500,
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 16 * 1024,
      env,
    })
    if (result.exitCode !== 0 || result.timedOut || result.outputExceeded || result.error)
      throw new Error("Could not prepare the bounded private code-quality Git index")
  }
  await call(["-c", "init.templateDir=", "init", "--quiet"])
  await call([
    `--git-dir=${join(snapshot, ".git")}`,
    `--work-tree=${snapshot}`,
    "--literal-pathspecs",
    "add",
    "--",
    ".",
  ])
}

function region(source: string, finding: Finding): string {
  const lines = source.split("\n")
  return lines.slice(Math.max(0, finding.line - 1), finding.endLine ?? finding.line).join("\n")
}

export async function checkProjectQuality(
  ctx: Ctx,
  options: QualityOptions,
  dependencies: { binary?: string; run?: typeof runQuality } = {},
): Promise<QualityProjectReport> {
  const project = await qualityProject(ctx)
  const mode = options.mode ?? "structure"
  const empty: Omit<QualityProjectReport, "status"> = {
    mode,
    root: project?.root ?? ctx.env.cwd(),
    files: [],
    findings: [],
  }
  if (!project)
    return {
      ...empty,
      status: "unavailable",
      reason: "Run code-quality checks inside a Git repository",
    }
  const savedControls = await controls(ctx, project.folder)
  if (!savedControls.enabled) return { ...empty, status: "disabled" }
  if (
    options.limitFiles !== undefined &&
    (!Number.isSafeInteger(options.limitFiles) || options.limitFiles < 1)
  )
    return {
      ...empty,
      status: "incomplete",
      reason: "Code-quality file limit must be a positive integer",
    }
  const binary = dependencies.binary ?? qualityToolPath(ctx)
  if (!binary || !(await ctx.fs.exists(binary)))
    return {
      ...empty,
      status: "unavailable",
      reason: "Qlty is not installed; run qualitylayer quality setup",
    }
  if (options.paths.length === 0) return { ...empty, status: "no_files" }
  try {
    return await ctx.fs.withLock<QualityProjectReport>(
      join(project.folder, ".scan.lock"),
      async () => {
        for (const name of await ctx.fs.readdir(project.folder)) {
          if (!/^inputs-[a-f0-9-]{36}$/.test(name)) continue
          const old = join(project.folder, name)
          if ((await ctx.fs.lstat?.(old))?.kind !== "directory") continue
          const owner = await readJson<{ schema: number; project: string }>(
            ctx,
            join(old, ".qlty", "qualitylayer-input.json"),
          )
          if (owner?.schema === 1 && owner.project === project.id) await ctx.fs.remove(old)
        }
        const config = await analysisConfig(ctx, project.root)
        const configurationHash = mode === "lint" ? config.lintPolicyHash : digest(config.text)
        if (mode === "lint" && !config.lintReady)
          return {
            ...empty,
            status: "unavailable",
            reason:
              "No Qlty linters are enabled in this project's .qlty/qlty.toml; keep using its existing lint command or enable its chosen Qlty plugins",
          }
        const scope: CaptureScope = {
          paths: options.paths,
          ...(options.all ? { inventory: await projectInventory(ctx, project.root) } : {}),
        }
        const sources = await capture(
          ctx,
          project.root,
          scope,
          mode,
          Math.min(options.limitFiles ?? MAX_FILES, MAX_FILES),
          config,
        )
        const files = [...sources.keys()].sort()
        if (!files.length) return { ...empty, status: "no_files" }
        const sourceHashes = Object.fromEntries(
          [...sources].map(([path, source]) => [path, source.sha256]),
        )
        const binaryState = await ctx.fs.stat?.(binary)
        const key = digest(
          JSON.stringify({ binary, binaryState, mode, sourceHashes, config: configurationHash }),
        )
        const reportPath = join(project.folder, `${mode}.json`)
        const previous = await readJson<Stored>(ctx, reportPath)
        const applyReviews = (findings: ReviewedFinding[]) =>
          findings.map((finding) => {
            const ack = mode === "lint" ? undefined : savedControls.acknowledgments[finding.id]
            return ack?.sourceHash === finding.sourceHash &&
              (finding.actual === undefined ||
                (ack.actual !== null && finding.actual <= ack.actual))
              ? {
                  ...finding,
                  state: "acknowledged" as const,
                  acknowledgment: { reason: ack.reason, at: ack.at },
                }
              : {
                  ...finding,
                  state: finding.state === "acknowledged" ? ("known" as const) : finding.state,
                  acknowledgment: undefined,
                }
          })
        if (
          mode !== "lint" &&
          previous?.schema === 1 &&
          previous.key === key &&
          previous.report.status === "complete"
        )
          return {
            ...previous.report,
            findings: applyReviews(previous.report.findings),
            cached: true,
          }
        const snapshot = join(project.folder, `inputs-${randomUUID()}`)
        await ctx.fs.mkdir(snapshot, { mode: 0o700 })
        try {
          await ctx.fs.mkdir(join(snapshot, ".qlty"), { mode: 0o700 })
          await ctx.fs.writeFile(
            join(snapshot, ".qlty", "qualitylayer-input.json"),
            JSON.stringify({ schema: 1, project: project.id }),
            { mode: 0o600 },
          )
          for (const [path, source] of sources) {
            await ctx.fs.mkdir(dirname(join(snapshot, path)), { mode: 0o700 })
            await ctx.fs.writeFile(join(snapshot, path), source.text, { mode: 0o400 })
          }
          await ctx.fs.mkdir(join(snapshot, ".qlty"), { mode: 0o700 })
          await ctx.fs.writeFile(join(snapshot, ".qlty", "qlty.toml"), config.text, { mode: 0o600 })
          await prepareGit(ctx, snapshot)
          const result = await (dependencies.run ?? runQuality)({
            binary,
            root: mode === "lint" ? project.root : snapshot,
            files: files.length > 200 ? ["."] : files,
            mode,
            timeoutMs: options.timeoutMs ?? 15_000,
            env: toolEnvironment(ctx),
          })
          if (result.status !== "complete")
            return {
              ...empty,
              status: result.status,
              files,
              reason: result.reason,
              elapsedMs: result.elapsedMs,
            }
          if (mode === "lint") {
            for (const [path, source] of sources)
              if (digest(await ctx.fs.readFile(join(project.root, path))) !== source.sha256)
                throw new Error(
                  `Source changed during lint analysis: ${path}; result is incomplete`,
                )
            if ((await analysisConfig(ctx, project.root)).lintPolicyHash !== configurationHash)
              throw new Error("Qlty policy changed during lint analysis; result is incomplete")
          }
          const findings = result.findings.map((finding) => {
            const text = sources.get(finding.path)?.text
            if (text === undefined)
              throw new Error(`Qlty reported an uncaptured source: ${finding.path}`)
            const related = (finding.related ?? []).map((location) => ({
              path: location.path,
              sha256: sources.get(location.path)?.sha256 ?? "outside-captured-scope",
            }))
            if (related.some((location) => location.sha256 === "outside-captured-scope"))
              throw new Error(
                "Qlty duplication refers to an uncaptured source; expand the checked scope",
              )
            const sourceHash = digest(
              JSON.stringify({
                region: region(text, finding),
                related,
                config: configurationHash,
                analyzer: result.version ?? binary,
                threshold: finding.threshold,
              }),
            )
            const id = digest(`${finding.rule}\0${finding.path}\0${sourceHash}`).slice(0, 24)
            const prior = previous?.report.findings.find((row) => row.id === id)
            const state = prior
              ? finding.actual !== undefined &&
                prior.actual !== undefined &&
                finding.actual > prior.actual
                ? "worsened"
                : "known"
              : "new"
            return { ...finding, id, state, sourceHash } as ReviewedFinding
          })
          const duplicates = new Map<string, number>()
          for (const finding of findings)
            duplicates.set(finding.id, (duplicates.get(finding.id) ?? 0) + 1)
          for (const finding of findings)
            if ((duplicates.get(finding.id) ?? 0) > 1)
              finding.id = digest(
                `${finding.id}\0${finding.line}\0${finding.startColumn ?? 0}`,
              ).slice(0, 24)
          for (const finding of findings) {
            const prior = previous?.report.findings.find((row) => row.id === finding.id)
            finding.state = !prior
              ? "new"
              : finding.actual !== undefined &&
                  prior.actual !== undefined &&
                  finding.actual > prior.actual
                ? "worsened"
                : "known"
          }
          const report: QualityProjectReport = {
            ...empty,
            status: "complete",
            files,
            sourceHashes,
            configurationHash,
            capturedAt: ctx.clock.now(),
            elapsedMs: result.elapsedMs,
            version: result.version,
            findings: applyReviews(findings),
            ...(result.metrics === undefined ? {} : { metrics: result.metrics }),
          }
          await saveJson(ctx, reportPath, { schema: 1, key, report } satisfies Stored)
          return report
        } finally {
          await ctx.fs.remove(snapshot)
        }
      },
      { waitMs: 0, label: "Code-quality analysis" },
    )
  } catch (error) {
    return {
      ...empty,
      status: "incomplete",
      reason:
        error instanceof WorkflowStateBusy
          ? SCAN_BUSY
          : error instanceof Error
            ? error.message
            : String(error),
    }
  }
}

function boundedSummary(text: string): string {
  let result = ""
  let bytes = 0
  for (const character of text) {
    const code = character.charCodeAt(0)
    const clean =
      (code >= 32 && !(code >= 127 && code <= 159)) || code === 9 || code === 10 ? character : " "
    const next = Buffer.byteLength(clean)
    if (bytes + next > 1200) break
    result += clean
    bytes += next
  }
  return result
}

/** The reason of a scan that found another scan holding the lock; the hook queue tries the file again on its next edit. */
const SCAN_BUSY = "another code-health scan is running; it runs again after your next edit"

export function qualitySummary(report: QualityProjectReport, max = 3): string {
  if (report.status === "disabled" || report.status === "no_files") return ""
  if (report.status === "incomplete" && report.reason === SCAN_BUSY)
    return `Code health skipped: ${SCAN_BUSY}.`
  if (report.status !== "complete")
    return boundedSummary(`Code health was not checked: ${report.reason ?? report.status}.`)
  const actionable = report.findings.filter((finding) => finding.state !== "acknowledged")
  if (!actionable.length) return ""
  const lines = actionable
    .slice(0, max)
    .map((finding) => `${finding.path}:${finding.line} ${finding.message} (${finding.id})`)
  return boundedSummary(
    [
      `Code health: ${actionable.length} findings need review in ${report.files.length} edited files.`,
      ...lines,
      "Inspect with qualitylayer quality check; keep valid debt visible and give a specific reason when acknowledging it.",
    ].join("\n"),
  )
}
