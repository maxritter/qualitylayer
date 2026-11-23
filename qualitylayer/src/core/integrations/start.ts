// A task started from a ticket link (`task start --from <link>`, `POST /api/tasks` with `from`, the
// App's "From a link"): the ticket is read with the person's own login, its title and text become the
// request, and the task keeps the link in its frontmatter (`from:`).

import { type Ctx, ok, type Result } from "../../ctx.ts"
import { missingOf, refused } from "../next/refusal.ts"
import { taskStart } from "../next.ts"
import { type RepoRef, resolveRepo } from "../paths.ts"
import {
  isTerminal,
  listTasks,
  patchReadme,
  readmeFrontmatter,
  type Task,
  type TaskType,
} from "../task/store.ts"
import { parseTicketLink } from "./links.ts"
import { previewOf, readTicket, type TicketPreview, ticketRequest } from "./tickets.ts"

export type LinkedRequest = {
  /** The link as kept in the task's frontmatter. */
  from: string
  request: string
  title?: string
  /** A bug ticket, when the caller did not choose the kind. */
  type?: TaskType
  /** What was read; absent when the ticket could not be read and the person's words carry the task. */
  ticket?: TicketPreview
  /** Why the ticket was not read, when the person's words carry the task instead. */
  unread?: string
}

/**
 * The request a link gives. When the ticket cannot be read (no CLI, no token, no access), the
 * person's own words, if they gave some, start the task with the link kept; without words the
 * refusal names the moves.
 */
export async function linkedRequest(
  ctx: Ctx,
  from: string,
  words: string,
  options: { type?: TaskType; title?: string } = {},
): Promise<Result<LinkedRequest>> {
  const read = await readTicket(ctx, from)
  if (!read.ok) {
    const link = parseTicketLink(from)
    if (words.trim() === "" || link === null) return read
    return ok({
      from: link.url,
      request: `${words.trim()}\n\nFrom: ${link.url}`,
      ...(options.title !== undefined ? { title: options.title } : {}),
      unread: [
        read.error.message,
        ...missingOf(read.error)
          .slice(0, 1)
          .map((m) => m.move),
      ].join(" "),
    })
  }
  const ticket = read.data
  return ok({
    from: ticket.url,
    request: ticketRequest(ticket, words),
    // A link not read here names the task by the person's words when they gave some.
    ...(options.title !== undefined
      ? { title: options.title }
      : ticket.linkOnly && words.trim() !== ""
        ? { title: words.trim() }
        : { title: ticket.title }),
    ...(options.type === undefined && ticket.bug ? { type: "bugfix" as const } : {}),
    ticket: previewOf(ticket),
  })
}

/** The open task already started from this link, if any: one link, one task. */
export async function taskFromLink(ctx: Ctx, repo: RepoRef, from: string): Promise<Task | null> {
  for (const task of await listTasks(ctx, repo)) {
    if (isTerminal(task.stage)) continue
    if ((await readmeFrontmatter(ctx, task)).from === from) return task
  }
  return null
}

type ScriptTaskInput = { request?: string; from?: string; type?: TaskType; title?: string }

type ResolvedScriptInput =
  | { existing: Record<string, unknown> }
  | { existing?: undefined; linked?: LinkedRequest; words: string }

async function resolveScriptInput(
  ctx: Ctx,
  repo: RepoRef,
  input: ScriptTaskInput,
): Promise<Result<ResolvedScriptInput>> {
  const words = input.request?.trim() ?? ""
  if (input.from === undefined) {
    if (words === "") {
      return refused("A task starts from a request or a ticket link.", [
        {
          what: "the request",
          move: 'POST /api/tasks {"request": "<words>"} or {"from": "<link>"}',
        },
      ])
    }
    return ok({ words })
  }
  const read = await linkedRequest(ctx, input.from, words, {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
  })
  if (!read.ok) return read
  const existing = await taskFromLink(ctx, repo, read.data.from)
  if (existing !== null) {
    return ok({
      existing: {
        task: existing.slug,
        id: `${existing.repoId}~${existing.slug}`,
        title: existing.title,
        step: existing.stage,
        from: read.data.from,
        created: false,
      },
    })
  }
  return ok({ linked: read.data, words })
}

function scriptTaskReply(
  startedData: Record<string, unknown>,
  linked: LinkedRequest | undefined,
): Record<string, unknown> {
  return {
    ...startedData,
    created: true,
    ...(linked
      ? {
          from: linked.from,
          ...(linked.ticket ? { ticket: linked.ticket } : {}),
          ...(linked.unread ? { unread: linked.unread } : {}),
        }
      : {}),
  }
}

/**
 * A script's start (`POST /api/tasks`, the App's "From a link"): the task waits on Home and no agent
 * session takes it. With `from`, the ticket gives the request and one link starts one task.
 */
export async function startScriptTask(
  ctx: Ctx,
  input: ScriptTaskInput,
): Promise<Result<Record<string, unknown>>> {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const resolved = await resolveScriptInput(ctx, repo.data, input)
  if (!resolved.ok) return resolved
  if (resolved.data.existing !== undefined) return ok(resolved.data.existing)
  const { linked, words } = resolved.data
  const title = input.title ?? linked?.title
  const started = await taskStart(ctx, linked?.request ?? words, {
    type: linked?.type ?? input.type ?? "feature",
    ...(title !== undefined ? { title } : {}),
    script: true,
  })
  if (!started.ok) return started
  const slug = String(started.data.task ?? "")
  const task = (await listTasks(ctx, repo.data)).find((t) => t.slug === slug)
  if (task !== undefined && linked !== undefined) await keepLink(ctx, task, linked.from)
  return ok(scriptTaskReply(started.data, linked))
}

/** Keep the link in the task's frontmatter. */
export async function keepLink(ctx: Ctx, task: Pick<Task, "dir">, from: string): Promise<void> {
  await patchReadme(ctx, task, { from }, "task_from_link")
}
