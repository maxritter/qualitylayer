// Security scans of what a task changed: each scanner reads only the changed files it knows (secrets in
// any file, dependencies in lockfiles, GitHub workflows, request handling in JavaScript, TypeScript and
// Python), within a time budget, on this computer. A scan is a record for the reviewers, never a stop:
// it says what it read, what it found, and what it could not read. A scanner that is missing, timed out
// or could not parse a file is "not checked" for that part, never clean.

import { lstatSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import { diagnostic, runQualityProcess } from "../engine.ts"
import { toolHome } from "../setup.ts"
import type { QualityFinding, QualityRunner } from "../types.ts"
import { SCANNERS, type ScannerId } from "./registry.ts"
import { DRIVERS, MAX_FILE_BYTES, rulesFile } from "./scan-drivers.ts"
import { scannerEnvironment, scannerPath } from "./setup.ts"

export { scanBrief, scanLine } from "./scan-drivers.ts"

export type ScanKind = "secrets" | "dependencies" | "workflows" | "code"
export const SCAN_KINDS: readonly ScanKind[] = ["secrets", "dependencies", "workflows", "code"]
export const SCANNER_OF: Readonly<Record<ScanKind, ScannerId>> = {
  secrets: "betterleaks",
  dependencies: "osv-scanner",
  workflows: "zizmor",
  code: "opengrep",
}

export type ScanFinding = Pick<
  QualityFinding,
  "id" | "rule" | "message" | "path" | "line" | "endLine"
>

export type Missed = { path?: string; reason: string }

/** One scanner's record: what it read, what it found, and what it could not read. */
export type ScanResult = {
  kind: ScanKind
  scanner: ScannerId
  name: string
  version: string
  /** `not_needed`: no changed file of its kind; `off`: Settings turned scans off. */
  state: "clean" | "findings" | "not_needed" | "not_checked" | "off"
  scanned: number
  findings: ScanFinding[]
  /** Files (or the whole scan, without a path) it could not read, with why. */
  notChecked: { path?: string; reason: string }[]
  elapsedMs: number
}

export type ScanOptions = {
  only?: readonly ScanKind[]
  /** Where dependency advisories come from: osv.dev, or a local copy of its database. */
  advisories?: "online" | "local"
  /** Every scan says off without running: Settings › Security scans. */
  off?: boolean
  run?: QualityRunner
  /** Test seam: the executable per scanner; null is not installed. */
  binaries?: Partial<Record<ScannerId, string | null>>
}

const MAX_FILES = 2000
const CHUNK = 200
const MAX_FINDINGS = 200
const BUDGET_MS: Readonly<Record<ScanKind, number>> = {
  secrets: 30_000,
  dependencies: 60_000,
  workflows: 30_000,
  code: 120_000,
}

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "deno.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "pdm.lock",
  "Cargo.lock",
  "go.mod",
  "Gemfile.lock",
  "composer.lock",
  "gradle.lockfile",
  "packages.lock.json",
  "pubspec.lock",
  "mix.lock",
  "pom.xml",
])
const CODE = /\.(?:[cm]?[jt]sx?|py)$/i

/**
 * Which of the changed paths each scan reads. Paths are repository-relative with `/`; a backslash is
 * part of a Unix file's name and is never rewritten (only Windows paths arrive with `\`, from `readable`).
 */
export function scanTargets(paths: readonly string[]): Record<ScanKind, string[]> {
  const norm = [...paths]
  return {
    secrets: norm,
    dependencies: norm.filter(
      (path) => LOCKFILES.has(basename(path)) || /(^|\/)requirements[^/]*\.txt$/.test(path),
    ),
    workflows: norm.filter(
      (path) =>
        /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) ||
        /(^|\/)action\.ya?ml$/.test(path) ||
        path === ".github/dependabot.yml",
    ),
    code: norm.filter((path) => CODE.test(path)),
  }
}

/** Whether `path` lies inside `root` (both real paths), or is the root itself when `self` is allowed. */
export function within(root: string, path: string, self = false): boolean {
  const inside = relative(root, path)
  if (inside === "") return self
  return !isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`)
}

function resolveRealParentFile(full: string): string | null {
  try {
    return join(realpathSync(dirname(full)), basename(full))
  } catch {
    return null
  }
}

function classifyReadablePath(
  root: string,
  realRoot: string,
  path: string,
): { file?: string; skipped?: Missed } {
  const full = resolve(root, path)
  const entry = lstatSync(full, { throwIfNoEntry: false })
  if (entry === undefined) return {}
  // The parent folder's real path (every link above the file followed); the file itself must not be a
  // link. Resolving the parent also keeps a backslash in a Unix name, which Bun's realpath misreads.
  const real = resolveRealParentFile(full)
  const outside = !within(root, full) || real === null || !within(realRoot, real)
  if (outside || entry.isSymbolicLink())
    return { skipped: { path, reason: "outside the repository, or reached through a link" } }
  if (!entry.isFile()) return {}
  if (entry.size > MAX_FILE_BYTES) return { skipped: { path, reason: "larger than 2 MB" } }
  const lexical = relative(root, full)
  return { file: sep === "/" ? lexical : lexical.split(sep).join("/") }
}

/**
 * The changed files a scan may read: regular files whose real path (every parent folder's link
 * followed) lies inside the repository's real root, at most 2 MB. A deleted path is no input. A path
 * that leaves the root, is a link, or is too large is kept as not checked, never dropped as clean.
 */
export function readable(
  root: string,
  paths: readonly string[],
): { files: string[]; skipped: Missed[] } {
  const realRoot = realpathSync(root)
  const files: string[] = []
  const skipped: Missed[] = []
  for (const path of paths) {
    const check = classifyReadablePath(root, realRoot, path)
    if (check.file !== undefined) files.push(check.file)
    if (check.skipped !== undefined) skipped.push(check.skipped)
  }
  const unique = [...new Set(files)]
  for (const path of unique.slice(MAX_FILES))
    skipped.push({ path, reason: "beyond the 2000-file scan limit" })
  return { files: unique.slice(0, MAX_FILES), skipped }
}

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

type ScanOneRequest = {
  ctx: Ctx
  root: string
  kind: ScanKind
  files: string[]
  options: ScanOptions
  skipped: Missed[]
}

async function scanOne({
  ctx,
  root,
  kind,
  files,
  options,
  skipped,
}: ScanOneRequest): Promise<ScanResult> {
  const id = SCANNER_OF[kind]
  const spec = SCANNERS[id]
  const started = performance.now()
  const result = (state: ScanResult["state"], extra: Partial<ScanResult> = {}): ScanResult => ({
    kind,
    scanner: id,
    name: spec.name,
    version: spec.version,
    state,
    scanned: files.length,
    findings: [],
    notChecked: [],
    elapsedMs: Math.round(performance.now() - started),
    ...extra,
  })
  if (options.off) return result("off", { scanned: 0 })
  if (files.length === 0)
    return skipped.length > 0
      ? result("not_checked", { scanned: 0, notChecked: skipped })
      : result("not_needed", { scanned: 0 })
  const binary = options.binaries?.[id] !== undefined ? options.binaries[id] : scannerPath(ctx, id)
  if (!binary || !lstatSync(binary, { throwIfNoEntry: false })?.isFile())
    return result("not_checked", {
      scanned: 0,
      notChecked: [
        { reason: `${spec.name} is not installed here; run qualitylayer quality setup` },
      ],
    })
  const local = options.advisories === "local"
  const env = await scannerEnvironment(ctx, id, root)
  // A scanner's own temporary files (OpenGrep's semgrep-*.rules, …) go to a folder of this run under
  // QualityLayer's home, removed when it ends: never the person's repository or a shared temp folder.
  const scratchRoot = join(toolHome(ctx), "tools", id, "state", "tmp")
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 })
  const scratch = await mkdtemp(join(scratchRoot, "run-"))
  env.TMPDIR = env.TMP = env.TEMP = scratch
  if (kind === "dependencies" && local)
    env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY = join(toolHome(ctx), "tools", id, "state", "db")
  const rulesPath = kind === "code" ? await rulesFile(ctx) : ""
  const argv = (batch: string[]) => DRIVERS[kind].argv(binary, batch, { rulesPath, local })
  const read = await runBatches(kind, files, argv, {
    root,
    env,
    run: options.run ?? runQualityProcess,
  }).finally(() => rm(scratch, { recursive: true, force: true }))
  const unique = [...new Map(read.findings.map((f) => [f.id, f])).values()].slice(0, MAX_FINDINGS)
  const notChecked = [...skipped, ...read.notChecked]
  return result(finalState(notChecked.length, files.length + skipped.length, unique.length), {
    findings: unique,
    notChecked,
  })
}

/** Not checked when nothing was read, else findings over a partial read, else not checked over clean. */
function finalState(missed: number, files: number, found: number): ScanResult["state"] {
  if (missed > 0 && missed >= files) return "not_checked"
  if (found > 0) return "findings"
  return missed > 0 ? "not_checked" : "clean"
}

/** Why a finished run read nothing, or null when it ran. */
function failedRun(output: Awaited<ReturnType<QualityRunner>>, kind: ScanKind): string | null {
  if (output.timedOut) return "the scan's time budget ran out"
  if (output.unavailable || output.error)
    return diagnostic(output.error ?? "the scanner did not start")
  if (output.outputExceeded) return "the scanner's output exceeded its budget"
  if (DRIVERS[kind].ran(output.exitCode)) return null
  const name = SCANNERS[SCANNER_OF[kind]].name
  return `${name} exited with ${output.exitCode}: ${diagnostic(output.stderr).slice(0, 200)}`
}

/** The scan in batches within its time budget; a batch that could not run is not checked, file by file. */
async function runBatches(
  kind: ScanKind,
  files: string[],
  argv: (batch: string[]) => string[],
  how: { root: string; env: Record<string, string>; run: QualityRunner },
): Promise<{ findings: ScanFinding[]; notChecked: Missed[] }> {
  const findings: ScanFinding[] = []
  const notChecked: Missed[] = []
  const missed = (batch: string[], reason: string) =>
    notChecked.push(...batch.map((path) => ({ path, reason })))
  const deadline = Date.now() + BUDGET_MS[kind]
  for (const batch of chunks(files)) {
    const left = deadline - Date.now()
    if (left <= 0) {
      missed(batch, "the scan's time budget ran out")
      continue
    }
    const output = await how.run(argv(batch), {
      cwd: how.root,
      timeoutMs: left,
      maxStdoutBytes: 16 * 1024 * 1024,
      maxStderrBytes: 256 * 1024,
      env: how.env,
    })
    const why = failedRun(output, kind)
    if (why !== null) {
      missed(batch, why)
      continue
    }
    try {
      const read = DRIVERS[kind].read(output.stdout, output.stderr, how.root)
      findings.push(...read.findings)
      notChecked.push(...read.notChecked)
    } catch (error) {
      const text = diagnostic(error instanceof Error ? error.message : String(error)).slice(0, 160)
      missed(batch, `unreadable ${SCANNERS[SCANNER_OF[kind]].name} report: ${text}`)
    }
  }
  return { findings, notChecked }
}

/** Runs every scan that has files to read, side by side, and returns one record per scan kind. */
export async function scanChanges(
  ctx: Ctx,
  root: string,
  paths: readonly string[],
  options: ScanOptions = {},
): Promise<ScanResult[]> {
  const { files, skipped } = readable(root, paths)
  const targets = scanTargets(files)
  // A skipped input is not checked by every scan that would have read it.
  const unread = scanTargets(skipped.map((s) => s.path ?? ""))
  const why = new Map(skipped.map((s) => [s.path, s.reason]))
  const kinds = SCAN_KINDS.filter(
    (kind) => options.only === undefined || options.only.includes(kind),
  )
  return Promise.all(
    kinds.map((kind) =>
      scanOne({
        ctx,
        root,
        kind,
        files: targets[kind],
        options,
        skipped: unread[kind].map((path) => ({ path, reason: why.get(path) ?? "" })),
      }),
    ),
  )
}
