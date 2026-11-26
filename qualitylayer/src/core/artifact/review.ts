// A fresh check of an artifact outside a task (`qualitylayer artifact review`): the same look the Plan
// step hands out, for the calling agent to give to a fresh subagent. What was handed out and where
// the report goes sit beside the artifact's QualityLayer state, one record per artifact page, so a
// second call on the same revision hands nothing out again.

import { basename, join, resolve } from "node:path"
import { loadWorkflow } from "#workflow"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { detectAgent } from "../agents/detect.ts"
import { isWireframe } from "../artifact-check.ts"
import { type ArtifactReview, artifactReviewBriefFor } from "../briefs.ts"
import { readConfig, SESSION_MODEL } from "../config.ts"
import { subagentModel } from "../helper-staff.ts"
import { reviewFindings } from "../task/items.ts"

/** The report a subagent returns may be long; more than this is not a report. */
const REPORT_MAX_BYTES = 256 * 1024

/** What `artifact review` knows of one page: the revision handed out, where the report goes, when it came. */
type ReviewRecord = { revision: string; handed: number; report: string; reported?: number }

/** The artifact page a review is about, as the command resolved it. */
export type ReviewTarget = {
  artifact: string
  /** The page of a folder artifact, as its file name; absent for a single page. */
  page?: string
  file: string
  html: string
  repoRoot: string
  /** The folder holding the artifact's QualityLayer state: its comments, revisions and reviews. */
  runtimeDir: string
  /** The task whose draft this is; absent for a project artifact. */
  task?: string
  /** The page's revision now: its source hash, or a folder's stamp. */
  revision: string
  /** The pictures to take: the artifact's width and a phone's, each light and dark. */
  views: ArtifactReview["views"]
  /** Every page of a multi-page folder artifact when reviewing without `--page`. */
  pages?: ArtifactReview["pages"]
}

/** What the command prints; `status` says which of the six things happened. */
type ReviewReply = {
  status: "handed" | "already-reviewed" | "recorded" | "off" | "wireframe"
  artifact: string
  page?: string
  revision?: string
  report?: string
  brief_file?: string
  /** The model the fresh agent runs on: Settings › Models › Design review for the calling agent. */
  model?: string
  effort?: "high"
  reported?: boolean
  findings?: number
  result?: string
  fallback?: string
  message: string
}

const ONE_ROUND =
  "One round: fix what it finds in one batch, confirm with your own screenshots, and do not run the review again."

const reviewsDir = (target: ReviewTarget) => join(target.runtimeDir, "artifact-reviews")
const keyOf = (target: ReviewTarget) =>
  target.page === undefined
    ? target.artifact
    : `${target.artifact}--${basename(target.page, ".html")}`
const recordPath = (target: ReviewTarget) => join(reviewsDir(target), `${keyOf(target)}.json`)
const reportPath = (target: ReviewTarget) => join(reviewsDir(target), `${keyOf(target)}.md`)
const briefPath = (target: ReviewTarget) => join(reviewsDir(target), `${keyOf(target)}.brief.md`)

const shown = (target: ReviewTarget) => ({
  artifact: target.artifact,
  ...(target.page !== undefined ? { page: target.page } : {}),
})

/** The `artifact review` call that names this page, for the messages. */
const callFor = (target: ReviewTarget) =>
  `qualitylayer artifact review ${target.artifact}${target.page !== undefined ? ` --page ${basename(target.page, ".html")}` : ""}`

async function readRecord(ctx: Ctx, target: ReviewTarget): Promise<ReviewRecord | null> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(recordPath(target))) as Partial<ReviewRecord>
    return typeof parsed.revision === "string" && typeof parsed.report === "string"
      ? (parsed as ReviewRecord)
      : null
  } catch {
    return null
  }
}

async function writeRecord(ctx: Ctx, target: ReviewTarget, record: ReviewRecord): Promise<void> {
  await ctx.fs.mkdir(reviewsDir(target))
  await ctx.fs.atomicWrite(recordPath(target), `${JSON.stringify(record, null, 2)}\n`)
}

/** What the person asked for, else the artifact's purpose. */
const askedOf = (request: string | undefined, purpose: string): string =>
  request !== undefined && request.trim() !== "" ? request.trim() : purpose

/** A page already reviewed on this revision: where its report is, and whether it came back. */
function alreadyReviewed(target: ReviewTarget, record: ReviewRecord): ReviewReply {
  const reported = record.reported !== undefined
  return {
    status: "already-reviewed",
    ...shown(target),
    revision: record.revision,
    report: record.report,
    reported,
    message: `${target.artifact} was already reviewed on this revision: ${
      reported
        ? `its report is ${record.report}`
        : `the fresh check was handed out and its report goes to ${record.report} (${callFor(target)} --done --report <file> records it)`
    }. The page changes with the fixes; do not review it again.`,
  }
}

/**
 * `artifact review`: Off and wireframes say so, a page already handed out on this revision says where
 * its report is, anything else writes the brief and records where the report goes.
 */
export async function reviewArtifact(
  ctx: Ctx,
  target: ReviewTarget,
  options: { request?: string; purpose: string },
): Promise<Result<ReviewReply>> {
  if ((await readConfig(ctx)).designReview === "off")
    return ok({
      status: "off",
      ...shown(target),
      message:
        "Design review is off (Settings › Workflow › Reviews › Design review): no fresh check is needed. Confirm the design with your own screenshots, then tell the person it is ready.",
    })
  if (isWireframe(target.html))
    return ok({
      status: "wireframe",
      ...shown(target),
      message: `${target.artifact} is a wireframe: wireframes are not reviewed. Draw the finished design, then review that.`,
    })
  const held = await readRecord(ctx, target)
  if (held !== null && held.revision === target.revision) return ok(alreadyReviewed(target, held))
  const loaded = await loadWorkflow(ctx)
  if (!loaded.ok) return loaded
  const brief = await artifactReviewBriefFor(ctx, {
    artifact: target.artifact,
    ...(target.page !== undefined ? { page: basename(target.page, ".html") } : {}),
    file: target.file,
    repoRoot: target.repoRoot,
    ...(target.task !== undefined ? { task: target.task } : {}),
    views: target.views,
    ...(target.pages !== undefined && target.pages.length > 1 ? { pages: target.pages } : {}),
    asked: askedOf(options.request, options.purpose),
  })
  await ctx.fs.mkdir(reviewsDir(target))
  await ctx.fs.atomicWrite(briefPath(target), `${brief}\n`)
  await writeRecord(ctx, target, {
    revision: target.revision,
    handed: ctx.clock.now(),
    report: reportPath(target),
  })
  const model = await subagentModel(ctx, detectAgent(ctx.env), "artifact-check")
  const check =
    model === SESSION_MODEL
      ? `Review ${target.artifact} in this session using the brief in ${briefPath(target)}.`
      : `Start a fresh reviewer${model === null ? "" : ` on ${model}`} at high effort using the brief in ${briefPath(target)}.`
  return ok({
    status: "handed",
    ...shown(target),
    revision: target.revision,
    report: reportPath(target),
    brief_file: briefPath(target),
    ...(model === SESSION_MODEL ? {} : { effort: "high" as const }),
    ...(model !== null && model !== SESSION_MODEL ? { model } : {}),
    fallback:
      "If you cannot start a subagent, take the four pictures yourself with no memory of how the page was drawn, hold them against the acceptance points, and tell the person the check was yours.",
    message:
      `${check} ` +
      `When its report returns, save it to a file and run \`${callFor(target)} --done --report <file>\`. ${ONE_ROUND}`,
  })
}

/** `artifact review --done --report <file>`: the finished report, kept where the review said it goes. */
export async function recordReview(
  ctx: Ctx,
  target: ReviewTarget,
  reportFile: string,
): Promise<Result<ReviewReply>> {
  const held = await readRecord(ctx, target)
  if (held === null)
    return err({
      code: "bad_args",
      message: `no review was handed out for ${target.artifact}: run \`${callFor(target)}\` first`,
    })
  const path = resolve(ctx.env.cwd(), reportFile)
  const text = await readReport(ctx, path)
  if (!text.ok) return text
  await ctx.fs.atomicWrite(held.report, `${text.data}\n`)
  await writeRecord(ctx, target, { ...held, reported: ctx.clock.now() })
  const result = /^Result:\s*(done|needs work)\b/im.exec(text.data)?.[1]
  return ok({
    status: "recorded",
    ...shown(target),
    revision: held.revision,
    report: held.report,
    reported: true,
    findings: reviewFindings(text.data).length,
    ...(result !== undefined ? { result } : {}),
    message: `Recorded the report at ${held.report}. ${ONE_ROUND}`,
  })
}

async function readReport(ctx: Ctx, path: string): Promise<Result<string>> {
  let text: string
  try {
    if (((await ctx.fs.stat?.(path))?.size ?? 0) > REPORT_MAX_BYTES) throw new Error("too large")
    text = (await ctx.fs.readFile(path)).trim()
  } catch {
    return err({
      code: "bad_args",
      message: `cannot read the report ${path}: save the subagent's last message there (at most ${REPORT_MAX_BYTES / 1024} KiB)`,
    })
  }
  return text === ""
    ? err({
        code: "bad_args",
        message: `the report ${path} is empty: save the subagent's last message there`,
      })
    : ok(text)
}
