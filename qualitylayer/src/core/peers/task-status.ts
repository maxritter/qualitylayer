// The status QualityLayer sets by itself. When `qualitylayer next` binds a session to a task, the
// session's line in `peers list` reads "QualityLayer <Step>: <task title>", and it follows the task
// from step to step. It is kept apart from what a session says by hand (`peers status set`): one
// set by hand after the session took up its task stays in front of it.
//
// This is the binding `peers list` trusts. The heartbeat binding under the project folder is not:
// every tool call of any session in the checkout refreshes it, so sessions that never ran
// QualityLayer end up bound to whichever task is open.

import { join } from "node:path"
import { type Ctx, realCtx } from "../../ctx.ts"
import { detectAgent, sessionIdentity } from "../agents/detect.ts"
import { FLOW_STEPS, flowStepOf } from "../flow.ts"
import { resolveRepo } from "../paths.ts"
import { isTerminal, loadTask, type Task } from "../task/store.ts"
import { asRecord, isUuid, readJson, stateDir } from "./base.ts"
import { isNativeKind, type NativeKind, nativeCallerOf } from "./native.ts"

export type TaskStatus = {
  /** `cc:<session uuid>` or `codex:<thread uuid>`. */
  who: string
  repo: string
  /** The checkout the task's documents are in. */
  checkout: string
  task: string
  title: string
  stage: string
  text: string
  /** When the session took this task up (epoch ms): a status set by hand after it wins. */
  since: number
  /** When the text last changed (epoch ms). */
  at: number
}

const FOLDER = "task-status"

/** Where the records are, under QualityLayer's home. */
export const taskStatusDir = (home?: string) =>
  home === undefined ? join(stateDir(), FOLDER) : join(home, "peers", FOLDER)

const fileOf = (who: { kind: string; uuid: string }) => `${who.kind}-${who.uuid}.json`

/** "QualityLayer <Step>: <title>", or null for a stage that is no step (an ended task). */
export function taskStatusText(stage: string, title: string): string | null {
  const step = flowStepOf(stage)
  const label = FLOW_STEPS.find((s) => s.id === step)?.label
  return label === undefined || isTerminal(stage as Task["stage"])
    ? null
    : `QualityLayer ${label}: ${title}`
}

/** The session running this command, by the id its agent hands it; null without one. */
function caller(ctx: Ctx): { kind: "cc" | "codex" | NativeKind; uuid: string } | null {
  const identity = sessionIdentity(ctx.env)
  const agent = identity?.agent ?? detectAgent(ctx.env)
  if (isNativeKind(agent)) return nativeCallerOf(ctx.env)
  const raw =
    identity?.id ??
    (agent === "codex" || agent === "unknown" ? ctx.env.get("CODEX_SESSION_ID") : undefined)
  const uuid = raw?.trim() ?? ""
  return isUuid(uuid) ? { kind: agent === "claude-code" ? "cc" : "codex", uuid } : null
}

async function ended(ctx: Ctx, task: Task): Promise<boolean> {
  return isTerminal(task.stage) || (await ctx.fs.exists(join(task.runtimeDir, "archived.json")))
}

function parse(value: unknown): TaskStatus | null {
  const rec = asRecord(value)
  if (rec === null || typeof rec.since !== "number") return null
  const fields = [rec.who, rec.repo, rec.checkout, rec.task, rec.text]
  return fields.every((field) => typeof field === "string") ? (rec as TaskStatus) : null
}

async function readExistingStatus(ctx: Ctx, path: string): Promise<TaskStatus | null> {
  if (!(await ctx.fs.exists(path))) return null
  try {
    return parse(JSON.parse(await ctx.fs.readFile(path)))
  } catch {
    return null
  }
}

async function syncTaskStatusFile(
  ctx: Ctx,
  who: { kind: string; uuid: string },
  task: Task,
): Promise<void> {
  const dir = taskStatusDir(ctx.home)
  const path = join(dir, fileOf(who))
  const previous = await readExistingStatus(ctx, path)
  const same = previous?.repo === task.repoId && previous.task === task.slug
  const text = taskStatusText(task.stage, task.title)
  if (text === null || (await ended(ctx, task))) {
    if (same) await ctx.fs.remove(path)
    return
  }
  if (same && previous?.text === text && previous.checkout === task.repoRoot) return
  const now = ctx.clock.now()
  const record: TaskStatus = {
    who: `${who.kind}:${who.uuid}`,
    repo: task.repoId,
    checkout: task.repoRoot,
    task: task.slug,
    title: task.title,
    stage: task.stage,
    text,
    since: same && previous !== null ? previous.since : now,
    at: now,
  }
  await ctx.fs.mkdir(dir, { mode: 0o700 })
  await ctx.fs.writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Record the task the calling session works on, once per `next`: a new task is taken up now, a
 * new step keeps when it was taken up, and an ended task leaves no status. It never fails `next`.
 */
export async function noteTaskStatus(ctx: Ctx, slug: unknown): Promise<void> {
  try {
    const who = typeof slug === "string" ? caller(ctx) : null
    if (who === null) return
    const repo = await resolveRepo(ctx)
    const task = repo.ok ? await loadTask(ctx, repo.data, slug as string) : null
    if (task !== null) await syncTaskStatusFile(ctx, who, task)
  } catch {
    // A status line is never worth a failed `next`.
  }
}

/** The task status of `who` (`cc:<uuid>` or `codex:<uuid>`), or null. */
export function readTaskStatus(who: string, dir = taskStatusDir()): TaskStatus | null {
  const [kind, uuid] = who.split(":", 2)
  if ((kind !== "cc" && kind !== "codex" && !isNativeKind(kind)) || !isUuid(uuid)) return null
  return parse(readJson(join(dir, fileOf({ kind, uuid: uuid as string })), null))
}

/** The record's line as the task stands now, or null once the task has ended or is gone. */
export async function currentTaskText(
  record: TaskStatus,
  ctx: Ctx = realCtx(),
): Promise<string | null> {
  return (await currentTaskContext(record, ctx))?.text ?? null
}

/** A saved workflow binding is current only while its task still exists and is active. */
export async function currentTaskContext(
  record: TaskStatus,
  ctx: Ctx = realCtx(),
): Promise<{
  checkout: string
  repo: string
  task: string
  title: string
  stage: string
  text: string
} | null> {
  const task = await loadTask(
    ctx,
    { root: record.checkout, id: record.repo, commonDir: "" },
    record.task,
  )
  if (task === null || (await ended(ctx, task))) return null
  const text = taskStatusText(task.stage, task.title)
  return text === null
    ? null
    : {
        checkout: task.repoRoot,
        repo: task.repoId,
        task: task.slug,
        title: task.title,
        stage: task.stage,
        text,
      }
}
