// The project checks on the final source. A fix round's re-judgement does not wait for
// `qualitylayer check all`: the agent runs the focused checks it chooses for the code it changed,
// and the reviewer rechecks only the points the fix touched. The person's review opens once the full project
// checks have passed on the source that would ship. A red result withdraws the standing pass and
// sends Verify back to the failing check.

import { type Ctx, ok, type Result } from "../../ctx.ts"
import { failureWords } from "../check-failures.ts"
import {
  type CheckRecord,
  checksRanSinceAsked,
  checksReadyForReview,
  noteChecksAsked,
  RED_CHECK_MOVES,
  readCheckRecords,
} from "../checks.ts"
import { readBuildRecord } from "../docs/build-log.ts"
import { projectRedState, type RedStanding } from "../red-checks.ts"
import { fixRoundsOf } from "../task/stages.ts"
import { appendEvent, readEvents, type Task } from "../task/store.ts"
import { taskFlow } from "../task-flow.ts"
import { fixReply } from "./implement.ts"
import { base, flowFields, type NextPayload } from "./shared.ts"
import { openExit } from "./verify-exit.ts"

/** Whether a fix round is under way: a judgement failed and the reviewer has not passed since. */
export async function inFixRound(ctx: Ctx, task: Task): Promise<boolean> {
  return fixRoundsOf(await readEvents(ctx, task)).judgeRuns > 0
}

/**
 * Whether the person's review may open on a standing pass. Null when it may: no project check is red as the
 * task's own, whatever the reviewer ruled (a check red on the base too, or kept red by the person,
 * is not). Otherwise the reply: the check to run, or the route a red one takes. The checks must
 * also have run on the final source: after a fix round, and after a commit the pass carries without
 * a reviewer (the reviewer's own tests, a later test-only commit).
 */
export async function finalCheckGate(ctx: Ctx, task: Task): Promise<Result<NextPayload> | null> {
  const ready = await checksReadyForReview(ctx, task)
  const recorded = !ready && (await checksRanSinceAsked(ctx, task))
  if (!ready && !recorded) {
    await noteChecksAsked(ctx, task)
    return ok(
      base(task, {
        phase: "verify",
        command: "qualitylayer check all",
        message:
          "The pass stands. The page turns to the person once the project checks have passed on the final source.",
        ...flowFields(await taskFlow(ctx, task)),
        then: "qualitylayer verify judge",
      }),
    )
  }
  return redCheckGate(ctx, task, recorded)
}

/**
 * With Independent review off nobody rules on a red project check, so a red latest result keeps the
 * page from the person: the same route as a red final check. Null when no project check is red.
 */
/** `asRecorded`: the latest runs stand for the source though it moved since (checksRanSinceAsked). */
export async function redCheckGate(
  ctx: Ctx,
  task: Task,
  asRecorded = false,
): Promise<Result<NextPayload> | null> {
  const { red, excused } = await projectRedState(ctx, task, undefined, asRecorded)
  const [first] = red
  return first === undefined ? null : withdraw(ctx, task, first, excused.standing.get(first))
}

/** A red result on the final source: the pass no longer stands; the way on is a fix or the exit question. */
async function withdraw(
  ctx: Ctx,
  task: Task,
  red: CheckRecord,
  standing: RedStanding | undefined,
): Promise<Result<NextPayload>> {
  // Red on the base too, with no test name to match: a fix round cannot tell whether the task broke
  // it, so the person decides whether to keep it red.
  if (red.timedOut !== true && standing?.state === "unmatched")
    return ok(await openExit(ctx, task, "red_base", { fixable: true }))
  const fresh = standing?.state === "new_failures" ? standing : null
  const seen = (await readCheckRecords(ctx, task)).length
  const again = (await readEvents(ctx, task)).findLast(
    (e) => e.event === "verify_withdrawn" && e.iteration === task.iterations,
  )
  if (again?.seen !== seen)
    await appendEvent(ctx, task, {
      event: "verify_withdrawn",
      iteration: task.iterations,
      command: red.command,
      seen,
    })
  if (red.timedOut === true)
    return ok(await openExit(ctx, task, "check_budget", { fixable: false }))
  // The withdrawn pass is a failed judgement: the task stays in Verify, in a fix round.
  const build = await fixReply(
    ctx,
    task,
    await taskFlow(ctx, task),
    await readBuildRecord(ctx, task),
  )
  const how = red.exit === null ? "stopped without an exit result" : `exited ${red.exit}`
  // Only what is new is named: the failures the base run shares count as red on the base.
  const named =
    fresh === null
      ? ""
      : ` ${failureWords(fresh.names)}${fresh.known > 0 ? `; ${fresh.known} more also fail on the base` : ""}.`
  return ok({
    ...build,
    message: `The project checks failed on the final source: \`${red.command}\` ${how}${red.log ? ` (log: ${red.log})` : ""}.${named} The reviewer's pass does not stand while a check is red. ${RED_CHECK_MOVES}`,
  })
}
