// Verify's list of checks, from the first moment of the step: every check that will run, each with
// its state while the judges work. It is computed from the Plan (its Done means), the CLI's
// recorded project checks, the quality pass, the judges' `qualitylayer verdict` calls and, once a
// round is written, the Verify file. The App draws it as it is; it never parses Markdown for it.

import type { Ctx } from "../ctx.ts"
import { proofOf } from "./acceptance.ts"
import { readAttestations } from "./attestations.ts"
import { assignRunningJudges, fixedGaps, judgesOfLastRound, userPoints } from "./checklist-gaps.ts"
import {
  buildBeforeRows,
  buildProjectRows,
  buildReviewSection,
  makeVerdictRow,
} from "./checklist-rows.ts"
import { readCheckRecords } from "./checks.ts"
import { readBuildRecord } from "./docs/build-log.ts"
import type { Outline } from "./docs/outline.ts"
import { judgeShares } from "./docs/rules/judge-shares.ts"
import { doneMeansOf } from "./done-means.ts"
import { HELPER_FRESH_MS } from "./estimate.ts"
import { type Activity, currentSet, readPastSets } from "./helpers.ts"
import { passRoles, qualityRowsFor } from "./polish.ts"
import { said } from "./said.ts"
import { planDetailsText, type Task } from "./task/store.ts"
import { taskFlow } from "./task-flow.ts"
import { readAssignment, staleInputs } from "./verification.ts"
import { type VerifyBudget, verifyBudget } from "./verify-budget.ts"

export { userPoints }

export type CheckState = "waiting" | "running" | "passed" | "failed" | "user"

export type CheckRow = {
  /** `scenario:2`, `done:8`, `check:bun test`, `security`, `review`: stable across reads. */
  id: string
  label: string
  state: CheckState
  /** Which checking part runs it: "Checking · part 1 of 3"; "Checking" when one agent does. */
  who?: string
  /** What the check found, in the checker's words; the command's exit for a project check. */
  text?: string
  /** A file under evidence/ that shows it. */
  evidence?: string
  /** Its earlier pass stands: the fix did not touch what it covers. */
  carried?: true
  /** Listed because it failed (a task's definition of done, an acceptance step): not one of the counted checks. */
  extra?: true
  /** Not needed on this task (no trust boundary): listed, not counted. */
  off?: true
}

export type CheckGroupId = "before" | "project" | "done" | "review"

export type Checklist = {
  groups: { id: CheckGroupId; title: string; rows: CheckRow[] }[]
  /** The checks the agents run; points only the person can confirm and checks that are off are not in it. */
  total: number
  passed: number
  failed: number
  /** Points only the person can confirm, still to confirm or confirmed. */
  user: CheckRow[]
  /** Whole minutes where each went; 0 when it did not run. */
  minutes: { checks: number; checking: number }
  /** The verification budget as recorded use: judge runs and minutes since the build was delivered. */
  budget?: VerifyBudget
  /** What each checking agent does at this moment. */
  now: { who: string; line: string }[]
  /** Checking rounds that recorded a result. */
  rounds: number
  /** The agents that did not write the code and checked it: the parts of the build, or the one judge. 0 before any. */
  agents: number
  /** What changed since the current assignment was handed out, in words; empty while it stands. */
  stale: string[]
  /** What an earlier round found and the checks now pass, with the round that found it; absent when nothing was. */
  fixed?: { id: string; label: string; text: string; round: number }[]
}

const minutesOf = (ms: number) => (ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60_000)))

export type ChecklistInput = {
  /** The helpers handed out in the task's stage, as `activity` lists them. */
  helpers: readonly (Pick<Activity, "id"> &
    Partial<Pick<Activity, "line" | "state" | "at" | "started">>)[]
}

async function checkingMinutes(ctx: Ctx, task: Task): Promise<number> {
  const past = await readPastSets(ctx, task)
  const current = await currentSet(ctx, task)
  const active =
    current !== null && current.stage === "verify"
      ? [
          {
            ...current,
            ended: current.running ? Math.max(current.ended, ctx.clock.now()) : current.ended,
          },
        ]
      : []
  const totalMs = [...past, ...active]
    .filter((s) => s.stage === "verify" && s.role === "judge")
    .reduce((t, s) => t + (s.ended - s.started), 0)
  return minutesOf(totalMs)
}

/** The checklist of a task at Verify or later; null before there is a Plan to check against. */
export async function readChecklist(
  ctx: Ctx,
  task: Task,
  input: ChecklistInput,
): Promise<Checklist | null> {
  const flow = await taskFlow(ctx, task)
  const outline: Outline | null = flow.plan
  if (outline === null) return null
  const log = await readBuildRecord(ctx, task)
  const planned = (await planDetailsText(ctx, task)) ?? ""
  const done = await doneMeansOf(ctx, task)
  const attested = new Map((await readAttestations(ctx, task)).map((a) => [a.item, a]))
  const { items: verdicts, open } = await said(ctx, task, log)
  // Points the judge recorded as `user`: the person's own. Never counted among the agents' checks,
  // and the only ones an attestation can settle.
  const personal = new Set([...verdicts].filter(([, v]) => v.state === "user").map(([id]) => id))
  const currentAssignment = await readAssignment(ctx, task)
  const shares = judgeShares(
    currentAssignment?.outline ?? outline,
    currentAssignment?.iteration ?? 1,
  )
  const nowMs = ctx.clock.now()
  const running = input.helpers.filter(
    (h) =>
      h.state === "running" &&
      /^j(?:\d+-|s\d+-)/.test(h.id) &&
      h.line?.toLowerCase() !== "done" &&
      nowMs - (h.at ?? h.started ?? 0) < HELPER_FRESH_MS,
  )
  const quality = await qualityRowsFor(
    ctx,
    task,
    passRoles(flow.flow),
    input.helpers.filter((h) => h.state === "running").map((h) => h.id),
  )
  const records = await readCheckRecords(ctx, task)
  const row = (id: string, label: string) => makeVerdictRow(id, label, verdicts, attested, personal)
  const { review, head, failedRest, taskById } = buildReviewSection(
    outline,
    await proofOf(ctx, task),
    { row, verdicts, attested, personal },
  )
  const groups: Checklist["groups"] = [
    { id: "before", title: "Before checking", rows: buildBeforeRows(quality) },
    { id: "project", title: "Project checks", rows: buildProjectRows(planned, records) },
    { id: "done", title: "Done means", rows: done.map((d) => row(`done:${d.n}`, d.outcome)) },
    { id: "review", title: "Code review", rows: review },
  ]
  const now = open || running.length > 0 ? assignRunningJudges(groups, shares, running) : []
  const allRows = groups.flatMap((g) => g.rows)
  const counted = allRows.filter(
    (r) => r.extra !== true && r.off !== true && r.state !== "user" && !personal.has(r.id),
  )
  const user = allRows.filter(
    (r) => r.state === "user" || (attested.has(r.id) && personal.has(r.id)),
  )
  const stale =
    open && currentAssignment !== null ? await staleInputs(ctx, task, currentAssignment) : []
  const rounds = log?.verification.filter((i) => i.result !== null).length ?? 0
  const fixed = fixedGaps(log, groups, review[0]?.state === "passed", taskById)
  const checksMs = records.filter((r) => r.scope === "all").reduce((t, r) => t + (r.ms ?? 0), 0)
  return {
    ...(fixed.length > 0 ? { fixed } : {}),
    groups,
    total: counted.length,
    passed: counted.filter((r) => r.state === "passed").length,
    // The review row stands for failing tasks and acceptance steps that are listed under it: counted once.
    failed:
      allRows.filter((r) => r.state === "failed").length -
      (head.state !== "failed" && failedRest.length > 0 ? 1 : 0),
    user,
    minutes: { checks: minutesOf(checksMs), checking: await checkingMinutes(ctx, task) },
    now,
    budget: await verifyBudget(ctx, task),
    rounds,
    agents:
      shares.length > 0
        ? shares.length
        : Math.max(judgesOfLastRound(input.helpers), rounds > 0 ? 1 : 0),
    stale,
  }
}
