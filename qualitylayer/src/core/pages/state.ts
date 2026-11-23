// What a task's document sections are drawn from, read once: the documents and logs, the
// questions answered in the App, the answers stored as comments, the gate decisions, the
// attestations and the build's records. render.ts turns it into Markdown.

import type { Ctx } from "../../ctx.ts"
import { readAttestations } from "../attestations.ts"
import { readBuildRecord } from "../docs/build-log.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { doneMeansOf } from "../done-means.ts"
import { readComments } from "../gate/comments.ts"
import { readDecided } from "../gate/decided.ts"
import { readLimits } from "../limits.ts"
import { requiredLimits } from "../required-lines.ts"
import { isPersonMode } from "../review/in-review.ts"
import { storedUrl } from "../ship/pull-request.ts"
import { planningQuestionAnswers } from "../task/planning-answers.ts"
import { readmeFrontmatter, type Task, taskDocPath } from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { taskFlow } from "../task-flow.ts"
import { checkedWithoutIndependentJudge } from "../verification.ts"
import { planReviews } from "./plan-reviews.ts"
import { decidedByYou } from "./plan-state.ts"
import { stepRecords } from "./records.ts"
import { decidedRows, evidenceRows, type PageState, when } from "./render.ts"
import {
  answerTo,
  planApprovalState,
  readBuildDecisions,
  readPlanMarkers,
  readText,
  sliceRows,
} from "./state-plan.ts"
import {
  collectFindings,
  collectFixNeeds,
  collectProofRows,
  readScopedWalkthrough,
  securityChecks,
} from "./state-verify.ts"
import { yourCallsOf } from "./your-calls.ts"

/**
 * Everything the sections of a task's documents draw from. `review`: the person's review is being
 * written (the final approval saves it), whatever Verify's mode says.
 */
export async function pageState(
  ctx: Ctx,
  task: Task,
  options: { review?: true } = {},
): Promise<PageState> {
  const [comments, decided, answered, flowed, record, attestations, fm, verifyMode] =
    await Promise.all([
      readComments(ctx, task),
      readDecided(ctx, task),
      planningQuestionAnswers(ctx, task),
      taskFlow(ctx, task),
      readBuildRecord(ctx, task),
      readAttestations(ctx, task),
      readmeFrontmatter(ctx, task),
      readVerifyMode(ctx, task),
    ])
  const outline = flowed.plan
  const reviewing = options.review === true || (task.stage === "verify" && isPersonMode(verifyMode))
  const asked = decidedRows(answered)
  const done = await doneMeansOf(ctx, task)
  const parsedPlan = parseDoc(await readText(ctx, taskDocPath(task, "plan")))
  const plan = parsedPlan.body

  const { artifacts, decides } = await readPlanMarkers(ctx, task, plan, comments)
  const yourCalls = Object.keys(yourCallsOf(plan))
  const approval = planApprovalState(decided, parsedPlan.frontmatter ?? {})
  const decisions = await readBuildDecisions(ctx, task, outline)

  const last = record.verification.at(-1)
  const findings = await collectFindings(ctx, task, last)
  const fixNeeds = collectFixNeeds(last)
  const proof = await collectProofRows(ctx, task, done, last, attestations)
  const checks = await securityChecks(ctx, task)

  const finalDecision = [...decided].reverse().find((d) => d.target === "final")
  const url = await storedUrl(ctx, task)
  const pr = url?.match(/\/pull\/(\d+)/)?.[1]
  const branch = task.branch ?? (typeof fm.branch === "string" ? fm.branch : null)

  const slices = sliceRows(task, outline)
  const records = await stepRecords(ctx, task, {
    flowed,
    record,
    slices,
    proof,
    verifyMode,
    reviewing,
    now: ctx.clock.now(),
    when,
  })
  const ship: PageState["ship"] = {
    branch,
    shipped: task.stage === "shipped",
    pr: pr !== undefined ? Number(pr) : null,
    ...(finalDecision?.decision === "approved" ? { approvedAt: finalDecision.at } : {}),
  }
  const walkthrough = await readScopedWalkthrough(ctx, task, reviewing, {
    done,
    proof,
    records,
    ship,
  })
  const doneAnswer = answerTo(comments, ["plan:done:1"])

  return {
    title: task.title,
    checkedWithoutJudge: await checkedWithoutIndependentJudge(ctx, task),
    done,
    ...(doneAnswer !== undefined ? { doneAnswer } : {}),
    decided: asked,
    // The agents' record of where each answered choice's facts came from.
    evidence: evidenceRows(answered),
    artifacts,
    decides,
    yourCalls,
    slices,
    approval,
    decisions,
    findings,
    ...(fixNeeds !== undefined ? { fixNeeds } : {}),
    proof,
    checks,
    records,
    // Required lines skipped, not done or failed are limits the person accepts with the change.
    limits: [...(await readLimits(ctx, task)), ...(await requiredLimits(ctx, task))],
    // The Plan: its review and the answers it rests on.
    byYou: await decidedByYou(ctx, task, plan, decides, asked),
    ...(await planReviews(ctx, task)),
    ...(walkthrough !== undefined ? { walkthrough } : {}),
    ship,
  }
}
