// The Plan step's fresh look at each artifact draft: one `artifact-check` helper per draft the Plan shows
// (a folder draft's pages together), with pictures at wide and phone width in both themes held against
// the Done means. Its report goes to `reviews/artifact-<draft>.md` with the planner's answer under each
// finding, and `plan draft` waits for every finding to be answered.

import { createHash } from "node:crypto"
import { basename, join } from "node:path"
import type { Ctx, ValidationError } from "../ctx.ts"
import { folderArtifactOf } from "./artifact/format.ts"
import { artifactsInPlan } from "./artifact/store.ts"
import { takeStoredName } from "./artifact/stored-state.ts"
import { artifactCheckHelper, type Helper, salt } from "./briefs.ts"
import { readConfig } from "./config.ts"
import { sectionText } from "./docs/build-log.ts"
import { folderDoc, REVIEWS_DIR } from "./docs/names.ts"
import { doneMeansPath } from "./done-means.ts"
import { reviewFindings } from "./task/items.ts"
import type { Task } from "./task/store.ts"

/** The widths and themes every artifact is looked at in. */
const SHOTS = [
  { width: 1440, theme: "light" },
  { width: 1440, theme: "dark" },
  { width: 390, theme: "light" },
  { width: 390, theme: "dark" },
] as const

/** An artifact's review, from the task folder. */
export const artifactReviewFile = (name: string): string => `${REVIEWS_DIR}/artifact-${name}.md`

/** What the reply tells the planner about one check handed out. */
export type ArtifactCheckHandle = { artifact: string; report: string; pictures: string[] }

const offeredPath = (task: Pick<Task, "runtimeDir">) => {
  takeStoredName(task.runtimeDir, "design-checks.json", "artifact-checks.json")
  return join(task.runtimeDir, "artifact-checks.json")
}
/** The pictures of a check; a folder kept under the old name is renamed on the first look. */
const picturesDir = (task: Pick<Task, "runtimeDir">) => {
  takeStoredName(task.runtimeDir, "design-checks", "artifact-checks")
  return join(task.runtimeDir, "artifact-checks")
}
const idsPath = (task: Pick<Task, "runtimeDir">) => {
  takeStoredName(task.runtimeDir, "design-check-ids.json", "artifact-check-ids.json")
  return join(task.runtimeDir, "artifact-check-ids.json")
}

async function checkIds(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<Record<string, string>> {
  try {
    return JSON.parse(await ctx.fs.readFile(idsPath(task))) as Record<string, string>
  } catch {
    return {}
  }
}

/** The artifact a check's helper read, by its id; null for any other helper. */
export async function artifactOfCheck(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  id: string,
): Promise<string | null> {
  return (await checkIds(ctx, task))[id] ?? null
}
const digest = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 24)

async function offered(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await ctx.fs.readFile(offeredPath(task)))
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export type DueChecks = {
  helpers: Helper[]
  handles: ArtifactCheckHandle[]
  /** Each artifact's digest at hand-out, kept once the helpers are started. */
  seen: Record<string, string>
  /** The artifact each check's helper reads, by helper id: `helper result` files its report there. */
  ids: Record<string, string>
  /** Design review is off and the Plan shows a finished design that would have been checked. */
  off?: true
}
const designReviewOff = async (ctx: Ctx): Promise<boolean> =>
  (await readConfig(ctx)).designReview === "off"

/** Whether the Plan's designs get a fresh check: a task with a user interface while design review is on. */
const reviewsDesigns = async (ctx: Ctx, task: Task): Promise<boolean> =>
  task.ui && !(await designReviewOff(ctx))

/** A wireframe (`artifact new --wire`): grey boxes for a bounded change to a screen that exists. */
export const isWireframe = (html: string): boolean => html.includes("A QualityLayer wireframe:")

type DraftPage = { file: string; path: string; name: string; html: string }
/** A draft the Plan shows: the folder's name, or a single page's; its pages on disk in the Plan's order. */
type Draft = { key: string; folder: boolean; pages: DraftPage[] }

/** The drafts the Plan shows, each with its pages that exist: one check and one review per draft. */
async function draftsInPlan(ctx: Ctx, task: Pick<Task, "dir">, plan: string): Promise<Draft[]> {
  const drafts = new Map<string, Draft>()
  for (const file of artifactsInPlan(plan)) {
    const path = join(task.dir, file)
    if (!(await ctx.fs.exists(path))) continue
    const name = basename(file, ".html")
    const folder = folderArtifactOf(file)
    const key = folder?.name ?? name
    const draft = drafts.get(key) ?? { key, folder: folder !== null, pages: [] }
    draft.pages.push({ file, path, name, html: await ctx.fs.readFile(path) })
    drafts.set(key, draft)
  }
  return [...drafts.values()]
}

/** The finished drafts the Plan shows that were never handed to a fresh check: their wireframe pages left out, none already offered. */
async function uncheckedArtifacts(ctx: Ctx, task: Task, plan: string): Promise<Draft[]> {
  const before = await offered(ctx, task)
  return (await draftsInPlan(ctx, task, plan))
    .filter((draft) => before[draft.key] === undefined)
    .map((draft) => ({ ...draft, pages: draft.pages.filter((p) => !isWireframe(p.html)) }))
    .filter((draft) => draft.pages.length > 0)
}

/** A draft's pictures of one page; a folder draft's carry the draft's name, so a fresh check can clear them. */
const pictureFile = (name: string, shot: (typeof SHOTS)[number]) =>
  `${name}-${shot.width}-${shot.theme}.png`
const pictureName = (draft: Draft, page: DraftPage, shot: (typeof SHOTS)[number]) =>
  pictureFile(draft.folder ? `${draft.key}--${page.name}` : page.name, shot)

/**
 * The checks due now: one per finished artifact the Plan shows that has never been handed to a fresh
 * check. Each artifact is checked once: the planner fixes the findings, confirms them with its own
 * screenshots and answers each, and the check does not run again. A wireframe gets none. None for a
 * task without a user interface or a Plan without an artifact, and none while design review is off.
 */
export async function dueArtifactChecks(ctx: Ctx, task: Task, plan: string): Promise<DueChecks> {
  const due: DueChecks = { helpers: [], handles: [], seen: {}, ids: {} }
  if (!task.ui) return due
  const unchecked = await uncheckedArtifacts(ctx, task, plan)
  if (await designReviewOff(ctx)) return unchecked.length > 0 ? { ...due, off: true } : due
  // The approved Done means: Discuss's, or an adopted task's Plan (doneMeansPath).
  const discussPath = doneMeansPath(task)
  const doneMeans = (await ctx.fs.exists(discussPath))
    ? sectionText(await ctx.fs.readFile(discussPath), "Done means")
    : ""
  for (const draft of unchecked) {
    // A page of a folder draft is drawn as `artifact shot <artifact> --page <page>`.
    const pages = draft.pages.map((page) => ({
      page: page.name,
      file: page.path,
      shots: SHOTS.map((s) => ({
        ...s,
        out: join(picturesDir(task), pictureName(draft, page, s)),
      })),
    }))
    const first = pages[0] as (typeof pages)[number]
    const id = `dc-${salt(ctx)}`
    due.ids[id] = draft.key
    due.helpers.push(
      artifactCheckHelper(task, {
        id,
        name: draft.key,
        ...(draft.folder ? { artifact: draft.key, page: first.page } : {}),
        file: first.file,
        shots: first.shots,
        ...(pages.length > 1 ? { pages } : {}),
        doneMeans,
      }),
    )
    due.handles.push({
      artifact: draft.key,
      report: artifactReviewFile(draft.key),
      pictures: pages.flatMap((page) => page.shots.map((s) => s.out)),
    })
    due.seen[draft.key] = digest(draft.pages.map((p) => p.html).join("\n"))
  }
  return due
}

async function clearPriorPictures(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  names: readonly string[],
): Promise<void> {
  const dir = picturesDir(task)
  const left = await ctx.fs.readdir(dir).catch(() => [] as string[])
  const stale = left.filter((file) =>
    names.some(
      (name) => file.startsWith(`${name}--`) || SHOTS.some((s) => file === pictureFile(name, s)),
    ),
  )
  await Promise.all(stale.map((file) => ctx.fs.remove(join(dir, file)).catch(() => {})))
}

async function archivePriorReports(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "dir">,
  names: readonly string[],
  before: Record<string, string>,
): Promise<void> {
  for (const name of names) {
    const report = join(task.dir, artifactReviewFile(name))
    if (!(await ctx.fs.exists(report))) continue
    const earlier = join(
      task.dir,
      REVIEWS_DIR,
      `artifact-${name}.before-${before[name] ?? "unchecked"}.md`,
    )
    await ctx.fs.writeFile(earlier, await ctx.fs.readFile(report))
    await ctx.fs.remove(report)
  }
}

/**
 * The helpers are handed out: these pages are not handed out again until they change. A report a
 * check of an earlier version of the page left is kept beside, as `artifact-<name>.before-<digest>.md`,
 * so the one `plan draft` waits for is the check of the page as it stands.
 */
export async function noteArtifactChecksOffered(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "dir">,
  seen: Record<string, string>,
  ids: Record<string, string> = {},
): Promise<void> {
  const names = Object.keys(seen)
  if (names.length === 0) return
  // A fresh check starts from no pictures: one left by an earlier run would be taken for its own.
  await clearPriorPictures(ctx, task, names)
  await ctx.fs.mkdir(task.runtimeDir)
  if (Object.keys(ids).length > 0) {
    await ctx.fs.atomicWrite(
      idsPath(task),
      `${JSON.stringify({ ...(await checkIds(ctx, task)), ...ids })}\n`,
    )
  }
  const before = await offered(ctx, task)
  await archivePriorReports(ctx, task, names, before)
  await ctx.fs.atomicWrite(offeredPath(task), `${JSON.stringify({ ...before, ...seen })}\n`)
}

async function pendingCheckError(
  ctx: Ctx,
  task: Task,
  draft: Draft,
  handed: Record<string, string>,
): Promise<ValidationError | null> {
  const name = draft.key
  const report = artifactReviewFile(name)
  if (handed[name] === undefined) {
    if (draft.pages.every((p) => isWireframe(p.html))) return null
    const files = draft.pages.map((p) => p.file).join(", ")
    return {
      line: 1,
      rule: "artifact-check-current",
      message: `no fresh check of artifact ${name} was handed out yet`,
      fix_hint: `run \`qualitylayer plan draft\`: it hands out the fresh check of ${files}; save the returned report with \`qualitylayer helper result <helper id> --file <report path>\``,
      severity: "error",
    }
  }
  if (await ctx.fs.exists(join(task.dir, report))) return null
  return {
    line: 1,
    rule: "artifact-check-missing",
    message: `the fresh check of artifact ${name} has not reported yet: ${report} is not written`,
    fix_hint: `wait for the \`artifact-check\` helper; save its returned report with \`qualitylayer helper result <helper id> --file <report path>\`, then answer each finding in ${report}`,
    severity: "error",
  }
}

/**
 * Each finished artifact the Plan shows whose one fresh check has not reported: none was handed out
 * yet (`plan draft` hands it out), or its report is not written yet. `plan draft` waits for both. A page
 * changed after its check (the planner fixing the findings) needs no second one. None for a task
 * without a user interface, none for a wireframe, and none while design review is off.
 */
export async function pendingArtifactChecks(ctx: Ctx, task: Task): Promise<ValidationError[]> {
  if (!(await reviewsDesigns(ctx, task))) return []
  const planPath = join(task.dir, folderDoc("plan"))
  if (!(await ctx.fs.exists(planPath))) return []
  const handed = await offered(ctx, task)
  const drafts = await draftsInPlan(ctx, task, await ctx.fs.readFile(planPath))
  const found = await Promise.all(drafts.map((d) => pendingCheckError(ctx, task, d, handed)))
  return found.filter((error): error is ValidationError => error !== null)
}

/**
 * Each finding of an artifact's review that has no `Answer: Taken · …` or `Answer: Kept · …` under it
 * (an `Ask` is still open): `plan draft` lists them and waits.
 */
export async function unansweredArtifactFindings(ctx: Ctx, task: Task): Promise<ValidationError[]> {
  const folder = join(task.dir, REVIEWS_DIR)
  if (!(await ctx.fs.exists(folder))) return []
  const errors: ValidationError[] = []
  for (const file of (await ctx.fs.readdir(folder)).sort()) {
    if (!/^artifact-[a-z0-9-]+\.md$/.test(file)) continue
    const findings = reviewFindings(await ctx.fs.readFile(join(folder, file)))
    findings.forEach((finding, index) => {
      if (finding.stance === "taken" || finding.stance === "kept") return
      errors.push({
        line: 1,
        rule: "artifact-check-answered",
        message: `finding ${index + 1} of ${REVIEWS_DIR}/${file} has no answer yet: ${finding.what}`,
        fix_hint:
          "fix it in the artifact or keep it, and write under it `Answer: Taken · <what you changed>` or `Answer: Kept · <why it stays>`",
        severity: "error",
      })
    })
  }
  return errors
}
