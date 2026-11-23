// What the team and outside reviewers said about a shared task, kept beside the
// owner's own drafts, never inside them: the Cockpit replaces a document's drafts on
// every save, and a teammate's words must survive that. `comments take` hands them
// over once; they stay afterwards, taken, so their verdicts keep showing as advice.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { hasAnnotationMigration, refuseLegacyAnnotationWrite } from "../task/answer-migration.ts"
import type { Task } from "../task/store.ts"
import {
  agentActionable,
  applyThreadChange,
  type Incoming,
  isStructured,
  type TeamComment,
  type TeamFile,
  type ThreadChange,
} from "./comment-rules.ts"
import { personNote } from "./thread-publication.ts"

export {
  agentActionable,
  asComment,
  type Incoming,
  isStructured,
  PERSON_NOTE_EXPLANATION,
  REVIEW_DOC,
  type TeamComment,
} from "./comment-rules.ts"
export { personNote } from "./thread-publication.ts"

type Where = Pick<Task, "runtimeDir">

const filePath = (task: Where) => join(task.runtimeDir, "team-comments.json")
const lockPath = (task: Where) => join(task.runtimeDir, "team-comments.lock")

export async function readTeamComments(ctx: Ctx, task: Where): Promise<TeamComment[]> {
  if (await hasAnnotationMigration(ctx, task)) return []
  if (!(await ctx.fs.exists(filePath(task)))) return []
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(filePath(task))) as unknown
    return Array.isArray(parsed) ? (parsed as TeamComment[]) : []
  } catch {
    return []
  }
}

async function write(ctx: Ctx, task: Where, comments: TeamComment[]): Promise<void> {
  await refuseLegacyAnnotationWrite(ctx, task)
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(filePath(task), `${JSON.stringify(comments, null, 2)}\n`)
}

/** Keep new comments; one already known (same source and backend id) is not added twice. */
export async function addTeamComments(
  ctx: Ctx,
  task: Where,
  incoming: Incoming[],
): Promise<number> {
  if (incoming.length === 0) return 0
  return ctx.fs.withLock(lockPath(task), async () => {
    const current = await readTeamComments(ctx, task)
    // A backend id says which comment it is only within one sharing of the task: sharing
    // it again starts the numbers over, so when it was said belongs to the identity.
    const same = (a: Incoming, b: Incoming) =>
      a.source === b.source && a.remote_id === b.remote_id && a.created === b.created
    const fresh = incoming.filter((c) => !current.some((known) => same(known, c)))
    if (fresh.length > 0) {
      const used = new Set(current.map((c) => c.id))
      const added: TeamComment[] = []
      for (const c of fresh) {
        let id = `${c.source}-${c.remote_id}`
        if (used.has(id)) id = `${id}-${c.created}`
        used.add(id)
        added.push({ ...c, id })
      }
      await write(ctx, task, [...current, ...added])
    }
    return fresh.length
  })
}

/** Replaces the entries of a team comment's files that carry these names (a fetched file for its missing entry). */
export async function setTeamFiles(
  ctx: Ctx,
  task: Where,
  id: string,
  changed: TeamFile[],
): Promise<void> {
  await ctx.fs.withLock(lockPath(task), async () => {
    const current = await readTeamComments(ctx, task)
    const target = current.find((c) => c.id === id)
    if (target?.files === undefined) return
    const by = new Map(changed.map((f) => [f.name, f]))
    await write(
      ctx,
      task,
      current.map((c) =>
        c.id === id ? { ...c, files: (c.files ?? []).map((f) => by.get(f.name) ?? f) } : c,
      ),
    )
  })
}

/** Hand over the comments not yet taken (of these documents, when named) and mark them taken. */
export async function takeTeam(ctx: Ctx, task: Where, docs?: string[]): Promise<TeamComment[]> {
  return ctx.fs.withLock(lockPath(task), async () => {
    const current = await readTeamComments(ctx, task)
    const now = ctx.clock.now()
    const wanted = (c: TeamComment) =>
      agentActionable(c) && (docs === undefined || docs.includes(c.doc))
    const fresh = current.filter(wanted)
    if (fresh.length === 0) return []
    await write(
      ctx,
      task,
      current.map((c) => (wanted(c) ? { ...c, taken: now } : c)),
    )
    return fresh.map((c) => ({ ...c, taken: now }))
  })
}

/** Comments handed to the agent since `since`, of these documents: what a `changes` decision carries. */
export async function takenSince(
  ctx: Ctx,
  task: Where,
  docs: string[],
  since: number,
): Promise<TeamComment[]> {
  return (await readTeamComments(ctx, task)).filter(
    (c) =>
      agentActionable(c, "resolve") &&
      c.taken !== undefined &&
      c.taken >= since &&
      docs.includes(c.doc),
  )
}

/** Reply and resolution share one durable, locked record with the incoming comment. */
export async function updateTeamThread(
  ctx: Ctx,
  task: Where,
  id: string,
  change: ThreadChange,
): Promise<TeamComment | null> {
  return ctx.fs.withLock(lockPath(task), async () => {
    const rows = await readTeamComments(ctx, task)
    const root = rows.find((c) => c.id === id && (!isStructured(c) || personNote(c) !== null))
    if (!root) return null
    const next = applyThreadChange(root, change, ctx.clock.now())
    await write(
      ctx,
      task,
      rows.map((c) => (c.id === id ? next : c)),
    )
    return next
  })
}
