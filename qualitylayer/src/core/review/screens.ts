import type { Ctx } from "../../ctx.ts"
import { sectionText, verifyLogPath } from "../docs/build-log.ts"
import { buildRevision } from "../gate/revision.ts"
import { currentPlanAsset } from "../plan-assets.ts"
import type { Task } from "../task/store.ts"
import {
  type EvidenceKind,
  type EvidenceRow,
  type EvidenceSource,
  isScreenRow,
  type ScreenOutcome,
  type ScreenRow,
} from "./screen-evidence.ts"
import type { WalkScreen } from "./screen-pairs.ts"
import { acceptanceAsRun, acceptanceRows } from "./screens-acceptance.ts"
import { checkedScreenPng } from "./screens-png.ts"
import { citedEvidence } from "./screens-standing.ts"
import { evidenceByRun, recordEvidence, recordScreen, screenRows } from "./screens-store.ts"
import { screenSurfaces } from "./screens-surfaces.ts"

export type { WalkScreen } from "./screen-pairs.ts"
export type { ScreenOutcome, ScreenRow }
export {
  acceptanceAsRun,
  acceptanceRows,
  checkedScreenPng,
  citedEvidence,
  evidenceByRun,
  recordEvidence,
  recordScreen,
  screenRows,
  screenSurfaces,
}

/** What a capture of a planned screen is recorded from; the file, digest and time are made here. */
export type ScreenInput = Omit<ScreenRow, "kind" | "file" | "shotDigest" | "at">
/** What an added picture or output is recorded from. */
export type EvidenceInput = EvidenceSource & { kind: EvidenceKind; buildRevision: string }
export type ScreenSurface = {
  key: string
  width: number
  artifactDigest: string
  artifact?: { kind: "wireframe" | "html"; source: string }
  /** The reference the Plan names the artifact by: what its approved picture is looked up with. */
  reference?: string
}
export type ScreenPair = ScreenSurface & {
  height?: number
  staleReason?: string
  row: ScreenRow | null
  stale: boolean
  file: string | null
  outcome: ScreenOutcome | "not captured"
  /** The picture of the artifact the Plan was approved with (`assets/…`), when it has one. */
  approved: string | null
}

/** The last capture of each planned screen at each size and theme, whichever run took it. */
function latestCaptures(rows: EvidenceRow[]): ScreenRow[] {
  const latest = new Map<string, ScreenRow>()
  for (const row of rows) {
    if (!isScreenRow(row)) continue
    const identity = `${row.key}\n${row.width}\n${row.height ?? 900}\n${row.theme}`
    latest.delete(identity)
    latest.set(identity, row)
  }
  return [...latest.values()]
}

function staleReasonFor(
  surface: ScreenSurface,
  row: ScreenRow,
  revision: string | null,
): string | undefined {
  const reasons: string[] = []
  if (row.artifactDigest !== surface.artifactDigest) reasons.push("artifact content changed")
  if (row.buildRevision !== revision) {
    reasons.push(
      revision === null ? "current build revision unavailable" : "recorded build changed",
    )
  }
  return reasons.length > 0 ? reasons.join("; ") : undefined
}

function pairsForSurface(
  surface: ScreenSurface,
  approved: string | null,
  rows: readonly ScreenRow[],
  revision: string | null,
): ScreenPair[] {
  const matches = rows.filter((row) => row.key === surface.key)
  if (!matches.length) {
    return [{ ...surface, row: null, stale: false, file: null, outcome: "not captured", approved }]
  }
  return matches.map((row) => {
    const staleReason = staleReasonFor(surface, row, revision)
    return {
      ...surface,
      approved,
      width: row.width,
      ...(row.height === undefined ? {} : { height: row.height }),
      row,
      file: row.file,
      outcome: row.outcome,
      stale: staleReason !== undefined,
      ...(staleReason !== undefined ? { staleReason } : {}),
    }
  })
}

export async function screenPairs(ctx: Ctx, task: Task): Promise<ScreenPair[]> {
  const surfaces = await screenSurfaces(ctx, task)
  if (surfaces.length === 0) return []
  const rows = latestCaptures(await screenRows(ctx, task))
  const revision = rows.length > 0 ? await buildRevision(ctx, task).catch(() => null) : null
  const approvedFiles = new Map<string, string | null>()
  for (const surface of surfaces) {
    const asset =
      surface.reference === undefined
        ? null
        : await currentPlanAsset(ctx, task, surface.reference).catch(() => null)
    approvedFiles.set(surface.key, asset?.file ?? null)
  }
  return surfaces.flatMap((surface) =>
    pairsForSurface(surface, approvedFiles.get(surface.key) ?? null, rows, revision),
  )
}

/** Keep the independent review's words when its record names the surface; never infer a visual match. */
export async function reviewScreens(ctx: Ctx, task: Task): Promise<WalkScreen[]> {
  const pairs = await screenPairs(ctx, task)
  if (pairs.length === 0) return []
  const path = verifyLogPath(task)
  const report = sectionText(
    (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : "",
    "Verification",
  )
  return pairs.map((pair) => ({
    key: pair.key,
    width: pair.width,
    ...(pair.height === undefined ? {} : { height: pair.height }),
    ...(pair.staleReason ? { staleReason: pair.staleReason } : {}),
    theme: pair.row?.theme ?? "light",
    ...(pair.row
      ? {
          run: pair.row.run,
          mode: pair.row.mode,
          ...(pair.row.step === undefined ? {} : { step: pair.row.step }),
        }
      : {}),
    outcome: pair.outcome,
    stale: pair.stale,
    file: pair.file,
    ...(pair.approved !== null ? { approved: pair.approved } : {}),
    artifact: pair.artifact,
    verdict:
      screenComparison(report, pair.key, pair.width, pair.row?.theme ?? "light", pair.height) ??
      "No comparison recorded.",
  }))
}

const PAIR_SUFFIX =
  /^\s*·\s*(\d+)(?:\s*[×x]\s*(\d+))?(?:\s*px)?(?:\s*·)?\s*(light|dark)\s*:\s*(\S.*)$/

type ComparisonHit = { exact?: string; widthOnly?: string; legacy?: string }

function matchComparisonSuffix(
  suffix: string,
  width: number,
  theme: "light" | "dark",
  height?: number,
): ComparisonHit {
  const hit: ComparisonHit = {}
  const pair = PAIR_SUFFIX.exec(suffix)
  if (pair && Number(pair[1]) === width && pair[3] === theme) {
    if (pair[2] !== undefined && Number(pair[2]) === height) hit.exact = pair[4]?.trim()
    else if (pair[2] === undefined) hit.widthOnly = pair[4]?.trim()
  }
  if (suffix.startsWith(": ")) hit.legacy = suffix.slice(2).trim() || undefined
  return hit
}

/** A pair-specific verdict outranks the older surface-only report format. */
export function screenComparison(
  report: string,
  key: string,
  width: number,
  theme: "light" | "dark",
  height?: number,
): string | undefined {
  const prefixes = [`- ${key}`, `- **${key}**`, `- \`${key}\``]
  let legacy: string | undefined
  let widthOnly: string | undefined
  for (const line of report.split(/\r?\n/)) {
    const prefix = prefixes.find((p) => line.startsWith(p))
    if (prefix === undefined) continue
    const hit = matchComparisonSuffix(line.slice(prefix.length), width, theme, height)
    if (hit.exact !== undefined) return hit.exact
    if (hit.widthOnly !== undefined) widthOnly = hit.widthOnly
    if (hit.legacy !== undefined) legacy = hit.legacy
  }
  return widthOnly ?? legacy
}
