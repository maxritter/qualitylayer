// The verbs: every change of a task is a command that says what the agent claims (plan §3.7). `next`
// only reads (next/compass.ts); these act, each idempotent (`already: true` when repeated after it
// succeeded), each refusal with `missing` (what is not there, and the move that settles it), each
// reply with the moves open after it, from the one table in next/moves.ts.

import { type Ctx, ok, type Result } from "../ctx.ts"
import { ciParityWarning } from "./ci-parity.ts"
import type { Answers } from "./config-values.ts"
import { moveStateOf } from "./next/compass.ts"
import { movesOf } from "./next/moves.ts"
import { planPayload, planText } from "./next/plan.ts"
import { actionable, refused } from "./next/refusal.ts"
import { served } from "./next/reply.ts"
import { base, type NextPayload } from "./next/shared.ts"
import { showMePayload, waitingShips } from "./next/ship.ts"
import { askPlaceFirst, handback, startedPayload } from "./next/start.ts"
import { type BriefStep, brief, commitBriefMarker, onceText } from "./next-brief.ts"
import { buildDoneVerb, buildStartVerb, verifyVerbCmd } from "./next-build.ts"
import { afterDecision, shipVerb } from "./next-ship.ts"
import { type RepoRef, resolveRepo } from "./paths.ts"
import { noteTaskStatus } from "./peers/task-status.ts"
import { adoptExistingPlan, ORIGINAL_FILE, type OriginalSource } from "./task/adoption.ts"
import { isArchived } from "./task/archive.ts"
import { advance } from "./task/machine.ts"
import { startTask } from "./task/startup.ts"
import {
  EARLIER_LAYOUT_REASON,
  isCurrentLayout,
  loadTask,
  lostIdentity,
  registerProject,
  resolveTask,
  type Task,
  type TaskType,
} from "./task/store.ts"

export { type Compass, compass, stripInvocation } from "./next/compass.ts"
export { INLINE_REPLY_LIMIT } from "./next/reply.ts"
export type { NextPayload } from "./next/shared.ts"
export {
  afterDecision,
  type BriefStep,
  brief,
  buildDoneVerb,
  buildStartVerb,
  shipVerb,
  verifyVerbCmd,
}

type Replied = Result<NextPayload>
type Reply = Promise<Replied>

export const START_MOVE = { what: "a task", move: 'qualitylayer task start "<request>"' }

/** The open task a verb acts on, or the refusal that names how to get one. */
export async function taskOf(ctx: Ctx, repo: RepoRef): Promise<Result<Task>> {
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
export async function usable(ctx: Ctx, task: Task): Promise<Result<Task>> {
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
export async function finish(ctx: Ctx, task: Task, _verb: string, result: Replied): Reply {
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
  const wasOnce = data.instructions_once === true
  const out = await served(ctx, data)
  if (out.ok && !wasOnce) await commitBriefMarker(ctx, now, out.data)
  return out
}

/** The verb run on the open task; its refusals and replies finished alike. */
export async function onTask(
  ctx: Ctx,
  verb: string,
  act: (task: Task, repo: RepoRef) => Reply,
): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const task = await taskOf(ctx, repo.data)
  if (!task.ok) return task
  return finish(ctx, task.data, verb, await act(task.data, repo.data))
}

export type StartOptions = {
  type?: TaskType
  title?: string
  answers?: Answers
  /** A start by a script: no agent session takes the task; it waits on Home. */
  script?: boolean
  /** The person's own plan, kept as given; the Plan maps it. */
  fromPlan?: OriginalSource
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
  const raw = {
    ...payload,
    ...(created ? { created: true } : { already: true }),
    message,
    ...(await askPlaceFirst(ctx, task, String(payload.instructions ?? ""), message)),
  }
  const deduped = await onceText(ctx, task, "plan", raw, {
    setAlready: false,
    baseText: planText(task),
  })
  return finish(ctx, task, "task start", ok(deduped))
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
  const deduped =
    task.type === "chat"
      ? payload
      : await onceText(ctx, task, "plan", payload, { setAlready: false, baseText: planText(task) })
  return finish(
    ctx,
    task,
    "task start",
    ok(waiting.length ? { ...deduped, ship_waiting: waiting } : deduped),
  )
}

async function handbackTaskReply(
  ctx: Ctx,
  repo: RepoRef,
  task: Task,
  reason: string,
  options: { prompt?: string; title?: string },
): Reply {
  if (task.stage === "abandoned") return ok(base(task, { already: true, done: true }))
  if (task.stage !== "plan") {
    return refused(
      `Task handback is available during Plan. ${task.slug} is in ${task.stage}.`,
      task.stage === "verify"
        ? [
            { what: "the current Verify move", move: "qualitylayer next" },
            {
              what: "a prerequisite only the person can provide",
              move: 'qualitylayer need "<what. why>" --for T<n>',
            },
          ]
        : [{ what: "the task stopped instead", move: "qualitylayer task abandon" }],
    )
  }
  return handback(ctx, repo, task, reason, options)
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
  return finish(
    ctx,
    task.data,
    "task handback",
    await handbackTaskReply(ctx, repo.data, task.data, reason, options),
  )
}

async function abandonTaskReply(ctx: Ctx, task: Task): Reply {
  const abandoned = await advance(ctx, task, "user_abandoned")
  if (!abandoned.ok) return abandoned
  return ok(
    base(task, {
      done: true,
      message: `${task.slug} was abandoned; its files stay in the repository.`,
    }),
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
  return finish(ctx, task.data, "task abandon", await abandonTaskReply(ctx, task.data))
}

/** `show <topic>`: the "show me" view of a topic, at any stage, without moving the task. */
export async function showTopic(ctx: Ctx, topic: string): Reply {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  return served(ctx, await showMePayload(ctx, await resolveTask(ctx, repo.data), topic))
}
