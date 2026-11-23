// SHELL owns this adapter, /interaction/shell/* and the global shell endpoints.

import { backgroundAgents, shellStatus } from "../core/interaction-shell/status.ts"
import { taskRuntimeDir } from "../core/paths.ts"
import { readBatch } from "../core/task/question-batch.ts"
import type { Ctx } from "../ctx.ts"
import type { ShellSnapshot } from "../interaction/contracts.ts"
import { listAllTasks, type TaskDetail, type TaskSummary, taskSummary } from "./api.ts"
import type { InteractionRoute } from "./interaction-route.ts"
import { buildHomeFacts } from "./interaction-shell-home.ts"
import {
  clearNotifications,
  filterTasksByScope,
  readScopedNotifications,
} from "./interaction-shell-notifications.ts"

export const shellCapabilities = { status: true, homeFacts: true }

export async function shellSnapshot(
  task: TaskSummary & Partial<Pick<TaskDetail, "question">>,
  ctx: Ctx,
): Promise<ShellSnapshot> {
  const batch = await readBatch(ctx, { runtimeDir: taskRuntimeDir(ctx, task.project, task.slug) })
  const status = shellStatus(
    { ...task, openItems: batch?.questions.length || task.openItems },
    ctx.clock.now(),
  )
  return {
    status,
    signals: task.live?.signals ?? null,
    agents: backgroundAgents(task),
    steps: task.helpers
      .filter((h): h is typeof h & { line: string } => h.line !== null)
      .map((h) => ({
        id: h.id,
        text: h.line,
        state: h.state === "done" ? "done" : "now",
        at: h.at,
      })),
    nextForYou:
      task.action === "implement"
        ? "Start the build"
        : task.action === "final"
          ? "Approve the change"
          : task.action === "review"
            ? "Approve the Plan"
            : null,
  }
}

const shellReply = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } })

async function handleGlobalShellGet(
  ctx: Ctx,
  route: "home" | "notifications",
  url: URL,
): Promise<Response> {
  const project = url.searchParams.get("project") ?? ""
  const agent = url.searchParams.get("agent") ?? ""
  const all = await listAllTasks(ctx)
  const tasks = filterTasksByScope(all, project, agent)
  if (route === "notifications")
    return shellReply({ ok: true, notifications: await readScopedNotifications(ctx, all, tasks) })
  const timezone =
    url.searchParams.get("timezone") ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format()
  } catch {
    return shellReply({ ok: false, error: { code: "timezone", message: "Unknown time zone" } }, 400)
  }
  return shellReply({
    ok: true,
    facts: await buildHomeFacts(ctx, tasks, { project, agent, timezone }),
  })
}

async function handleShellGet(
  ctx: Ctx,
  id: string | null,
  path: string[],
  request: Request,
): Promise<Response> {
  if (id !== null && path[1] === "status") {
    const detail = await taskSummary(ctx, id)
    return detail.ok
      ? shellReply({ ok: true, shell: await shellSnapshot(detail.data, ctx) })
      : shellReply({ ok: false, error: detail.error }, 404)
  }
  if (id === null && (path[1] === "home" || path[1] === "notifications"))
    return handleGlobalShellGet(ctx, path[1], new URL(request.url))
  return shellReply({ ok: false, error: { code: "not_found" } }, 404)
}

export const shellRoute: InteractionRoute = async (ctx, id, path, request) => {
  if (path[0] !== "shell") return null
  // Clear all: the settled notifications in this scope are cleared. What still waits stays, since
  // it is no notice but the work itself; it leaves once it is answered.
  if (
    request.method === "POST" &&
    id === null &&
    path[1] === "notifications" &&
    path[2] === "clear"
  ) {
    const url = new URL(request.url)
    const cleared = await clearNotifications(
      ctx,
      url.searchParams.get("project") ?? "",
      url.searchParams.get("agent") ?? "",
    )
    return shellReply({ ok: true, cleared })
  }
  if (request.method !== "GET")
    return shellReply({ ok: false, error: { code: "method", message: "Use GET" } }, 405)
  return handleShellGet(ctx, id, path, request)
}
