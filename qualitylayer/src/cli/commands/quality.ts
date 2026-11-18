import { relative, resolve } from "node:path"
import {
  acknowledgeQuality,
  checkProjectQuality,
  type QualityMode,
  qualityStatus,
  setQualityEnabled,
} from "../../core/code-quality/project.ts"
import { SCANNERS } from "../../core/code-quality/scanners/registry.ts"
import {
  type ScanKind,
  type ScanResult,
  scanChanges,
  scanLine,
} from "../../core/code-quality/scanners/scan.ts"
import { scanSettings } from "../../core/code-quality/scanners/settings.ts"
import { ensureScanners } from "../../core/code-quality/scanners/setup.ts"
import { ensureQualityTool } from "../../core/code-quality/setup.ts"
import { lastSetup, logSetup, setupToolLine } from "../../core/code-quality/setup-log.ts"
import { recordQualityToolSetup, recordScannerSetups } from "../../core/install/install.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"

export const qualityScanUsage =
  "qualitylayer quality scan [paths... | --since <rev>] [--secrets] [--dependencies] [--workflows] [--code] [--local]"

const USAGE = `usage: qualitylayer quality setup | status | on | off
qualitylayer quality check [paths...] [--all] [--duplication] [--fail-on-new]
${qualityScanUsage}
qualitylayer quality metrics | lint [paths...] [--all]
qualitylayer quality acknowledge <finding-id> --reason "<specific review reason>"
Checks use the working files. Existing project lint/test commands remain required.`

async function changedFiles(ctx: Ctx): Promise<string[]> {
  const root = await ctx.git.topLevel(ctx.env.cwd())
  if (!root) throw new Error("Run this command inside a Git repository")
  const tracked = await ctx.git.run(root, ["diff", "--name-only", "-z", "HEAD", "--"])
  const untracked = await ctx.git.run(root, ["ls-files", "--others", "--exclude-standard", "-z"])
  if (tracked.code !== 0 || untracked.code !== 0)
    throw new Error("Could not read changed file names; supply explicit paths")
  const files = [...new Set((tracked.stdout + untracked.stdout).split("\0").filter(Boolean))]
  if (files.length > 2000) throw new Error("More than 2000 paths changed; supply a focused scope")
  return files
}

/** The files changed since `rev` in commits, plus the working changes. */
async function changedSince(ctx: Ctx, rev: string): Promise<string[]> {
  const root = await ctx.git.topLevel(ctx.env.cwd())
  if (!root) throw new Error("Run this command inside a Git repository")
  if (!/^[\w./~^@{}-]{1,200}$/.test(rev) || rev.startsWith("-")) throw new Error("Invalid revision")
  const committed = await ctx.git.run(root, ["diff", "--name-only", "-z", `${rev}...HEAD`, "--"])
  if (committed.code !== 0) throw new Error(`Could not read the changes since ${rev}`)
  return [
    ...new Set([...committed.stdout.split("\0").filter(Boolean), ...(await changedFiles(ctx))]),
  ]
}

const SCAN_FLAGS: Readonly<Record<string, ScanKind>> = {
  "--secrets": "secrets",
  "--dependencies": "dependencies",
  "--workflows": "workflows",
  "--code": "code",
}

function scanText(result: ScanResult): string[] {
  const summary =
    result.state === "not_checked"
      ? `${result.name} ${result.version} · ${result.kind} · not checked`
      : scanLine({ ...result, notChecked: [] })
  return [
    summary,
    ...result.findings.map(
      ({ path, line, rule, message }) => `  ${path}:${line} [${rule}] ${message}`,
    ),
    ...result.notChecked.map(
      ({ path, reason }) => `  Not checked · ${path ? `${path} · ` : ""}${reason}`,
    ),
  ].map((line) =>
    line.replace(
      /[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ),
  )
}

/** `quality scan`: the security scans of changed (or named) files, as records; never a failing exit for findings. */
async function scanCommand(
  ctx: Ctx,
  rest: string[],
  dependencies: QualityCommandDependencies,
): Promise<Result<unknown>> {
  const only: ScanKind[] = []
  const paths: string[] = []
  let since: string | undefined
  let advisories: "online" | "local" | undefined
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string
    if (arg in SCAN_FLAGS) only.push(SCAN_FLAGS[arg] as ScanKind)
    else if (arg === "--since" && rest[i + 1] !== undefined) since = rest[++i]
    else if (arg === "--local") advisories = "local"
    else if (arg.startsWith("-")) return err({ code: "bad_args", message: USAGE })
    else paths.push(arg)
  }
  if (since !== undefined && paths.length) return err({ code: "bad_args", message: USAGE })
  const root = await ctx.git.topLevel(ctx.env.cwd())
  if (!root) return err({ code: "bad_args", message: "Run this command inside a Git repository" })
  const cwd = ctx.env.cwd()
  const files = paths.length
    ? paths.map((path) => relative(root, resolve(cwd, path)))
    : since !== undefined
      ? await changedSince(ctx, since)
      : await changedFiles(ctx)
  const settings = await scanSettings(ctx)
  const results = await (dependencies.scanChanges ?? scanChanges)(ctx, root, files, {
    ...(only.length ? { only } : {}),
    advisories: advisories ?? settings.advisories,
    off: !settings.enabled,
  })
  return {
    ok: true,
    data: { root, results, lines: results.map(scanLine) },
    terminalText: results.flatMap(scanText).join("\n"),
  }
}

export type QualityCommandDependencies = {
  scanChanges?: typeof scanChanges
  setup?: typeof ensureQualityTool
  recordSetup?: typeof recordQualityToolSetup
  scanners?: typeof ensureScanners
  recordScanners?: typeof recordScannerSetups
  scan?: typeof checkProjectQuality
}

/**
 * `quality setup`: Qlty and each security scanner are installed independently, so one that fails
 * (a download, an antivirus holding a file) never keeps the others away. The command succeeds only
 * when Qlty and every scanner with a build here are ready and recorded; otherwise its message names
 * each tool's result. A scanner with no build here leaves only its scan not checked.
 */
async function setupCommand(
  ctx: Ctx,
  dependencies: QualityCommandDependencies,
): Promise<Result<unknown>> {
  const setup = await (dependencies.setup ?? ensureQualityTool)(ctx)
  const recorded =
    setup.status === "ready"
      ? await (dependencies.recordSetup ?? recordQualityToolSetup)(ctx, setup)
      : null
  const scanners = await (dependencies.scanners ?? ensureScanners)(ctx)
  const kept = await (dependencies.recordScanners ?? recordScannerSetups)(ctx, scanners)
  const line = setupToolLine
  const qlty =
    recorded !== null && !recorded.ok
      ? `Qlty ${setup.version} not recorded: ${recorded.error.message}`
      : line("Qlty", setup)
  const notKept = kept.ok ? [] : [`scanners not recorded: ${kept.error.message}`]
  const tools = [
    qlty,
    ...scanners.map((scanner) => line(SCANNERS[scanner.id].name, scanner)),
    ...notKept,
  ]
  const complete =
    setup.status === "ready" &&
    recorded?.ok === true &&
    kept.ok &&
    scanners.every((scanner) => scanner.status !== "failed")
  await logSetup(ctx, {
    at: new Date(ctx.clock.now()).toISOString(),
    complete,
    tools,
    // What kept the setup from being complete; a scanner with no build here is no failure.
    failed: [
      ...(setup.status === "ready" && recorded?.ok === true ? [] : [qlty]),
      ...scanners
        .filter((scanner) => scanner.status === "failed")
        .map((scanner) => line(SCANNERS[scanner.id].name, scanner)),
      ...notKept,
    ],
  })
  if (!complete)
    return err({ code: "open_failed", message: `Quality setup incomplete: ${tools.join("; ")}` })
  return ok({ ...setup, scanners })
}

export async function qualityCmd(
  ctx: Ctx,
  args: string[],
  dependencies: QualityCommandDependencies = {},
): Promise<Result<unknown>> {
  const [verb = "status", ...rest] = args
  try {
    if (verb === "status" && rest.length === 0)
      return ok({ ...(await qualityStatus(ctx)), setup: await lastSetup(ctx) })
    if (verb === "setup" && rest.length === 0) return await setupCommand(ctx, dependencies)
    if ((verb === "on" || verb === "off") && rest.length === 0) {
      await setQualityEnabled(ctx, verb === "on")
      return ok({ enabled: verb === "on", project: ctx.env.cwd() })
    }
    if (verb === "acknowledge") {
      const [id, flag, reason] = rest
      if (rest.length !== 3 || flag !== "--reason" || id === undefined || reason === undefined)
        return err({ code: "bad_args", message: USAGE })
      await acknowledgeQuality(ctx, id, reason, { changed: () => changedFiles(ctx) })
      return ok({ id, acknowledged: true, reason })
    }
    if (verb === "scan") return await scanCommand(ctx, rest, dependencies)
    if (!["check", "metrics", "lint"].includes(verb))
      return err({ code: "bad_args", message: USAGE })
    const all = rest.includes("--all")
    const duplication = rest.includes("--duplication")
    const failOnNew = rest.includes("--fail-on-new")
    if (verb !== "check" && (duplication || failOnNew))
      return err({ code: "bad_args", message: USAGE })
    const paths = rest.filter((arg) => !["--all", "--duplication", "--fail-on-new"].includes(arg))
    if (paths.some((path) => path.startsWith("-")) || (all && paths.length > 0))
      return err({ code: "bad_args", message: USAGE })
    const mode: QualityMode =
      verb === "metrics"
        ? "metrics"
        : verb === "lint"
          ? "lint"
          : duplication
            ? "duplication"
            : "structure"
    const report = await (dependencies.scan ?? checkProjectQuality)(ctx, {
      paths: all ? ["."] : paths.length ? paths : await changedFiles(ctx),
      mode,
      timeoutMs: all ? 120_000 : 15_000,
    })
    if (failOnNew && report.status === "disabled")
      return err({
        code: "open_failed",
        message:
          "Code-health checks are disabled for this project; run qualitylayer quality on before using --fail-on-new",
      })
    if (!["complete", "disabled", "no_files"].includes(report.status))
      return err({
        code: "open_failed",
        message: `Code health was not checked: ${report.reason ?? report.status}`,
      })
    const unreviewed = report.findings.filter((finding) => finding.state !== "acknowledged")
    if (failOnNew && unreviewed.length)
      return err({
        code: "validation_failed",
        message: `${unreviewed.length} code-health findings require review`,
        errors: unreviewed.map((finding) => ({
          line: finding.line,
          rule: finding.rule,
          message: `${finding.path}: ${finding.message} (${finding.id})`,
          fix_hint:
            "Inspect the source, fix relevant findings or acknowledge a specific reviewed reason",
          severity: "error" as const,
        })),
      })
    return ok({ ...report, needsReview: unreviewed.length })
  } catch (error) {
    return err({
      code: "bad_args",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
