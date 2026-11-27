import {
  acknowledgeQuality,
  checkProjectQuality,
  pruneQualityProjects,
  type QualityMode,
  QualityStoreFullError,
  qualityProject,
  qualityStatus,
  setQualityEnabled,
} from "../../core/code-quality/project.ts"
import { SCANNERS } from "../../core/code-quality/scanners/registry.ts"
import type { scanChanges } from "../../core/code-quality/scanners/scan.ts"
import { ensureScanners } from "../../core/code-quality/scanners/setup.ts"
import { ensureQualityTool } from "../../core/code-quality/setup.ts"
import { lastSetup, logSetup, setupToolLine } from "../../core/code-quality/setup-log.ts"
import { recordQualityToolSetup, recordScannerSetups } from "../../core/install/install.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { changedFiles, scanCommand } from "./quality-scan.ts"

export const qualityScanUsage =
  "qualitylayer quality scan [paths... | --since <rev>] [--secrets] [--dependencies] [--workflows] [--code] [--local]"

const USAGE = `usage: qualitylayer quality setup | status | on | off
qualitylayer quality check [paths...] [--all] [--duplication] [--fail-on-new]
${qualityScanUsage}
qualitylayer quality metrics | lint [paths...] [--all]
qualitylayer quality acknowledge <finding-id> --reason "<specific review reason>"
qualitylayer quality prune [--keep <n>]
Checks use the working files. Existing project lint/test commands remain required.`

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

async function acknowledgeCommand(ctx: Ctx, rest: string[]): Promise<Result<unknown>> {
  const [id, flag, reason] = rest
  if (rest.length !== 3 || flag !== "--reason" || id === undefined || reason === undefined)
    return err({ code: "bad_args", message: USAGE })
  await acknowledgeQuality(ctx, id, reason, { changed: () => changedFiles(ctx) })
  return ok({ id, acknowledged: true, reason })
}

function qualityModeOf(verb: string, duplication: boolean): QualityMode {
  if (verb === "metrics") return "metrics"
  if (verb === "lint") return "lint"
  return duplication ? "duplication" : "structure"
}

function formatQualityReport(
  report: Awaited<ReturnType<typeof checkProjectQuality>>,
  failOnNew: boolean,
): Result<unknown> {
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
}

async function checkModeCommand(
  ctx: Ctx,
  verb: string,
  rest: string[],
  dependencies: QualityCommandDependencies,
): Promise<Result<unknown>> {
  const all = rest.includes("--all")
  const duplication = rest.includes("--duplication")
  const failOnNew = rest.includes("--fail-on-new")
  if (verb !== "check" && (duplication || failOnNew))
    return err({ code: "bad_args", message: USAGE })
  const paths = rest.filter((arg) => !["--all", "--duplication", "--fail-on-new"].includes(arg))
  if (paths.some((path) => path.startsWith("-")) || (all && paths.length > 0))
    return err({ code: "bad_args", message: USAGE })
  const scope = all
    ? { all: true, paths: ["."], timeoutMs: 120_000 }
    : { paths: paths.length ? paths : await changedFiles(ctx), timeoutMs: 15_000 }
  const report = await (dependencies.scan ?? checkProjectQuality)(ctx, {
    ...scope,
    mode: qualityModeOf(verb, duplication),
  })
  return formatQualityReport(report, failOnNew)
}

async function dispatchSimpleVerb(
  ctx: Ctx,
  verb: string,
  dependencies: QualityCommandDependencies,
): Promise<Result<unknown> | null> {
  if (verb === "status") return ok({ ...(await qualityStatus(ctx)), setup: await lastSetup(ctx) })
  if (verb === "setup") return setupCommand(ctx, dependencies)
  if (verb === "on" || verb === "off") {
    await setQualityEnabled(ctx, verb === "on")
    return ok({ enabled: verb === "on", project: ctx.env.cwd() })
  }
  return null
}

async function pruneCommand(ctx: Ctx, rest: string[]): Promise<Result<unknown>> {
  let keep: number | undefined
  if (rest.length === 2 && rest[0] === "--keep") {
    const parsed = Number(rest[1])
    if (!Number.isSafeInteger(parsed) || parsed < 0)
      return err({ code: "bad_args", message: "--keep must be a non-negative integer" })
    keep = parsed
  } else if (rest.length > 0) {
    return err({ code: "bad_args", message: USAGE })
  }
  const current = await qualityProject(ctx, { inspect: true }).catch(() => null)
  return ok(await pruneQualityProjects(ctx, { keep, excludeId: current?.id }))
}

async function dispatchQuality(
  ctx: Ctx,
  verb: string,
  rest: string[],
  dependencies: QualityCommandDependencies,
): Promise<Result<unknown>> {
  const simple = rest.length === 0 ? await dispatchSimpleVerb(ctx, verb, dependencies) : null
  if (simple !== null) return simple
  const handlers: Record<string, () => Promise<Result<unknown>>> = {
    prune: () => pruneCommand(ctx, rest),
    acknowledge: () => acknowledgeCommand(ctx, rest),
    scan: () => scanCommand(ctx, rest, USAGE, dependencies.scanChanges),
    check: () => checkModeCommand(ctx, verb, rest, dependencies),
    metrics: () => checkModeCommand(ctx, verb, rest, dependencies),
    lint: () => checkModeCommand(ctx, verb, rest, dependencies),
  }
  const handler = handlers[verb]
  return handler ? handler() : err({ code: "bad_args", message: USAGE })
}

export async function qualityCmd(
  ctx: Ctx,
  args: string[],
  dependencies: QualityCommandDependencies = {},
): Promise<Result<unknown>> {
  const [verb = "status", ...rest] = args
  try {
    return await dispatchQuality(ctx, verb, rest, dependencies)
  } catch (error) {
    return err({
      code: error instanceof QualityStoreFullError ? "open_failed" : "bad_args",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
