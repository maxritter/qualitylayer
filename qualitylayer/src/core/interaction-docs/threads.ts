import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { CommentThread } from "../../interaction/contracts.ts"
import { refuseStandaloneAnnotationWrite } from "../artifact/annotation-upgrade.ts"
import { type CommentHandling, type HandlingContext, threadHandling } from "../comment-handling.ts"
import { type Comment, readComments } from "../gate/comments.ts"
import { agentName } from "../live/liveness.ts"
import { readLive } from "../live/read.ts"
import { liveAnswerRun, reachOf, sessionWaiting } from "../review/answers.ts"
import type { Task } from "../task/store.ts"
import { readSession } from "../task/store.ts"
import {
  asComment,
  isStructured,
  personNote,
  readTeamComments,
  updateTeamThread,
} from "../team/comments.ts"
import { attachmentProblem, type Incoming, saveAttachments } from "./attachments.ts"
import {
  buildCommentThread,
  buildLocalComment,
  needsAgentHandling,
  type ThreadInput,
} from "./thread-build.ts"

type Holder = Pick<Task, "runtimeDir"> & Partial<Pick<Task, "stage">>

/** Normalize existing comment records. No guessed people, votes or delivery timestamps. */
export function threadsOf(comments: Comment[], stage?: Task["stage"]): CommentThread[] {
  const groups = new Map<string, Comment[]>()
  for (const comment of comments) {
    if (comment.kind !== undefined && comment.remark === "" && !comment.files?.length) continue
    const id = comment.thread?.id ?? comment.id
    const existing = groups.get(id)
    if (existing) existing.push(comment)
    else groups.set(id, [comment])
  }
  const result: CommentThread[] = []
  for (const [id, rows] of groups) {
    const thread = buildCommentThread(id, rows, stage)
    if (thread !== null) result.push(thread)
  }
  return result
}

/** What the cards need to say where each comment stands: the agent, its reach, the helper running now. */
async function handlingContext(ctx: Ctx, task: Holder): Promise<HandlingContext> {
  const session = await readSession(ctx, task)
  const live = await readLive(ctx, task).catch(() => null)
  const waiting = await sessionWaiting(ctx, task)
  const run = await liveAnswerRun(ctx, task)
  const stage = task.stage
  return {
    now: ctx.clock.now(),
    agent: agentName(live?.agent ?? session?.agent ?? null),
    reach: await reachOf(ctx, task, waiting),
    ...(stage !== undefined ? { busyWith: stage.charAt(0).toUpperCase() + stage.slice(1) } : {}),
    helper: run?.helper
      ? { name: run.helper.name, ...(run.helper.line ? { line: run.helper.line } : {}) }
      : null,
  }
}

/** The thread with the status of its newest comment, where the comment is one an agent answers. */
const withHandling = (t: CommentThread, hc: HandlingContext | null): CommentThread => {
  const handling: CommentHandling | null = hc === null ? null : threadHandling(t.comments, hc)
  return handling === null ? t : { ...t, handling }
}

export async function readThreads(ctx: Ctx, task: Holder): Promise<CommentThread[]> {
  const threads = threadsOf(
    [
      ...(await readComments(ctx, task)),
      ...(await readTeamComments(ctx, task))
        .filter((c) => !isStructured(c) || personNote(c) !== null)
        .map(asComment),
    ],
    task.stage,
  )
  const waiting = threads.some((t) => t.comments.some(needsAgentHandling))
  const hc = waiting ? await handlingContext(ctx, task) : null
  const fallback: HandlingContext = {
    now: ctx.clock.now(),
    agent: "The agent",
    reach: "idle",
    helper: null,
  }
  return threads.map((t) => withHandling(t, hc ?? fallback))
}

const save = async (ctx: Ctx, task: Holder, rows: Comment[]) => {
  refuseStandaloneAnnotationWrite(ctx, task)
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    join(task.runtimeDir, "comments.json"),
    `${JSON.stringify(rows, null, 2)}\n`,
  )
}

async function tryReplyToTeamThread(
  ctx: Ctx,
  task: Holder,
  input: ThreadInput,
  files: Incoming[],
): Promise<CommentThread | null> {
  if (input.thread === undefined) return null
  const remote = (await readTeamComments(ctx, task)).find(
    (c) => c.id === input.thread && (!isStructured(c) || personNote(c) !== null),
  )
  if (!remote) return null
  if (files.length > 0)
    throw new Error(
      "A reply on a teammate's thread carries words only. Attach the files to a comment of your own.",
    )
  if (asComment(remote).doc !== input.doc)
    throw new Error("This thread is on another document. Reload it before replying.")
  await updateTeamThread(ctx, task, remote.id, { text: input.remark, via: "app" })
  return (await readThreads(ctx, task)).find((t) => t.id === remote.id) as CommentThread
}

export async function addThread(
  ctx: Ctx,
  task: Holder,
  input: ThreadInput,
): Promise<CommentThread> {
  refuseStandaloneAnnotationWrite(ctx, task)
  const files = input.files ?? []
  const problem = attachmentProblem(files)
  if (problem !== null) throw new Error(problem)
  const teamReply = await tryReplyToTeamThread(ctx, task, input, files)
  if (teamReply !== null) return teamReply
  return ctx.fs.withLock(join(task.runtimeDir, "comments.lock"), async () => {
    const rows = await readComments(ctx, task)
    const root =
      input.thread === undefined ? undefined : threadsOf(rows).find((t) => t.id === input.thread)
    const invalidReply =
      input.thread !== undefined &&
      (root === undefined || root.doc !== input.doc || root.state !== "open")
    if (invalidReply)
      throw new Error(
        "This thread is missing, resolved or on another document. Reload it before replying.",
      )
    const id = `c-${crypto.randomUUID()}`
    const thread = root?.id ?? id
    refuseStandaloneAnnotationWrite(ctx, task)
    const saved = await saveAttachments(ctx, task, id, files)
    const comment = buildLocalComment({
      id,
      thread,
      input,
      root,
      saved,
      now: ctx.clock.now(),
    })
    const next = [...rows, comment]
    await save(ctx, task, next)
    return threadsOf(next, task.stage).find((t) => t.id === thread) as CommentThread
  })
}

/**
 * Close a thread (`open` false) or open it again. A comment closed before the agent took it never
 * reaches the agent; reopened, it is handed over at the agent's next reply like a new one.
 */
export async function resolveThread(
  ctx: Ctx,
  task: Holder,
  id: string,
  open = false,
): Promise<CommentThread> {
  refuseStandaloneAnnotationWrite(ctx, task)
  const remote = await updateTeamThread(ctx, task, id, open ? { reopen: true } : { resolve: true })
  if (remote) return (await readThreads(ctx, task)).find((t) => t.id === id) as CommentThread
  return ctx.fs.withLock(join(task.runtimeDir, "comments.lock"), async () => {
    const rows = await readComments(ctx, task)
    if (!threadsOf(rows).some((t) => t.id === id))
      throw new Error("This thread no longer exists. Reload the comments.")
    const next = rows.map((c) => {
      if ((c.thread?.id ?? c.id) !== id) return c
      if (!open)
        return { ...c, resolved: ctx.clock.now(), thread: { id, state: "resolved" as const } }
      const { resolved: _resolved, ...rest } = c
      return { ...rest, thread: { id, state: "open" as const } }
    })
    await save(ctx, task, next)
    return threadsOf(next, task.stage).find((t) => t.id === id) as CommentThread
  })
}
