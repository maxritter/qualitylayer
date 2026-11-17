// `qualitylayer plan draft` (D19): the step between writing the Plan and opening its gate. It
// validates the Plan and starts its review (the other vendor's second opinion, or a fresh Sonnet
// reviewer when none can run), and tells the person nothing: no gate is open yet. The planner
// rereads the Plan as the reviewer will and opens the gate without waiting for the review: the
// person reads while the review runs, Approve locked until its findings are folded in.

import { join } from "node:path"
import { type Ctx, err, ok, type Result, type ValidationError } from "../../ctx.ts"
import { pendingArtifactChecks, unansweredArtifactFindings } from "../artifact-check.ts"
import { readConfig } from "../config.ts"
import { folderDoc } from "../docs/names.ts"
import { tidyLeftoverSlots } from "../docs/slots.ts"
import { validateDoc } from "../docs/validate.ts"
import { missingCheckError, missingFromPlan } from "../required-lines.ts"
import {
  couldNotRunLine,
  crossReviewStep,
  handleOf,
  type ReviewHandle,
  reviewerOf,
  startReview,
} from "../review/cross.ts"
import { planReviewCoverage, planReviewCoverageNote } from "../review/plan-input.ts"
import { appendEvent, type Task } from "../task/store.ts"
import { taskFlow } from "../task-flow.ts"
import { lockPath } from "./lock.ts"

export type Drafted = {
  drafted: true
  document: string
  /** The Plan's review in flight, or none when no review applies to this task. */
  reviews: ReviewHandle[]
  /** Writing-rule warnings and the design check's open items; none of them holds the draft back. */
  warnings: ValidationError[]
  message: string
  then: string
  /** The same wait as the review's, for an agent that waits in the background. */
  wait_background?: string
}

/** Written once the Plan was drafted: `next` then names the gate as the step after the Plan. */
const draftedPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "plan-drafted.json")

export const wasDrafted = (ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<boolean> =>
  ctx.fs.exists(draftedPath(task))

/** Why no review reads this Plan, in the words the agent passes on. */
async function noReviewReason(ctx: Ctx, task: Task): Promise<string> {
  const words = task.overrides
  if (words.includes("-second-opinion") || words.includes("-second-opinion:plan"))
    return "the task's own words switched it off"
  const config = await readConfig(ctx)
  if (!config.secondOpinion.enabled) return "Settings › Second opinion is Off"
  const { flow } = await taskFlow(ctx, task)
  if (flow.planReview === "none")
    return "the Plan is not risky, and Settings › Second opinion reviews a risky Plan only; your reread is its check"
  return "no agent can run it here"
}

export async function draftPlan(ctx: Ctx, task: Task): Promise<Result<Drafted>> {
  return ctx.fs.withLock(lockPath(task), () => draftUnlocked(ctx, task))
}

async function draftUnlocked(ctx: Ctx, task: Task): Promise<Result<Drafted>> {
  const document = folderDoc("plan")
  if (task.stage !== "plan")
    return err({
      code: "bad_args",
      message: `plan draft is the Plan's step: this task is at stage "${task.stage}"`,
    })
  await tidyLeftoverSlots(ctx, task.dir, document)
  const report = await validateDoc(ctx, task.dir, document, { runtimeDir: task.runtimeDir })
  if (!report.ok) return report
  if (!report.data.valid) {
    const count = report.data.errors.filter((e) => e.severity === "error").length
    return err({
      code: "validation_failed",
      message: `${document} has ${count} validation error(s); fix them and run plan draft again`,
      errors: report.data.errors,
    })
  }
  // A required Project check the Plan does not name yet: the approval covers only what the Plan names.
  const missing = await missingFromPlan(ctx, task)
  if (missing.length > 0)
    return err({
      code: "validation_failed",
      message: `${document} does not name ${missing.length === 1 ? "a Project check" : `${missing.length} Project checks`} the instructions require; fix it and run plan draft again`,
      errors: missing.map(missingCheckError),
    })
  // The design check of each artifact runs beside the draft and never holds it back: what it has not
  // reported, and each finding still without an answer, come back as warnings.
  const warnings: ValidationError[] = [
    ...report.data.errors.filter((e) => e.severity === "warning"),
    ...[
      ...(await pendingArtifactChecks(ctx, task)),
      ...(await unansweredArtifactFindings(ctx, task)),
    ].map((e): ValidationError => ({ ...e, severity: "warning" })),
  ]
  const step = await crossReviewStep(ctx, task, "plan")
  const run = step !== null ? await startReview(ctx, task, step) : null
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    draftedPath(task),
    `${JSON.stringify({ at: ctx.clock.now(), review: run?.state ?? null })}\n`,
  )
  await appendEvent(ctx, task, { event: "plan_drafted", review: run?.by ?? null })
  const then = "qualitylayer gate open plan"
  const aside =
    warnings.length === 0
      ? ""
      : ` ${warnings.length} warning(s) are in \`warnings\`: fix what you agree with; the design check of each artifact runs beside the draft (\`qualitylayer next\` hands it out).`
  if (run === null)
    return ok({
      drafted: true,
      document,
      reviews: [],
      warnings,
      message:
        `${document} is drafted and valid.${aside} No review of the Plan runs: ${await noReviewReason(ctx, task)}. ` +
        `Reread the Plan once as a reviewer would, then run \`${then}\`.`,
      then,
    })
  const handle = handleOf(task, run)
  const coverage = planReviewCoverageNote(await planReviewCoverage(ctx, task, run))
  const reading =
    run.state === "running"
      ? run.panel !== undefined
        ? `${reviewerOf(run)} is reading it in the background.`
        : `${run.name} is reading it in the background (${handle.status}).`
      : run.state === "failed"
        ? `${couldNotRunLine(run)} (details in ${handle.file}); the gate's reply tells you what to say.`
        : `${reviewerOf(run)}'s review is already in (${run.state}), in ${handle.file}.`
  // The review reads beside the person: the gate opens at once with Approve locked, and the
  // findings are folded in when the review returns. Nobody waits for it before reading.
  const fold =
    `fold the findings in (under each finding in ${handle.file} write \`Answer: Taken · <what changed>\`, ` +
    "`Answer: Kept · <why the Plan stays>` or `Answer: Ask · <the question>`)"
  return ok({
    drafted: true,
    document,
    reviews: [handle],
    warnings,
    message:
      run.state === "running"
        ? `${document} is drafted and valid.${aside} ${reading} Reread the Plan once as the reviewer will and fix ` +
          `what you find, then run \`${then}\` without waiting for the review: the gate opens with Approve ` +
          `locked, so the person reads the Plan while ${run.panel !== undefined ? "the panel" : run.name} does. Start \`${handle.wait}\` in the ` +
          `background (or run it after the gate opens); when it returns, ${fold}, and run \`${then}\` ` +
          "again: that unlocks Approve."
        : `${document} is drafted and valid.${aside} ${reading} ${coverage}Reread the Plan as the reviewer will and ${fold}. ` +
          `Then run \`${then}\`: the person is told once the gate is open and the findings are processed.`,
    then,
    wait_background: handle.wait,
  })
}
