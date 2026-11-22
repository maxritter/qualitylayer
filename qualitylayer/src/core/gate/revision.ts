import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { parseArtifactReference } from "../artifact/reference.ts"
import { artifactReferenceRevision } from "../artifact/reference-source.ts"
import { addedBlocks, withoutAdded } from "../docs/added.ts"
import { implementAgentsPath, parseNotes } from "../docs/build-log.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { parseMarkers, withoutMarkerText } from "../docs/markers.ts"
import { agentFileOf, EVIDENCE_DIR, folderDoc, roleOf } from "../docs/names.ts"
import { allTasks } from "../docs/outline.ts"
import { readCards } from "../docs/outline-files.ts"
import { PLAN_GATE_DOCS } from "../docs/schema.ts"
import { artifactPath, extractFences } from "../docs/visuals.ts"
import { buildBase } from "../git/base.ts"
import { sliceCommits } from "../git/build-start.ts"
import { type OwnedTree, ownedTree } from "../git/owned-tree.ts"
import { untrackedFiles } from "../git/repo.ts"
import { revisionPaths } from "../git/revision-paths.ts"
import { planPictureDigest, planPictureRefs } from "../plan-assets.ts"
import { hasReviewCandidate, selectedReviewCandidate } from "../review-candidate.ts"
import {
  isAdopted,
  ORIGINAL_FILE,
  originalDigest,
  originalIntact,
  readAdoption,
} from "../task/adoption.ts"
import { ANSWER_MODE_FIELDS, APPROVAL_MODE_FIELDS } from "../task/answer-mode.ts"
import { planningQuestionAnswers } from "../task/planning-answers.ts"
import { answeredQuestions } from "../task/question.ts"
import { readmeFrontmatter, type Task } from "../task/store.ts"
import { normalizedLineEnds, trimEndCharacters } from "../text-boundaries.ts"

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

export const evidenceFolder = (task: Pick<Task, "dir">) => join(task.dir, EVIDENCE_DIR)

export async function fileRevision(ctx: Ctx, path: string): Promise<string> {
  if (!(await ctx.fs.exists(path))) return "missing"
  return digest(ctx.fs.readBytes ? await ctx.fs.readBytes(path) : await ctx.fs.readFile(path))
}

/**
 * A judge's captured proof, digested into the receipt's `proof` map so the
 * receipt names the bytes its verdict saw (no gate re-reads that map yet).
 * Whitespace cannot change what a text capture shows, so line endings,
 * trailing spaces and blank lines at the end are normalised: tidying them for
 * git's whitespace check keeps the verdict. Binary proof, such as a
 * screenshot, stays bound byte for byte.
 */
export async function evidenceRevision(ctx: Ctx, path: string): Promise<string> {
  if (!(await ctx.fs.exists(path))) return "missing"
  const bytes = ctx.fs.readBytes
    ? await ctx.fs.readBytes(path)
    : new TextEncoder().encode(await ctx.fs.readFile(path))
  if (bytes.includes(0)) return digest(bytes)
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return digest(bytes)
  }
  return `text:${digest(trimEndCharacters(normalizedLineEnds(text), "\n"))}`
}

/**
 * The paths the plan's tasks name in their Files blocks, or null when it names none. Another session
 * editing other files in the same checkout (a website, a README) is not this build's code.
 */
async function plannedPaths(ctx: Ctx, task: Task): Promise<string[] | null> {
  const paths = [...new Set(allTasks(await readCards(ctx, task.dir)).flatMap((t) => t.files))]
  return paths.length > 0 ? paths : null
}

/**
 * The planned files changed in the working tree when none was committed since the build's base: a
 * build about to be reviewed and shipped without its code. Empty when anything planned was
 * committed, so an unrelated edit someone left in a planned file never blocks the review.
 */
export async function uncommittedBuild(ctx: Ctx, task: Task): Promise<string[]> {
  const named = await plannedPaths(ctx, task)
  const planned = named === null ? null : revisionPaths(task.repoRoot, named).local
  if (planned?.length === 0) return []
  const base = planned === null ? null : await buildBase(ctx, task)
  if (planned === null || base === null) return []
  const committed = await ctx.git.run(task.repoRoot, [
    "diff",
    "--name-only",
    `${base}..HEAD`,
    "--",
    ...planned,
  ])
  if (committed.code !== 0 || committed.stdout.trim() !== "") return []
  const open = await ctx.git.run(task.repoRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...planned,
  ])
  if (open.code !== 0) return []
  return open.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3))
}

/** Whether a changed path is one the plan names: the file itself, or a file inside a folder it names. */
export const within = (paths: string[], file: string) =>
  paths.some((p) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`))

/**
 * The files this task's own commits changed (`commit slice` and `commit fix` record each one), or
 * null when it recorded none. On a branch other sessions commit to as well, their commits are not
 * the build's: they never expire its checks (Max, 2026-10-13).
 */
async function ownCommitPaths(ctx: Ctx, task: Task): Promise<string[] | null> {
  const commits = await sliceCommits(ctx, task)
  if (commits.length === 0) return null
  const listed = await ctx.git.run(task.repoRoot, [
    "show",
    "--name-only",
    "--format=",
    "-z",
    ...commits,
  ])
  if (listed.code !== 0) return null
  return [
    ...new Set(
      listed.stdout
        .split("\0")
        .map((p) => p.trim())
        .filter((p) => p !== "" && !p.startsWith("docs/plans/")),
    ),
  ]
}

/**
 * The paths that are the build's own: the files its tasks name and every file its own commits
 * changed. Null when the plan names none: nothing is then left out. A step that decides from these
 * ignores what another session saves or commits in the same checkout.
 */
export async function buildOwnPaths(ctx: Ctx, task: Task): Promise<string[] | null> {
  const planned = await plannedPaths(ctx, task)
  if (planned === null) return null
  const own = await ownCommitPaths(ctx, task)
  if (own !== null) return [...new Set([...planned, ...own])]
  // No recorded commits (a task from before they were recorded): every commit since the base.
  const base = await buildBase(ctx, task).catch(() => null)
  if (base === null) return null
  const committed = await ctx.git.run(task.repoRoot, ["diff", "--name-only", `${base}..HEAD`])
  if (committed.code !== 0) return null
  return [...new Set([...planned, ...committed.stdout.split("\n").filter((p) => p.trim() !== "")])]
}

/**
 * Includes every committed change since the base, and the staged, unstaged and new code of the files
 * the plan's tasks name; workflow records are bound separately. A commit is always this build's
 * word, wherever it lands (a review fix may touch a file no task named); work in progress outside
 * the plan's files may be another session's, and must not expire a run.
 */
export async function buildRevision(ctx: Ctx, task: Task): Promise<string> {
  if (task.stage === "verify" && (await hasReviewCandidate(ctx, task))) {
    const selected = await selectedReviewCandidate(ctx, task).catch(() => null)
    return digest(
      JSON.stringify(
        selected
          ? {
              candidate: selected.id,
              repository: selected.repo,
              checkout: selected.choice.checkout,
              head: selected.choice.head,
              plan: selected.plan,
            }
          : { staleReviewCandidate: task.repoId, task: task.slug },
      ),
    )
  }
  const fm = await readmeFrontmatter(ctx, task)
  if (typeof fm.base !== "string" || fm.base === "")
    throw new Error("No recorded build base; establish the task branch before verification")
  // Measured from where the build meets its main line now: a rebase onto a newer main, or a merge
  // of it, does not bring other people's commits into the build's revision.
  const base = await buildBase(ctx, task)
  if (base === null)
    throw new Error("The recorded build base is unavailable; restore it before verification")
  const named = await plannedPaths(ctx, task)
  const scope = named === null ? null : revisionPaths(task.repoRoot, named)
  const planned = scope?.local ?? null
  const external: [string, string][] = []
  for (const path of scope?.external ?? []) external.push([path, await fileRevision(ctx, path)])
  // The Cockpit asks on every refresh, and the diff below runs each file through its diff driver
  // (git-crypt's textconv): the revision is kept by what it was read from, and read again only
  // when any of that changed.
  const owned = (await committedOnly(ctx, task)) ? await ownedTree(ctx, task) : null
  const seen = await revisionInputs(ctx, task, base, planned, owned, external)
  const kept = revisions.get(ctx.git) ?? new Map<string, { seen: string; revision: string }>()
  revisions.set(ctx.git, kept)
  const saves = typeof task.runtimeDir === "string" && task.runtimeDir !== ""
  const known =
    kept.get(task.dir) ?? (seen !== null && saves ? await savedRevision(ctx, task) : undefined)
  if (seen !== null && known?.seen === seen) {
    kept.set(task.dir, known)
    return known.revision
  }
  const revision = await readRevision(ctx, task, base, planned, owned, external)
  if (seen !== null) {
    kept.set(task.dir, { seen, revision })
    if (saves && (await ctx.fs.exists(task.runtimeDir)))
      await ctx.fs
        .atomicWrite(savedRevisionPath(task), `${JSON.stringify({ seen, revision })}\n`)
        .catch(() => {})
  }
  return revision
}

/** The last revision of each task, with what it was read from. */
const revisions = new WeakMap<Ctx["git"], Map<string, { seen: string; revision: string }>>()

/**
 * The last revision is also saved beside the task's state: reading it diffs the whole build through
 * git-crypt's textconv, half a minute for an old task of a large repository, and a restarted App
 * (or the next command) would otherwise pay that again for the same inputs.
 */
const savedRevisionPath = (task: Pick<Task, "runtimeDir">) =>
  join(task.runtimeDir, "build-revision.json")
async function savedRevision(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<{ seen: string; revision: string } | undefined> {
  try {
    const saved = JSON.parse(await ctx.fs.readFile(savedRevisionPath(task)))
    return typeof saved?.seen === "string" && typeof saved?.revision === "string"
      ? { seen: saved.seen, revision: saved.revision }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Everything a build's revision is read from, cheaply: the base, HEAD, which planned files differ
 * from HEAD and how (git's own listing), and the content of each of those files and of each new
 * one. Null when git cannot say, and the revision is read in full.
 */
async function revisionInputs(
  ctx: Ctx,
  task: Task,
  base: string,
  planned: string[] | null,
  owned: OwnedTree | null,
  external: [string, string][],
): Promise<string | null> {
  if (await committedOnly(ctx, task))
    return digest(
      JSON.stringify({
        base,
        own: await sliceCommits(ctx, task),
        planned,
        ownedTree: owned?.current,
        ...(external.length === 0 ? {} : { external }),
      }),
    )
  const head = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])
  const raw =
    planned?.length === 0
      ? { code: 0, stdout: "" }
      : await ctx.git.run(task.repoRoot, [
          "diff",
          "--raw",
          "-z",
          "--abbrev=40",
          "HEAD",
          "--",
          ...(planned === null ? ["."] : planned.map((p) => `:(literal)${p}`)),
          ":(exclude)docs/plans/**",
        ])
  const fresh = await untrackedFiles(ctx, task.repoRoot)
  if (head.code !== 0 || raw.code !== 0 || fresh === null) return null
  const changed = raw.stdout.split("\0").filter((field) => field !== "" && !field.startsWith(":"))
  const added = fresh.filter(
    (p) => !p.startsWith("docs/plans/") && (planned === null || within(planned, p)),
  )
  const contents: [string, string][] = []
  for (const path of [...new Set([...changed, ...added])])
    contents.push([path, await fileRevision(ctx, join(task.repoRoot, path))])
  return digest(
    JSON.stringify({
      base,
      head: head.stdout,
      raw: raw.stdout,
      planned,
      contents,
      ...(external.length === 0 ? {} : { external }),
    }),
  )
}

/**
 * What the task's own commits changed, as text that stays the same when other commits land beside
 * them: blob ids and hunk line numbers are left out, since another session's commit to the same
 * file moves both without changing what this task wrote.
 */
async function ownCommitsDiff(ctx: Ctx, task: Task): Promise<{ code: number; stdout: string }> {
  const commits = await sliceCommits(ctx, task)
  const shown = await ctx.git.run(task.repoRoot, [
    "show",
    "--binary",
    "--no-textconv",
    "--format=%x00",
    ...commits,
    "--",
    ".",
    ":(exclude)docs/plans/**",
  ])
  return {
    code: shown.code,
    stdout: shown.stdout
      .split("\n")
      .filter((line) => !line.startsWith("index "))
      .map((line) => (line.startsWith("@@ ") ? line.replace(/^@@ [^@]* @@/, "@@") : line))
      .join("\n"),
  }
}

/** The steps after Implement, when every slice is committed. */
const AFTER_IMPLEMENT = new Set(["verify", "shipped"])

/**
 * After Implement, uncommitted work is not attributed to the finished task. Its recorded patches
 * and current committed owned-tree identity still bind a later manual change.
 */
async function committedOnly(ctx: Ctx, task: Task): Promise<boolean> {
  return AFTER_IMPLEMENT.has(task.stage) && (await sliceCommits(ctx, task)).length > 0
}

function revisionReadError(task: Task, committed: number, working: number): Error {
  const [operation, code] =
    committed !== 0
      ? ["git diff --binary <recorded-base> HEAD", committed]
      : working !== 0
        ? ["git diff --binary HEAD", working]
        : ["untracked file inventory (git ls-files --others --exclude-standard -z)", null]
  return new Error(
    `Cannot inspect the complete build diff in repository ${JSON.stringify(task.repoRoot.slice(0, 300))}: ${operation} failed${code === null ? "" : ` (exit ${code})`}. No build revision was recorded. Fix the Git failure in that checkout, then rerun qualitylayer next.`,
  )
}

/**
 * The revision itself: the task's own commits (every commit since the base when it recorded none),
 * the working diff of its planned files and its new files, digested. After Implement, recorded
 * patches and the committed owned tree bind the revision, without adopting other commits.
 */
async function readRevision(
  ctx: Ctx,
  task: Task,
  base: string,
  planned: string[] | null,
  owned: OwnedTree | null,
  external: [string, string][],
): Promise<string> {
  // A recorded commit git no longer has (a pruned rebase) falls back to the whole range.
  const own = (await sliceCommits(ctx, task)).length > 0 ? await ownCommitsDiff(ctx, task) : null
  if (own !== null && own.code === 0 && (await committedOnly(ctx, task)))
    return digest(
      JSON.stringify({
        base,
        own: own.stdout,
        ownedTree: owned?.current,
        ...(external.length === 0 ? {} : { external }),
      }),
    )
  const committed =
    own !== null && own.code === 0
      ? own
      : await ctx.git.run(task.repoRoot, [
          "diff",
          "--binary",
          base,
          "HEAD",
          "--",
          ".",
          ":(exclude)docs/plans/**",
        ])
  const working =
    planned?.length === 0
      ? { code: 0, stdout: "" }
      : await ctx.git.run(task.repoRoot, [
          "diff",
          "--binary",
          "HEAD",
          "--",
          ...(planned === null ? ["."] : planned.map((p) => `:(literal)${p}`)),
          ":(exclude)docs/plans/**",
        ])
  const diff = {
    code: committed.code !== 0 ? committed.code : working.code,
    stdout: `${committed.stdout}\0${working.stdout}`,
  }
  const fresh = await untrackedFiles(ctx, task.repoRoot)
  if (diff.code !== 0 || fresh === null) throw revisionReadError(task, committed.code, working.code)
  const files: [string, string][] = []
  for (const path of fresh.filter(
    (p) => !p.startsWith("docs/plans/") && (planned === null || within(planned, p)),
  )) {
    files.push([path, await fileRevision(ctx, join(task.repoRoot, path))])
  }
  return digest(
    JSON.stringify({
      base,
      diff: diff.stdout,
      files,
      ...(external.length === 0 ? {} : { external }),
    }),
  )
}

/**
 * Everything the gate on `target` asks the person to review and stamps as approved: the Plan's gate
 * approves the Plan (with its agents' file, `documentRevision`); any other target is one document. A
 * task started from an existing plan binds the original's digest beside it (`gateRevision`).
 */
export function reviewTargets(target: string, _task?: Pick<Task, "origin">): string[] {
  return target === folderDoc("plan") ? [...PLAN_GATE_DOCS] : [target]
}

/**
 * Fields QualityLayer's own bookkeeping writes after the Plan was approved. Where the questions are
 * answered (the App or a terminal) is set when a run starts: Approve & start in a terminal rewrites
 * it, and nothing the person approved depends on it. `startup_owner` is the session that started
 * the task, written once by the CLI. Builds before the fix counted both in a document's digest.
 */
const BOOKKEEPING = ["answers", "startup_owner"] as const

const STATE_FIELDS = new Set([
  ...ANSWER_MODE_FIELDS,
  // Where approvals happen is set like `answers`, by the person or a run start, never approved;
  // no build ever counted it, so it stays out of the older digest too.
  "approvals",
  ...APPROVAL_MODE_FIELDS,
  "status",
  "approved",
  "review_digest",
  "review_basis",
  "review_shape",
  "stage",
  "gate",
  "iterations",
  "base",
  "base_ref",
  "branch",
  "created",
  "shipped",
  "commits",
  "touched",
  "slices",
  // Whether the team sees the task is bookkeeping, not part of what the person approves.
  "shared",
  // Which files the folder holds is set once, when the task is created.
  "layout",
  // A visible change can turn up while the Plan is written; the flag then classifies the
  // task for the validator and must not expire the Plan's approval.
  "ui",
  // The scaling rules' switches are the user's words recorded by the CLI, not part of the Plan.
  "overrides",
  ...BOOKKEEPING,
])

/**
 * Changes to attached visuals count as changes to the document that approves them. A document
 * approved by a build that still counted `answers` and `startup_owner` keeps the digest it was
 * stamped with, so a task approved then is never refused when a newer build opens it: every value
 * derived from that digest (the Plan's basis, a judge's receipt, a check's proof) stays as it was.
 * `legacy` asks for that older digest outright.
 */
export async function documentRevision(
  ctx: Ctx,
  task: Task,
  name: string,
  legacy = false,
): Promise<string> {
  const path = join(task.dir, name)
  if (!(await ctx.fs.exists(path))) return "missing"
  const markdown = await ctx.fs.readFile(path)
  const { frontmatter, body } = parseDoc(markdown)
  const fieldsWithout = (skip: (key: string) => boolean) =>
    Object.entries(frontmatter ?? {})
      .filter(([key]) => !skip(key))
      .sort(([a], [b]) => a.localeCompare(b))
  const artifacts: [string, string][] = []
  for (const fence of extractFences(body)) {
    if (fence.kind !== "artifact") continue
    const parsed = artifactPath(fence)
    if (!("path" in parsed)) continue
    const file = join(task.dir, parsed.path)
    if (await ctx.fs.exists(file)) {
      artifacts.push([parsed.path, digest(await ctx.fs.readFile(file))])
      continue
    }
    artifacts.push([parsed.path, "missing"])
  }
  for (const marker of parseMarkers(body).markers) {
    const named = marker.name === "artifact" ? marker.args[0] : undefined
    // Existing bare-name approvals keep their recorded revision. New explicit/focused references
    // bind the complete registered source and dependencies, rather than silently following edits.
    if (!named || (!named.includes("/") && !named.includes("#"))) continue
    const reference = parseArtifactReference(named)
    if (!reference) continue
    const revision = await artifactReferenceRevision(
      ctx,
      { taskDir: task.dir, repoRoot: task.repoRoot },
      reference,
    ).catch(() => null)
    artifacts.push([named, revision ?? "unavailable"])
  }
  // A Plan shows each artifact's picture, linked in QualityLayer's own marker text, which the
  // digest leaves out: the approval binds the picture's bytes instead.
  if (name === folderDoc("plan"))
    for (const ref of planPictureRefs(markdown))
      artifacts.push([`picture:${ref}`, await planPictureDigest(ctx, task, ref)])
  // The step's agents' file is part of what the approval covers: later agents work from it, and an
  // edit to it after approval shows as a change, as an edit to the step file does.
  const role = roleOf(name)
  if (role !== null) {
    const agents = join(task.dir, agentFileOf(role))
    if (await ctx.fs.exists(agents))
      artifacts.push([`agents:${agentFileOf(role)}`, digest(await ctx.fs.readFile(agents))])
  }
  // Progress ticks do not rewrite the approved task contract; a block a later
  // stage added belongs to that stage's approval, not to this document's own. The
  // text QualityLayer writes between markers comes from the other documents and the answers: it
  // never expires an approval.
  const content = withoutMarkerText(withoutAdded(body))
  const digestOf = (skip: (key: string) => boolean) =>
    digest(JSON.stringify({ fields: fieldsWithout(skip), content, artifacts }))
  const legacyFields = () =>
    fieldsWithout(
      (key) => STATE_FIELDS.has(key) && !(BOOKKEEPING as readonly string[]).includes(key),
    )
  // The older digest, optionally as if `answers` still held the value it had when it was stamped.
  const olderWith = (answers: unknown) =>
    digest(
      JSON.stringify({
        fields: legacyFields().map(([key, value]) => [key, key === "answers" ? answers : value]),
        content,
        artifacts,
      }),
    )
  if (legacy) return olderWith(frontmatter?.answers)
  const current = digestOf((key) => STATE_FIELDS.has(key))
  const stamped = frontmatter?.review_digest
  // A build that counted `answers` also rewrote it after the approval (Copy prompt or a start in
  // the App flipped app/terminal): that stamp still describes the approved document.
  return typeof stamped === "string" &&
    stamped !== current &&
    [frontmatter?.answers, "app", "terminal"].some((answers) => stamped === olderWith(answers))
    ? stamped
    : current
}

/** A short fingerprint of everything a particular document gate asks the user to review. */
export async function gateRevision(
  ctx: Ctx,
  task: Task,
  target: string,
  legacy = false,
): Promise<string> {
  if (target === "final") {
    const log = implementAgentsPath(task)
    return digest(
      JSON.stringify({
        code: await buildRevision(ctx, task),
        plan: await gateRevision(ctx, task, folderDoc("plan")),
        added: await addedBy(ctx, task, [...PLAN_GATE_DOCS], "build"),
        deviations: parseNotes((await ctx.fs.exists(log)) ? await ctx.fs.readFile(log) : "")
          .filter((note) => note.kind !== "judged")
          .map(({ kind, task: card, text }) => ({ kind, task: card, text })),
      }),
    )
  }
  const values: unknown[] = []
  const names = reviewTargets(target, task)
  for (const name of names) values.push([name, await documentRevision(ctx, task, name, legacy)])
  // What the Plan's step added to its documents is approved with it.
  const added = target === folderDoc("plan") ? await addedBy(ctx, task, names, "plan") : []
  // The answers are written into their documents between markers, which a digest leaves out: the
  // approval binds what the person answered instead (an answer they change later is a new review).
  if (target === folderDoc("plan")) values.push(["answers", await answersDigest(ctx, task)])
  // An adopted task's Plan maps the person's original: the approval binds those exact bytes and the
  // digest its record holds, so a changed original (or record) is no longer what was approved.
  if (target === folderDoc("plan") && isAdopted(task))
    values.push([
      ORIGINAL_FILE,
      await originalDigest(ctx, task),
      (await readAdoption(ctx, task))?.original.sha256 ?? "unrecorded",
    ])
  return digest(JSON.stringify(added.length > 0 ? [...values, ["added", added]] : values))
}

/** Each answer given to a question of the task, by its id and the choice standing now. */
async function answersDigest(ctx: Ctx, task: Task, planning = true): Promise<[string, string][]> {
  const answers = planning
    ? await planningQuestionAnswers(ctx, task)
    : await answeredQuestions(ctx, task)
  return answers
    .filter((a) => a.reopened !== true && a.gate === undefined)
    .map((a): [string, string] => [a.id ?? String(a.number), a.choice])
}

/** The blocks a stage added to these documents, per document. */
async function addedBy(
  ctx: Ctx,
  task: Task,
  names: string[],
  stage: string,
): Promise<[string, string[]][]> {
  const added: [string, string[]][] = []
  for (const name of names) {
    const path = join(task.dir, name)
    if (!(await ctx.fs.exists(path))) continue
    const mine = addedBlocks(parseDoc(await ctx.fs.readFile(path)).body)
      .filter((b) => b.stage === stage)
      .map((b) => b.text)
    if (mine.length > 0) added.push([name, mine])
  }
  return added
}

/** Whether a recorded revision still describes the documents. */
export async function revisionMatches(
  ctx: Ctx,
  task: Task,
  target: string,
  recorded: string | undefined,
): Promise<boolean> {
  return recorded !== undefined && recorded === (await gateRevision(ctx, task, target))
}

/** Whether an existing Plan approval still binds the current Plan, including a legacy digest. */
export async function planApprovalMatches(
  ctx: Ctx,
  task: Task,
  recorded: string | undefined,
  revision?: string,
): Promise<boolean> {
  if (recorded === undefined) return false
  const target = folderDoc("plan")
  return (
    recorded === (revision ?? (await gateRevision(ctx, task, target))) ||
    recorded === (await gateRevision(ctx, task, target, true))
  )
}

/** What an approval records: the revision it binds. */
export async function approvalFields(
  ctx: Ctx,
  task: Task,
  name: string,
): Promise<{ review_basis: string }> {
  return { review_basis: await gateRevision(ctx, task, name) }
}

/**
 * The documents of the gate whose own approval stamp no longer matches them, in the gate's order.
 * Empty when each document still matches its stamp and the approval moved on what the gate also
 * binds (an answer, a block a stage added).
 */
export async function driftedDocuments(ctx: Ctx, task: Task, target: string): Promise<string[]> {
  const drifted: string[] = []
  for (const name of reviewTargets(target, task)) {
    const path = join(task.dir, name)
    if (!(await ctx.fs.exists(path))) continue
    const stamped = parseDoc(await ctx.fs.readFile(path)).frontmatter?.review_digest
    if (stamped !== (await documentRevision(ctx, task, name))) drifted.push(name)
  }
  // The original carries no stamp (it is never written to): it drifts when it no longer matches its record.
  if (target === folderDoc("plan") && isAdopted(task) && !(await originalIntact(ctx, task)))
    drifted.push(ORIGINAL_FILE)
  return drifted
}

/** Whether a document's recorded approval still describes it; an approval without a basis does not. */
export async function approvalCurrent(ctx: Ctx, task: Task, name: string): Promise<boolean> {
  const path = join(task.dir, name)
  if (!(await ctx.fs.exists(path))) return false
  const fm = parseDoc(await ctx.fs.readFile(path)).frontmatter
  if (fm?.approved !== true || typeof fm.review_basis !== "string") return false
  return revisionMatches(ctx, task, name, fm.review_basis)
}
