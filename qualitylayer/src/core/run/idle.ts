import { existsSync, lstatSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { readGate } from "../gate/gate.ts"
import { readNeeds } from "../need/need.ts"
import { openQuestion } from "../task/question.ts"
import { readBatch } from "../task/question-batch.ts"
import { acceptedStopEvent } from "./bind.ts"
import type { RunRecord } from "./contracts.ts"
import { nativeSessionFile } from "./control.ts"
import { intentHelperRunning } from "./intent.ts"
import { updateRun } from "./registry.ts"

export { watchIdleRun } from "./idle-watch.ts"

export const RUN_IDLE_MS = 15 * 60_000

/** Missing hooks or an unfinished turn never count as idle evidence. */
export function idleRunBoundary(run: RunRecord): number | undefined {
  if (run.agent === "other" || !run.nativeSession || run.waitSince || run.terminalPrompt)
    return undefined
  if (run.intent && !["paused", "blocked", "complete"].includes(run.intent.state)) return undefined
  const stop = run.status === "running" ? acceptedStopEvent(run) : undefined
  return stop && Number.isFinite(Date.parse(stop.at)) ? stop.sequence : undefined
}

/**
 * The planner's build went outside the App (handoff/outside.ts) and a turn ended after it was told:
 * its host closes it at this boundary, without the idle wait and whoever watches it.
 */
export function handedOffBoundary(run: RunRecord, sequence: number): boolean {
  return run.handedOff !== undefined && sequence > run.handedOff.sequence
}

export const HUMAN_FILES = [
  "gate.json",
  "question.json",
  "question-batches.json",
  "questions.json",
  "needs.json",
]

/** Atomic task-file replacements must invalidate an in-flight eligibility check. */
export function idleStateStamp(run: RunRecord): string {
  if (!run.taskRuntimeDir) return "unbound"
  return HUMAN_FILES.map((name) => {
    const path = join(run.taskRuntimeDir as string, name)
    try {
      const stat = lstatSync(path, { bigint: true })
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unknown task state")
      return `${name}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return `${name}:absent`
      throw cause
    }
  }).join("|")
}

export function reserveIdleStop(
  home: string,
  id: string,
  generation: number,
  sequence: number,
  stamp: string,
) {
  updateRun(home, id, generation, (run) => {
    if (idleRunBoundary(run) !== sequence || idleStateStamp(run) !== stamp)
      throw new Error("The session changed before idle cleanup")
    return { status: "stopping", guardedRestart: { sequence, valid: true } }
  })
}

function isReadableHumanFile(runtimeDir: string, name: string): boolean {
  const path = join(runtimeDir, name)
  if (!existsSync(path)) return true
  // A damaged or unexpectedly large record is unknown, never permission to stop.
  if (statSync(path).size > 1024 * 1024) return false
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown
  const array = name === "questions.json" || name === "question-batches.json"
  if (!value || typeof value !== "object" || Array.isArray(value) !== array) return false
  if (name !== "gate.json") return true
  return ["pending", "approved", "changes"].includes((value as { decision: string }).decision)
}

/** Preserve native resume and every outstanding human/helper boundary. */
export async function idleRunBlocked(ctx: Ctx, run: RunRecord): Promise<boolean> {
  if (!nativeSessionFile(ctx, run)) return true
  if (!run.taskRuntimeDir) return Boolean(run.task) || run.purpose.kind === "task"
  if (!HUMAN_FILES.every((name) => isReadableHumanFile(run.taskRuntimeDir as string, name)))
    return true
  return Object.values(await idlePending(ctx, run)).some(Boolean)
}

/**
 * What the run's task still waits on: a person (a question, an approval or a need) or one
 * of the run's own helpers. The Sessions page tells the two apart; neither is ever stopped.
 */
export async function idlePending(
  ctx: Ctx,
  run: RunRecord,
): Promise<{ human: boolean; helper: boolean }> {
  if (!run.taskRuntimeDir) return { human: false, helper: false }
  const task = { runtimeDir: run.taskRuntimeDir }
  const [gate, question, batch, needs, helper] = await Promise.all([
    readGate(ctx, task),
    openQuestion(ctx, task),
    readBatch(ctx, task),
    readNeeds(ctx, task),
    intentHelperRunning(ctx, task, run),
  ])
  const human = [
    gate?.decision === "pending",
    question,
    batch?.questions.length,
    needs.some((need) => need.state === "open" && need.waiting !== null),
  ]
  return { human: human.some(Boolean), helper: Boolean(helper) }
}
