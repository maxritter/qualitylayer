// The Review of a verified change as the Cockpit shows it, read from the task's own record: the
// frame's Done means with the proof the judge wrote for each, the results by kind, the pictures
// and the steps for the whole change, and the other agent's review.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { proofOf } from "../acceptance.ts"
import { includingAdded } from "../docs/added.ts"
import {
  type BuildLog,
  type Iteration,
  implementAgentsPath,
  lastIteration,
  sectionText,
  type Verdict,
} from "../docs/build-log.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { agentFileOf } from "../docs/names.ts"
import { evidenceIn as evidencePaths } from "../docs/outline.ts"
import { sectionRanges } from "../docs/rules/types.ts"
import { donePoints } from "../done-means.ts"
import { buildBase } from "../git/base.ts"
import { baseBranchRefusal, baseWhenOn } from "../git/branch.ts"
import { type Changes, changes, isPlanPath } from "../git/changes.ts"
import { currentBranch } from "../git/repo.ts"
import { movedEntries } from "../moved.ts"
import { roundVerdicts } from "../recheck.ts"
import { withPointVerdicts } from "../said.ts"
import { pullRequestState } from "../ship/choice.ts"
import {
  branchPushed,
  commandsFor,
  ghInstalled,
  pullRequestOf,
  wrongBranch,
} from "../ship/pull-request.ts"
import { type Task, taskDocPath } from "../task/store.ts"
import { taskFlow } from "../task-flow.ts"
import { trimEndWhile } from "../text-boundaries.ts"
import { parseFinalChecks } from "../timeline.ts"
import { itemId } from "../verdicts.ts"
import { changesByTask } from "./by-task.ts"
import { readRun } from "./cross.ts"
import { finalChecksText } from "./final-checks.ts"
import type {
  ApproveChoices,
  CodeHealth,
  DoneMeansView,
  PullRequestView,
  ResultKey,
  ResultTile,
  ReviewDetail,
} from "./summary.ts"
import { readReview } from "./threads.ts"

const IMAGE = /\.(png|jpe?g|gif|webp)$/i
const EVIDENCE = /^evidence\//

const evidenceIn = (text: string): string[] =>
  evidencePaths(text)
    .filter((p) => EVIDENCE.test(p))
    .map((p) => p.replace(EVIDENCE, ""))

/**
 * The points under the frame's `## Done means`, as every reader takes them (`donePoints`): each
 * `### <n>.` heading's number and outcome, and the sentence on how it shows.
 */
export function doneMeansOf(frame: string): { n: number; head: string; text: string }[] {
  return donePoints(sectionText(frame, "Done means")).map(({ n, outcome, how }) => ({
    n,
    head: outcome,
    text: how,
  }))
}

const KINDS: [ResultKey, string, string][] = [
  ["checks", "Checks", "check"],
  ["scenarios", "Scenarios", "scenario"],
  ["acceptance", "Done means", "acceptance"],
  ["done", "Definition of done", "dod"],
]

const passed = (v: Verdict) => v.verdict === "PASS" || v.verdict === "NOTE"

/** Words that name a verdict in a list: "scenario 2", "dod T5", "check". */
const labelOf = (v: Verdict) => (v.subject === "" ? v.kind : `${v.kind} ${v.subject}`)

function tilesOf(iteration: Iteration | null): ResultTile[] {
  // The Plan asks for no scenario and no card line: their tiles are listed when a reviewer wrote some.
  const kinds = KINDS.filter(
    ([, , kind]) =>
      (kind !== "scenario" && kind !== "dod") ||
      (iteration?.verdicts ?? []).some((v) => v.kind === kind),
  )
  return kinds.map(([key, label, kind]) => {
    const verdicts = (iteration?.verdicts ?? []).filter((v) => v.kind === kind)
    return {
      key,
      label,
      passed: verdicts.filter(passed).length,
      total: verdicts.length,
      lines: verdicts.map((v) => ({
        ok: passed(v),
        label: labelOf(v),
        text: v.text,
        evidence: evidenceIn(v.text),
      })),
    }
  })
}

/** The proof the judge wrote for a Done means, without the evidence paths it cites. */
const proofText = (text: string) =>
  trimEndWhile(
    text.replace(/(?<!\s)\s*(?:[—–-]\s*)?`(?:evidence|records)\/[^`]+`/g, ""),
    (character) => /[\s,;]/.test(character),
  ).trim()

function doneMeansViews(frame: string, verdicts: readonly Verdict[]): DoneMeansView[] {
  return doneMeansOf(frame).map((item) => {
    const verdict = verdicts.find((v) => v.kind === "done" && v.subject === String(item.n))
    return {
      ...item,
      proven: verdict !== undefined && passed(verdict),
      proof: verdict === undefined ? "" : proofText(verdict.text),
      evidence: verdict === undefined ? [] : evidenceIn(verdict.text),
    }
  })
}

/** A concept cell that says the change adds no module. */
const NO_MODULE = /^(n\/a|none|no new module|[-—–]+)$/i

/**
 * The rows of Implement's *Modules* table (`Concept · Lives in · Reuses`): each new module and its
 * line, the table's other cells joined.
 */
export function implementModules(cards: string): CodeHealth["modules"] {
  const range = sectionRanges(cards).find((r) => r.heading === "Modules")
  if (range === undefined) return []
  return cards
    .split(/\r?\n/)
    .slice(range.start, range.end - 1)
    .filter((line) => /^\s*\|/.test(line) && !/^\s*\|[\s:|-]+$/.test(line))
    .slice(1)
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .map((cells) => ({
      name: cells[1] ?? "",
      line: cells
        .slice(2, -1)
        .filter((cell) => cell !== "")
        .join(" · "),
    }))
    .filter((m) => m.name !== "" && !NO_MODULE.test(m.name))
}

/** The change's size without the plan's documents, and the new modules Implement's table names. */
async function codeHealthOf(ctx: Ctx, task: Task, diff: Changes): Promise<CodeHealth | null> {
  if (diff.base === null) return null
  const code = diff.files.filter((f) => !isPlanPath(f.path))
  // The modules of the code are in Implement's agents' file.
  const cardsPath = join(task.dir, agentFileOf("implement"))
  return {
    added: code.reduce((sum, f) => sum + f.additions, 0),
    removed: code.reduce((sum, f) => sum + f.deletions, 0),
    modules: (await ctx.fs.exists(cardsPath))
      ? implementModules(await ctx.fs.readFile(cardsPath))
      : [],
  }
}

/** The git-derived parts of Review, read with the diff after the task page has opened. */
export async function reviewChangesOf(
  ctx: Ctx,
  task: Task,
  diff: Changes,
): Promise<Pick<ReviewDetail, "codeHealth" | "byTask">> {
  const logPath = implementAgentsPath(task)
  return {
    codeHealth: await codeHealthOf(ctx, task, diff),
    byTask: await changesByTask(
      ctx,
      task,
      diff,
      (await taskFlow(ctx, task)).plan,
      (await ctx.fs.exists(logPath)) ? await ctx.fs.readFile(logPath) : "",
    ),
  }
}

/** What changed since the judge's round, when its record was read against a tree that had moved. */
async function movedInRound(ctx: Ctx, task: Task, round: number): Promise<ReviewDetail["moved"]> {
  const entry = (await movedEntries(ctx, task)).findLast((m) => m.iteration === round)
  return entry === undefined ? null : { exercised: entry.exercised, others: entry.others }
}

/** The three ways to approve: `gh` and the right branch decide the first; the third is the same push and pull request by hand. */
export async function approveChoices(
  ctx: Ctx,
  task: Task,
  branch: string | null,
): Promise<ApproveChoices> {
  const gh = ghInstalled(ctx)
  const commands = branch !== null ? await commandsFor(ctx, task, branch) : []
  // On the base branch there is no branch to open a pull request from, and Approve would push the base.
  const base = gh && branch !== null ? await baseWhenOn(ctx, task) : null
  const reason = !gh
    ? "gh is not installed here"
    : branch === null
      ? "The checkout is on no branch"
      : base !== null
        ? baseBranchRefusal(task, base).reason
        : wrongBranch(task, branch)
  return {
    pullRequest: { ok: reason === null, reason },
    branch,
    commands,
    text: commands.join("\n"),
    lastError: (await pullRequestState(ctx, task))?.error ?? null,
  }
}

/** The Review of a task a judge has passed; null before one has, and for a task with no plan to review. */
export async function reviewOf(
  ctx: Ctx,
  task: Task,
  log: BuildLog | null,
  evidence: string[],
  options: {
    withChanges?: boolean
    /** Where the pull request comes from; the App's server gives its cache, which never waits for `gh`. */
    pullRequest?: (ctx: Ctx, task: Task) => Promise<PullRequestView | null>
  } = {},
): Promise<ReviewDetail | null> {
  if (log === null) return null
  const iteration = lastIteration(log)
  if (iteration === null) return null
  // A last round that failed has no review: Verify ends with a question instead.
  if (iteration.result !== "pass") return null

  // The document Done means is written in: the Plan.
  const framePath = taskDocPath(task, "plan")
  const frame = (await ctx.fs.exists(framePath))
    ? includingAdded(parseDoc(await ctx.fs.readFile(framePath)).body)
    : ""
  const list = await proofOf(ctx, task)
  const checks = parseFinalChecks(await finalChecksText(ctx, task))
  const proofs = iteration.verdicts
    .filter((v) => passed(v) && ["scenario", "acceptance", "check"].includes(v.kind))
    .flatMap((v) =>
      evidenceIn(v.text)
        .filter((file) => !IMAGE.test(file) && evidence.includes(file))
        .map((file) => ({ file, title: labelOf(v), caption: proofText(v.text) })),
    )
  const second = await readRun(ctx, task, "verify")
  const pr = await (options.pullRequest ?? pullRequestOf)(ctx, task)
  const branch = await currentBranch(ctx, task.repoRoot)
  const changeView =
    options.withChanges === false
      ? {}
      : await reviewChangesOf(
          ctx,
          task,
          await changes(ctx, task.repoRoot, await buildBase(ctx, task)),
        )
  const openItems = iteration.verdicts
    .filter((v) => v.verdict === "FAIL" || v.verdict === "MISSING" || v.verdict === "NOTE")
    .map((v) => ({
      id: itemId(`${v.kind} ${v.subject}`) ?? v.kind,
      label: v.kind === "dod" ? `${v.subject} · definition of done` : labelOf(v),
      text: v.text,
    }))

  return {
    round: iteration.n,
    judge: iteration.judge,
    verified: iteration.result === "pass",
    ...(openItems.length > 0 ? { openItems } : {}),
    // A points Plan proves each Done means point from its steps: the result is derived, not written.
    doneMeans: doneMeansViews(
      frame,
      withPointVerdicts(list, await roundVerdicts(ctx, task, iteration)),
    ),
    tiles: tilesOf(iteration),
    pictures: iteration.pictures.map((p) => ({
      file: p.file.replace(EVIDENCE, ""),
      caption: p.caption,
    })),
    proofs,
    ...changeView,
    approve: await approveChoices(ctx, task, branch),
    moved: await movedInRound(ctx, task, iteration.n),
    second:
      second === null
        ? null
        : { name: second.name, state: second.state, findings: second.findings ?? null },
    tryIt:
      iteration.tryIt.length > 0
        ? iteration.tryIt
        : checks.tries.map((t) => ({
            text: [t.title, t.what].filter(Boolean).join(": "),
            command: t.command,
          })),
    notVerified: checks.notVerified,
    ...(await readReview(ctx, task)),
    pushed: await branchPushed(ctx, task),
    pr,
  }
}
