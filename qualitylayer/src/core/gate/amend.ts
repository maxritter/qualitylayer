// `plan amend`: the build changes the approved Plan, within bounds. No gate reopens. Only
// `01-plan.md` is amended: a card is the build session's to change (`agents/02-implement.md`), never
// an amendment. The agent may amend what no decision of the person covers; a change to what the
// person decided needs their answer in the chat, recorded with --by user. Either way the Plan is
// validated, its approval is rebound, and one note records who and why.

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { proofOf } from "../acceptance.ts"
import { appendToSection, implementAgentsPath, NOTES } from "../docs/build-log.ts"
import { agentFileOf, folderDoc } from "../docs/names.ts"
import { allTasks, type Outline } from "../docs/outline.ts"
import { readCards } from "../docs/outline-files.ts"
import { readPullRequestRecord } from "../ship/pr-record.ts"
import { advance, type Stage } from "../task/machine.ts"
import { doctor } from "../task/reconcile.ts"
import { appendEvent, loadTask, type Task, taskDocPath } from "../task/store.ts"
import {
  formatAmendMessage,
  rebindAmendedDocs,
  recordAgreedAdditions,
  reopenedTasks,
  staleApprovals,
  unagreedBuildAdditions,
  validateAmendedDocs,
} from "./amend-helpers.ts"
import {
  commandsMoved,
  DECIDED_BY_YOU,
  readBaseline,
  rebaseCommands,
  writeBaseline,
} from "./baseline.ts"
import { lockPath } from "./gate.ts"
import { movedByUser, movedSinceApproval } from "./plan-moved.ts"
import { approvalCurrent } from "./revision.ts"
import { type StaleStep, staleSteps } from "./stale-steps.ts"

/** Once the Plan is approved, a changed Plan is amended in place instead of going back to planning. */
export const AMEND_STAGES: Stage[] = ["implement", "verify"]

/** What an amend says when the task is not at a stage the approved Plan reaches. */
export function notApprovedMessage(command: string, stage: Stage): string {
  return stage === "plan"
    ? `${command} works once the Plan is approved: the Plan is not approved yet; this task is at stage "${stage}"`
    : `${command} works on a task in progress after its Plan was approved; this task is at stage "${stage}"`
}

/**
 * Remember what the person decided, once the Plan is approved, so a later amendment can tell
 * whether it touches it. The Plan's approval records it; this fills it in on a build that has
 * none yet.
 */
export async function ensurePlanBaseline(ctx: Ctx, task: Task): Promise<void> {
  if (!AMEND_STAGES.includes(task.stage)) return
  if ((await readBaseline(ctx, task)) !== null) return
  if (!(await approvalCurrent(ctx, task, folderDoc("plan")))) return
  await writeBaseline(ctx, task)
}

export type AmendOptions = {
  by: "agent" | "user"
  note: string
  /** The tasks the change belongs to, named together on one line; a plan-level note without any. */
  taskIds?: string[]
  /** Why an addition outside the Plan is needed and what it costs: the person reads it beside Add and Skip it. */
  because?: string
  /** Set by `amendPlan` for a shipped task it reopens: every card was built, so a box open again is reopened. */
  afterApproval?: boolean
}

export type AmendResult = {
  /** An addition outside the Plan is applied at once: nothing waits for the person. */
  held: false
  by: "agent" | "user"
  /** The documents whose text changed since their approval. */
  changed: string[]
  /** Every approval rebound. */
  rebound: string[]
  /** The build log's one line for the amendment: `- T1, T2 (amended): …`, or `- Plan (…): …`. */
  lines: string[]
  details: string
  /** Steps of the Plan's Done means that name what the cards no longer hold: a file, a slice or a branch now gone. */
  stale_steps?: StaleStep[]
  then: string
  message: string
}

export async function amendPlan(
  ctx: Ctx,
  task: Task,
  options: AmendOptions,
): Promise<Result<AmendResult>> {
  return ctx.fs.withLock(lockPath(task), async () => {
    const current = await loadTask(ctx, { root: task.repoRoot, id: task.repoId }, task.slug)
    if (current === null)
      return err({ code: "bad_args", message: "The task has no valid current state" })
    return current.stage === "shipped"
      ? reopenShipped(ctx, current, options)
      : amendWithin(ctx, current, options)
  })
}

/**
 * A problem found after the approval, on an open pull request or on the person's own route (a
 * staging merge, a deploy, end-to-end tests), reopens the build: the fix is amended, built and
 * verified again, and needs a new approval. Only an amendment that holds and changes the Plan
 * reopens it; a refused or empty one leaves the task shipped.
 */
async function reopenShipped(
  ctx: Ctx,
  task: Task,
  options: AmendOptions,
): Promise<Result<AmendResult>> {
  if ((await readPullRequestRecord(ctx, task))?.state === "merged")
    return err({
      code: "bad_args",
      message:
        "This task's pull request is merged, so its change is in its base: a follow-up is a new task.",
    })
  const outcome: { amended?: Result<AmendResult> } = {}
  const reopened = await advance(ctx, task, "follow_up", {
    effect: async (updated) => {
      outcome.amended = await amendWithin(ctx, updated, { ...options, afterApproval: true })
      // An empty amendment fails the effect too, so the task is put back as shipped.
      const empty = outcome.amended.ok && outcome.amended.data.lines.length === 0
      return empty ? err({ code: "bad_args", message: "nothing was amended" }) : outcome.amended
    },
  })
  // The effect runs whenever the task could reopen: its answer stands, kept or put back.
  return outcome.amended ?? (reopened.ok ? amendWithin(ctx, task, options) : reopened)
}

async function checkAmendInputs(
  ctx: Ctx,
  task: Task,
  options: AmendOptions,
): Promise<Result<{ note: string; cards: Outline; taskIds: string[] }>> {
  if (!AMEND_STAGES.includes(task.stage))
    return err({ code: "bad_args", message: notApprovedMessage("plan amend", task.stage) })
  const note = options.note.replace(/\s+/g, " ").trim()
  if (note === "") {
    return err({
      code: "bad_args",
      message:
        'usage: qualitylayer plan amend --by agent|user --note "<what changed and why>" [--for T<n>]...',
    })
  }
  const cards = await readCards(ctx, task.dir)
  const taskIds = [...new Set((options.taskIds ?? []).map((id) => id.toUpperCase()))]
  const unknown = taskIds.filter((id) => !allTasks(cards).some((t) => t.id === id))
  if (unknown.length > 0) {
    return err({
      code: "bad_args",
      message: `${unknown.join(", ")} ${unknown.length === 1 ? "is not a card" : "are not cards"} in ${agentFileOf("implement")}`,
    })
  }
  return ok({ note, cards, taskIds })
}

function emptyAmendResult(plan: string, by: AmendOptions["by"]): Result<AmendResult> {
  return ok({
    held: false,
    by,
    changed: [],
    rebound: [],
    lines: [],
    details: "",
    then: "qualitylayer next",
    message:
      `Nothing in the approved Plan changed, so nothing was amended. A card is yours to change in ${agentFileOf("implement")} without an amendment. ` +
      `To amend, change ${plan} first, then run plan amend. Something the person decided during the build goes in ${plan} as a quote block ` +
      "that opens `> [!ADDED] build · <why>`, its text on the `>` lines after it, then `plan amend --by user`. " +
      "A note that changes no promise goes under Notes as a tactical line.",
  })
}

async function userDecisionGuardError(
  ctx: Ctx,
  task: Task,
  plan: string,
): Promise<Result<AmendResult>> {
  const why = await movedSinceApproval(ctx, task)
  return err({
    code: "bad_args",
    message:
      `${why === "" ? "" : `${why}\n`}this amendment changes what the person approved (the Problem, the Scope or a Done means point in ${plan}, ` +
      `or its ${DECIDED_BY_YOU}), which only they change. Put those passages back as approved; adding a step under a point is yours. ` +
      "Complete the approved promise; if it requires a decision only the person can make, ask them through the question flow " +
      "and record their answer before amending.",
  })
}

async function recordAmendment(input: {
  ctx: Ctx
  task: Task
  options: AmendOptions
  plan: string
  note: string
  cards: Outline
  taskIds: string[]
  stale: string[]
  baseline: Awaited<ReturnType<typeof readBaseline>>
  reopened: string[]
  decided: Awaited<ReturnType<typeof unagreedBuildAdditions>>
}): Promise<Result<AmendResult>> {
  const { ctx, task, options, plan, note, cards, taskIds, stale, baseline, reopened, decided } =
    input
  const changed = await rebindAmendedDocs(ctx, task, stale)
  if (options.by === "user") await writeBaseline(ctx, task)
  else await rebaseCommands(ctx, task)

  const named = [...new Set([...taskIds, ...reopened])]
  const kind = options.by === "user" ? "agreed" : "amended"
  const line = `- ${named.length > 0 ? named.join(", ") : "Plan"} (${kind}): ${note}`
  const logPath = implementAgentsPath(task)
  const logWritten = await ctx.fs.exists(logPath)
  if (logWritten)
    await ctx.fs.writeFile(logPath, appendToSection(await ctx.fs.readFile(logPath), NOTES, line))
  const documents = [
    ...new Set([...(changed.length > 0 ? changed : stale), ...decided.map((d) => d.doc)]),
  ]
  if (decided.length > 0) await recordAgreedAdditions(ctx, task, decided)
  await appendEvent(ctx, task, {
    event: "plan_amended",
    by: options.by,
    ...(named.length > 0 ? { tasks: named } : {}),
    ...(reopened.length > 0 ? { reopened } : {}),
    changed: documents,
    note,
  })
  const repaired = await doctor(ctx, task, true)
  const open =
    task.stage === "verify"
      ? allTasks(cards)
          .filter((t) => !t.checked)
          .map((t) => t.id)
      : []
  const steps = await staleSteps(
    ctx,
    task,
    cards,
    baseline?.files,
    (await proofOf(ctx, task)).steps,
  )
  return ok({
    held: false,
    by: options.by,
    changed: documents,
    rebound: stale,
    lines: [line],
    details: taskDocPath(task, "implement"),
    ...(steps.length > 0 ? { stale_steps: steps } : {}),
    then: "qualitylayer next",
    message: formatAmendMessage({
      plan,
      stale,
      documents,
      open,
      logWritten,
      line,
      repaired,
      steps,
    }),
  })
}

/** `amendPlan` for a caller that holds the gate lock already. */
export async function amendWithin(
  ctx: Ctx,
  task: Task,
  options: AmendOptions,
): Promise<Result<AmendResult>> {
  const checked = await checkAmendInputs(ctx, task, options)
  if (!checked.ok) return checked
  const { note, cards, taskIds } = checked.data
  const plan = folderDoc("plan")
  const stale = await staleApprovals(ctx, task)
  const baseline = await readBaseline(ctx, task)
  const moved = await movedByUser(ctx, task, baseline)
  const reopened = reopenedTasks(task, cards, baseline, options.afterApproval === true)
  const decided = options.by === "user" ? await unagreedBuildAdditions(ctx, task) : []

  const nothingChanged =
    stale.length === 0 &&
    reopened.length === 0 &&
    decided.length === 0 &&
    !(await commandsMoved(ctx, task, baseline))
  if (nothingChanged) return emptyAmendResult(plan, options.by)
  if (options.by === "agent" && (baseline === null || moved.agreed || moved.decided))
    return userDecisionGuardError(ctx, task, plan)

  const validated = await validateAmendedDocs(ctx, task, stale)
  if (!validated.ok) return validated

  return recordAmendment({
    ctx,
    task,
    options,
    plan,
    note,
    cards,
    taskIds,
    stale,
    baseline,
    reopened,
    decided,
  })
}
