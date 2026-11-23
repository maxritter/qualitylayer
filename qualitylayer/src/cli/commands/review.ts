// review <plan | build | verify>: the independent review by the other agent. An opened gate, or the
// build reaching its first finished slices, starts it by itself, in the background; `wait --for
// review` blocks until it is back. Thin parsing over core/review/cross.

import { runAnotherReview } from "../../core/review/another.ts"
import { runAnswers } from "../../core/review/answers.ts"
import { decidedStepOf, type ReviewPoint, runCrossReview } from "../../core/review/cross.ts"
import { decideThread, openThreads } from "../../core/review/triage.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { parseArgs, requireTask } from "./shared.ts"

const POINTS: ReviewPoint[] = ["plan", "build", "verify"]

const USAGE =
  'usage: qualitylayer review plan | build | verify · review threads · review decide <thread> --as fix|other|answer|replan --note "…"'

/** `review threads`: the open threads of this task's Review. `review decide`: how the author settled one. */
async function threadsCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (args[0] === "threads") {
    return ok({ threads: await openThreads(ctx, task.data) })
  }
  const { positional, flags } = parseArgs(args.slice(1), ["as", "note"])
  const thread = positional[0]
  if (thread === undefined || typeof flags.as !== "string") {
    return err({
      code: "bad_args",
      message: 'usage: qualitylayer review decide <thread> --as fix|other|answer|replan --note "…"',
    })
  }
  const decided = await decideThread(
    ctx,
    task.data,
    thread,
    flags.as,
    typeof flags.note === "string" ? flags.note : "",
  )
  if (!decided.ok) return decided
  return ok({
    ...decided.data,
    instructions:
      "Recorded in the thread. Go on with the next thread that needs triage; when none is left, run `qualitylayer ship` (after the approval) or `qualitylayer next`.",
  })
}

async function answerCmd(ctx: Ctx, rest: string[]): Promise<Result<unknown>> {
  // A project's artifacts belong to no task: the worker is named by their project and root.
  const { flags } = parseArgs(rest, ["task", "artifacts", "root"])
  if (flags.artifacts !== undefined)
    return err({
      code: "bad_args",
      message: "Standalone artifact feedback is retired; its history is read-only.",
    })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  return ok(await runAnswers(ctx, task.data))
}

async function anotherCmd(ctx: Ctx, rest: string[]): Promise<Result<unknown>> {
  const task = await requireTask(ctx)
  if (!task.ok) return task
  const { flags } = parseArgs(rest, ["run"])
  if (typeof flags.run !== "string")
    return err({ code: "bad_args", message: "usage: qualitylayer review another --run <id>" })
  return ok({ run: await runAnotherReview(ctx, task.data, flags.run) })
}

async function crossReviewCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const point = args[0] as ReviewPoint | undefined
  if (point === undefined || !POINTS.includes(point))
    return err({ code: "bad_args", message: USAGE })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  // A gate that starts this worker says which review to run; a person's own `review plan` decides.
  const { flags } = parseArgs(args.slice(1), ["by", "model", "effort", "kind", "panel"])
  const decided = decidedStepOf(task.data, point, flags)
  if (!decided.ok) return decided
  const result = await runCrossReview(ctx, task.data, point, decided.data)
  return result.ok ? { ok: true, data: result.data } : result
}

export async function reviewCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args[0] === "threads" || args[0] === "decide") return threadsCmd(ctx, args)
  // The worker a question on a line of the change starts: it answers through the waiting session or
  // a fresh helper, and ends once every question is settled.
  if (args[0] === "answer") return answerCmd(ctx, args.slice(1))
  // The worker Ask another reviewer starts: one review of a file or the whole change.
  if (args[0] === "another") return anotherCmd(ctx, args.slice(1))
  return crossReviewCmd(ctx, args)
}
