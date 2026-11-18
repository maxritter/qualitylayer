// What the Verify page says at a glance, from the records: the four stages planned from the start with
// the checks in each, the round, how many points are judged or pass, and the check in work. Nothing
// here invents progress: a stage with no recorded check waits, and a check is in work only while a
// helper, a project check or the build session's report says so.

import type { VerifyLaneId } from "../../../core/flow.ts"
import {
  LANE_STAGES,
  type LaneRow,
  type LaneState,
  withoutStateWord,
} from "../../../core/pages/lanes.ts"
import { fixRoundsOf } from "../../../core/task/stages.ts"
import type { TaskDetail } from "../../api.ts"
import { fixingVerify, personVerify } from "../../model.ts"
import { environmental } from "../../step-page/checks.ts"
import { listsByPoint, planProofOf } from "../../step-page/proof.ts"
import type { ProofRow } from "../../step-page/state.ts"
import { executingCheck } from "./checks.ts"

/** What a helper or the build session reports it is doing, and when. */
export type LaneActivity = { line: string; at: number | null }

/** Which lane a helper works for, from its id and role. */
const laneOf = (id: string, role: string): VerifyLaneId | null => {
  if (id.startsWith("q-security-") || role === "security") return "security"
  if (/^j(?:\d|s)/.test(id) || role === "judge") return "judge"
  return role === "review" ? "second" : null
}

/** Where a stage stands: its checks' states folded into one. */
export type StageState = "done" | "running" | "waiting" | "fail" | "skipped"

export type BoardCheck = {
  lane: VerifyLaneId
  name: string
  who: string
  state: LaneState
  result: string
  /** What the helper reports it is doing, while the check is in work. */
  activity?: string
}

export type BoardStage = {
  n: number
  name: string
  /** Who runs a stage that has no check rows of its own (the fix round, the recheck). */
  who?: string
  /** The condition under a stage that may not run ("if a check fails"). */
  condition?: string
  state: StageState
  checks: BoardCheck[]
  /** One mark per check: done, in work, or still to come. */
  segments: ("d" | "w" | "")[]
}

/** The names of the checks as the board draws them. */
const CHECK_NAMES: Record<VerifyLaneId, string> = {
  checks: "Project checks",
  scans: "Security scans",
  security: "Security review",
  judge: "Done means, scenarios and tasks",
  second: "Second opinion",
  fix: "Fix rounds",
}

/** A points Plan has one list of proof: the reviewer runs its steps and reads the diff. */
const POINTS_JUDGE = "Acceptance test and the diff"

/** Who runs a check, in a few words: "QualityLayer", "a fresh agent", "Codex · GPT-6.1 Sol". */
export function whoWords(who: string): string {
  const parts = who
    .split("·")
    .map((part, index, all) => {
      const start = index > 0 ? part.trimStart() : part
      const value = index < all.length - 1 ? start.trimEnd() : start
      return value.replace(/(?<=\s)itself$/i, "").trim()
    })
    .filter(
      (part) =>
        part !== "" && !/^(?:no agent|never saw the build|read-only|another vendor)$/i.test(part),
    )
  const first = parts[0] ?? who
  // The kinds of runner are named alone; another vendor's agent keeps its model beside its name.
  if (/fresh agent|build session/i.test(first))
    return first.charAt(0).toLowerCase() + first.slice(1)
  return /^QualityLayer$/i.test(first) ? "QualityLayer" : parts.slice(0, 2).join(" · ")
}

/** The points judged and passing, from the proof rows. */
export function pointCounts(rows: readonly ProofRow[]) {
  const passed = rows.filter((row) => row.state === "passed").length
  const failed = rows.filter(
    (row) => row.state === "failed" && !environmental(row.sentence ?? ""),
  ).length
  const unverified = rows.filter(
    (row) => row.state === "failed" && environmental(row.sentence ?? ""),
  ).length
  return { passed, failed, unverified, judged: passed + failed + unverified, total: rows.length }
}

/** `4 Nov, 13:40`, in the viewer's own clock. */
export function whenWords(ts: number): string {
  const date = new Date(ts)
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return `${day}, ${time}`
}

/** `45 min`, `1 h 28 min`, `2 h 15 min`. */
export function spanWords(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return "under a minute"
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`
}

/**
 * How Verify's checking went, for the review's header (Workflow model: Verify): `checked in 2 h 15 min,
 * 2 rounds`, from the first move into Verify to the moment it turned to the person. Null without both.
 */
export function checkedWords(events: readonly Record<string, unknown>[]): string | null {
  const timed = events.filter((event) => typeof event.ts === "number")
  const starts = timed.filter((event) => event.to === "verify").map((event) => Number(event.ts))
  const ready = timed.find((event) => event.event === "verify_ready")?.ts
  if (starts.length === 0 || typeof ready !== "number") return null
  const span = spanWords(ready - Math.min(...starts))
  const results = events.filter((event) => event.event === "verify_result").length
  return results === 0
    ? `checked in ${span}`
    : `checked in ${span}, ${results} ${results === 1 ? "round" : "rounds"}`
}

export type VerifyPhase = "checking" | "fixing" | "rechecking" | "decision" | "verified"

/** The exit question waits when a Verify exit was recorded and the person has not answered it. */
function exitPending(events: readonly Record<string, unknown>[]): boolean {
  const at = events.findLastIndex((event) => event.event === "verify_exit")
  if (at < 0) return false
  return !events
    .slice(at + 1)
    .some(
      (event) =>
        event.event === "fix_round_asked" ||
        (event.event === "plan_amended" && event.by === "user"),
    )
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
  const events = task.events.filter((event) => typeof event.ts === "number")
  const starts = events.filter((event) => event.to === "verify").map((event) => Number(event.ts))
  const started = starts.length ? Math.min(...starts) : null
  const entered = starts.length ? Math.max(...starts) : null
  const ended = events.find(
    (event) =>
      event.event === "verify_ready" || (event.from === "verify" && event.to === "shipped"),
  )?.ts
  const fixingMode = fixingVerify(task)
  const active = task.stage === "verify" && !personVerify(task)
  const rounds = fixRoundsOf(task.events)
  // Verify has ended: no lane is still at work, whatever a record last said of it.
  const lanes = source.map((row) => ({
    ...row,
    ...(!active && row.state === "running" ? { state: "done" as const } : {}),
  }))
  const activity: Partial<Record<VerifyLaneId, LaneActivity>> = {}

  for (const helper of task.helpers) {
    if (helper.state !== "running") continue
    const lane = laneOf(helper.id, String(helper.role ?? ""))
    if (!lane || !helper.line || helper.line.toLowerCase() === "done") continue
    activity[lane] = { line: helper.line, at: helper.at ?? helper.started ?? null }
    const row = lanes.find((row) => row.id === lane)
    if (row && active) row.state = "running"
  }
  const check = executingCheck(task.checkProgress)
  if (check && active) {
    activity.checks = {
      line:
        check.files.total !== null
          ? `${check.command} · ${check.files.done} of ${check.files.total} test files`
          : `command ${check.i} of ${check.of}`,
      at: check.updated ?? check.started,
    }
    const row = lanes.find((row) => row.id === "checks")
    if (row) row.state = "running"
  }
  const report = task.taskProgress
  const reportCurrent =
    active &&
    report &&
    (report.step === "verify" ||
      (report.step === undefined && entered !== null && report.at >= entered)) &&
    (entered === null || report.at >= entered || fixingMode)
  if (reportCurrent) {
    const lane =
      lanes.find((row) => row.state === "running")?.id ??
      lanes.find((row) => row.id !== "fix" && row.state !== "done" && row.state !== "skipped")
        ?.id ??
      "checks"
    if (!activity[lane] || report.at > (activity[lane]?.at ?? 0))
      activity[lane] = { line: report.line, at: report.at }
  }

  const fixing = fixingMode || lanes.some((l) => l.id === "fix" && l.state === "running")
  const phase: VerifyPhase = !active
    ? "verified"
    : task.question !== null && exitPending(task.events)
      ? "decision"
      : fixing
        ? "fixing"
        : rounds.judgeRuns > 0
          ? "rechecking"
          : "checking"

  const points = pointCounts(proof)
  const results = task.events.filter((event) => event.event === "verify_result").length
  const roundWords =
    phase === "verified"
      ? results === 0
        ? ""
        : `${results} ${results === 1 ? "round" : "rounds"}`
      : // A fix round is the agents' own work: the header counts the round they are heading for.
        `round ${rounds.judgeRuns + 1}`

  // The four stages, planned from the start: each lists the checks it holds.
  const stages: BoardStage[] = LANE_STAGES.map((stage, index): BoardStage => {
    const own = stage.lanes
      .map((id) => lanes.find((lane) => lane.id === id))
      .filter((lane): lane is LaneRow => lane !== undefined && lane.state !== "skipped")
    const checks = own
      .filter((lane) => lane.id !== "fix")
      .map(
        (lane): BoardCheck => ({
          lane: lane.id,
          name: byPoint && lane.id === "judge" ? POINTS_JUDGE : CHECK_NAMES[lane.id],
          who: whoWords(lane.who),
          state: lane.state,
          result: lane.result === "" ? "" : withoutStateWord(lane.result),
          ...(activity[lane.id] ? { activity: activity[lane.id]?.line ?? "" } : {}),
        }),
      )
    const fixLane = lanes.find((lane) => lane.id === "fix")
    const states = checks.map((c) => c.state)
    let state: StageState = states.some((s) => s === "fail")
      ? "fail"
      : states.some((s) => s === "running")
        ? "running"
        : checks.length > 0 && states.every((s) => s === "done")
          ? "done"
          : "waiting"
    let who: string | undefined
    let condition: string | undefined
    // Verify passed without a fix round: stages 3 and 4 were not needed, and say so. A fix round that
    // ran leaves its mark in the lanes (a fix lane with a result) and in a second verdict.
    const fixRan =
      (fixLane !== undefined && fixLane.state !== "waiting" && fixLane.state !== "skipped") ||
      rounds.done > 0 ||
      results > 1
    const unneeded = phase === "verified" && !fixRan
    if (index === 2) {
      who = "the build session"
      condition = unneeded ? "not needed" : "if a check fails"
      state =
        fixLane?.state === "running" || phase === "fixing"
          ? "running"
          : fixRan
            ? "done"
            : unneeded
              ? "skipped"
              : "waiting"
    }
    if (index === 3) {
      // A recheck runs only the steps that failed, and the ones the fix reaches, with a fresh agent.
      who = byPoint ? "a fresh agent" : "fresh agents"
      condition = unneeded ? "not needed" : byPoint ? "only what failed" : "after a fix round"
      state =
        phase === "rechecking" && lanes.some((l) => l.id === "judge" && l.state === "running")
          ? "running"
          : phase === "verified" && fixRan
            ? "done"
            : unneeded
              ? "skipped"
              : "waiting"
      // The recheck is the Independent review run again: its checks stand under stage 2.
    }
    return {
      n: index + 1,
      name: index === 2 ? "Fix rounds" : stage.name,
      ...(who !== undefined ? { who } : {}),
      ...(condition !== undefined ? { condition } : {}),
      state,
      checks,
      segments: checks.map((c) => (c.state === "done" ? "d" : c.state === "running" ? "w" : "")),
    }
  })

  // The check in work: the stage it belongs to and what its helper reports.
  const working = lanes.find((lane) => lane.state === "running")
  const latest = Object.entries(activity).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))[0]
  // A fix round is the build session's, whatever a reviewer's last line says.
  const workLane: VerifyLaneId | undefined =
    phase === "fixing" ? "fix" : ((latest?.[0] as VerifyLaneId | undefined) ?? working?.id)
  const workStage =
    workLane === undefined
      ? undefined
      : phase === "rechecking" && (workLane === "judge" || workLane === "second")
        ? stages[3]
        : (stages.find((stage) => stage.checks.some((c) => c.lane === workLane)) ??
          (workLane === "fix" ? stages[2] : undefined))
  // With no activity line the chip names the point the reviewer is on.
  const runningPoint = proof.find((row) => row.state === "running")
  const sentence =
    workLane === undefined
      ? undefined
      : (activity[workLane]?.line ??
        (workLane === "judge" && runningPoint !== undefined
          ? `point ${runningPoint.n}`
          : undefined))
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
    ended: typeof ended === "number" ? ended : null,
    elapsed:
      started === null
        ? null
        : spanWords((typeof ended === "number" && !active ? ended : now) - started),
    now: workStage
      ? {
          stage:
            byPoint && workLane === "judge" && phase !== "rechecking"
              ? "Done means"
              : workStage.name,
          lane: workLane as VerifyLaneId,
          line: sentence ?? "",
        }
      : null,
  }
}
