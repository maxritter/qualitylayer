// The verbs: every change of a task is a command that says what the agent claims (plan §3.7). `next`
// only reads (next/compass.ts); these act, each idempotent (`already: true` when repeated after it
// succeeded), each refusal with `missing` (what is not there, and the move that settles it), each
// reply with the moves open after it, from the one table in next/moves.ts.

import { join } from "node:path"
import { phaseText } from "#workflow"
import { type Ctx, ok, type Result } from "../ctx.ts"
import { ciParityWarning } from "./ci-parity.ts"
import type { Answers } from "./config-values.ts"
import { readBuildRecord } from "./docs/build-log.ts"
import { fillNames, LOGS } from "./docs/names.ts"
import { allTasks } from "./docs/outline.ts"
import { ensurePlanBaseline } from "./gate/amend.ts"
import { markPicked } from "./gate/comments.ts"
import {
  FINAL,
  type GateFile,
  type GateOutcome,
  invalidateGate,
  pendingDecision,
  readGate,
  reopenVerify,
  settle,
} from "./gate/gate.ts"
import { readBuildStart, stagedBaseline, withStagedBaseline } from "./git/build-start.ts"
import { otherBuildLead, readBuildLead } from "./next/build-lead.ts"
import { moveStateOf } from "./next/compass.ts"
import { buildDone, buildStart, implementPayload, implementStop } from "./next/implement.ts"
import { movesOf } from "./next/moves.ts"
import { planPayload } from "./next/plan.ts"
import { actionable, refused } from "./next/refusal.ts"
import { served, stepTextAsServed } from "./next/reply.ts"
import { BUILD_STAGES, base, type NextPayload } from "./next/shared.ts"
import { adoptPlan, pendingShip, shippedPayload, showMePayload, waitingShips } from "./next/ship.ts"
import { askPlaceFirst, handback, startedPayload } from "./next/start.ts"
import { finalPayload, type VerifyVerb, verifyBrief, verifyVerb } from "./next/verify.ts"
import { type RepoRef, resolveRepo, taskDir } from "./paths.ts"
import { noteTaskStatus } from "./peers/task-status.ts"
import { withTaskComments } from "./planning-comments.ts"
import { closingReadyPath, shipStatePath } from "./ship/closing-record.ts"
import { adoptExistingPlan, ORIGINAL_FILE, type OriginalSource } from "./task/adoption.ts"
import { isArchived } from "./task/archive.ts"
import { sessionKey } from "./task/binding.ts"
import { advance } from "./task/machine.ts"
import { reconcile } from "./task/reconcile.ts"
import { startTask } from "./task/startup.ts"
import {
  EARLIER_LAYOUT_REASON,
  isCurrentLayout,
  listTasks,
  loadTask,
  lostIdentity,
  readmeFrontmatter,
  readSession,
  registerProject,
  resolveTask,
  type Task,
  type TaskType,
} from "./task/store.ts"
import { type TaskFlow, taskFlow } from "./task-flow.ts"

export { type Compass, compass, stripInvocation } from "./next/compass.ts"
export { INLINE_REPLY_LIMIT } from "./next/reply.ts"
export type { NextPayload } from "./next/shared.ts"

type Replied = Result<NextPayload>
type Reply = Promise<Replied>

const START_MOVE = { what: "a task", move: 'qualitylayer task start "<request>"' }

/** The open task a verb acts on, or the refusal that names how to get one. */
async function taskOf(ctx: Ctx, repo: RepoRef): Promise<Result<Task>> {
  const task = await resolveTask(ctx, repo)
  if (task === null) {
    const lost = await lostIdentity(ctx, repo)
    return lost !== null
      ? refused(lost.message, [{ what: `task ${lost.slug}`, move: lost.move }])
      : refused("No open task in this repository.", [START_MOVE])
  }
  return usable(ctx, task)
}

/** A task the workflow can act on: of this workflow, not archived, not a Chat. */
async function usable(ctx: Ctx, task: Task): Promise<Result<Task>> {
  if (!isCurrentLayout(task)) return refused(`${task.slug}: ${EARLIER_LAYOUT_REASON}`, [START_MOVE])
  if (await isArchived(ctx, task))
    return refused(`${task.slug} is archived.`, [
      { what: "the task restored", move: `qualitylayer task restore ${task.slug}` },
    ])
  if (task.type === "chat")
    return refused("This is a Chat, outside the workflow's steps.", [
      { what: "a task made from it", move: "qualitylayer chat promote --type feature|bugfix" },
    ])
  return ok(task)
}

/**
 * A verb's reply as it leaves: a refusal made actionable; a success
 * with the moves open after it, the CI warning, and the texts filled and marked (`served`).
 */
async function finish(ctx: Ctx, task: Task, _verb: string, result: Replied): Reply {
  if (!result.ok) return { ok: false, error: actionable(result.error) }
  const now = (await loadTask(ctx, { root: task.repoRoot, id: task.repoId }, task.slug)) ?? task
  const { state } = await moveStateOf(ctx, now)
  const warning = isCurrentLayout(now) ? await ciParityWarning(ctx, now) : null
  const data: NextPayload = {
    ...result.data,
    ...(warning !== null
      ? {
          warnings: [...((result.data.warnings as string[] | undefined) ?? []), warning],
          instructions: `${warning}\n\n${String(result.data.instructions ?? "")}`.trim(),
        }
      : {}),
    moves: movesOf(state),
  }
  // The calling session's line in `peers list` names this task and the step it is on now.
  await noteTaskStatus(ctx, now.slug)
  return served(ctx, data)
}

/** The verb run on the open task; its refusals and replies finished alike. */
async function onTask(ctx: Ctx, verb: string, act: (task: Task, repo: RepoRef) => Reply): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const task = await taskOf(ctx, repo.data)
  if (!task.ok) return task
  return finish(ctx, task.data, verb, await act(task.data, repo.data))
}

// ---------------------------------------------------------------- task start · handback · abandon

export type StartOptions = {
  type?: TaskType
  title?: string
  answers?: Answers
  /** A start by a script: no agent session takes the task; it waits on Home. */
  script?: boolean
  /** The person's own plan, kept as given; the Plan maps it. */
  fromPlan?: OriginalSource
}

/** `task start "<request>"`: a task at Plan, its brief, and the place question when nothing is chosen. */
export async function taskStart(ctx: Ctx, request: string, options: StartOptions = {}): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  await registerProject(ctx, repo.data)
  if (options.fromPlan !== undefined)
    return startFromPlan(ctx, repo.data, options.fromPlan, options)
  const started = await startTask(ctx, repo.data, request, {
    ...(options.type !== undefined ? { type: options.type } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.answers !== undefined ? { answers: options.answers } : {}),
    ...(options.script === true ? { script: true as const } : {}),
  })
  if (!started.ok) return started
  const { task, created } = started.data
  if (options.script === true)
    return ok({
      task: task.slug,
      id: `${task.repoId}~${task.slug}`,
      title: task.title,
      step: task.type === "chat" ? "chat" : "plan",
      moves: movesOf(task.type === "chat" ? { stage: "chat" } : { stage: "plan", gate: "none" }),
    })
  const payload = await startedPayload(ctx, repo.data, task, created)
  const waiting = (await waitingShips(ctx, repo.data)).map(({ slug }) => ({
    task: slug,
    command: `qualitylayer ship --task ${slug}`,
  }))
  return finish(
    ctx,
    task,
    "task start",
    ok(waiting.length ? { ...payload, ship_waiting: waiting } : payload),
  )
}

/**
 * `task start --from-plan <file|->`: a task from a plan the person already has. The plan is kept as
 * given (task/adoption.ts) and the task enters the Plan, which maps it. Sending the same plan again
 * from this session continues the task it started.
 */
async function startFromPlan(
  ctx: Ctx,
  repo: RepoRef,
  source: OriginalSource,
  options: StartOptions,
): Reply {
  const adopted = await adoptExistingPlan(ctx, repo, source, {
    type: options.type === "chat" ? undefined : options.type,
    title: options.title,
    answers: options.answers,
  })
  if (!adopted.ok) return adopted
  const { task, created } = adopted.data
  const payload = await planPayload(ctx, task)
  const message = `${created ? "Started a new task" : "Continuing the task"} from your existing plan: ${task.slug}. The plan is kept exactly as given in ${ORIGINAL_FILE}; the Plan maps it.`
  return finish(
    ctx,
    task,
    "task start",
    ok({
      ...payload,
      ...(created ? { created: true } : { already: true }),
      message,
      ...(await askPlaceFirst(ctx, task, String(payload.instructions ?? ""), message)),
    }),
  )
}

/** `task handback "<reason>" --prompt "<prompt>"`: close the Plan task and keep a plain prompt. */
export async function taskHandback(
  ctx: Ctx,
  reason: string,
  options: { prompt?: string; title?: string } = {},
): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const found = await resolveTask(ctx, repo.data)
  // Without a task, the prompt is kept on its own in the App's history.
  if (found === null) return handback(ctx, repo.data, null, reason, options)
  const task = await usable(ctx, found)
  if (!task.ok) return task
  if (task.data.stage === "abandoned")
    return finish(
      ctx,
      task.data,
      "task handback",
      ok(base(task.data, { already: true, done: true })),
    )
  if (task.data.stage !== "plan")
    return finish(
      ctx,
      task.data,
      "task handback",
      refused(`A task is handed back from its Plan; ${task.data.slug} is in ${task.data.stage}.`, [
        { what: "the task stopped instead", move: "qualitylayer task abandon" },
      ]),
    )
  return finish(
    ctx,
    task.data,
    "task handback",
    await handback(ctx, repo.data, task.data, reason, options),
  )
}

/** `task abandon`: stop the task; its files stay. */
export async function taskAbandon(ctx: Ctx): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const found = await resolveTask(ctx, repo.data)
  if (found === null) return refused("No open task in this repository.", [START_MOVE])
  if (found.stage === "abandoned")
    return ok(base(found, { already: true, done: true, moves: movesOf({ stage: "abandoned" }) }))
  const task = await usable(ctx, found)
  if (!task.ok) return task
  const abandoned = await advance(ctx, task.data, "user_abandoned")
  if (!abandoned.ok) return finish(ctx, task.data, "task abandon", abandoned)
  return finish(
    ctx,
    task.data,
    "task abandon",
    ok(
      base(task.data, {
        done: true,
        message: `${task.data.slug} was abandoned; its files stay in the repository.`,
      }),
    ),
  )
}

/** `show <topic>`: the "show me" view of a topic, at any stage, without moving the task. */
export async function showTopic(ctx: Ctx, topic: string): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  return served(ctx, await showMePayload(ctx, await resolveTask(ctx, repo.data), topic))
}

// ------------------------------------------------------------------------------------- brief

/** Which session read a step's text: QualityLayer's own record, outside the briefs folder the agent is granted. */
const briefMarker = (task: Task, step: string) => join(task.runtimeDir, `brief-served-${step}.json`)

/**
 * The step's text, paid once per session: served again to the same session with the same text, the
 * reply is `already` and names the file that holds it instead of repeating it.
 */
async function onceText(
  ctx: Ctx,
  task: Task,
  step: string,
  payload: NextPayload,
): Promise<NextPayload> {
  const said = typeof payload.instructions === "string" ? payload.instructions : ""
  if (said === "") return payload
  // The file holds the text as the session got it, the person's block for the step included, so an
  // edit of their instructions is a new text and reaches the next brief.
  const text = await stepTextAsServed(ctx, task, String(payload.phase ?? step), fillNames(said))
  const { createHash } = await import("node:crypto")
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 24)
  const session = sessionKey(ctx.env) ?? "unbound"
  // In the briefs folder the session reads from (a managed run's grant, else the task's own); a
  // text too long for a reply was filed there as served, under the same digest.
  const dir = ctx.managedBriefsDir ?? join(task.runtimeDir, "briefs")
  const file = join(dir, `${step}-${digest}.md`)
  let seen: { session?: string; digest?: string; ref?: string } = {}
  try {
    seen = JSON.parse(await ctx.fs.readFile(briefMarker(task, step)))
  } catch {
    seen = {}
  }
  // Paid once only after the text reached the session (`brief` records where it went).
  if (
    seen.session === session &&
    seen.digest === digest &&
    typeof seen.ref === "string" &&
    (await ctx.fs.exists(file))
  ) {
    const ref = seen.ref !== "inline" && (await ctx.fs.exists(seen.ref)) ? seen.ref : file
    return {
      ...payload,
      already: true,
      instructions: `The ${step} text is unchanged since this session read it; read \`${ref}\` again only if it is no longer in your context.`,
      instructions_ref: ref,
      instructions_once: true,
    }
  }
  await ctx.fs.mkdir(dir)
  await ctx.fs.atomicWrite(file, text)
  await ctx.fs.atomicWrite(briefMarker(task, step), `${JSON.stringify({ session, digest })}\n`)
  return payload
}

/**
 * The staged files from before the build that the cards, once written, name: said once, with the
 * first brief that has the cards. `build start` comes before the cards and can name none of them.
 */
async function withCardsStaged(
  ctx: Ctx,
  task: Task,
  flow: TaskFlow,
  payload: NextPayload,
): Promise<NextPayload> {
  if (flow.plan === null || allTasks(flow.plan).length === 0) return payload
  const noted = join(task.runtimeDir, "staged-baseline-noted.json")
  if (await ctx.fs.exists(noted)) return payload
  const start = await readBuildStart(ctx, task)
  if (start === null) return payload
  const found = stagedBaseline(start, flow.plan)
  await ctx.fs.atomicWrite(noted, `${JSON.stringify({ at: ctx.clock.now() })}\n`)
  return found !== null && found.named_by_cards.length > 0
    ? withStagedBaseline(payload, found)
    : payload
}

export type BriefStep = "plan" | "implement" | "verify"

/**
 * `brief [plan|implement|verify]`: the step's text and payload. The current step's brief may start
 * its helpers (the research helpers, the security review); another step's is its text alone.
 */
export async function brief(ctx: Ctx, asked?: BriefStep): Reply {
  const reply = await briefReply(ctx, asked)
  // The file the served text went to is the one a repeated brief names (onceText).
  if (reply.ok && reply.data.already !== true) {
    const repo = await resolveRepo(ctx)
    const task = repo.ok ? await resolveTask(ctx, repo.data) : null
    const step = typeof reply.data.phase === "string" ? reply.data.phase : null
    if (task !== null && step !== null)
      try {
        const marker = briefMarker(task, step)
        const seen = JSON.parse(await ctx.fs.readFile(marker)) as Record<string, unknown>
        await ctx.fs.atomicWrite(
          marker,
          `${JSON.stringify({ ...seen, ref: typeof reply.data.instructions_ref === "string" ? reply.data.instructions_ref : "inline" })}\n`,
        )
      } catch {
        // No marker: the text was not served once (an exit's words, another step's text).
      }
  }
  // The person's comments on the planning documents come with the Plan's brief, once each, ahead
  // of the step's text.
  if (reply.ok && reply.data.phase === "plan") {
    const repo = await resolveRepo(ctx)
    const task = repo.ok ? await resolveTask(ctx, repo.data) : null
    if (task !== null) return ok(await withTaskComments(ctx, task, reply.data))
  }
  return reply
}

async function briefReply(ctx: Ctx, asked?: BriefStep): Reply {
  return onTask(ctx, `brief ${asked ?? ""}`.trim(), async (task) => {
    const current: BriefStep | null =
      task.stage === "plan" || task.stage === "implement" || task.stage === "verify"
        ? task.stage
        : task.stage === "shipped"
          ? "verify"
          : null
    const step = asked ?? current
    if (step === null)
      return refused(`${task.slug} is ${task.stage}: no step's text applies.`, [START_MOVE])
    if (step !== current)
      return ok(
        base(task, {
          phase: step,
          instructions:
            phaseText(task.type === "bugfix" ? `${step}-bugfix` : step) ?? phaseText(step) ?? "",
          message: `The ${step} text only: ${task.slug} is in ${task.stage}.`,
        }),
      )
    if (step === "plan") return ok(await onceText(ctx, task, step, await planPayload(ctx, task)))
    if (step === "implement") {
      if ((await readBuildLead(ctx, task)) === null)
        return ok(
          base(task, {
            phase: "implement",
            instructions:
              phaseText(task.type === "bugfix" ? "implement-bugfix" : "implement") ?? "",
            message: "No session builds this task yet: qualitylayer build start takes it here.",
          }),
        )
      const checked = await reconcile(ctx, task)
      if (!checked.ok) return checked
      const flow = await taskFlow(ctx, task)
      const payload = await implementPayload(ctx, task, flow, await readBuildRecord(ctx, task))
      return ok(await onceText(ctx, task, step, await withCardsStaged(ctx, task, flow, payload)))
    }
    if (task.stage === "shipped") return ok(await finalPayload(ctx, task))
    const checked = await reconcile(ctx, task)
    if (!checked.ok) return checked
    const verified = await verifyBrief(ctx, task)
    if (!verified.ok) return verified
    // The reply may be a move alone (run the checks, hand out the judge): the brief is still
    // Verify's text. An exit's reply keeps its own words: its question is all that is open.
    const said = typeof verified.data.instructions === "string" ? verified.data.instructions : ""
    const payload =
      verified.data.phase === "verify" && said === "" && verified.data.exit === undefined
        ? {
            ...verified.data,
            instructions: phaseText(task.type === "bugfix" ? "verify-bugfix" : "verify") ?? "",
          }
        : verified.data
    return ok(await onceText(ctx, task, step, payload))
  })
}

// ------------------------------------------------------------------------------------- build

/**
 * The task `build start` without a task name builds: the one approved Plan whose build no other
 * session leads; several are listed, each with the command that builds it.
 */
async function approvedPlan(ctx: Ctx, repo: RepoRef): Promise<Result<Task>> {
  if ((ctx.env.get("QUALITYLAYER_TASK") ?? "") !== "") return taskOf(ctx, repo)
  const mine = sessionKey(ctx.env)
  const waiting: Task[] = []
  for (const task of await listTasks(ctx, repo)) {
    if (!isCurrentLayout(task) || (await isArchived(ctx, task))) continue
    const gate = task.stage === "plan" ? await readGate(ctx, task) : null
    const approved =
      task.stage === "implement" ||
      (gate !== null &&
        gate.target !== FINAL &&
        gate.decision === "approved" &&
        gate.settled !== true)
    if (!approved) continue
    const lead = await readBuildLead(ctx, task)
    if (lead !== null && lead.session !== mine) continue
    waiting.push(task)
  }
  const [only] = waiting
  if (waiting.length === 1 && only !== undefined) return ok(only)
  if (waiting.length > 1)
    return refused(
      `${waiting.length} approved Plans wait for their build.`,
      waiting.map((task) => ({
        what: task.title,
        move: `qualitylayer build start --task ${task.slug}`,
      })),
    )
  return taskOf(ctx, repo)
}

/** A decision recorded but not applied yet (the App, a timeout), applied once, here. */
async function applyDecision(
  ctx: Ctx,
  task: Task,
): Promise<Result<{ task: Task; outcome: GateOutcome | null }>> {
  const decided = await pendingDecision(ctx, task)
  if (decided === null) return ok({ task, outcome: null })
  const settled = await settle(ctx, task, decided)
  if (!settled.ok) return settledRefusal(ctx, task, decided, settled)
  const now = (await loadTask(ctx, { root: task.repoRoot, id: task.repoId }, task.slug)) ?? task
  return ok({ task: now, outcome: settled.data })
}

/**
 * A recorded decision that cannot be applied. A final approval whose reviewed papers moved is set
 * aside and the review reopened, so the agents recheck and the person approves again.
 */
async function settledRefusal(
  ctx: Ctx,
  task: Task,
  decided: GateFile,
  settled: Extract<Result<GateOutcome>, { ok: false }>,
): Promise<Result<never>> {
  if (decided.target === FINAL && settled.error.code === "validation_failed") {
    await invalidateGate(ctx, task)
    await ctx.fs.remove(closingReadyPath(task))
    await ctx.fs.remove(shipStatePath(task))
    await reopenVerify(ctx, task)
    return refused("The approved review's papers moved since the approval; the review reopens.", [
      { what: "the change rechecked", move: "qualitylayer verify recheck" },
    ])
  }
  return { ok: false, error: actionable(settled.error) }
}

/**
 * A build lives in one checkout; say so instead of working on a stale copy. Before the build has
 * started anywhere, any checkout may start it.
 */
async function wrongCheckout(ctx: Ctx, task: Task): Promise<Result<never> | null> {
  const session = await readSession(ctx, task)
  if (session === null || session.checkout === task.repoRoot) return null
  if (!BUILD_STAGES.includes(session.phase) || !(await ctx.fs.exists(session.checkout))) return null
  if (
    task.stage === "implement" &&
    !(await ctx.fs.exists(join(taskDir(session.checkout, task.slug), LOGS.implement)))
  )
    return null
  return refused(
    `This task's build lives in ${session.checkout}.`,
    [{ what: "the build continued there", move: `cd ${session.checkout} && qualitylayer next` }],
    "wrong_checkout",
  )
}

/** What a build verb needs before it acts: the approved Plan as approved, in this checkout. */
async function buildReady(ctx: Ctx, task: Task): Promise<Result<true>> {
  const checked = await reconcile(ctx, task)
  if (!checked.ok) return checked
  // What the person decided, remembered while the Plan is the approved one.
  await ensurePlanBaseline(ctx, task)
  return (await wrongCheckout(ctx, task)) ?? ok(true)
}

/** What a verb in a later step needs while the task is still at Plan: the person's approval. */
async function approvalFirst(ctx: Ctx, task: Task): Promise<Result<never>> {
  const gate = await readGate(ctx, task)
  const open =
    gate !== null && gate.target !== FINAL && gate.settled !== true && gate.decision === "pending"
  return refused(`${task.slug} is at Plan: the build starts once the person approves it.`, [
    open
      ? { what: "the person's approval of the Plan", move: "qualitylayer wait --for approval" }
      : { what: "the Plan's gate, open", move: "qualitylayer gate open plan" },
  ])
}

/** `build start [--task <task>]`: this session takes the approved Plan's build. */
export async function buildStartVerb(ctx: Ctx): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  await registerProject(ctx, repo.data)
  // The checkout that builds holds the Plan: copy it from the one that planned it when it is missing.
  if ((await resolveTask(ctx, repo.data)) === null) await adoptPlan(ctx, repo.data)
  const picked = await approvedPlan(ctx, repo.data)
  if (!picked.ok) return picked
  const applied = await applyDecision(ctx, picked.data)
  if (!applied.ok) return finish(ctx, picked.data, "build start", applied)
  const task = applied.data.task
  if (task.stage === "plan") return finish(ctx, task, "build start", await approvalFirst(ctx, task))
  if (task.stage === "verify" || task.stage === "shipped")
    return finish(
      ctx,
      task,
      "build start",
      ok(
        base(task, {
          already: true,
          message: `The build of ${task.slug} is done; it is in ${task.stage}.`,
        }),
      ),
    )
  if (task.stage !== "implement")
    return finish(ctx, task, "build start", refused(`${task.slug} is ${task.stage}.`, [START_MOVE]))
  const ready = await buildReady(ctx, task)
  if (!ready.ok) return finish(ctx, task, "build start", ready)
  // Another session leads this build: without the task's name this session does not take it over.
  if ((ctx.env.get("QUALITYLAYER_TASK") ?? "") === "" && (await otherBuildLead(ctx, task)) !== null)
    return finish(
      ctx,
      task,
      "build start",
      refused(`Another session builds ${task.slug}; nothing was taken over.`, [
        { what: "its progress, without taking it", move: "qualitylayer next" },
        {
          what: "this session taking the build over, by the task's name",
          move: `qualitylayer build start --task ${task.slug}`,
        },
      ]),
    )
  return finish(ctx, task, "build start", await buildStart(ctx, task))
}

/** `build done [--defer "<why>"]`: the build is ready, Implement → Verify. */
export async function buildDoneVerb(ctx: Ctx, defer: string | null): Reply {
  return onTask(ctx, "build done", async (task) => {
    if (task.stage === "plan") return approvalFirst(ctx, task)
    if (task.stage === "verify" || task.stage === "shipped")
      return ok(base(task, { already: true, message: `${task.slug} is in ${task.stage}.` }))
    if (task.stage !== "implement") return refused(`${task.slug} is ${task.stage}.`, [START_MOVE])
    if ((await readBuildLead(ctx, task)) === null)
      return refused("No session builds this task yet.", [
        { what: "the build taken by this session", move: "qualitylayer build start" },
      ])
    const ready = await buildReady(ctx, task)
    if (!ready.ok) return ready
    return buildDone(ctx, task, defer)
  })
}

// ------------------------------------------------------------------------------------- verify

/** `verify judge | recheck | fix | keep-red`. */
export async function verifyVerbCmd(ctx: Ctx, verb: VerifyVerb): Reply {
  return onTask(ctx, `verify ${verb}`, async (task) => {
    if (task.stage === "plan") return approvalFirst(ctx, task)
    if (task.stage === "implement")
      return refused(`${task.slug} is still in Implement.`, [
        { what: "the build declared ready", move: "qualitylayer build done" },
      ])
    // After the approval, a fix for what the pull request says is rechecked before it is pushed.
    if (task.stage === "shipped")
      return verb === "recheck"
        ? ok(await shippedPayload(ctx, task))
        : ok(base(task, { already: true, message: `${task.slug} is approved; ship lands it.` }))
    if (task.stage !== "verify") return refused(`${task.slug} is ${task.stage}.`, [START_MOVE])
    // The person's approval always saves; once it is recorded the agents' verbs give way to it.
    const decided = await pendingDecision(ctx, task)
    if (decided !== null && decided.target === FINAL && decided.decision === "approved")
      return refused("The person approved the change.", [
        { what: "their approval, applied", move: "qualitylayer wait --for approval" },
      ])
    const ready = await buildReady(ctx, task)
    if (!ready.ok) return ready
    return verifyVerb(ctx, task, verb)
  })
}

// ------------------------------------------------------------------------------------- ship

/**
 * A crash after settling the final gate but before clearing the closing marker leaves the task on
 * Verify while it is shipped: the closing finishes once, here.
 */
async function finishedClosing(ctx: Ctx, task: Task): Promise<boolean> {
  const closingPending = join(task.runtimeDir, "closing-pending")
  if (!(await ctx.fs.exists(closingPending))) return false
  const frontmatter = await readmeFrontmatter(ctx, task)
  const gate = await readGate(ctx, task)
  const closed =
    frontmatter.stage === "shipped" &&
    (await ctx.fs.exists(shipStatePath(task))) &&
    gate?.target === FINAL &&
    gate.decision === "approved" &&
    gate.settled === true
  if (closed) await ctx.fs.remove(closingPending)
  return closed
}

/**
 * `ship`: after the final approval, the landing steps (the approved description, the pull request
 * the person chose, with the approved commit); asked again, the pull request's triage.
 */
export async function shipVerb(ctx: Ctx): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  // A task the App approved without a pull request is shipped and no longer open, so the usual
  // lookup skips it: the one whose landing steps wait is the task `ship` means.
  if ((await resolveTask(ctx, repo.data)) === null) {
    const waiting = await waitingShips(ctx, repo.data)
    if (waiting.length > 1)
      return refused(
        "Several shipped tasks wait for their landing steps.",
        waiting.map(({ slug }) => ({
          what: `${slug} landed`,
          move: `qualitylayer ship --task ${slug}`,
        })),
      )
    const only = waiting[0]
    const task = only === undefined ? null : await loadTask(ctx, repo.data, only.slug)
    if (task !== null) {
      const found = await usable(ctx, task)
      if (!found.ok) return found
      return finish(ctx, found.data, "ship", await landing(ctx, found.data, repo.data))
    }
  }
  return onTask(ctx, "ship", (found, repo) => landing(ctx, found, repo))
}

/** `ship` on its task: the decision applied, then the landing steps or what still stands before them. */
async function landing(ctx: Ctx, found: Task, repo: RepoRef): Reply {
  let task = found
  if (await finishedClosing(ctx, task)) task = (await loadTask(ctx, repo, task.slug)) ?? task
  const applied = await applyDecision(ctx, task)
  if (!applied.ok) return applied
  task = applied.data.task
  if (task.stage === "plan") return approvalFirst(ctx, task)
  if (task.stage === "implement")
    return refused(`${task.slug} is still in Implement.`, [
      { what: "the build declared ready", move: "qualitylayer build done" },
    ])
  if (task.stage === "verify")
    return refused(`${task.slug} waits for the person's approval of the change.`, [
      { what: "their approval", move: "qualitylayer wait --for approval" },
    ])
  if (task.stage !== "shipped") return refused(`${task.slug} is ${task.stage}.`, [START_MOVE])
  const ship = await pendingShip(ctx, repo, task.slug)
  if (ship === null) return ok({ ...(await shippedPayload(ctx, task)), already: true })
  const gate = await readGate(ctx, task)
  return ok(
    gate?.target === FINAL && gate.decision === "approved" && gate.approvedHead !== undefined
      ? { ...ship, approved_commit: gate.approvedHead }
      : ship,
  )
}

// ------------------------------------------------------------------------------------- wait

/**
 * What `wait` adds to a decision it applied: on the Plan's approval, the stop that lets the person
 * choose where the build runs; on the final approval, the ship step; on changes to the final
 * review, the reopened review and its move.
 */
export async function afterDecision(
  ctx: Ctx,
  task: Task,
  outcome: GateOutcome,
): Promise<NextPayload> {
  const now = (await loadTask(ctx, { root: task.repoRoot, id: task.repoId }, task.slug)) ?? task
  const moves = movesOf((await moveStateOf(ctx, now)).state)
  if (outcome.decision === "approved" && now.stage === "implement")
    return { ...outcome, ...(await implementStop(ctx, now)), moves }
  if (outcome.decision === "approved" && now.stage === "shipped")
    return {
      ...outcome,
      next: "qualitylayer ship",
      then: outcome.then ?? "qualitylayer ship",
      moves,
    }
  if (outcome.decision === "changes" && now.stage === "verify") {
    await reopenVerify(ctx, now)
    // Handed to the agent with this reply: the person's notes read "picked up".
    await markPicked(
      ctx,
      now,
      outcome.comments.map((c) => c.id),
    )
    return {
      ...outcome,
      then: 'Apply each comment test first, commit with qualitylayer commit fix, answer each with qualitylayer comments resolve <id> --answer "<what changed>", then qualitylayer verify recheck.',
      moves: movesOf((await moveStateOf(ctx, now)).state),
    }
  }
  return { ...outcome, moves }
}
