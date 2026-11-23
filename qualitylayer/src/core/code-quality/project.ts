import { realpath } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { QUALITY_PROJECTS_MAX } from "../home-caps.ts"
import { realLocation } from "../install/manifest.ts"
import { WorkflowStateBusy } from "../lock-busy.ts"
import { runQuality } from "./engine.ts"
import { type CaptureScope, captureSources, projectInventory } from "./project-capture.ts"
import {
  analysisConfig,
  type Controls,
  controls,
  digest,
  MAX_FILES,
  readJson,
  type Stored,
  saveJson,
} from "./project-config.ts"
import { applyReviews, buildReviewedFindings, SCAN_BUSY } from "./project-review.ts"
import {
  createAnalysisSnapshot,
  pruneOldSnapshots,
  toolEnvironment,
  verifyLintStability,
} from "./project-snapshot.ts"
import { scannerStatus } from "./scanners/setup.ts"
import { qualityToolPath } from "./setup.ts"

export { acknowledgeQuality } from "./project-ack.ts"
export { qualitySummary } from "./project-review.ts"

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

export async function qualityProject(
  ctx: Ctx,
  options: { existingHook?: string; inspect?: boolean } = {},
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
  if (!options.inspect && !(await ctx.fs.exists(folder))) {
    const entries = (await ctx.fs.exists(base)) ? await ctx.fs.readdir(base) : []
    if (entries.filter((name) => /^[a-f0-9]{24}$/.test(name)).length >= QUALITY_PROJECTS_MAX)
      throw new Error(
        `QualityLayer already stores quality data for ${QUALITY_PROJECTS_MAX} checkouts. Run qualitylayer quality status --json in an inactive checkout to find its reportDirectory. Move that whole folder outside ${JSON.stringify(base)}, then retry. If the checkout is gone, its saved structure.json identifies it in report.root.`,
      )
  }
  return { root, id, folder }
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
  const project = await qualityProject(ctx, { inspect: true })
  const binary = qualityToolPath(ctx)
  return {
    engine: "qlty",
    binary,
    installed: binary !== null && (await ctx.fs.exists(binary)),
    project: project?.root ?? null,
    reportDirectory: project && (await ctx.fs.exists(project.folder)) ? project.folder : null,
    enabled: project ? (await controls(ctx, project.folder)).enabled : null,
    automatic: "Edited files at turn completion: structure checks and the secrets scan",
    scanners: await scannerStatus(ctx),
  }
}

type CheckContext = {
  ctx: Ctx
  project: { root: string; id: string; folder: string }
  mode: QualityMode
  options: QualityOptions
  binary: string
  savedControls: Controls
  empty: Omit<QualityProjectReport, "status">
  run: typeof runQuality
}

async function runProjectCheckLocked(check: CheckContext): Promise<QualityProjectReport> {
  const { ctx, project, mode, options, binary, savedControls, empty, run } = check
  await pruneOldSnapshots(ctx, project.folder, project.id)
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
  const sources = await captureSources(ctx, project.root, scope, {
    mode,
    limit: Math.min(options.limitFiles ?? MAX_FILES, MAX_FILES),
    config,
  })
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
  const canReuse =
    mode !== "lint" &&
    previous?.schema === 1 &&
    previous.key === key &&
    previous.report.status === "complete"
  if (canReuse && previous)
    return {
      ...previous.report,
      findings: applyReviews(previous.report.findings, mode, savedControls),
      cached: true,
    }
  const snapshot = await createAnalysisSnapshot(ctx, project, sources, config)
  try {
    const result = await run({
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
    if (mode === "lint") await verifyLintStability(ctx, project.root, sources, configurationHash)
    const findings = buildReviewedFindings(result.findings, sources, previous, {
      configurationHash,
      analyzer: result.version ?? binary,
    })
    const report: QualityProjectReport = {
      ...empty,
      status: "complete",
      files,
      sourceHashes,
      configurationHash,
      capturedAt: ctx.clock.now(),
      elapsedMs: result.elapsedMs,
      version: result.version,
      findings: applyReviews(findings, mode, savedControls),
      ...(result.metrics === undefined ? {} : { metrics: result.metrics }),
    }
    await saveJson(ctx, reportPath, { schema: 1, key, report } satisfies Stored)
    return report
  } finally {
    await ctx.fs.remove(snapshot)
  }
}

function earlyInputReport(
  empty: Omit<QualityProjectReport, "status">,
  options: QualityOptions,
  binaryReady: boolean,
): QualityProjectReport | null {
  const badLimit =
    options.limitFiles !== undefined &&
    (!Number.isSafeInteger(options.limitFiles) || options.limitFiles < 1)
  if (badLimit)
    return {
      ...empty,
      status: "incomplete",
      reason: "Code-quality file limit must be a positive integer",
    }
  if (!binaryReady)
    return {
      ...empty,
      status: "unavailable",
      reason: "Qlty is not installed; run qualitylayer quality setup",
    }
  return options.paths.length === 0 ? { ...empty, status: "no_files" } : null
}

async function resolveCheckInputs(
  ctx: Ctx,
  options: QualityOptions,
  dependencies: { binary?: string; run?: typeof runQuality },
): Promise<CheckContext | QualityProjectReport> {
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
  const binary = dependencies.binary ?? qualityToolPath(ctx)
  const binaryReady = Boolean(binary && (await ctx.fs.exists(binary)))
  const early = earlyInputReport(empty, options, binaryReady)
  if (early) return early
  return {
    ctx,
    project,
    mode,
    options,
    binary: binary as string,
    savedControls,
    empty,
    run: dependencies.run ?? runQuality,
  }
}

export async function checkProjectQuality(
  ctx: Ctx,
  options: QualityOptions,
  dependencies: { binary?: string; run?: typeof runQuality } = {},
): Promise<QualityProjectReport> {
  const prepared = await resolveCheckInputs(ctx, options, dependencies)
  if ("status" in prepared) return prepared
  try {
    return await ctx.fs.withLock<QualityProjectReport>(
      join(prepared.project.folder, ".scan.lock"),
      () => runProjectCheckLocked(prepared),
      { waitMs: 0, label: "Code-quality analysis" },
    )
  } catch (error) {
    return {
      ...prepared.empty,
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
