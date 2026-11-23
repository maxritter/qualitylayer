import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { addedBlocks, withoutAdded } from "../docs/added.ts"
import { implementAgentsPath, parseNotes } from "../docs/build-log.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { withoutMarkerText } from "../docs/markers.ts"
import { folderDoc } from "../docs/names.ts"
import { PLAN_GATE_DOCS } from "../docs/schema.ts"
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
import type { Task } from "../task/store.ts"
import { digest } from "./build-paths.ts"
import { buildRevision } from "./build-revision.ts"
import { documentArtifacts } from "./doc-artifacts.ts"

export {
  buildOwnPaths,
  evidenceFolder,
  evidenceRevision,
  fileRevision,
  uncommittedBuild,
  within,
} from "./build-paths.ts"
export { buildRevision } from "./build-revision.ts"

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
  const artifacts = await documentArtifacts(ctx, task, name, markdown, body)
  // Progress ticks do not rewrite the approved task contract; a block a later
  // stage added belongs to that stage's approval, not to this document's own. The
  // text QualityLayer writes between markers comes from the other documents and the answers: it
  // never expires an approval.
  const content = withoutMarkerText(withoutAdded(body))
  const legacyFields = fieldsWithout(
    (key) => STATE_FIELDS.has(key) && !(BOOKKEEPING as readonly string[]).includes(key),
  )
  const olderWith = (answers: unknown) =>
    digest(
      JSON.stringify({
        fields: legacyFields.map(([key, value]) => [key, key === "answers" ? answers : value]),
        content,
        artifacts,
      }),
    )
  if (legacy) return olderWith(frontmatter?.answers)
  const current = digest(
    JSON.stringify({ fields: fieldsWithout((key) => STATE_FIELDS.has(key)), content, artifacts }),
  )
  const stamped = frontmatter?.review_digest
  // A build that counted `answers` also rewrote it after the approval (Copy prompt or a start in
  // the App flipped app/terminal): that stamp still describes the approved document.
  const matchesLegacy =
    typeof stamped === "string" &&
    stamped !== current &&
    [frontmatter?.answers, "app", "terminal"].some((answers) => stamped === olderWith(answers))
  return matchesLegacy ? stamped : current
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
  const added = target === folderDoc("plan") ? await addedBy(ctx, task, names, "plan") : []
  if (target === folderDoc("plan")) values.push(["answers", await answersDigest(ctx, task)])
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
