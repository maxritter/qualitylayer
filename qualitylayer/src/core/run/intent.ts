import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { agentFileOf, folderDoc } from "../docs/names.ts"
import { isAutonomousBuildStage } from "../flow.ts"
import { FINAL, readGate } from "../gate/gate.ts"
import { readNeeds } from "../need/need.ts"
import { keyOf } from "../task/binding.ts"
import { openQuestion } from "../task/question.ts"
import { readBatch } from "../task/question-batch.ts"
import type { Task } from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { helperRunning } from "../wait-rules.ts"
import { INTENT_NO_PROGRESS, type RunIntent, type RunRecord } from "./contracts.ts"
import { taskHelperWait } from "./helper-wait.ts"
import {
  INTENT_HELPER_STALE,
  INTENT_HELPER_WAIT,
  INTENT_PROCESS_ENDED,
  intentWaitStatus,
} from "./intent-wait.ts"

export { taskHelperWait } from "./helper-wait.ts"
export { INTENT_HELPER_STALE, INTENT_HELPER_WAIT, INTENT_PROCESS_ENDED, intentWaitStatus }

export type IntentFacts = {
  task: string
  session: string
  stage: string
  progress: string
  boundary: "none" | "review" | "human" | "permission" | "error" | "wait"
  reason?: string
  interrupted?: boolean
}
export const armIntent = (task: string, nativeSession: string, armedAt: string): RunIntent => ({
  version: 1,
  target: "human-review",
  driver: "hook",
  task,
  nativeSession,
  armedAt,
  state: nativeSession ? "active" : "waiting",
  ...(!nativeSession ? { reason: "Waiting for native lead binding." } : {}),
})

function resolveAllowDecision(
  intent: RunIntent,
  facts: IntentFacts,
): { state: RunIntent["state"]; reason: string } | null {
  if (facts.interrupted)
    return { state: "paused", reason: "Interrupted by you. Resume explicitly to continue." }
  if (intent.task !== facts.task || intent.nativeSession !== facts.session)
    return {
      state: "blocked",
      reason: "The task or native lead changed. Continuation was refused.",
    }
  if (facts.boundary === "review")
    return { state: "complete", reason: "The change is ready for your Review." }
  if (facts.boundary !== "none")
    return {
      state: facts.boundary === "error" ? "blocked" : "waiting",
      reason: facts.reason ?? "Waiting at a recorded boundary.",
    }
  return null
}

export function decideIntent(
  intent: RunIntent,
  facts: IntentFacts,
): { intent: RunIntent; action: "continue" | "allow" } {
  if (!facts.interrupted && (intent.state === "paused" || intent.state === "complete"))
    return { intent, action: "allow" }
  const stop = resolveAllowDecision(intent, facts)
  if (stop) return { intent: { ...intent, ...stop }, action: "allow" }
  if (facts.stage !== "implement" && facts.stage !== "verify")
    return {
      intent: {
        ...intent,
        state: "waiting",
        reason: "The approved build is not active. Waiting for its human boundary.",
      },
      action: "allow",
    }
  if (!facts.progress || intent.attemptedProgress === facts.progress)
    return { intent: { ...intent, state: "blocked", reason: INTENT_NO_PROGRESS }, action: "allow" }
  return {
    intent: { ...intent, state: "active", reason: undefined, attemptedProgress: facts.progress },
    action: "continue",
  }
}

/** Elapsed-time summaries change on reads; they cannot purchase another model turn. */
export async function intentProgress(ctx: Ctx, task: Task): Promise<string> {
  const digest = createHash("sha256").update(`${task.stage}:${task.iterations}`)
  for (const file of [
    folderDoc("plan"),
    folderDoc("implement"),
    agentFileOf("implement"),
    folderDoc("verify"),
  ]) {
    const path = join(task.dir, file)
    if (!(await ctx.fs.exists(path))) continue
    const text = await ctx.fs.readFile(path)
    digest
      .update(file)
      .update(
        text
          .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
          .replace(/<!-- ql:summary(?:\s[^>]*)? -->[\s\S]*?<!-- \/ql:summary -->/g, ""),
      )
  }
  return digest.digest("hex")
}

type HumanBoundaryInput = {
  task: Task
  autonomous: boolean
  gate: Awaited<ReturnType<typeof readGate>>
  question: Awaited<ReturnType<typeof openQuestion>>
  batch: Awaited<ReturnType<typeof readBatch>>
  needs: Awaited<ReturnType<typeof readNeeds>>
}

function resolveHumanBoundary(
  input: HumanBoundaryInput,
): { kind: IntentFacts["boundary"]; reason: string } | null {
  const { task, autonomous, gate, question, batch, needs } = input
  if (task.stage === "verify" && gate?.target === FINAL && gate.decision === "pending")
    return { kind: "review", reason: "The change is ready for your review." }
  if (!autonomous && (question || batch?.questions.length))
    return { kind: "human", reason: "Waiting for your answer in QualityLayer." }
  if (gate?.decision === "pending")
    return { kind: "human", reason: "Waiting for your approval in QualityLayer." }
  if (
    !autonomous &&
    needs.some((need) => need.state === "open" && typeof need.waiting === "number")
  )
    return { kind: "human", reason: "Waiting for the access or information only you can provide." }
  return null
}

export async function intentFacts(
  ctx: Ctx,
  task: Task,
  run: RunRecord,
  waiting = false,
): Promise<IntentFacts> {
  const [gate, question, batch, needs, verifyMode] = await Promise.all([
    readGate(ctx, task),
    openQuestion(ctx, task),
    readBatch(ctx, task),
    readNeeds(ctx, task),
    readVerifyMode(ctx, task),
  ])
  const base = (kind: IntentFacts["boundary"], reason: string, progress = ""): IntentFacts => ({
    task: `${task.repoId}~${task.slug}`,
    session: run.nativeSession ?? "",
    stage: task.stage,
    progress,
    boundary: kind,
    reason,
  })
  const autonomous = isAutonomousBuildStage(task.stage, verifyMode ?? undefined)
  const human = resolveHumanBoundary({ task, autonomous, gate, question, batch, needs })
  if (human) return base(human.kind, human.reason)
  if (run.intent?.state === "waiting" && run.intent.reason === "Permission required in the agent.")
    return base("permission", "Permission required in the agent.")
  if (waiting) return base("wait", "An existing wait owns the next event.")
  if (await intentHelperRunning(ctx, task, run)) return base("wait", INTENT_HELPER_WAIT)
  return base("none", "", await intentProgress(ctx, task))
}

export async function intentHelperRunning(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir"> & Partial<Pick<Task, "stage">>,
  run: RunRecord,
): Promise<boolean> {
  if (!run.nativeSession || !run.firstPromptAt) return false
  if (await helperRunning(ctx, task, keyOf(run.nativeSession), Date.parse(run.firstPromptAt)))
    return true
  return (
    task.stage !== undefined &&
    (await taskHelperWait(ctx, { runtimeDir: task.runtimeDir, stage: task.stage })) !== null
  )
}
