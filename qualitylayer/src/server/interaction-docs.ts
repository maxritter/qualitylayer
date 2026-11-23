// DOCS owns this adapter and /interaction/docs/*; existing guarded document/artifact APIs stay.

import { readThreads } from "../core/interaction-docs/threads.ts"
import { isArchived } from "../core/task/archive.ts"
import type { Ctx } from "../ctx.ts"
import type { DocsSnapshot } from "../interaction/contracts.ts"
import type { TaskDetail } from "./api.ts"
import { locate } from "./api.ts"
import { taskArtifacts } from "./artifacts.ts"
import { docsPostRoute } from "./interaction-docs-post.ts"
import { docsGetRoute, failDocs } from "./interaction-docs-read.ts"
import type { InteractionRoute } from "./interaction-route.ts"

export const docsCapabilities = { threads: true }

export async function docsSnapshot(task: TaskDetail, ctx: Ctx): Promise<DocsSnapshot> {
  const found = await locate(ctx, task.id)
  const artifacts = await taskArtifacts(ctx, task.id)
  return {
    documents: task.docs,
    threads: found.ok ? await readThreads(ctx, found.data.task) : [],
    artifacts: artifacts.ok ? artifacts.data.task : [],
  }
}

const POST_ACTIONS = new Set(["thread", "resolve", "reopen", "helper"])

async function handleWritableDocsPost(
  ctx: Ctx,
  task: Extract<Awaited<ReturnType<typeof locate>>, { ok: true }>["data"]["task"],
  action: string,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST" || !POST_ACTIONS.has(action))
    return failDocs("Unknown document action.", 404)
  if (await isArchived(ctx, task)) return failDocs("Restore this task before commenting.")
  if (task.stage === "shipped" || task.stage === "abandoned")
    return failDocs("This task is closed; its comments are kept.")
  return docsPostRoute(ctx, task, action as "thread" | "resolve" | "reopen" | "helper", request)
}

export const docsRoute: InteractionRoute = async (ctx, id, path, request) => {
  if (path[0] !== "docs") return null
  if (id === null) return failDocs("A task is required.")
  const found = await locate(ctx, id)
  if (!found.ok) return Response.json(found, { status: 404 })
  const getResponse = await docsGetRoute(ctx, found.data.task, path[1], request)
  return getResponse ?? handleWritableDocsPost(ctx, found.data.task, path[1] ?? "", request)
}
