// What the QualityLayer-written sections of a task's Implement and Verify documents are drawn
// from, read once per refresh by state.ts: the build's summary, the lanes with who ran each and how
// it ended, the four stages they fall into, the project checks, the fix rounds and the second
// opinion on the change. sections/{implement,verify}.ts turn it into text; nothing here writes a
// file.

import type { Ctx } from "../../ctx.ts"
import { AGENT_NAMES, isNativeAgent } from "../agents/ids.ts"
import { modelName, type StepAgent } from "../agents/model-values.ts"
import { readCheckProgress } from "../check-progress.ts"
import { latestRuns, readCheckRecords } from "../checks.ts"
import { readTaskScans } from "../code-quality/scanners/task-scans.ts"
import { reusedReceiptCount } from "../combined-review.ts"
import { readConfig } from "../config.ts"
import { SESSION_MODEL } from "../config-values.ts"
import { type BuildLog, lastIteration } from "../docs/build-log.ts"
import { projectChecks as plannedProjectChecks } from "../docs/commands.ts"
import { VERIFY_LANES } from "../flow.ts"
import { runningNow } from "../helpers.ts"
import { passRoles, qualityRowsFor } from "../polish.ts"
import { readRun, reviewFile } from "../review/cross.ts"
import { screenPairs } from "../review/screens.ts"
import { otherVendorInstalled } from "../review/vendors.ts"
import type { VerifyMode } from "../task/stages.ts"
import { planDetailsText, readEvents, readSession, type Task } from "../task/store.ts"
import type { TaskFlow } from "../task-flow.ts"
import { checkedWithoutIndependentJudge } from "../verification.ts"
import { type LaneRow, type StageRow, screenFacts, stageRows } from "./lanes.ts"
import { checksLane, scansLane } from "./records-checks.ts"
import { formatCheckLines, formatFixRounds } from "./records-format.ts"
import { fixLane, judgeLane, securityLane } from "./records-lanes.ts"
import { buildSecondReview, riskReasons, secondLane } from "./records-second-lane.ts"
import { buildSummaryText, recheckStage, verifySummaryText } from "./records-summaries.ts"
import type { PlanReviewState, ProofRow, SliceRow } from "./render.ts"
import { reviewFixFacts } from "./review-fix-facts.ts"

export { checksLaneOf, scansLane, settledChecksLane } from "./records-checks.ts"
export { secondOpinionOffWhy } from "./records-format.ts"

/** The text a task's Implement and Verify documents are written from. */
export type StepRecords = {
  /** Implement's *Summary*: the slices done and running, when the build started. */
  buildSummary: string
  /** Verify's *Summary*: the round and its result. */
  verifySummary: string
  /** The lanes in run order. */
  lanes: LaneRow[]
  /** Verify's four stages, as the people's *Checks* lists them. */
  stages: StageRow[]
  /** The agents' *Commands*: one line per recorded project check. */
  checks: string[]
  /** The agents' *Fix rounds*: one line per judge run with what it left open. */
  fixRounds: string[]
  /** The other agent's review of the built change, once one started. */
  second?: PlanReviewState
}

type Inputs = {
  flowed: TaskFlow
  record: BuildLog
  slices: SliceRow[]
  proof: ProofRow[]
  /** Verify's mode while the task is in Verify; null in any other stage. */
  verifyMode: VerifyMode | null
  /** The person reviews the change (Verify turned to them, or the final approval is being saved). */
  reviewing: boolean
  now: number
  when: (ms: number) => string
}

function proofCounts(proof: readonly ProofRow[]) {
  const proofYours = proof.filter(
    (p) => p.status === "yours to confirm" || p.status === "confirmed by you",
  ).length
  return {
    proofYours,
    proofJudged: proof.length - proofYours,
    proofPassed: proof.filter((p) => p.status === "passed").length,
    proofFailed: proof.filter((p) => p.status === "failed" || p.status === "missing").length,
  }
}

/** Everything the documents' QualityLayer sections need, for a task. */
export async function stepRecords(ctx: Ctx, task: Task, input: Inputs): Promise<StepRecords> {
  const { flowed, record } = input
  const flow = flowed.flow
  const config = await readConfig(ctx)
  const agent = ((await readSession(ctx, task))?.agent ?? "claude-code") as StepAgent
  const events = await readEvents(ctx, task)
  const withoutJudge = await checkedWithoutIndependentJudge(ctx, task)
  const built = task.stage === "verify" || task.stage === "shipped"
  const reviewing = task.stage === "shipped" || input.reviewing
  const live = task.stage === "verify"
  // No subagents (Settings › helpers: This session): the build session runs every lane itself, and
  // the page says so instead of naming a fresh agent that never ran.
  const solo = config.models[agent]?.helpers === SESSION_MODEL

  const runningHelpers = live || task.iterations > 0 ? await runningNow(ctx, task) : []
  const runningHelperIds = runningHelpers.map((helper) => helper.id)
  const runningQuality = runningHelpers
    .filter((row) => row.kind === "helper" && /^q-security-/.test(row.id))
    .map((row) => row.id)
  const rows = await qualityRowsFor(ctx, task, passRoles(flow), runningQuality)
  const security = rows.find((r) => r.step === "security")
  const screens = built && task.ui ? screenFacts(await screenPairs(ctx, task)) : []

  const secondRun = await readRun(ctx, task, "verify")
  const secondPath = reviewFile(task, "verify")
  const secondText = (await ctx.fs.exists(secondPath)) ? await ctx.fs.readFile(secondPath) : ""
  const second = buildSecondReview(secondRun, secondText)

  // The latest `check all` run only: a command a later run no longer holds leaves no red row.
  const recorded = await readCheckRecords(ctx, task)
  const projectChecks = recorded.filter((r) => r.scope === "all")
  const checkRuns = live
    ? (await readCheckProgress(ctx, task)).filter((row) => row.scope === "all" && row.running)
    : []
  // Only the run that holds the check lock runs a command; one that waits for it leaves the lane waiting.
  const activeCheck = checkRuns.filter((row) => !row.queued).at(-1)
  const queuedCheck = activeCheck === undefined && checkRuns.length > 0
  const fixFacts = reviewFixFacts(
    second?.findings ?? [],
    plannedProjectChecks((await planDetailsText(ctx, task)) ?? ""),
    projectChecks,
    secondRun?.ended,
  )

  const effective = lastIteration(record)
  const judgeWho = `${isNativeAgent(agent) ? AGENT_NAMES[agent] : "A fresh agent"} · ${modelName(
    agent,
    config.models[agent]?.judge ?? "",
  )} · never saw the build`
  const counts = proofCounts(input.proof)
  const { boundaryReason, reasons } = riskReasons(flowed)
  // Due, but it cannot run: the working agent's other vendor is not installed on this computer.
  const noSecondVendor =
    flow.changeSecondOpinion && secondRun === null
      ? (await otherVendorInstalled(ctx, task)) === false
      : false
  const roundCount = Math.max(0, task.iterations - 1)

  const laneRows: LaneRow[] = [
    securityLane({ security, flowed, boundaryReason, solo, live }),
    await checksLane(ctx, task, recorded, activeCheck, queuedCheck),
    scansLane(config.securityScans.enabled, await readTaskScans(ctx, task), Boolean(activeCheck)),
    judgeLane({
      withoutJudge,
      solo,
      judgeWho,
      effective,
      live,
      runningHelperIds,
      proof: input.proof,
      ...counts,
      screens,
      reusedReceipts: effective === null ? 0 : reusedReceiptCount(effective.verdicts),
    }),
    secondLane({
      enabled: flow.changeSecondOpinion,
      configEnabled: config.secondOpinion.enabled,
      task,
      secondRun,
      second,
      noSecondVendor,
      fixFacts,
      reasons,
    }),
    fixLane({
      roundCount,
      runningHelperIds,
      verifyMode: input.verifyMode,
      built,
      reviewing,
      effective,
    }),
  ]

  const qualityDone =
    security === undefined || security.state === "done" || security.state === "off"
  const stages = stageRows(
    laneRows,
    recheckStage({
      roundCount,
      reviewing,
      effective,
      proofCount: input.proof.length,
      proofPassed: counts.proofPassed,
      proofJudged: counts.proofJudged,
    }),
  )

  return {
    buildSummary: buildSummaryText({
      task,
      slices: input.slices,
      events,
      now: input.now,
      when: input.when,
    }),
    verifySummary: verifySummaryText({
      reviewing,
      events,
      laneRows,
      qualityDone,
      round: task.iterations,
      roundCount,
      solo,
      effective,
      proof: input.proof,
      proofPassed: counts.proofPassed,
      when: input.when,
    }),
    // In the order they run, whatever order they were worked out in.
    lanes: VERIFY_LANES.flatMap((lane) => laneRows.filter((row) => row.id === lane.id)),
    stages,
    checks: formatCheckLines(latestRuns(projectChecks)),
    fixRounds: formatFixRounds(record.verification),
    ...(second !== undefined ? { second } : {}),
  }
}
