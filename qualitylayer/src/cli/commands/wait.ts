// wait [--for answer|approval|review|helper]: the one way to wait. It blocks until the person, a
// reviewer, a helper or a check acts and says what happened. A recorded decision is applied here,
// exactly once (the gate's own settle). Without `--for` it waits for whatever the task waits for.

import * as gate from "../../core/gate/gate.ts"
import { helperLines } from "../../core/helpers.ts"
import { outsidePoller, readSent } from "../../core/integrations/approval.ts"
import { moveStateOf } from "../../core/next/compass.ts"
import { refused } from "../../core/next/refusal.ts"
import { afterDecision } from "../../core/next.ts"
import { projectRuntimeDir, resolveRepo } from "../../core/paths.ts"
import { handleOf, type ReviewPoint, waitForReview } from "../../core/review/cross.ts"
import { agentSession } from "../../core/task/question.ts"
import { homeQuestionDir } from "../../core/task/question-app.ts"
import { readBatch } from "../../core/task/question-batch.ts"
import type { Task } from "../../core/task/store.ts"
import { BATCH_QUIET_MS, type WaitKind, waitFor } from "../../core/wait.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { parseArgs, requireTask } from "./shared.ts"

const USAGE =
  "usage: qualitylayer wait [--for answer|approval|review|helper] [--until-decided] [--until-event] [--batch <batch-id>] [--quiet <seconds>] [--seconds 1..1800] [--home] [--task <task>]. " +
  "The default wait is 55 seconds. Use --until-event or --until-decided for a background wait of up to 30 minutes. " +
  "--for approval --until-decided returns on approval, requested changes, new comments, a review to address, a saved answer to fold into the Plan, or timeout. Follow the returned move. A decision is applied once. " +
  "--for answer waits for the person's answer, --for review for the other agent's review, and --for helper for a helper to finish. " +
  "--batch holds answers until the batch is complete or no new answer arrives for --quiet seconds (default 45). Add --json for one JSON object."

type For = "answer" | "approval" | "review" | "helper"
const FORS: readonly For[] = ["answer", "approval", "review", "helper"]

/** The quiet period in milliseconds: `--quiet`, else the environment (tests), else 45 seconds. */
function quietMs(ctx: Ctx, flag: string | true | undefined): number | null {
  const given = flag ?? ctx.env.get("QUALITYLAYER_WAIT_QUIET_SECONDS")
  if (given === undefined) return BATCH_QUIET_MS
  const seconds = given === true ? Number.NaN : Number(given)
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 1800 ? seconds * 1000 : null
}

/** What the task waits for when `--for` is not given, read from the moves table. */
async function waitedFor(ctx: Ctx, task: Task): Promise<For | null> {
  // A recorded decision is the task's own only on its step's gate: a Plan decision is never
  // applied once the task is past Plan, nor the final one outside Verify.
  const decided = await gate.pendingDecision(ctx, task)
  if (decided !== null && (decided.target === gate.FINAL ? "verify" : "plan") === task.stage)
    return "approval"
  const { state } = await moveStateOf(ctx, task)
  if (state.stage === "plan")
    return state.gate === "reviewing" ? "review" : state.gate === "none" ? null : "approval"
  if (state.stage === "verify")
    return state.mode === "asked" ? "answer" : state.mode === "yours" ? "approval" : null
  return null
}

/** `--for approval`: the person's decision on the open gate, applied once. */
async function forApproval(ctx: Ctx, task: Task, untilDecided: boolean): Promise<Result<unknown>> {
  // The final review opens when the page turned to the person; a reader may not have opened it yet.
  if (task.stage === "verify") await gate.ensureFinalReview(ctx, task)
  const current = await gate.readGate(ctx, task)
  // A Plan gate left behind once the task is past Plan is nothing to approve any more.
  const stale = current !== null && current.target !== gate.FINAL && task.stage !== "plan"
  const open = current !== null && current.settled !== true && !stale
  if (!open && !(await gate.finalApprovalUnheard(ctx, task, current))) {
    const { state } = await moveStateOf(ctx, task)
    return refused("Nothing is open for the person's approval on this task.", [
      state.stage === "plan"
        ? { what: "the Plan's gate, open", move: "qualitylayer gate open plan" }
        : state.stage === "verify" && state.mode === "rechecking"
          ? {
              what: "the recheck; their approval still saves meanwhile",
              move: "qualitylayer verify recheck",
            }
          : { what: "the step's next move", move: "qualitylayer next" },
    ])
  }
  // A Plan or a change sent for approval outside (`gate open plan|final --via`) is read while it waits.
  const target = task.stage === "plan" ? "plan" : task.stage === "verify" ? "final" : null
  const sent = target === null ? null : await readSent(ctx, task, target)
  const waited = await gate.wait(ctx, task, {
    untilDecided,
    ...(sent !== null && target !== null ? { outside: outsidePoller(ctx, task, { target }) } : {}),
  })
  if (!waited.ok) return waited
  const outcome = waited.data
  if (outcome.decision === "approved" || outcome.decision === "changes")
    return ok(await afterDecision(ctx, task, outcome))
  // The person commented while the gate stays open: the same event a plain wait reports.
  return ok(outcome.decision === "comments" ? { event: "comment", ...outcome } : outcome)
}

/** `--for review`: the other agent's review of the step the task is in. */
async function forReview(ctx: Ctx, task: Task): Promise<Result<unknown>> {
  const point: ReviewPoint =
    task.stage === "plan" ? "plan" : task.stage === "implement" ? "build" : "verify"
  const run = await waitForReview(ctx, task, point)
  if (run === null)
    return refused(`No review of the ${point} is running.`, [
      { what: "the step's next move", move: "qualitylayer next" },
    ])
  return ok({ event: "review", ...handleOf(task, run), findings: run.findings ?? null })
}

/** How often `--for helper` looks at the helpers' lines. */
const HELPER_POLL_MS = 2_000

/** `--for helper`: until one of the running helpers says it is done, or the time is up. */
async function forHelper(ctx: Ctx, task: Task, seconds: number): Promise<Result<unknown>> {
  const running = (await helperLines(ctx, task)).filter((helper) => !helper.done)
  if (running.length === 0)
    return refused("No helper is running for this task.", [
      { what: "the step's next move", move: "qualitylayer next" },
    ])
  const ids = new Set(running.map((helper) => helper.id))
  const until = ctx.clock.now() + seconds * 1000
  for (;;) {
    const lines = (await helperLines(ctx, task)).filter((helper) => ids.has(helper.id))
    const finished = lines.filter((helper) => helper.done).map((helper) => helper.id)
    if (finished.length > 0)
      return ok({
        event: "helper",
        finished,
        running: lines.filter((helper) => !helper.done).map((helper) => helper.id),
      })
    if (ctx.clock.now() >= until)
      return ok({
        event: "pending",
        again: true,
        status: lines.map((helper) => `${helper.id}: ${helper.line ?? "no line yet"}`).join("; "),
        then: "qualitylayer wait --for helper",
      })
    await ctx.clock.sleep(HELPER_POLL_MS)
  }
}

export async function waitCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { flags, positional } = parseArgs(args, ["seconds", "batch", "quiet", "for"])
  const untilDecided = flags["until-decided"] === true
  const long = flags["until-event"] === true || flags.batch !== undefined || untilDecided
  // A foreground wait stays under a tool's time limit; --until-event is the background wait.
  const fallback = flags["until-event"] === true || untilDecided ? 1800 : 55
  const seconds = flags.seconds === undefined ? fallback : Number(flags.seconds)
  const quiet = quietMs(ctx, flags.quiet)
  const asked = flags.for
  if (
    positional.length ||
    (flags.seconds !== undefined && typeof flags.seconds !== "string") ||
    (flags.batch !== undefined && typeof flags.batch !== "string") ||
    (asked !== undefined && !FORS.includes(asked as For)) ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 1800 ||
    quiet === null
  )
    return err({ code: "bad_args", message: USAGE })
  const batch = typeof flags.batch === "string" ? flags.batch : undefined
  // A wait that is not told to coalesce wakes for every answer, as it always did.
  const coalesce = long ? { quietMs: quiet, ...(batch !== undefined ? { batch } : {}) } : undefined
  // A wait for a batch or an answer is for the person's answer: a check a builder finishes
  // meanwhile is not what it waits for (it stays unheard for the next plain wait).
  const kinds =
    batch !== undefined || asked === "answer"
      ? { kinds: ["answer", "comment", "gate", "need"] as WaitKind[] }
      : {}
  if (flags.home === true) {
    const repo = await resolveRepo(ctx)
    if (!repo.ok) return repo
    const host = {
      runtimeDir: homeQuestionDir(projectRuntimeDir(ctx, repo.data.id)),
      stage: "plan" as const,
    }
    if (batch !== undefined) {
      const named = await readBatch(ctx, host, batch)
      if (!named) return err({ code: "bad_args", message: "unknown batch id" })
      if (named.session && named.session !== agentSession(ctx.env))
        return err({
          code: "bad_args",
          message: "Only the native session that asked this batch may wait for its answers.",
        })
    }
    return ok(await waitFor(ctx, host, { seconds, ...kinds, ...(coalesce ? { coalesce } : {}) }))
  }
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (batch !== undefined) {
    const named = await readBatch(ctx, task.data, batch)
    if (!named) return err({ code: "bad_args", message: "unknown batch id" })
    if (named.session && named.session !== agentSession(ctx.env))
      return err({
        code: "bad_args",
        message: "Only the native session that asked this batch may wait for its answers.",
      })
  }
  const what =
    (asked as For | undefined) ?? (batch === undefined ? await waitedFor(ctx, task.data) : null)
  if (what === "approval") return forApproval(ctx, task.data, untilDecided)
  if (what === "review") return forReview(ctx, task.data)
  if (what === "helper") return forHelper(ctx, task.data, seconds)
  return ok(await waitFor(ctx, task.data, { seconds, ...kinds, ...(coalesce ? { coalesce } : {}) }))
}
