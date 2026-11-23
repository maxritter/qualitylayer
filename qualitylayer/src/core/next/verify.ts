import { type Ctx, ok, type Result } from "../../ctx.ts"
import { lastIteration, readBuildRecord } from "../docs/build-log.ts"
import { reopenVerify, reviewStanding } from "../gate/gate.ts"
import { hasReviewCandidate } from "../review-candidate.ts"
import { readEvents, type Task } from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { taskFlow } from "../task-flow.ts"
import { lostEvidence } from "../verification.ts"
import { fixReply } from "./implement.ts"
import { refused } from "./refusal.ts"
import { base, type NextPayload } from "./shared.ts"
import { pendingExit } from "./verify-exit.ts"
import { runVerify } from "./verify-run.ts"

export { verifyPayload } from "./verify-payload.ts"
export { verifyRecordErrors } from "./verify-records.ts"
export { checksFirst, finalPayload } from "./verify-shared.ts"

/** Whether the last counted round passed and still stands on its proof and on the code it judged. */
async function recordedPassStands(ctx: Ctx, task: Task): Promise<boolean> {
  const last = lastIteration(await readBuildRecord(ctx, task))
  // A pass recorded with no judged round in the record (a standing pass carried over) stands as recorded.
  if (last === null) return true
  if (last.result !== "pass" || last.n !== task.iterations) return false
  if ((await lostEvidence(ctx, task, last)).length > 0) return false
  return (await reviewStanding(ctx, task)).passStands
}

/** The words of Verify's verbs. */
export type VerifyVerb = "judge" | "recheck" | "fix" | "keep-red"

const ANSWER_FIRST = {
  what: "the person's answer to Verify's exit question",
  move: "qualitylayer wait --for answer",
}

/** `brief verify`: Verify's text and what runs first (the security review, the checks, the review). */
export async function verifyBrief(ctx: Ctx, task: Task): Promise<Result<NextPayload>> {
  return runVerify(ctx, task, "")
}

async function verifyJudgeVerb(ctx: Ctx, task: Task, mode: string): Promise<Result<NextPayload>> {
  // A standing pass is not judged twice: the reply is the brief's (the person's review, or what
  // an agent settles before it). A pass whose proof is gone, or that no longer stands, is
  // judged again, as the replies that name this verb say.
  if (mode === "yours" && (await recordedPassStands(ctx, task))) {
    // No judged round in the record: nothing to read again, the recorded pass is the answer.
    if (lastIteration(await readBuildRecord(ctx, task)) === null)
      return ok(
        base(task, {
          already: true,
          message: "The judgement passed and stands: the person reviews.",
        }),
      )
    const standing = await runVerify(ctx, task, "")
    return standing.ok && standing.data.phase === "final"
      ? ok({ ...standing.data, already: true })
      : standing
  }
  return runVerify(ctx, task, "judge")
}

async function verifyRecheckVerb(ctx: Ctx, task: Task, mode: string): Promise<Result<NextPayload>> {
  if (mode === "yours" || mode === "rechecking") {
    // The agent's recheck reopens the person's review under the gate's lock; an approval
    // already saved, during a recheck too, stands.
    const reopened = await reopenVerify(ctx, task)
    if (reopened === null)
      return refused("The person's approval is saved, and it closes the task as approved.", [
        { what: "the saved approval, applied", move: "qualitylayer wait --for approval" },
      ])
    if (!reopened.ok) return reopened
  }
  const reply = await runVerify(ctx, task, "judge")
  if (
    reply.ok &&
    reply.data.mode === "fixing" &&
    Array.isArray(reply.data.moved) &&
    reply.data.moved.length > 0
  )
    return ok({
      ...reply.data,
      message:
        "Recorded the earlier failed review after the worktree changed. If you’ve fixed what it found, run qualitylayer verify recheck again to request a fresh judge for the current code.",
    })
  return reply
}

async function verifyFixVerb(ctx: Ctx, task: Task, mode: string): Promise<Result<NextPayload>> {
  if (mode === "asked") return runVerify(ctx, task, "round")
  if (mode !== "fixing")
    return refused("Nothing failed to fix: the last judgement did not fail.", [
      {
        what: "a failed judgement",
        move: mode === "checking" ? "qualitylayer verify judge" : "qualitylayer verify recheck",
      },
    ])
  await pendingExit(ctx, task)
  const started = (await readEvents(ctx, task)).some(
    (e) => e.event === "round_started" && e.n === task.iterations,
  )
  const flow = await taskFlow(ctx, task)
  const reply = await fixReply(ctx, task, flow, await readBuildRecord(ctx, task))
  return ok(started ? { ...reply, already: true } : reply)
}

async function verifyKeepRedVerb(ctx: Ctx, task: Task, mode: string): Promise<Result<NextPayload>> {
  if (mode === "yours")
    return ok(base(task, { already: true, message: "The person's review is open." }))
  if (mode !== "asked")
    return refused("No exit question waits for a Keep answer.", [
      {
        what: "an exit question the person answered Keep it red and review it",
        move: "qualitylayer verify judge",
      },
    ])
  return runVerify(ctx, task, "keep")
}

/**
 * `verify judge | recheck | fix | keep-red`: one verb per thing the agent claims. A judgement that
 * passed stands (`already`); the exit's answers are the person's, so they are read, never assumed.
 */
export async function verifyVerb(
  ctx: Ctx,
  task: Task,
  verb: VerifyVerb,
): Promise<Result<NextPayload>> {
  const mode = (await readVerifyMode(ctx, task)) ?? "checking"
  const reviewing = verb === "judge" || verb === "recheck"
  if (reviewing && mode === "asked")
    return refused("Verify waits for the person's answer to its exit question.", [ANSWER_FIRST])
  if (reviewing && (await hasReviewCandidate(ctx, task)))
    return runVerify(ctx, task, verb === "recheck" ? "recovery-recheck" : "judge")
  if (verb === "judge") return verifyJudgeVerb(ctx, task, mode)
  if (verb === "recheck") return verifyRecheckVerb(ctx, task, mode)
  return verb === "fix" ? verifyFixVerb(ctx, task, mode) : verifyKeepRedVerb(ctx, task, mode)
}
