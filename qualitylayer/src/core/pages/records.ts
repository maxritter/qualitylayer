// What the QualityLayer-written sections of a task's Implement and Verify documents are drawn
// from, read once per refresh by state.ts: the build's summary, the lanes with who ran each and how
// it ended, the four stages they fall into, the project checks, the fix rounds and the second
// opinion on the change. sections/{implement,verify}.ts turn it into text; nothing here writes a
// file.

import type { Ctx } from "../../ctx.ts"
import { AGENT_NAMES, isNativeAgent } from "../agents/ids.ts"
import { modelName, type StepAgent } from "../agents/model-values.ts"
import { failureWords } from "../check-failures.ts"
import { readCheckProgress } from "../check-progress.ts"
import { type CheckRecord, latestRuns, readCheckRecords } from "../checks.ts"
import { readTaskScans, type TaskScans } from "../code-quality/scanners/task-scans.ts"
import { reusedReceiptCount } from "../combined-review.ts"
import { readConfig } from "../config.ts"
import { SESSION_MODEL } from "../config-values.ts"
import { type BuildLog, lastIteration } from "../docs/build-log.ts"
import { projectChecks as plannedProjectChecks } from "../docs/commands.ts"
import { VERIFY_LANES } from "../flow.ts"
import { buildRevision } from "../gate/revision.ts"
import { runningNow } from "../helpers.ts"
import { passRoles, qualityRowsFor } from "../polish.ts"
import { excusedChecks, type RedStanding } from "../red-checks.ts"
import { readRun, reasonOf, reviewFile } from "../review/cross.ts"
import { screenPairs } from "../review/screens.ts"
import { otherVendorInstalled } from "../review/vendors.ts"
import { crossesBoundary, risksNameRisk } from "../scaling.ts"
import { reviewFindings } from "../task/items.ts"
import type { VerifyMode } from "../task/stages.ts"
import { planDetailsText, readEvents, readSession, type Task } from "../task/store.ts"
import type { TaskFlow } from "../task-flow.ts"
import { checkedWithoutIndependentJudge } from "../verification.ts"
import {
  countedFacts,
  type LaneRow,
  type LaneState,
  laneNameOf,
  laneResult,
  plainReason,
  type StageRow,
  screenFacts,
  stageRows,
  summaryText,
} from "./lanes.ts"
import type { PlanReviewState, ProofRow, SliceRow } from "./render.ts"
import { reviewFixFacts } from "./review-fix-facts.ts"

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

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

/** `3 h 10 min`, `48 min`, `under a minute`. */
export function spent(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return "under a minute"
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`.replace(" 0 min", "")
    : `${minutes} min`
}

/** `models.<agent>.helpers: session` runs helper work in the build session itself. */
export const SOLO_WHO = "the build session itself · QualityLayer helpers: This session"

/**
 * Why the second opinion did not read the change, in the words the person can act on: this task
 * said no, Settings switched it off (and what would have made it run), or the change is not risky.
 */
export function secondOpinionOffWhy(input: {
  enabled: boolean
  taskOff: boolean
  reasons: string[]
}): string {
  if (input.taskOff) return "Not run: this task asked for no second opinion."
  if (!input.enabled)
    return input.reasons.length > 0
      ? `Not run: Second opinion is off in Settings, though it would run here because ${joined(input.reasons)}; say "get a second opinion" to have one.`
      : "Not run: Second opinion is off in Settings."
  return "Not run: the change is not risky, and Second opinion on Automatic runs only on a risky change."
}

type Standing = ReadonlyMap<CheckRecord, RedStanding>

/**
 * The project checks lane once no check runs: the latest `check all` run, done or failed. Shared by
 * the refresh that writes the lanes and the read that serves a finished task, so a record written
 * before a later run passed never shows a stale red row.
 */
export function settledChecksLane(
  records: readonly CheckRecord[],
  standing: Standing = new Map(),
): LaneRow {
  const rows = latestRuns(records.filter((r) => r.scope === "all"))
  const row = { id: "checks" as const, who: "QualityLayer itself · no agent" }
  if (rows.length === 0) return { ...row, state: "waiting", result: "" }
  const failed = rows.filter((r) => !(r.ran && r.exit === 0 && r.notRun === undefined))
  // A red check that is not the task's to fix still shows red: on the base, or kept by the person.
  const onBase = failed.filter((r) => standing.get(r)?.state === "on_base").length
  const kept = failed.filter((r) => standing.get(r)?.state === "kept").length
  const reused = rows.filter((r) => r.reused === true).length
  // A check that is partly red on the base shows only what is new; the rest counts as red on the base.
  const ours = failed.flatMap((r) => {
    const found = standing.get(r)
    return found?.state === "on_base" || found?.state === "kept" ? [] : [found]
  })
  const news = ours.flatMap((found) => (found?.state === "new_failures" ? found.names : []))
  const shared = ours.reduce(
    (n, found) => n + (found?.state === "new_failures" ? found.known : 0),
    0,
  )
  const unnamed = ours.filter((found) => found?.state !== "new_failures").length
  return ours.length > 0
    ? {
        ...row,
        state: "fail",
        result: laneResult("fail", [
          ...(news.length > 0 ? [failureWords(news)] : []),
          ...(unnamed > 0 || news.length === 0
            ? [`${unnamed || ours.length} of ${plural(rows.length, "check")}`]
            : []),
          ...(shared > 0 ? [`${shared} red on the base`] : []),
        ]),
      }
    : {
        ...row,
        state: "done",
        result: laneResult("done", [
          ...(onBase > 0 ? [`${onBase} red on the base`] : []),
          ...(kept > 0 ? [`${kept} kept red by you`] : []),
          plural(rows.length, "check"),
          ...(reused > 0 ? [`${reused} reused`] : []),
        ]),
      }
}

/** The project checks lane from the records, with the red results that are not the task's to fix. */
export async function checksLaneOf(
  ctx: Ctx,
  task: Task,
  records: readonly CheckRecord[],
): Promise<LaneRow> {
  const revision = await buildRevision(ctx, task).catch(() => null)
  return settledChecksLane(records, (await excusedChecks(ctx, task, records, revision)).standing)
}

/**
 * The Security scans lane from the last scans `check all` recorded: off in Settings, waiting for the
 * checks, done with what it found (a scanner that is not installed is named, not failed), or failed
 * when a scan could not read part of the change. The
 * findings count toward nothing: they are records for the reviewers.
 */
export function scansLane(enabled: boolean, scans: TaskScans | null, checking: boolean): LaneRow {
  const row = { id: "scans" as const, who: "QualityLayer itself · no agent" }
  if (!enabled)
    return {
      ...row,
      state: "skipped",
      result: laneResult("not run", ["off in Settings"]),
      why: "Off in Settings › Security scans.",
    }
  // The scans run inside the project checks: they run while those run, and wait while those wait.
  if (scans === null) return { ...row, state: checking ? "running" : "waiting", result: "" }
  const ran = scans.results.filter((r) => r.state !== "not_needed" && r.state !== "off")
  const findings = scans.results.reduce((n, r) => n + r.findings.length, 0)
  // A scanner that is not on this computer did not fail: nothing ran. Only a scan that ran and could
  // not read a file of the change is red.
  const missed = scans.results.filter((r) => r.notChecked.length > 0)
  const absent = missed.filter((r) => r.notChecked.every((n) => n.path === undefined)).length
  const unchecked = missed.length - absent
  const notNeeded = scans.results.length - ran.length
  const facts = [
    findings === 0 ? "no findings" : plural(findings, "finding"),
    ...(unchecked > 0 ? [`${unchecked} not checked`] : []),
    ...(absent > 0 ? [`${absent} not installed`] : []),
    ...(notNeeded > 0 ? [`${notNeeded} not needed`] : []),
  ]
  const state = unchecked > 0 ? "fail" : "done"
  return { ...row, state, result: laneResult(state, facts) }
}

/** Verify's summary while a lane runs. */
function runningSummary(id: LaneRow["id"]): string {
  return `${laneNameOf(id)} is running.`
}

function joined(words: string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
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

  // --- the lanes ------------------------------------------------------------------------------
  const helpersModel = config.models[agent]?.helpers
  // No subagents (Settings › helpers: This session): the build session runs every lane itself, and
  // the page says so instead of naming a fresh agent that never ran.
  const solo = helpersModel === SESSION_MODEL
  const roles = passRoles(flow)
  const runningHelpers =
    task.stage === "verify" || task.iterations > 0 ? await runningNow(ctx, task) : []
  const runningQuality = runningHelpers
    .filter((row) => row.kind === "helper" && /^q-security-/.test(row.id))
    .map((row) => row.id)
  const rows = await qualityRowsFor(ctx, task, roles, runningQuality)
  const screens = built && task.ui ? screenFacts(await screenPairs(ctx, task)) : []
  const security = rows.find((r) => r.step === "security")
  const coverageFacts = () => {
    const gaps = security?.coverage ?? []
    return gaps.length === 0 ? [] : [`${plural(gaps.length, "review area")} unverified`]
  }
  const secondRun = await readRun(ctx, task, "verify")
  const secondText = (await ctx.fs.exists(reviewFile(task, "verify")))
    ? await ctx.fs.readFile(reviewFile(task, "verify"))
    : ""
  const secondName =
    secondRun === null
      ? null
      : `${secondRun.name} · ${modelName(secondRun.by, secondRun.model)} · another vendor`
  const second: PlanReviewState | undefined =
    secondRun === null
      ? undefined
      : {
          label: `Second opinion · ${secondRun.name}, ${modelName(secondRun.by, secondRun.model)}`,
          state: secondRun.state,
          ...(secondRun.state === "failed"
            ? { reason: reasonOf(secondRun), subject: "The second opinion on the change" }
            : {}),
          verdict:
            secondRun.state === "done"
              ? (secondText.match(/^(APPROVE|REVISE[^\n]*|BLOCK[^\n]*)/m)?.[1]?.trim() ?? null)
              : null,
          findings:
            secondRun.state === "done"
              ? reviewFindings(secondText).map((f) => ({
                  what: f.what,
                  ...(f.stance !== undefined ? { stance: f.stance } : {}),
                  ...(f.answer !== undefined ? { answer: f.answer } : {}),
                }))
              : [],
        }

  // The latest `check all` run only: a command a later run no longer holds leaves no red row.
  const recorded = await readCheckRecords(ctx, task)
  const projectChecks = recorded.filter((r) => r.scope === "all")
  const checkRows = latestRuns(projectChecks)
  const checkRuns =
    task.stage === "verify"
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
  const proofYours = input.proof.filter(
    (p) => p.status === "yours to confirm" || p.status === "confirmed by you",
  ).length
  const proofJudged = input.proof.length - proofYours
  // The Plan's points are counted as "Done means", the same words as the Plan's heading.
  const pointsWord = (n: number) => `${n} Done means`
  const proofPassed = input.proof.filter((p) => p.status === "passed").length
  const proofFailed = input.proof.filter(
    (p) => p.status === "failed" || p.status === "missing",
  ).length

  const reasons: string[] = []
  // The Plan's own words, cleaned of code, paths and routes so the reason stays one plain sentence.
  const boundaryWords = plainReason(flowed.signals.trustBoundary)
  const boundaryReason = `the change crosses a trust boundary${boundaryWords !== "" ? `: ${boundaryWords}` : ""}`
  if (crossesBoundary(flowed.signals.trustBoundary)) reasons.push(boundaryReason)
  if (risksNameRisk(flowed.signals.risks))
    reasons.push("the Plan's risks name a new dependency, an outside system or a migration")

  const laneRows: LaneRow[] = []
  // The next lane of the run order that is not done runs now, when Verify is under way.
  const live = task.stage === "verify"
  let securityState: LaneRow["state"] =
    security === undefined || (security.state === "off" && !flow.security)
      ? "skipped"
      : security.state === "done"
        ? "done"
        : live
          ? "running"
          : "waiting"
  let securityResult =
    security?.state === "off" || security === undefined
      ? laneResult("not run", [])
      : security.state === "done"
        ? laneResult(securityState, countedFacts(security.result ?? ""))
        : security.state === "fixing"
          ? laneResult(securityState, [`fixing ${plural(security.open ?? 0, "severe finding")}`])
          : ""
  if (security?.coverage !== undefined) {
    securityState = security.state === "running" ? "running" : "waiting"
    securityResult = laneResult(securityState, coverageFacts())
  }
  laneRows.push({
    id: "security",
    who: solo ? SOLO_WHO : "a fresh agent · read-only",
    state: securityState,
    // While a severe finding is fixed, the earlier result is not the lane's: it says what it does now.
    result: securityResult,
    why: flow.security
      ? crossesBoundary(flowed.signals.trustBoundary)
        ? `${boundaryReason.charAt(0).toUpperCase()}${boundaryReason.slice(1)}.`
        : flow.agentControls?.length
          ? `The change edits what steers an agent, a hook or CI: ${flow.agentControls.slice(0, 3).join(", ")}.`
          : "You asked for it."
      : "The Plan's trust boundary line says nothing crosses it, and no agent instructions, hooks or CI changed.",
  })
  const qualityDone =
    security === undefined || security.state === "done" || security.state === "off"
  laneRows.push(
    activeCheck
      ? {
          id: "checks",
          who: "QualityLayer itself · no agent",
          state: "running",
          result: laneResult("running", [
            activeCheck.files.total !== null
              ? `${activeCheck.files.done} of ${activeCheck.files.total} test files`
              : `command ${activeCheck.i} of ${activeCheck.of}`,
          ]),
        }
      : queuedCheck
        ? // A run that waits for the lock leaves the lane waiting, with the last recorded result.
          { ...(await checksLaneOf(ctx, task, recorded)), state: "waiting" }
        : await checksLaneOf(ctx, task, recorded),
  )
  laneRows.push(
    scansLane(config.securityScans.enabled, await readTaskScans(ctx, task), Boolean(activeCheck)),
  )
  const reusedReceipts = effective === null ? 0 : reusedReceiptCount(effective.verdicts)
  laneRows.push({
    id: "judge",
    who: withoutJudge
      ? "not run"
      : solo
        ? `${SOLO_WHO} · not independent`
        : (effective?.judge ?? judgeWho),
    state: withoutJudge
      ? "skipped"
      : effective === null
        ? live && runningHelpers.some((helper) => /^j(?:\d|s)/.test(helper.id))
          ? "running"
          : "waiting"
        : effective.result === "pass"
          ? "done"
          : effective.result === "fail"
            ? "fail"
            : "running",
    result: withoutJudge
      ? laneResult("not run", ["off in Settings"])
      : effective === null || input.proof.length === 0
        ? ""
        : effective.result === "fail"
          ? laneResult("fail", [`${proofFailed} of ${pointsWord(proofJudged)}`])
          : laneResult(effective.result === "pass" ? "done" : "running", [
              `${proofPassed} of ${pointsWord(proofJudged)}`,
              ...(proofYours > 0 ? [`${proofYours} yours to confirm`] : []),
              ...screens,
              ...(reusedReceipts > 0
                ? [
                    `${reusedReceipts} check ${reusedReceipts === 1 ? "receipt" : "receipts"} reused`,
                  ]
                : []),
            ]),
    ...(withoutJudge ? { why: "You switched it off in Settings." } : {}),
  })
  // Due, but it cannot run: the working agent's other vendor is not installed on this computer.
  const noSecondVendor =
    flow.changeSecondOpinion && secondRun === null
      ? (await otherVendorInstalled(ctx, task)) === false
      : false
  laneRows.push({
    id: "second",
    who: secondName ?? "another vendor's agent",
    state:
      !flow.changeSecondOpinion || noSecondVendor
        ? "skipped"
        : secondRun === null
          ? "waiting"
          : secondRun.state === "running"
            ? "running"
            : secondRun.state === "done"
              ? "done"
              : "fail",
    result: !flow.changeSecondOpinion
      ? laneResult("not run", [])
      : noSecondVendor
        ? laneResult("not run", ["no second vendor installed"])
        : second === undefined
          ? ""
          : second.state === "done"
            ? second.findings.length === 0
              ? laneResult("done", ["nothing to change"])
              : laneResult("done", [
                  fixFacts.fixed > 0
                    ? `${plural(fixFacts.fixed, "finding")} fixed`
                    : plural(second.findings.length, "finding"),
                  ...(fixFacts.planned > 0
                    ? [`${plural(fixFacts.planned, "fix", "fixes")} awaiting checks`]
                    : []),
                  ...(fixFacts.kept > 0 ? [`${fixFacts.kept} kept`] : []),
                ])
            : second.state === "running"
              ? laneResult("running", ["reading the diff"])
              : laneResult("fail", ["did not finish"]),
    why: !flow.changeSecondOpinion
      ? secondOpinionOffWhy({
          enabled: config.secondOpinion.enabled,
          taskOff:
            task.overrides.includes("-second-opinion") ||
            task.overrides.includes("-second-opinion:change"),
          reasons,
        })
      : noSecondVendor
        ? `It would run because ${reasons.length > 0 ? joined(reasons) : "this task asks for it"}, but no other coding agent is installed on this computer.`
        : reasons.length > 0
          ? `Runs because ${joined(reasons)}.`
          : "Runs because this task asks for it.",
  })

  // --- the fix rounds -------------------------------------------------------------------------
  // The build session fixes the gaps of a round and commits; each judge run in the record is a round.
  const fixRounds = record.verification.map((run) => {
    const open = run.verdicts.filter((v) => v.verdict === "FAIL" || v.verdict === "MISSING").length
    return `- Round ${run.n} · ${
      run.result === "pass"
        ? "everything checked passed"
        : run.result === "fail"
          ? `${plural(open, "point")} still open`
          : "being checked"
    }`
  })
  const roundCount = Math.max(0, task.iterations - 1)
  const fixActive =
    runningHelpers.some((helper) => helper.id.startsWith("fx-")) || input.verifyMode === "fixing"
  const fixState: LaneRow["state"] = fixActive
    ? "running"
    : roundCount > 0 || reviewing || effective?.result === "pass"
      ? "done"
      : "waiting"
  laneRows.push({
    id: "fix",
    who: "the build session",
    state: fixState,
    result:
      roundCount > 0
        ? laneResult(fixState, [plural(roundCount, "round")])
        : fixActive
          ? laneResult("running", ["fixing current findings"])
          : built && (reviewing || effective?.result === "pass")
            ? laneResult("done", ["none needed"])
            : "",
  })

  // --- the check lines --------------------------------------------------------------------------
  const checks = checkRows.flatMap((r) => [
    // The grammar `qualitylayer check` records in the build's own *Checks*, so the judge cites either.
    `- ${r.scope} · ${r.revision} · \`${r.command}\` · ${r.notRun !== undefined ? `failed: ${r.notRun}` : r.exit === null ? "stopped at the time limit" : `exit ${r.exit}`}${r.ms !== undefined ? ` · ${Math.round(r.ms / 100) / 10}s` : ""}${r.reused === true ? " · reused" : ""}`,
  ])

  // --- the summaries ----------------------------------------------------------------------------
  const startedAt =
    (events.find((e) => e.event === "build_log_created")?.ts as number | undefined) ?? null
  // The build ends where the task first leaves Implement for Verify.
  const builtAt = events.find((e) => e.from === "implement" && e.to === "verify")?.ts as
    | number
    | undefined
  const tasks = input.slices.reduce((n, s) => n + s.tasks, 0)
  const done = input.slices.reduce((n, s) => n + s.checked, 0)
  const doneSlices = input.slices.filter((s) => s.now === "done").length
  // The summaries follow the grammar of `summaryText`: the counts joined by ` · `, then the state in
  // one sentence. They are written from the same state as the lanes above, in the same refresh, so
  // a lane that changes changes the summary with it.
  const buildSummary =
    input.slices.length === 0
      ? "The build has not started."
      : summaryText(
          [
            `${done} of ${plural(tasks, "task")}`,
            `${doneSlices} of ${plural(input.slices.length, "slice")}`,
          ],
          done === 0 && startedAt === null
            ? "The build has not started."
            : task.stage === "implement"
              ? startedAt !== null
                ? `Building now: started ${input.when(startedAt)}, ${spent(input.now - startedAt)} so far.`
                : "Building now."
              : startedAt !== null && builtAt !== undefined && builtAt >= startedAt
                ? `Built ${input.when(startedAt)} to ${input.when(builtAt).replace(/^.*, /, "")} · ${spent(builtAt - startedAt)}.`
                : startedAt !== null
                  ? `Built: started ${input.when(startedAt)}.`
                  : "Built.",
        )

  const round = task.iterations
  // The build session's own review is a review round, not a judge run: the fresh judge's runs are
  // what the budget counts, so a session judgment never claims one.
  const judgeRunWords = (n: number): string =>
    solo ? plural(n, "review round") : plural(n, "judge run")
  // Verify turns to the person only on a pass, so a task they review was verified: when it started
  // and when it passed.
  const verifyStart = events.find((e) => e.to === "verify")?.ts as number | undefined
  const verifyEnd = events.findLast((e) => e.event === "verify_result" && e.passed === true)?.ts as
    | number
    | undefined
  const verifyState = reviewing
    ? verifyStart !== undefined && verifyEnd !== undefined
      ? `Verified ${input.when(verifyStart)} to ${input.when(verifyEnd)} after ${judgeRunWords(round)}.`
      : `Passed after ${judgeRunWords(round)}.`
    : laneRows.some((lane) => lane.state === "fail")
      ? `${joined(laneRows.filter((lane) => lane.state === "fail").map((lane) => laneNameOf(lane.id)))} failed; the fix round follows.`
      : laneRows.some((lane) => lane.state === "running")
        ? runningSummary(laneRows.find((lane) => lane.state === "running")?.id ?? "checks")
        : round === 0
          ? !qualityDone
            ? "The security review reads the change beside the checks."
            : laneRows.find((lane) => lane.id === "checks")?.state === "done"
              ? "The independent review is next."
              : "Project checks and independent review are next."
          : `Round ${round + 1}: checking after ${plural(roundCount, "fix round")}.`
  const verifySummary = summaryText(
    [
      ...(input.proof.length > 0
        ? effective === null
          ? [
              `${laneRows.filter((lane) => lane.id !== "fix" && lane.state === "done").length} of ${laneRows.filter((lane) => lane.id !== "fix" && lane.state !== "skipped").length} checks finished`,
            ]
          : [`${proofPassed} of ${pointsWord(input.proof.length)} proven`]
        : []),
      ...(roundCount > 0 ? [plural(roundCount, "fix round")] : []),
    ],
    verifyState,
  )

  // The recheck is the independent review run again after a fix round.
  const recheckState: LaneState =
    roundCount === 0
      ? reviewing || effective?.result === "pass"
        ? "skipped"
        : "waiting"
      : effective === null
        ? "waiting"
        : effective.result === "pass"
          ? "done"
          : effective.result === "fail"
            ? "fail"
            : "running"
  const stages = stageRows(laneRows, {
    state: recheckState,
    result:
      recheckState === "skipped"
        ? "not needed"
        : recheckState === "waiting"
          ? "after a fix round"
          : input.proof.length > 0
            ? `${proofPassed} of ${pointsWord(proofJudged)} proven`
            : "",
  })

  return {
    buildSummary,
    verifySummary,
    // In the order they run, whatever order they were worked out in.
    lanes: VERIFY_LANES.flatMap((lane) => laneRows.filter((row) => row.id === lane.id)),
    stages,
    checks,
    fixRounds,
    ...(second !== undefined ? { second } : {}),
  }
}
