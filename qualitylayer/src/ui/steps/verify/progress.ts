// What the Verify page says at a glance, from the records: the four stages planned from the start with
// the checks in each, the round, how many points are judged or pass, and the check in work. Nothing
// here invents progress: a stage with no recorded check waits, and a check is in work only while a
// helper, a project check or the build session's report says so.

import type { VerifyLaneId } from "../../../core/flow.ts"
import type { LaneRow } from "../../../core/pages/lanes.ts"
import { fixRoundsOf } from "../../../core/task/stages.ts"
import type { TaskDetail } from "../../api.ts"
import { fixingVerify, personVerify } from "../../model.ts"
import { listsByPoint, planProofOf } from "../../step-page/proof.ts"
import type { ProofRow } from "../../step-page/state.ts"
import { failedChecks, projectCheckWords } from "./checks.ts"
import {
  applyProjectReceipt,
  collectVerifyActivity,
  formatRoundWords,
  resolveVerifyPhase,
} from "./progress-activity.ts"
import { buildBoardStages } from "./progress-stages.ts"
import {
  type BoardCheck,
  type BoardStage,
  checkedWords,
  type LaneActivity,
  pointCounts,
  type StageState,
  spanWords,
  type VerifyPhase,
  whenWords,
  whoWords,
} from "./progress-words.ts"

export {
  type BoardCheck,
  type BoardStage,
  checkedWords,
  pointCounts,
  type StageState,
  spanWords,
  whenWords,
  whoWords,
}

function verifyTimeline(events: readonly Record<string, unknown>[]) {
  const timed = events.filter((event) => typeof event.ts === "number")
  const starts = timed.filter((event) => event.to === "verify").map((event) => Number(event.ts))
  const ended = timed.find(
    (event) =>
      event.event === "verify_ready" || (event.from === "verify" && event.to === "shipped"),
  )?.ts
  return {
    started: starts.length ? Math.min(...starts) : null,
    entered: starts.length ? Math.max(...starts) : null,
    ended: typeof ended === "number" ? ended : null,
  }
}

function resolveNowChip(input: {
  lanes: readonly LaneRow[]
  stages: readonly BoardStage[]
  activity: Partial<Record<VerifyLaneId, LaneActivity>>
  proof: readonly ProofRow[]
  phase: VerifyPhase
  byPoint: boolean
}): { stage: string; lane: VerifyLaneId; line: string } | null {
  const { lanes, stages, activity, proof, phase, byPoint } = input
  const working = lanes.find((lane) => lane.state === "running")
  const latest = Object.entries(activity).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))[0]
  const workLane: VerifyLaneId | undefined =
    phase === "fixing" ? "fix" : ((latest?.[0] as VerifyLaneId | undefined) ?? working?.id)
  if (workLane === undefined) return null

  const workStage =
    phase === "rechecking" && (workLane === "judge" || workLane === "second")
      ? stages[3]
      : (stages.find((stage) => stage.checks.some((c) => c.lane === workLane)) ??
        (workLane === "fix" ? stages[2] : undefined))
  if (!workStage) return null

  const runningPoint = proof.find((row) => row.state === "running")
  const fallbackLine =
    workLane === "judge" && runningPoint !== undefined ? `point ${runningPoint.n}` : ""
  const stageName =
    byPoint && workLane === "judge" && phase !== "rechecking" ? "Done means" : workStage.name
  return { stage: stageName, lane: workLane, line: activity[workLane]?.line ?? fallbackLine }
}

/** Presentation follows recorded work; neither a heartbeat nor a future check invents progress. */
export function verifyView(
  task: TaskDetail,
  source: readonly LaneRow[],
  proof: readonly ProofRow[],
  now: number,
) {
  // A Plan that lists its Acceptance test by Done means point: the board and the header say so.
  const byPoint = listsByPoint(planProofOf(task))
  const { started, entered, ended } = verifyTimeline(task.events)
  const fixingMode = fixingVerify(task)
  const active = task.stage === "verify" && !personVerify(task)
  const rounds = fixRoundsOf(task.events)
  // Verify has ended: no lane is still at work, whatever a record last said of it.
  const lanes = source.map((row) => ({
    ...row,
    ...(!active && row.state === "running" ? { state: "done" as const } : {}),
  }))
  const projectRows = task.verifyActivity?.projectChecks?.commands
  const failureCount = failedChecks(projectRows ?? [])
  const failedResult = failureCount > 0 && projectRows ? projectCheckWords(projectRows) : null
  if (active) applyProjectReceipt(lanes, projectRows, failedResult)

  const activity = collectVerifyActivity(task, lanes, active, entered, fixingMode)
  const phase = resolveVerifyPhase(task, lanes, active, fixingMode, rounds.judgeRuns)
  const points = pointCounts(proof)
  const results = task.events.filter((event) => event.event === "verify_result").length
  const roundWords = formatRoundWords(phase, results, rounds.judgeRuns)
  const stages = buildBoardStages({
    lanes,
    byPoint,
    failedResult,
    failureCount,
    activity,
    phase,
    roundsDone: rounds.done,
    results,
  })
  const elapsed =
    started === null ? null : spanWords((ended !== null && !active ? ended : now) - started)

  return {
    phase,
    stages,
    points,
    byPoint,
    /** One tick per Done means point of a points Plan: proven, in work, or still to come. */
    ticks: proof.map((row): "done" | "work" | "todo" =>
      row.state === "passed" ? "done" : row.state === "running" && active ? "work" : "todo",
    ),
    roundWords,
    started,
    ended,
    elapsed,
    now: resolveNowChip({ lanes, stages, activity, proof, phase, byPoint }),
  }
}
