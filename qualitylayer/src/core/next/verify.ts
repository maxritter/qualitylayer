import { createHash } from "node:crypto"
import { join } from "node:path"
import { phaseText } from "#workflow"
import { type Ctx, err, ok, type Result, type ValidationError } from "../../ctx.ts"
import { leadInstructions } from "../../workflow/notice.ts"
import { type Helper, judgeHelper, qualityHelper, salt, withBriefFiles } from "../briefs.ts"
import { contextOf, readerPackage } from "../build-package.ts"
import {
  checksGap,
  checksRanSinceAsked,
  checksReadyForReview,
  latestRuns,
  noteChecksAsked,
  readCheckRecords,
} from "../checks.ts"
import { redactTaskRecords } from "../code-quality/scanners/redact.ts"
import { scanBrief } from "../code-quality/scanners/scan.ts"
import { candidateScans, readTaskScans, runTaskScans } from "../code-quality/scanners/task-scans.ts"
import { combinedSection, sourceReceipts } from "../combined-review.ts"
import { readConfig } from "../config.ts"
import {
  type BuildLog,
  type Iteration,
  lastIteration,
  readBuildRecord,
  verifyLogPath,
} from "../docs/build-log.ts"
import { agentFileOf, CHECKS_RECORD, LOGS } from "../docs/names.ts"
import { type JudgeShare, judgeShares } from "../docs/rules/judge-shares.ts"
import {
  acceptanceBasis,
  evidenceResolves,
  recordVerdictErrors,
} from "../docs/rules/verify-rules.ts"
import { withoutExemptNotes } from "../exempt-notes.ts"
import {
  ensureFinalReview,
  finalChatReview,
  type ReviewStanding,
  reopenVerify,
  reviewStanding,
} from "../gate/gate.ts"
import { buildRevision, fileRevision } from "../gate/revision.ts"
import { buildBase } from "../git/base.ts"
import { TaskReviewHistoryError, taskCommitDiff } from "../git/task-diff.ts"
import { staff } from "../helper-staff.ts"
import {
  helperLines,
  rememberHelperOffers,
  startHelpers,
  unfinishedQualityOffers,
} from "../helpers.ts"
import { environmentOnly, type ReleaseWait, releaseWaiting } from "../judge-environment.ts"
import { movedEntries, movedNote } from "../moved.ts"
import { openNeeds, readNeeds } from "../need/need.ts"
import { refreshPages } from "../pages/refresh.ts"
import {
  blockHeading,
  ensureQualitySection,
  nextQuality,
  nextQualityOf,
  passRoles,
  qualityRecordSlot,
  readQualityLog,
} from "../polish.ts"
import { commitOwnedRecords } from "../records-commit.ts"
import { requiredJudgeSection } from "../required-lines.ts"
import { crossReviewStep, handleOf, readRun, runCrossReview, startReview } from "../review/cross.ts"
import { settleDecisions } from "../review/triage.ts"
import {
  hasReviewCandidate,
  readReviewCandidates,
  selectedReviewCandidate,
  withReviewCandidateLock,
} from "../review-candidate.ts"
import { commitReviewerTests, reviewerTestsWord } from "../reviewer-tests.ts"
import { shellQuote } from "../shell.ts"
import { descriptionPath, ensureDraftDescription } from "../ship/closing-record.ts"
import { ensureVerifyLog } from "../task/reconcile.ts"
import {
  appendEvent,
  loadTask,
  patchReadme,
  readEvents,
  readmeFrontmatter,
  type Task,
} from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { type TaskFlow, taskFlow } from "../task-flow.ts"
import {
  type Assignment,
  acceptMovedVerification,
  assignmentCurrent,
  checkedWithoutIndependentJudge,
  codeDiff,
  evidenceFolder,
  finishVerification,
  judgedHeadWarning,
  lostEvidence,
  lostEvidenceWarnings,
  prepareJudgeAdmission,
  prepareVerification,
  readAssignment,
  recordWithoutIndependentJudge,
  stampVerification,
  verificationErrors,
} from "../verification.ts"
import { setAsideReplaced, setAsideStaleUnread } from "../verification-superseded.ts"
import { committedAreas, fixReply, notesOf, otherWork } from "./implement.ts"
import { refused } from "./refusal.ts"
import { agentsFields, at, base, flowFields, type NextPayload } from "./shared.ts"
import {
  type ExitReason,
  exitReply,
  openExit,
  pendingExit,
  takeAskedRound,
  takeKeptRed,
} from "./verify-exit.ts"
import { finalCheckGate, inFixRound, redCheckGate } from "./verify-final.ts"

export async function verifyPayload(
  ctx: Ctx,
  task: Task,
  errors?: ValidationError[],
  assignment?: Assignment,
  /** `verify judge` asked again while this round's judge is at work on unchanged code (`judgeAtWork`). */
  atWork?: { assignment: Assignment; helpers: string[] },
): Promise<NextPayload> {
  const recorded = errors === undefined ? null : lastIteration(await readBuildRecord(ctx, task))
  const n = recorded?.n ?? task.iterations + 1
  const since = await buildBase(ctx, task)
  // The other agent's review of the built change starts with the quality pass; one not started yet
  // starts beside the judge, and the final gate waits for it. One that is in was settled before.
  const step =
    assignment && !assignment.recovery ? await crossReviewStep(ctx, task, "verify") : null
  const started = step !== null ? await startReview(ctx, task, step) : null
  const review = started !== null && started.state !== "done" ? started : null
  const flow = await taskFlow(ctx, task)
  const outline = flow.plan
  // One judge; a build too large for one has several, each with a share. When their parts are
  // refused because a share has none, only the judges of those shares start again.
  const original = assignment ?? (await readAssignment(ctx, task))
  const assignedPlan = original?.iteration === n ? original.outline : undefined
  // A re-check after a fix round is one judge with the re-run brief.
  const shares =
    assignedPlan !== undefined
      ? judgeShares(assignedPlan, n)
      : outline !== null
        ? judgeShares(outline, n)
        : []
  const restart =
    assignment === undefined && errors !== undefined && shares.length > 0
      ? await unrecordedShares(ctx, task, n, shares)
      : null
  const judging = assignment ?? restart?.assignment
  const currentAssignment = judging ?? (original?.iteration === n ? original : undefined)
  const currentHead =
    currentAssignment?.source === null
      ? (await ctx.git.run(task.repoRoot, ["rev-parse", "--verify", "HEAD"])).stdout.trim()
      : undefined
  const wholeTree =
    currentAssignment?.source === null &&
    currentAssignment.iteration === n &&
    currentAssignment.head === currentHead
  const waitingAssignment =
    atWork?.assignment ?? (judging === undefined && wholeTree ? currentAssignment : undefined)
  const visibleAssignment = judging ?? waitingAssignment
  const ownedDiff = wholeTree
    ? null
    : await taskCommitDiff(
        ctx,
        task,
        judging?.source && judging.head ? { until: judging.head } : {},
      )
  const diff =
    ownedDiff?.command ??
    codeDiff(
      wholeTree
        ? shellQuote(since ?? "HEAD")
        : judging?.head !== undefined
          ? shellQuote(since !== null ? `${since}..${judging.head}` : judging.head)
          : since !== null
            ? shellQuote(since)
            : "HEAD",
      visibleAssignment?.recovery ? [] : await otherWork(ctx, task),
    )
  const instructions = judging
    ? phaseText("verify-judge")
    : atWork !== undefined
      ? `The fresh review already has assignment ${atWork.assignment.id}, and its helper ${atWork.helpers.join(", ")} is at work on this code. No second review was started. Continue available work while it runs. If the helper completed without recording its verdicts, follow up in that same context. If it has ended and cannot go on, run ${atWork.helpers.map((id) => `qualitylayer progress done --agent ${id}`).join(" and ")}; qualitylayer verify judge then hands out a new review.`
      : waitingAssignment !== undefined && errors === undefined
        ? `The fresh review already has assignment ${waitingAssignment.id} at ${waitingAssignment.head}. Continue available work while that review is pending. If its native helper completed without recording its verdicts, follow up in that same context; do not start another review merely because its report is not recorded yet.`
        : errors !== undefined
          ? ""
          : (phaseText(`verify-${task.type}`) ?? phaseText("verify"))
  const pkg = await readerPackage(ctx, "judge", task)
  const tag = salt(ctx)
  // The independent reviewer also adds the missing tests: its brief adds that half and the receipts
  // to reuse. Split into shares, the diff-wide share carries it, as it reads the whole change.
  const combinedBrief =
    flow.flow.combinedReview === true && !judging?.recovery
      ? combinedSection(task.repoRoot, await sourceReceipts(ctx, task))
      : null
  // The judge also reads what the build session recorded for Verify's required lines.
  const required = await requiredJudgeSection(ctx, task)
  const serviceNeeds =
    judging?.after === undefined
      ? []
      : openNeeds(await readNeeds(ctx, task)).filter(
          (need) => need.kind === "service" && /^T[0-9]+$/.test(need.for),
        )
  const services = serviceNeeds.length
    ? `## Outstanding service needs\n\n${serviceNeeds
        .map((need) =>
          need.state === "set"
            ? `- ${need.for}: reported restored; verify availability before rerunning its step.`
            : `- ${need.for}: open service need; compare it with the previous verdict and evidence.`,
        )
        .join("\n")}`
    : null
  // And which checks' results are a clean copy's, so files that were left out fail no point.
  const cleanCopy = await cleanCopyNote(ctx, task)
  const withRequired = (helper: Helper): Helper => ({
    ...helper,
    brief: [helper.brief, required, cleanCopy, services]
      .filter((part) => part !== null)
      .join("\n\n"),
  })
  const withCombined = (helper: Helper): Helper =>
    withRequired(
      combinedBrief === null ? helper : { ...helper, brief: `${helper.brief}\n\n${combinedBrief}` },
    )
  const judgeBriefs = (given: Assignment): Helper[] =>
    shares.length === 0
      ? [
          withCombined(
            judgeHelper(task, n, since, diff, pkg, given, {
              progress: `j${n}-${tag}`,
            }),
          ),
        ]
      : (restart?.shares ?? shares).map((share) => {
          const helper = judgeHelper(task, n, since, diff, pkg, given, {
            progress: `j${n}-s${share.n}-${tag}`,
            share,
          })
          return share.kind === "diff" ? withCombined(helper) : withRequired(helper)
        })
  // The whole change still gets the configured judge, including a light task. Staffing uses the
  // helpers' model only for split acceptance shares. A recheck after a pass uses medium effort.
  const after = judging?.after
  const afterPass =
    after !== undefined &&
    (await readBuildRecord(ctx, task)).verification.find((round) => round.n === after.iteration)
      ?.result === "pass"
  const briefs = judging === undefined ? [] : judgeBriefs(judging)
  const judged = await staff(
    ctx,
    afterPass ? briefs.map((helper) => ({ ...helper, effort: "medium" })) : briefs,
  )
  await startHelpers(ctx, task, judged.on)
  const why = [
    judged.off,
    instructions ?? "",
    // The session reads it too, where it is not already in the helper's brief.
    judging === undefined && errors === undefined ? (cleanCopy ?? "") : "",
  ]
    .filter((part) => part !== "")
    .join("\n\n")
  return base(task, {
    phase: "verify",
    instructions: why,
    // Asked again while the reviewer works: nothing new started.
    ...(atWork !== undefined ? { already: true } : {}),
    ...(review !== null ? { reviews: [handleOf(task, review)] } : {}),
    iteration: n,
    record_as: `### Iteration ${n}`,
    record_in: verifyLogPath(task),
    evidence: evidenceFolder(task),
    ...(visibleAssignment
      ? {
          assignment: visibleAssignment.id,
          revision: visibleAssignment.revision,
          ...(judged.on.length === 1 ? { helper: judged.on[0] } : {}),
          ...(judged.on.length > 1 ? { helpers: judged.on } : {}),
        }
      : {}),
    ...flowFields(flow),
    context: await contextOf(ctx, "coordinator", task),
    // The same verb reads the reviewer's verdicts once they are recorded, and corrects a refused record.
    then: "qualitylayer verify judge",
    ...(errors !== undefined ? { errors } : {}),
    ...(errors?.some((e) => e.severity === "error") ? { message: refusalOf(errors) } : {}),
  })
}

/**
 * The project checks whose standing result is a run on a clean copy (HEAD plus the task's own
 * files, after the command failed in the checkout), with the files that copy left out; null when
 * none is. The judge's brief and the Verify reply carry it, so the recorded run is read as the
 * check's result and no point fails as "environment" for a file that is not the task's.
 */
async function cleanCopyNote(ctx: Ctx, task: Task): Promise<string | null> {
  const runs = latestRuns(await readCheckRecords(ctx, task)).filter(
    (run) => run.scope === "all" && run.leftOut !== undefined && run.exit === 0 && !run.notRun,
  )
  if (runs.length === 0) return null
  const files = [...new Set(runs.flatMap((run) => run.leftOut ?? []))]
  const shown = `${files.slice(0, 8).join(", ")}${files.length > 8 ? ", …" : ""}`
  return [
    "## Checks that passed on a clean copy",
    "",
    `${runs.map((run) => `\`${run.command}\``).join(", ")} failed in the checkout and passed on a copy of HEAD plus this task's own files. Its log keeps both outputs. Read the result in \`${CHECKS_RECORD}\`, or under \`## Checks\` in \`${agentFileOf("implement")}\` for an earlier run.`,
    "",
    `Left out: ${files.length} file${files.length === 1 ? "" : "s"} that ${files.length === 1 ? "is" : "are"} not this task's (${shown}): another session's uncommitted work, or untracked files no session of this task wrote. They are still in the checkout, and a command run there can fail on them. Such a failure is no finding against this task and no \`environment:\` failure: cite the recorded run for the check, and judge the task's own code.`,
  ].join("\n")
}

/** How many of a refused record's errors its message names; `errors` holds them all. */
const NAMED_ERRORS = 3

/** A refused record's message: the count, and the first errors with their line, rule and fix. */
function refusalOf(errors: ValidationError[]): string {
  const blocking = errors.filter((e) => e.severity === "error")
  const named = blocking
    .slice(0, NAMED_ERRORS)
    .map((e) => `line ${e.line} [${e.rule}] ${e.message} (fix: ${e.fix_hint})`)
  const rest = blocking.length - named.length
  return `Cannot read the judge's record: ${blocking.length} error(s). ${named.join("; ")}${rest > 0 ? `; ${rest} more under \`errors\`` : ""}. Correct them in the Verify record before continuing. No new iteration has started.`
}

/** The shares of the current verification round whose judges recorded no part: they start again. */
async function unrecordedShares(
  ctx: Ctx,
  task: Task,
  n: number,
  shares: JudgeShare[],
): Promise<{ assignment: Assignment; shares: JudgeShare[] } | null> {
  const assignment = await readAssignment(ctx, task)
  const iteration = lastIteration(await readBuildRecord(ctx, task))
  if (assignment === null || iteration?.n !== n || iteration.assignment !== assignment.id)
    return null
  const open = shares.filter((share) => !iteration.parts?.some((part) => part.share === share.n))
  return open.length > 0 ? { assignment, shares: open } : null
}

/**
 * The quality pass's next move. The first reply of the pass also starts the second opinion of a
 * risky change, so its findings are in, and fixed, before the one judge rules (`secondOpinionFirst`).
 */
export async function qualityReply(ctx: Ctx, task: Task): Promise<NextPayload | null> {
  const reply = await qualityStep(ctx, task)
  if (
    reply === null ||
    reply.phase !== "verify" ||
    reply.quality_dispatch_wait === true ||
    (await readRun(ctx, task, "verify")) !== null
  )
    return reply
  const step = await crossReviewStep(ctx, task, "verify")
  if (step === null) return reply
  const run = await startReview(ctx, task, step)
  return { ...reply, reviews: [handleOf(task, run)] }
}

/** The security review's next move: its helper, the fix of what it found, or nothing (the judge). */
async function qualityStep(ctx: Ctx, task: Task): Promise<NextPayload | null> {
  await ctx.fs.mkdir(task.runtimeDir)
  return ctx.fs.withLock(join(task.runtimeDir, "quality-dispatch.lock"), async () => {
    const commonDir = await ctx.git.commonDir(task.repoRoot)
    if (commonDir === null) throw new Error("The quality dispatch repository is unavailable")
    const current = await loadTask(
      ctx,
      { root: task.repoRoot, id: task.repoId, commonDir },
      task.slug,
    )
    if (current === null) throw new Error("The quality dispatch task is unavailable")
    return current.stage === "verify"
      ? qualityStepWithin(ctx, current)
      : base(current, { phase: current.stage, then: "qualitylayer next" })
    // (The task left Verify meanwhile: `next` names the moves of the stage it is in now.)
  })
}

async function pendingQualityReply(
  ctx: Ctx,
  task: Task,
  flow: TaskFlow,
  key: string,
): Promise<NextPayload | null> {
  const outstanding = await unfinishedQualityOffers(ctx, task)
  if (outstanding.length === 0) return null
  let previous: { key?: string; ids?: string[] } = {}
  try {
    const saved = JSON.parse(await ctx.fs.readFile(join(task.runtimeDir, "quality-offers.json")))
    previous = saved !== null && typeof saved === "object" && !Array.isArray(saved) ? saved : {}
  } catch {
    /* old dispatch */
  }
  const same =
    previous.key === key &&
    Array.isArray(previous.ids) &&
    outstanding.every((helper) => previous.ids?.includes(helper.id ?? ""))
  return base(task, {
    phase: "verify",
    quality_step: outstanding.map((helper) => helper.role),
    ...(same && outstanding.length === 1 ? { helper: outstanding[0] } : {}),
    ...(same && outstanding.length > 1 ? { helpers: outstanding } : {}),
    helpers_pending: outstanding,
    already_offered: outstanding.map((helper) => helper.id),
    record_as: outstanding
      .map((helper) => `### ${blockHeading(helper.role as "security")}`)
      .join(" and "),
    record_in: verifyLogPath(task),
    ...flowFields(flow),
    then: "qualitylayer verify judge",
  })
}

async function qualityStepWithin(ctx: Ctx, task: Task): Promise<NextPayload | null> {
  const flow = await taskFlow(ctx, task)
  const roles = passRoles(flow.flow)
  const cursor = await nextQuality(ctx, task, roles)
  if (cursor.kind === "judge") return null
  await ensureQualitySection(ctx, task)
  if (cursor.kind === "fix")
    return base(task, {
      phase: "verify",
      quality_step: "fix",
      open_items: cursor.items.map(({ id, severity, text }) => ({ id, severity, text })),
      record_in: verifyLogPath(task),
      instructions: phaseText("verify"),
      ...flowFields(flow),
      then: "qualitylayer verify judge",
    })
  const dispatchPath = join(task.runtimeDir, "quality-offers.json")
  const revision = await buildRevision(ctx, task)
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        revision,
        plan: await fileRevision(ctx, at(task, "plan")),
        cards: await fileRevision(ctx, join(task.dir, agentFileOf("implement"))),
        iteration: task.iterations,
        recheck: cursor.recheck ?? null,
      }),
    )
    .digest("hex")
  const pending = await pendingQualityReply(ctx, task, flow, key)
  if (pending !== null) return pending
  const since = await buildBase(ctx, task)
  // The build's commits, not the working copy: another session's unsaved files are not this change.
  const leaveOut = await otherWork(ctx, task)
  const owned = await taskCommitDiff(ctx, task)
  const diff =
    owned?.command ?? codeDiff(since !== null ? `${shellQuote(since)}..HEAD` : "HEAD", leaveOut)
  const areas = since !== null ? await committedAreas(ctx, task, since, leaveOut) : []
  const recheck = cursor.recheck !== undefined
  // The scans' findings are the review's first candidates; scans of this HEAD are reused, else run now (seconds).
  const head = (await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])).stdout.trim()
  const kept = await readTaskScans(ctx, task)
  const scans = kept !== null && kept.head === head ? kept : await runTaskScans(ctx, task)
  const brief = qualityHelper(
    task,
    {
      base: since,
      diff,
      pkg: await readerPackage(ctx, "security", task),
      id: `q-security-${salt(ctx)}`,
    },
    {
      inline: [
        `**Trust boundary:** ${flow.signals.trustBoundary ?? "not stated"}`,
        ...(flow.flow.agentControls?.length
          ? [`**Agent controls changed:** ${flow.flow.agentControls.slice(0, 12).join(", ")}`]
          : []),
        scanBrief(scans),
      ]
        .filter(Boolean)
        .join("\n\n"),
      recheck: cursor.recheck ?? [],
      areas,
      recordSlot: qualityRecordSlot(await readQualityLog(ctx, task), recheck),
    },
  )
  const staffed = await staff(ctx, [brief])
  const filed = await withBriefFiles(ctx, task, staffed.on)
  const currentStage = (await readmeFrontmatter(ctx, task)).stage
  if ((await buildRevision(ctx, task)) !== revision || currentStage !== "verify")
    return base(task, {
      phase: typeof currentStage === "string" ? currentStage : "verify",
      quality_dispatch_wait: true,
      then: "qualitylayer verify judge",
    })
  await startHelpers(ctx, task, filed)
  await rememberHelperOffers(ctx, task, filed)
  await ctx.fs.atomicWrite(
    dispatchPath,
    `${JSON.stringify({ key, ids: filed.map((helper) => helper.id) })}\n`,
  )
  return base(task, {
    phase: "verify",
    quality_step: cursor.roles,
    instructions: [staffed.off, phaseText("verify")]
      .filter((part) => part !== "" && part !== undefined)
      .join("\n\n"),
    ...(filed.length === 1 ? { helper: filed[0] } : {}),
    record_as: recheck ? "### Security re-check" : "### Security",
    record_in: verifyLogPath(task),
    ...flowFields(flow),
    then: "qualitylayer verify judge",
  })
}

/** The project checks are not recorded for the current source: the command that records them. */
export async function checksFirst(ctx: Ctx, task: Task): Promise<NextPayload> {
  const why = await checksGap(ctx, task)
  await noteChecksAsked(ctx, task)
  return base(task, {
    phase: "verify",
    command: "qualitylayer check all",
    message: `No project check is recorded for the current source${why === null ? "." : `: ${why}`}`,
    ...flowFields(await taskFlow(ctx, task)),
    then: "qualitylayer verify judge",
  })
}

/** The release wait as a reply: what to do and the command after it. */
export const releaseReply = ({ instructions, then }: ReleaseWait) => ({ instructions, then })

/**
 * The reply with the runs this call accepted on a moved tree: what changed, and the words that
 * tell the build session to judge whether the run needs repeating.
 */
export async function withMoved(
  ctx: Ctx,
  task: Task,
  before: number,
  payload: NextPayload,
): Promise<NextPayload> {
  const fresh = (await movedEntries(ctx, task)).slice(before)
  if (fresh.length === 0) return payload
  const note = movedNote(fresh)
  return {
    ...payload,
    moved: fresh,
    instructions:
      typeof payload.instructions === "string"
        ? leadInstructions(payload.instructions, note)
        : note,
  }
}

/** A warning line after the reply's instructions (the move comes first), kept in `warnings` too. */
function warned(payload: NextPayload, warning: string | null): NextPayload {
  if (warning === null) return payload
  return {
    ...payload,
    warnings: [...((payload.warnings as string[]) ?? []), warning],
    instructions: `${String(payload.instructions ?? "")}\n\n${warning}`,
  }
}

type Inspected = {
  records: BuildLog
  recordErrors: ValidationError[]
  pendingErrors: ValidationError[]
}

/** The Verify record as it stands: every recorded verdict's errors, and the unread round's own. */
async function inspectRecord(ctx: Ctx, task: Task): Promise<Inspected> {
  let records = await readBuildRecord(ctx, task)
  let pending = lastIteration(records)
  const assignment = pending?.n === task.iterations + 1 ? await readAssignment(ctx, task) : null
  if (
    pending !== null &&
    assignment !== null &&
    assignment.id === pending.assignment &&
    assignment.iteration === pending.n &&
    (await stampVerification(ctx, task, pending, assignment))
  ) {
    records = await readBuildRecord(ctx, task)
    pending = lastIteration(records)
  }
  const { recordErrors, pendingErrors } = await recordErrorsOf(ctx, task, records)
  return { records, recordErrors, pendingErrors }
}

/**
 * Every error `next` refuses a Verify record for: each recorded verdict's, each unread round's
 * cited files, and the unread round's own (its assignment, its shares, its proof). `next` and the
 * judges' `validate` both ask here, so a record that validates is not refused when it is read.
 */
async function recordErrorsOf(
  ctx: Ctx,
  task: Task,
  records: BuildLog,
): Promise<{ recordErrors: ValidationError[]; pendingErrors: ValidationError[] }> {
  const pending = lastIteration(records)
  const plan = (await taskFlow(ctx, task)).plan
  const recordErrors = await recordVerdictErrors(
    ctx,
    task.runtimeDir,
    plan,
    records.verification,
    await acceptanceBasis(ctx, task.dir),
  )
  // Only a round not yet read is held to its files. A counted round was read when they were there
  // and cannot be edited; a file it cites that is gone is a warning (`lostEvidenceWarnings`).
  for (const iteration of records.verification.filter((i) => i.n > task.iterations))
    recordErrors.push(
      ...(await evidenceResolves(iteration, async (path) => {
        try {
          return (await ctx.fs.readFile(join(task.dir, path))).length > 0
        } catch {
          return false
        }
      })),
    )
  const pendingErrors =
    pending !== null && pending.n > task.iterations
      ? await verificationErrors(ctx, task, pending, plan)
      : []
  for (const error of pendingErrors)
    if (
      !recordErrors.some(
        (e) => e.line === error.line && e.rule === error.rule && e.message === error.message,
      )
    )
      recordErrors.push(error)
  return { recordErrors, pendingErrors }
}

/** The Verify record's errors as `next` would refuse it for now; reads only, stamps nothing. */
export async function verifyRecordErrors(ctx: Ctx, task: Task): Promise<ValidationError[]> {
  return (await recordErrorsOf(ctx, task, await readBuildRecord(ctx, task))).recordErrors
}

/**
 * The record after `verify judge` set aside an unread block whose inputs are obsolete: a malformed
 * record of current inputs stays with its judge for correction.
 */
async function currentRecord(ctx: Ctx, task: Task, control: string): Promise<Inspected> {
  // A replaced judge's late block is set aside whoever asks: it cannot be read, and it hides the
  // current judge's block when it is the last one written.
  await setAsideReplaced(ctx, task)
  const inspected = await inspectRecord(ctx, task)
  const unreadFrom = inspected.records.verification
    .filter((i) => i.n > task.iterations)
    .reduce<number>((first, i) => Math.min(first, i.line), Number.POSITIVE_INFINITY)
  const stale = inspected.recordErrors.some(
    (e) => e.severity === "error" && (e.line >= unreadFrom || e.rule.startsWith("verification-")),
  )
  if (control === "judge" && stale && (await setAsideStaleUnread(ctx, task)).length > 0)
    return inspectRecord(ctx, task)
  return inspected
}

/** `verify judge` may replace a single unmatched block whose only error is its assignment. */
async function explicitReassignment(
  ctx: Ctx,
  task: Task,
  control: string,
  { records, recordErrors }: Inspected,
): Promise<boolean> {
  const unmatched = records.verification.filter((iteration) => iteration.n > task.iterations)
  const unbound = unmatched[0]
  const onlyAssignmentError =
    recordErrors.length === 1 &&
    recordErrors[0]?.severity === "error" &&
    recordErrors[0].rule === "verification-assignment"
  if (control !== "judge" || unmatched.length !== 1 || !onlyAssignmentError) return false
  if (unbound?.n !== task.iterations + 1 || unbound.parts !== undefined) return false
  if (typeof unbound.assignment !== "string" || !/^[A-Za-z0-9-]+$/.test(unbound.assignment))
    return false
  return (
    (await readConfig(ctx)).independentReview.enabled &&
    (await helperLines(ctx, task)).every((helper) => helper.done)
  )
}

/**
 * With Independent review off in Settings, Verify records the change as checked without one; what
 * only the person can unblock ends Verify with its question instead.
 */
async function withoutIndependentReview(ctx: Ctx, task: Task): Promise<Result<NextPayload>> {
  const ready = await checksReadyForReview(ctx, task)
  if (!ready && !(await checksRanSinceAsked(ctx, task))) return ok(await checksFirst(ctx, task))
  // Runs that stand as recorded count as they ended: a red one keeps the page from the person.
  const final = await redCheckGate(ctx, task, !ready)
  if (final !== null) return final
  const release = await releaseWaiting(ctx, task)
  if (release !== null && !release.exhausted)
    return ok(base(task, { phase: "verify", ...releaseReply(release) }))
  if (release !== null) return ok(await openExit(ctx, task, "release_wait", { fixable: false }))
  if (openNeeds(await readNeeds(ctx, task)).length > 0)
    return ok(await openExit(ctx, task, "person_needed", { fixable: false }))
  const step = await crossReviewStep(ctx, task, "verify")
  const run = step !== null ? await startReview(ctx, task, step) : null
  await recordWithoutIndependentJudge(ctx, task)
  // Checked without an independent judge: the mode is read from this record (verifyModeOf).
  await appendEvent(ctx, task, {
    event: "verify_result",
    passed: true,
    budgeted: false,
    iteration: task.iterations,
    judge: null,
    independent: false,
  })
  const payload = await toThePerson(ctx, task, (await taskFlow(ctx, task)).flow.light === true)
  return ok(run === null ? payload : { ...payload, reviews: [handleOf(task, run)] })
}

/** A judge's verdicts written and still current, which `next` reads instead of assigning anew. */
function verdictsWaiting(task: Task, { records, pendingErrors }: Inspected): boolean {
  const unread = lastIteration(records)
  return (
    unread !== null &&
    unread.n > task.iterations &&
    !pendingErrors.some((e) =>
      ["verification-current", "verification-assignment", "verification-context"].includes(e.rule),
    )
  )
}

/**
 * This round's judge when the evidence says it is at work: its assignment is open and nothing of
 * it is in the record yet, the code, Plan and deviations are as it was handed them, and a helper
 * of the round reported a line and has not said it ended. Evidence, not time: a helper that never
 * reported shows no sign it started, and one that ended is said so (`progress <id> done`, the
 * agent's own move for a judge that died), so replacing a dead or stopped judge keeps working.
 */
async function judgeAtWork(
  ctx: Ctx,
  task: Task,
  /** Also a helper that was handed out and has not reported yet (plain `next` never replaces one). */
  handedOut = false,
): Promise<{ assignment: Assignment; helpers: string[] } | null> {
  const n = task.iterations + 1
  const assignment = await readAssignment(ctx, task)
  if (assignment === null || assignment.iteration !== n || assignment.result !== undefined)
    return null
  const record = await readBuildRecord(ctx, task)
  if (record.verification.some((iteration) => iteration.assignment === assignment.id)) return null
  const helpers = (await helperLines(ctx, task))
    .filter(
      (helper) =>
        helper.id.startsWith(`j${n}-`) && (handedOut || helper.at !== null) && !helper.done,
    )
    .map((helper) => helper.id)
  if (helpers.length === 0 || !(await assignmentCurrent(ctx, task, assignment))) return null
  return { assignment, helpers }
}

/**
 * The same admission rule and recovery reply apply before Security and before assignment.
 */
async function judgeAdmission(
  ctx: Ctx,
  task: Task,
): Promise<Result<Awaited<ReturnType<typeof prepareJudgeAdmission>>>> {
  try {
    return ok(await prepareJudgeAdmission(ctx, task))
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return err({
      code: "state_mismatch",
      message,
      stored: task.stage,
      found: message,
      fix: "Run qualitylayer doctor --json in the task checkout to inspect its recorded branch and receipts. If a receipt belongs to one slice and its exact replacement is on HEAD, register it with qualitylayer commit slice <n> --commit <fullsha>. Keep shared receipts. If the recorded history cannot be reconciled, keep the independent review evidence outside QualityLayer until the task's source authority is recovered.",
    })
  }
}

/**
 * The checks first, then the judge: a red check is its evidence. `verify judge` assigns it; the
 * brief says what comes. A release wait comes before both.
 */
async function assignJudge(
  ctx: Ctx,
  task: Task,
  control: string,
  pendingErrors: ValidationError[],
): Promise<Result<NextPayload>> {
  const release = await releaseWaiting(ctx, task)
  if (release?.exhausted === true) {
    if (!(await checksReadyForReview(ctx, task)) && !(await checksRanSinceAsked(ctx, task)))
      return ok(await checksFirst(ctx, task))
    return ok(await openExit(ctx, task, "release_wait", { fixable: false }))
  }
  if (release !== null) return ok(base(task, { phase: "verify", ...releaseReply(release) }))
  const admission = await judgeAdmission(ctx, task)
  if (!admission.ok) return admission
  // A fix round's re-judgement, and the recheck of a change made after a pass, do not wait for
  // `check all`: the agent ran the focused checks for its change, and the project checks run once
  // on the final source (finalCheckGate).
  const last = lastIteration(await readBuildRecord(ctx, task))
  const afterPass = last?.result === "pass" && last.n === task.iterations
  if (
    !afterPass &&
    !(await inFixRound(ctx, task)) &&
    !(await checksReadyForReview(ctx, task)) &&
    !(await checksRanSinceAsked(ctx, task))
  )
    return ok(await checksFirst(ctx, task))
  const errors = pendingErrors.length > 0 ? pendingErrors : undefined
  // Only `verify judge` (or `verify recheck`) hands a reviewer out: the brief says what comes, and
  // a fix round stays the agent's until it asks for the recheck.
  if (control !== "judge") return ok(await verifyPayload(ctx, task, errors))
  // Asked again while this round's judge is at work on unchanged code: no second reviewer starts,
  // and its assignment and receipt stay as they are. A helper handed out and not reporting yet
  // counts as at work: asking again never replaces it.
  const atWork = errors === undefined ? await judgeAtWork(ctx, task, true) : null
  if (atWork !== null) return ok(await verifyPayload(ctx, task, undefined, undefined, atWork))
  const assignment = await prepareVerification(ctx, task, admission.data)
  if (!assignment.ok) return assignment
  return ok(await verifyPayload(ctx, task, errors, assignment.data))
}

/**
 * Records a judged round: a failure's result in the task's events (the record the fix rounds are
 * counted from, written once per round before the counter moves), and the round counted. A pass is
 * recorded by `recordPass` once nothing holds the page from the person: its record turns Verify's
 * mode to `yours`, which a page still held by the final checks must not show.
 */
async function countRound(
  ctx: Ctx,
  task: Task,
  iteration: Iteration,
): Promise<{ counted: Task; passed: boolean; blocked: boolean }> {
  const passed = iteration.result === "pass"
  const blocked = environmentOnly(iteration)
  await finishVerification(ctx, task, iteration)
  // A failure is one judgement, an environment block none.
  if (!passed) await recordResult(ctx, task, iteration, false, !blocked)
  await patchReadme(ctx, task, { iterations: iteration.n })
  return { counted: { ...task, iterations: iteration.n }, passed, blocked }
}

/** A round's result in the task's events, once per round. */
async function recordResult(
  ctx: Ctx,
  task: Task,
  iteration: Iteration,
  passed: boolean,
  budgeted: boolean,
): Promise<void> {
  if (
    (await readEvents(ctx, task)).some(
      (event) => event.event === "verify_result" && event.iteration === iteration.n,
    )
  )
    return
  await appendEvent(ctx, task, {
    event: "verify_result",
    passed,
    budgeted,
    iteration: iteration.n,
    judge: iteration.judge,
  })
}

/**
 * Why a counted round ends Verify with a question instead of going on, or null when it goes on:
 * a failing environment, a timed-out check, or something only the person can do.
 */
async function exitOf(
  ctx: Ctx,
  counted: Task,
  round: { passed: boolean; blocked: boolean; iteration: Iteration },
): Promise<Exclude<ExitReason, "fix_cap"> | null> {
  if (round.blocked) return "environment"
  const failed = round.iteration.verdicts.filter(
    (v) => v.verdict === "FAIL" || v.verdict === "MISSING",
  )
  if (!round.passed && failed.length > 0 && failed.every((v) => v.kind === "check")) {
    const revision = await buildRevision(ctx, counted)
    if ((await readCheckRecords(ctx, counted)).some((r) => r.revision === revision && r.timedOut))
      return "check_budget"
  }
  if (round.passed && openNeeds(await readNeeds(ctx, counted)).length > 0) return "person_needed"
  return null
}

/**
 * The pass is counted and stands: Verify turns to the person. The final gate opens (its record says
 * `verify_ready`), the description is prepared with Your review's text, and the decisions the author
 * agreed in the review are settled.
 */
async function toThePerson(ctx: Ctx, task: Task, commitRecords: boolean): Promise<NextPayload> {
  await settleDecisions(ctx, task)
  // A small change's records are committed once, here, after the pass is counted: a commit
  // between `check all` and `verify judge` would make their receipts stale.
  if (commitRecords)
    await commitOwnedRecords(ctx, task, `docs(plan): record ${task.slug}'s verification`)
  await ensureFinalReview(ctx, task)
  return finalPayload(ctx, task)
}

/**
 * Your review's reply: the description (`03-verify.md`, the pull request body) with its generated
 * sections current, the diff, the judge's notes and the final gate's move.
 */
export async function finalPayload(ctx: Ctx, task: Task): Promise<NextPayload> {
  await refreshPages(ctx, task)
  const description = await ensureDraftDescription(ctx, task)
  const since = await buildBase(ctx, task)
  const record = await readBuildRecord(ctx, task)
  const current = lastIteration(record)
  // A note that a Trivial card has no failing test is no follow-up for the person.
  const verdicts = await withoutExemptNotes(ctx, task, current?.verdicts ?? [])
  const judgeNotes = notesOf({
    ...record,
    verification: current === null ? [] : [{ ...current, verdicts }],
  })
  return base(task, {
    phase: "final",
    instructions: phaseText("final") ?? "",
    ...((await checkedWithoutIndependentJudge(ctx, task)) ? { independent_review: "off" } : {}),
    description,
    description_file: descriptionPath(task),
    ...(await agentsFields(ctx, task, "verify", task.title)),
    ...(since !== null ? { diff: codeDiff(`${since}..HEAD`, await otherWork(ctx, task)) } : {}),
    ...(judgeNotes.length > 0 ? { judge_notes: judgeNotes } : {}),
    context: await contextOf(ctx, "review", task),
    // With approvals in the agent, the step's text asks the reply's one approval question.
    ...((await finalChatReview(ctx, task)) ?? {}),
    then: "qualitylayer wait --for approval",
  })
}

/**
 * What holds the person's page once the pass stands: open items an agent can settle, in words, and
 * the move. The reply never starts a judge for them: the reviewer already ruled and the code did not
 * move.
 */
async function openReply(ctx: Ctx, task: Task, standing: ReviewStanding): Promise<NextPayload> {
  return base(task, {
    phase: "verify",
    message: `The pass stands; the page turns to the person once nothing is left open. ${standing.why}.`,
    open_items: standing.open.map(({ id, source, text }) => ({ id, source, text })),
    ...flowFields(await taskFlow(ctx, task)),
    then: "qualitylayer verify judge",
  })
}

/**
 * The counted pass still stands: the page turns to the person, or, when something an agent can
 * settle is open, the reply names it. Without a standing pass, or with the exit's cause still there,
 * null. A pass that stands after a recheck (nothing it covers moved) is recorded again, without a
 * judge, so Verify's mode is the person's once more.
 */
async function passStandsAfterExit(ctx: Ctx, task: Task): Promise<Result<NextPayload> | null> {
  const last = lastIteration(await readBuildRecord(ctx, task))
  // Once the page is the person's, a need opened since is theirs on it, not an exit's cause.
  const yours = (await readVerifyMode(ctx, task)) === "yours"
  if (
    last?.result !== "pass" ||
    last.n !== task.iterations ||
    (!yours && openNeeds(await readNeeds(ctx, task)).length > 0) ||
    (await releaseWaiting(ctx, task)) !== null
  )
    return null
  const standing = await reviewStanding(ctx, task)
  if (!standing.passStands) return null
  // A pass never rests on proof that is gone: a fresh reviewer runs those points again.
  if ((await lostEvidence(ctx, task, last)).length > 0) return null
  const final = await finalCheckGate(ctx, task)
  if (final !== null) return final
  if (standing.recheck) return ok(await openReply(ctx, task, standing))
  if (!yours)
    await appendEvent(ctx, task, {
      event: "verify_result",
      passed: true,
      budgeted: false,
      iteration: task.iterations,
      judge: null,
      standing: true,
    })
  // Already the person's: its records were committed when the pass turned to them, and a later
  // brief or `next` commits nothing more.
  const light = (await taskFlow(ctx, task)).flow.light === true
  return ok(await toThePerson(ctx, task, light && !yours))
}

/**
 * Reads the judge's unread verdicts: refused when they do not hold, else counted. A pass turns the
 * page to the person; a failure stays in Verify with its gaps (mode `fixing`); an exit asks.
 */
async function readVerdicts(ctx: Ctx, task: Task): Promise<Result<NextPayload>> {
  const flow = await taskFlow(ctx, task)
  let log = await readBuildRecord(ctx, task)
  let iteration = lastIteration(log)
  if (iteration === null || iteration.n <= task.iterations)
    return ok(await verifyPayload(ctx, task))
  // The reviewer's raw records are read before anyone commits them: a secret there is removed, never asked about.
  await redactTaskRecords(ctx, task)
  // A tree that moved under the judge refuses nothing: the record is bound to the code as it is.
  const movedBefore = (await movedEntries(ctx, task)).length
  if (await acceptMovedVerification(ctx, task, flow.plan, iteration)) {
    log = await readBuildRecord(ctx, task)
    iteration = lastIteration(log) ?? iteration
  }
  const headWarning = await judgedHeadWarning(ctx, task, iteration)
  const errors = await verificationErrors(ctx, task, iteration, flow.plan)
  if (errors.some((e) => e.severity === "error"))
    return ok(warned(await verifyPayload(ctx, task, errors), headWarning))
  const { counted, passed, blocked } = await countRound(ctx, task, iteration)
  // The reviewer's added tests are part of its pass: committed with it, so the commit it judged is
  // the one the person reviews.
  const recovery = await hasReviewCandidate(ctx, task)
  const tests =
    passed && iteration.assignment !== undefined && !recovery
      ? await commitReviewerTests(ctx, counted, iteration.assignment)
      : null
  // The project checks run again on the source with them before the page turns.
  if (tests?.commit) await noteChecksAsked(ctx, counted)
  const said = (payload: NextPayload) =>
    warned(warned(payload, reviewerTestsWord(tests)), headWarning)
  const reason = await exitOf(ctx, counted, { passed, blocked, iteration })
  if (reason !== null) {
    if (passed) await recordResult(ctx, counted, iteration, true, !blocked)
    return ok(said(await openExit(ctx, counted, reason, { fixable: !passed })))
  }
  if (passed) {
    // The pass is recorded, and the page turns to the person, once the full check has run on this
    // source; until then the round is counted and a later `verify judge` records the standing pass.
    const final = await finalCheckGate(ctx, counted)
    if (final !== null) return final.ok ? ok(said(final.data)) : final
    await recordResult(ctx, counted, iteration, true, !blocked)
    const review = await toThePerson(ctx, counted, flow.flow.light === true && !recovery)
    return ok(said(await withMoved(ctx, task, movedBefore, review)))
  }
  const build = await fixReply(ctx, counted, flow, log)
  // The record's own lines for what failed: the gaps say what, these say where the judge wrote it.
  const failedLines = iteration.verdicts
    .filter((v) => v.verdict === "FAIL" || v.verdict === "MISSING")
    .map((v) => ({
      file: LOGS.verify,
      line: v.line,
      verdict: v.verdict,
      subject: `${v.kind} ${v.subject}`.trim(),
    }))
  const named = failedLines.length > 0 ? { ...build, failed_lines: failedLines } : build
  return ok(warned(await withMoved(ctx, task, movedBefore, named), headWarning))
}

/**
 * Verify's engine behind its verbs: the security review when the change needs one, the project
 * checks, the fresh reviewer's assignment, and its verdicts read and counted once they are written.
 * No record is committed here: the check receipts the judge needs are bound to HEAD's tree.
 */
async function runVerify(ctx: Ctx, task: Task, control: string): Promise<Result<NextPayload>> {
  const step = async () => {
    if (await hasReviewCandidate(ctx, task)) return verifySelectedCandidate(ctx, task, control)
    const reply = await verifyStep(ctx, task, control)
    if (
      reply.ok ||
      reply.error.code !== "state_mismatch" ||
      (control !== "" && control !== "judge") ||
      !(await readReviewCandidates(ctx, task)).eligible
    )
      return reply
    const move = "Open Verify in the App and select Choose review commit."
    if (control === "") return ok(base(task, { phase: "verify", message: move }))
    return err({ ...reply.error, fix: move })
  }
  const result =
    task.stage === "verify" ? await withReviewCandidateLock(ctx, task, step) : await step()
  if (!result.ok || result.data.phase !== "verify") return result
  // Counted rounds whose cited files are gone: said with the reply, the same words `validate` uses.
  const gone = await lostEvidenceWarnings(
    ctx,
    task,
    (await readBuildRecord(ctx, task)).verification,
  )
  return ok(gone.reduce((payload, e) => warned(payload, `${e.message} ${e.fix_hint}`), result.data))
}

async function verifySelectedCandidate(
  ctx: Ctx,
  task: Task,
  control: string,
): Promise<Result<NextPayload>> {
  try {
    const selected = await selectedReviewCandidate(ctx, task)
    if (!selected) return err({ code: "bad_args", message: "Choose the review commit in Verify." })
    const scoped = { ...task, repoRoot: selected.choice.checkout }
    const answered = await actOnExitAnswer(ctx, scoped, control, verifySelectedCandidate)
    if (answered !== null) return answered
    const waiting = await pendingExit(ctx, scoped)
    if (waiting !== null) return ok(await exitReply(ctx, scoped, waiting))
    const current = await readAssignment(ctx, scoped)
    if (current?.recovery === selected.id) await setAsideReplaced(ctx, scoped)
    const log = await readBuildRecord(ctx, scoped)
    const latest = log.verification.findLast((round) => round.assignment === current?.id)
    if (current?.recovery === selected.id && latest?.assignment === current.id) {
      if (latest.n > scoped.iterations) return await readVerdicts(ctx, scoped)
      if (latest.result === "pass" && latest.n === scoped.iterations && current.result === "pass")
        return (await finalCheckGate(ctx, scoped)) ?? ok(await toThePerson(ctx, scoped, false))
    }
    if (!(await checksReadyForReview(ctx, scoped))) return ok(await checksFirst(ctx, scoped))
    if (current?.recovery === selected.id) {
      const atWork = await judgeAtWork(ctx, scoped, true)
      if (atWork) return ok(await verifyPayload(ctx, scoped, undefined, undefined, atWork))
      if (current.result === undefined && control !== "recovery-recheck")
        return ok(
          base(scoped, {
            phase: "verify",
            assignment: current.id,
            then: "qualitylayer verify recheck",
            message:
              "The selected commit already has a review assignment. Use it while its judge is active.",
          }),
        )
    }
    if (control !== "judge" && control !== "recovery-recheck")
      return ok(
        base(scoped, {
          phase: "verify",
          then: "qualitylayer verify judge",
          message: `The selected commit ${selected.choice.head} is ready for a fresh whole-candidate review.`,
        }),
      )
    if (!(await readConfig(ctx)).independentReview.enabled)
      return err({
        code: "bad_args",
        message: "Turn on independent review before reviewing the selected commit.",
      })
    const scans = await candidateScans(ctx, scoped, { id: selected.id, head: selected.choice.head })
    const flow = await taskFlow(ctx, scoped)
    const security = await selectedSecurity(ctx, scoped, selected, flow, scanBrief(scans))
    if (typeof security !== "string") return ok(security)
    const opinion = await selectedOpinion(
      ctx,
      scoped,
      selected,
      flow,
      control === "recovery-recheck",
    )
    if (!opinion.ok) return opinion
    const admission = await prepareJudgeAdmission(ctx, scoped)
    if (admission.recovery !== selected.id)
      return err({
        code: "bad_args",
        message: "The selected review commit changed. Open Verify again.",
      })
    const picked = await prepareVerification(ctx, scoped, {
      ...admission,
      note: [admission.note, scanBrief(scans).slice(0, 3500), security, opinion.data]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8000),
    })
    return picked.ok ? ok(await verifyPayload(ctx, scoped, undefined, picked.data)) : picked
  } catch (cause) {
    return err({
      code: "bad_args",
      message:
        cause instanceof Error ? cause.message : "Open Verify and choose the current commit again.",
    })
  }
}

type Selected = NonNullable<Awaited<ReturnType<typeof selectedReviewCandidate>>>

async function selectedSecurity(
  ctx: Ctx,
  task: Task,
  selected: Selected,
  flow: TaskFlow,
  scans: string,
): Promise<string | NextPayload> {
  if (!flow.flow.security) return ""
  const slot = `candidate-${selected.id}`
  const start = `<!-- quality-record:${slot} -->`
  const end = `<!-- /quality-record:${slot} -->`
  const existing = await readQualityLog(ctx, task)
  const text = existing.split(start)[1]?.split(end)[0] ?? ""
  const pending = nextQualityOf(["security"], text)
  if (pending.kind === "judge")
    return `## Selected candidate security review\n\n${text.trim().slice(0, 2800)}`
  if (pending.kind === "fix")
    return base(task, {
      phase: "verify",
      quality_step: "fix",
      open_items: pending.items,
      message: "Fix the security findings, then choose the corrected commit for a fresh review.",
    })
  await ensureVerifyLog(ctx, task)
  if (!existing.includes(start)) await ctx.fs.append(verifyLogPath(task), `\n${start}\n${end}\n`)
  const id = `q-security-${selected.id.slice(0, 12)}`
  const active = (await helperLines(ctx, task)).some((item) => item.id === id && !item.done)
  const helper = qualityHelper(
    task,
    {
      base: await buildBase(ctx, task),
      diff: "the whole selected commit; inspect tracked code with git ls-files",
      pkg: await readerPackage(ctx, "security", task),
      id,
    },
    {
      recordSlot: slot,
      inline: `Selected commit: ${selected.choice.head}. Review only its exact checkout. Earlier security reviews are historical.\n\n${scans}`,
    },
  )
  const staffed = await staff(ctx, [helper])
  const filed = await withBriefFiles(ctx, task, staffed.on)
  if (!active) await startHelpers(ctx, task, filed)
  return base(task, {
    phase: "verify",
    quality_step: ["security"],
    instructions: staffed.off,
    ...(filed[0] ? { helper: filed[0] } : {}),
    record_as: "### Security",
    record_in: verifyLogPath(task),
    then: "qualitylayer verify judge",
  })
}

async function selectedOpinion(
  ctx: Ctx,
  task: Task,
  selected: Selected,
  flow: TaskFlow,
  retry: boolean,
): Promise<Result<string>> {
  if (!flow.flow.changeSecondOpinion) return ok("")
  const runtimeDir = join(task.runtimeDir, "review-candidates", selected.id)
  const scoped = { ...task, runtimeDir }
  const file = join(task.dir, "reviews", `verify-candidate-${selected.id}.md`)
  const known = await readRun(ctx, scoped, "verify")
  if (known?.state === "done" && (await ctx.fs.exists(file)))
    return ok(`Read the fresh second opinion in ${file}.`)
  if (known && !retry)
    return err({
      code: "bad_args",
      message:
        "The selected candidate still needs its second opinion. Run qualitylayer verify recheck.",
    })
  const step = await crossReviewStep(ctx, task, "verify")
  if (!step)
    return err({
      code: "bad_args",
      message:
        "The selected candidate needs its configured second opinion. Enable an available reviewer and run qualitylayer verify recheck.",
    })
  const reviewed = await runCrossReview(ctx, scoped, "verify", {
    ...step,
    file,
    recoveryHead: selected.choice.head,
  })
  if (!reviewed.ok) return reviewed
  if (!reviewed.data.completed)
    return err({
      code: "bad_args",
      message:
        "The selected candidate's second opinion could not complete. Run qualitylayer verify recheck after fixing reviewer availability.",
    })
  return ok(`Read the fresh second opinion in ${file}.`)
}

/**
 * `verify fix` and `verify keep-red` on an exit: the person's answer is what moves Verify, never
 * another judgement. Null for any other word.
 */
async function actOnExitAnswer(
  ctx: Ctx,
  task: Task,
  control: string,
  resume = verifyStep,
): Promise<Result<NextPayload> | null> {
  if (control === "round") {
    const moved = await takeAskedRound(ctx, task)
    if (!moved.ok) return moved
    const flow = await taskFlow(ctx, moved.data)
    return ok(await fixReply(ctx, moved.data, flow, await readBuildRecord(ctx, moved.data)))
  }
  if (control !== "keep") return null
  // The red check is recorded as kept, then Verify goes on as its brief would.
  const kept = await takeKeptRed(ctx, task)
  return kept.ok ? resume(ctx, task, "") : kept
}

/**
 * The quality gate's reply, when it has one. A task whose review history cannot be read still gets
 * its judge on `verify judge`, once the admission can be prepared; any other failure goes on.
 */
async function qualityStop(
  ctx: Ctx,
  task: Task,
  control: string,
  inspected: Inspected,
  independent: boolean,
): Promise<Result<NextPayload> | null> {
  try {
    const quality = await qualityReply(ctx, task)
    return quality === null ? null : ok(quality)
  } catch (cause) {
    if (
      !(cause instanceof TaskReviewHistoryError) ||
      !independent ||
      control !== "judge" ||
      verdictsWaiting(task, inspected)
    )
      throw cause
    const admission = await judgeAdmission(ctx, task)
    if (!admission.ok) return admission
    if (admission.data.source !== null || admission.data.note === undefined) throw cause
    return await assignJudge(ctx, task, control, inspected.pendingErrors)
  }
}

async function verifyStep(ctx: Ctx, task: Task, control: string): Promise<Result<NextPayload>> {
  try {
    await ensureVerifyLog(ctx, task)
    const answered = await actOnExitAnswer(ctx, task, control)
    if (answered !== null) return answered
    const waiting = await pendingExit(ctx, task)
    if (waiting !== null) return ok(await exitReply(ctx, task, waiting))
    const inspected = await currentRecord(ctx, task, control)
    const broken = inspected.recordErrors.some((e) => e.severity === "error")
    if (broken && !(await explicitReassignment(ctx, task, control, inspected))) {
      const last = lastIteration(inspected.records)
      const warning = last === null ? null : await judgedHeadWarning(ctx, task, last)
      return ok(warned(await verifyPayload(ctx, task, inspected.recordErrors), warning))
    }
    const independent = (await readConfig(ctx)).independentReview.enabled
    const quality = await qualityStop(ctx, task, control, inspected, independent)
    if (quality !== null) return quality
    if (!independent) return await withoutIndependentReview(ctx, task)
    if ((control === "" || control === "judge") && !verdictsWaiting(task, inspected)) {
      const standing = await passStandsAfterExit(ctx, task)
      if (standing !== null) return standing
      return await assignJudge(ctx, task, control, inspected.pendingErrors)
    }
    return await readVerdicts(ctx, task)
  } catch (cause) {
    if (!(cause instanceof TaskReviewHistoryError)) throw cause
    return err({
      code: "state_mismatch",
      message: cause.message,
      stored: task.stage,
      found: cause.message,
      fix: "Run qualitylayer doctor --json to check whether the recorded branch proves the rewrite. If it reports a fresh full-working-tree review is available, review current files with qualitylayer quality scan <paths> --local and record Security's scope and results in Verify. Record genuinely unavailable coverage as unverified, fix known severe findings, run the approved project checks, then qualitylayer verify judge. If a reviewer already has a fresh assignment, use that assignment.",
    })
  }
}

/** Whether the last counted round passed and still stands on its proof and on the code it judged. */
async function recordedPassStands(ctx: Ctx, task: Task): Promise<boolean> {
  const last = lastIteration(await readBuildRecord(ctx, task))
  // A pass recorded with no judged round in the record (a standing pass carried over) stands as recorded.
  if (last === null) return true
  if (last.result !== "pass" || last.n !== task.iterations) return false
  if ((await lostEvidence(ctx, task, last)).length > 0) return false
  return (await reviewStanding(ctx, task)).passStands
}

/** The words of Verify's verbs. */
export type VerifyVerb = "judge" | "recheck" | "fix" | "keep-red"

const ANSWER_FIRST = {
  what: "the person's answer to Verify's exit question",
  move: "qualitylayer wait --for answer",
}

/** `brief verify`: Verify's text and what runs first (the security review, the checks, the review). */
export async function verifyBrief(ctx: Ctx, task: Task): Promise<Result<NextPayload>> {
  return runVerify(ctx, task, "")
}

/**
 * `verify judge | recheck | fix | keep-red`: one verb per thing the agent claims. A judgement that
 * passed stands (`already`); the exit's answers are the person's, so they are read, never assumed.
 */
export async function verifyVerb(
  ctx: Ctx,
  task: Task,
  verb: VerifyVerb,
): Promise<Result<NextPayload>> {
  const mode = (await readVerifyMode(ctx, task)) ?? "checking"
  if ((verb === "judge" || verb === "recheck") && mode === "asked")
    return refused("Verify waits for the person's answer to its exit question.", [ANSWER_FIRST])
  if ((verb === "judge" || verb === "recheck") && (await hasReviewCandidate(ctx, task)))
    return runVerify(ctx, task, verb === "recheck" ? "recovery-recheck" : "judge")
  switch (verb) {
    case "judge":
      // A standing pass is not judged twice: the reply is the brief's (the person's review, or what
      // an agent settles before it). A pass whose proof is gone, or that no longer stands, is
      // judged again, as the replies that name this verb say.
      if (mode === "yours" && (await recordedPassStands(ctx, task))) {
        // No judged round in the record: nothing to read again, the recorded pass is the answer.
        if (lastIteration(await readBuildRecord(ctx, task)) === null)
          return ok(
            base(task, {
              already: true,
              message: "The judgement passed and stands: the person reviews.",
            }),
          )
        const standing = await runVerify(ctx, task, "")
        return standing.ok && standing.data.phase === "final"
          ? ok({ ...standing.data, already: true })
          : standing
      }
      if (mode === "asked")
        return refused("Verify waits for the person's answer to its exit question.", [ANSWER_FIRST])
      return runVerify(ctx, task, "judge")
    case "recheck": {
      if (mode === "asked")
        return refused("Verify waits for the person's answer to its exit question.", [ANSWER_FIRST])
      if (mode === "yours" || mode === "rechecking") {
        // The agent's recheck reopens the person's review under the gate's lock; an approval
        // already saved, during a recheck too, stands.
        const reopened = await reopenVerify(ctx, task)
        if (reopened === null)
          return refused("The person's approval is saved, and it closes the task as approved.", [
            { what: "the saved approval, applied", move: "qualitylayer wait --for approval" },
          ])
        if (!reopened.ok) return reopened
      }
      return runVerify(ctx, task, "judge")
    }
    case "fix": {
      if (mode === "asked") return runVerify(ctx, task, "round")
      if (mode !== "fixing")
        return refused("Nothing failed to fix: the last judgement did not fail.", [
          {
            what: "a failed judgement",
            move: mode === "checking" ? "qualitylayer verify judge" : "qualitylayer verify recheck",
          },
        ])
      await pendingExit(ctx, task)
      const started = (await readEvents(ctx, task)).some(
        (e) => e.event === "round_started" && e.n === task.iterations,
      )
      const flow = await taskFlow(ctx, task)
      const reply = await fixReply(ctx, task, flow, await readBuildRecord(ctx, task))
      return ok(started ? { ...reply, already: true } : reply)
    }
    case "keep-red":
      if (mode === "yours")
        return ok(base(task, { already: true, message: "The person's review is open." }))
      if (mode !== "asked")
        return refused("No exit question waits for a Keep answer.", [
          {
            what: "an exit question the person answered Keep it red and review it",
            move: "qualitylayer verify judge",
          },
        ])
      return runVerify(ctx, task, "keep")
  }
}
