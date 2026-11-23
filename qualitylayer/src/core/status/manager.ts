import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { implementLogPath } from "../docs/build-log.ts"
import { readDecided } from "../gate/decided.ts"
import { type GateFile, readGate } from "../gate/gate.ts"
import type { Activity } from "../helpers.ts"
import { readNeeds } from "../need/need.ts"
import { readShipRecord, type ShipChoice } from "../ship/choice.ts"
import { answerModeInfo, approvalModeInfo } from "../task/answer-mode.ts"
import { isArchived } from "../task/archive.ts"
import { openQuestion } from "../task/question.ts"
import { approvalsOf } from "../task/sides.ts"
import { readmeFrontmatter, readSession, type Task } from "../task/store.ts"
import { resolveWaitingOn, type WaitingOn } from "./waiting-on.ts"

export type { WaitingOn } from "./waiting-on.ts"

export type DecisionSummary = {
  target: string
  decision: "approved" | "changes"
  at: number
  by: string | null
  ship_choice: ShipChoice | null
}

export async function awaitingBuildStart(ctx: Ctx, task: Task): Promise<boolean> {
  if (task.stage !== "implement") return false
  return (
    (await ctx.fs.exists(join(task.runtimeDir, "handoff.json"))) &&
    !(await ctx.fs.exists(implementLogPath(task)))
  )
}

async function latestDecision(
  ctx: Ctx,
  task: Task,
  gate: GateFile | null,
): Promise<DecisionSummary | null> {
  const decisions = await readDecided(ctx, task)
  const previous = decisions.reduce<(typeof decisions)[number] | null>(
    (last, one) => (last === null || one.at > last.at ? one : last),
    null,
  )
  const at = typeof gate?.decided === "number" ? gate.decided : null
  const current = gate?.decision !== "pending" && at !== null ? gate : null
  const latest =
    current && at !== null && (!previous || at >= previous.at)
      ? {
          target: current.target,
          decision: current.decision,
          at,
          by: current.by ?? null,
        }
      : previous
  if (!latest || latest.decision === "pending") return null
  const final = latest.target === "final" && latest.decision === "approved"
  const ship = final ? await readShipRecord(ctx, task) : null
  return {
    target: latest.target,
    decision: latest.decision,
    at: latest.at,
    by: latest.by,
    ship_choice: ship?.choice ?? null,
  }
}

export async function managerStatus(
  ctx: Ctx,
  task: Task,
  activities: Activity[] = [],
  savedGate?: GateFile | null,
) {
  const gate = savedGate === undefined ? await readGate(ctx, task) : savedGate
  const [frontmatter, question, needs, session, archived, lastDecision] = await Promise.all([
    readmeFrontmatter(ctx, task),
    openQuestion(ctx, task),
    readNeeds(ctx, task),
    readSession(ctx, task),
    isArchived(ctx, task),
    latestDecision(ctx, task, gate),
  ])
  const waiting_on: WaitingOn = await resolveWaitingOn({
    ctx,
    task,
    archived,
    gate,
    question,
    needs,
    session,
    activities,
    awaitingBuildStart,
  })
  return {
    question: question?.question ?? null,
    waiting_on,
    last_decision: lastDecision,
    answer_mode: answerModeInfo(frontmatter, task.answers),
    approval_mode: approvalModeInfo(frontmatter, approvalsOf(task)),
  }
}
