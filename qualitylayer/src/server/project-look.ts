// The sidebar's per-machine project look (order, color, name, hidden) and a task's rename, over HTTP.
//
// Guard: these are ordinary App writes, like archiving a task or leaving a comment. They need what
// every `/api` call needs: a loopback host, the page's own origin, and the key or a paired session
// (`refuse`, the same check `createHandler` runs first). They do not need the stricter key-paired
// App window that `projectFolderRoute` asks for, because they reach no folder. Reveal starts the
// system's file manager on a registered project's folder, as Open and Reveal do on a task's files,
// under the same guard.

import { realpath, stat } from "node:fs/promises"
import type { LookPatch } from "../core/project-look.ts"
import { readLooks, setLook, setOrder } from "../core/project-look-store.ts"
import { renameTask } from "../core/task/rename.ts"
import { type Ctx, err, type HarnessError, type Result } from "../ctx.ts"
import { listProjects, locate } from "./api.ts"
import { type GuardConfig, refuse } from "./guard.ts"
import { type Opener, openFile, systemOpener } from "./open-file.ts"

const BODY_MAX = 8192
const STATUS: Partial<Record<HarnessError["code"], number>> = { bad_args: 400, no_task: 404 }

/**
 * Show a project's folder in the system's file manager: the first of its paths that still exists as a
 * folder. The same opener, and the same guard, as Open and Reveal on a task's files.
 */
async function revealProject(
  ctx: Ctx,
  id: string,
  opener: Opener,
): Promise<Result<Record<string, never>>> {
  const project = (await listProjects(ctx)).find((p) => p.id === id)
  if (project === undefined) return err({ code: "no_task", message: `unknown project "${id}"` })
  for (const path of project.paths) {
    try {
      const real = await realpath(path)
      if (!(await stat(real)).isDirectory()) continue
      return openFile("folder", real, opener.platform, opener.run)
    } catch {
      // gone or unreadable: the next path
    }
  }
  return err({ code: "no_task", message: "The project's folder is not on this computer any more." })
}

function answer(result: Result<unknown>): Response {
  if (result.ok)
    return Response.json(
      { ok: true, ...(result.data as object) },
      { headers: { "cache-control": "no-store" } },
    )
  return Response.json(
    { ok: false, error: result.error },
    { status: STATUS[result.error.code] ?? 500, headers: { "cache-control": "no-store" } },
  )
}

const bad = (message: string) => answer(err({ code: "bad_args", message }))

async function input(request: Request): Promise<Record<string, unknown> | string> {
  const text = await request.text()
  if (text.length > BODY_MAX) return "The request is too large."
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  } catch {
    // answered below
  }
  return "The request is not a JSON object."
}

type LookRouteAction = "get-looks" | "put-look" | "put-order" | "put-title" | "reveal"

const LOOK_ROUTE_RULES: Array<{
  action: LookRouteAction
  match: (parts: string[], method: string) => boolean
}> = [
  {
    action: "get-looks",
    match: (p, m) => m === "GET" && p.length === 3 && p[1] === "projects" && p[2] === "look",
  },
  {
    action: "put-look",
    match: (p, m) => m === "PUT" && p.length === 4 && p[1] === "projects" && p[2] === "look",
  },
  {
    action: "put-order",
    match: (p, m) => m === "PUT" && p.length === 3 && p[1] === "projects" && p[2] === "order",
  },
  {
    action: "reveal",
    match: (p, m) => m === "POST" && p.length === 4 && p[1] === "projects" && p[3] === "reveal",
  },
  {
    action: "put-title",
    match: (p, m) => m === "PUT" && p.length === 4 && p[1] === "tasks" && p[3] === "title",
  },
]

function matchLookRoute(parts: string[], method: string): LookRouteAction | null {
  if (parts[0] !== "api") return null
  return LOOK_ROUTE_RULES.find((rule) => rule.match(parts, method))?.action ?? null
}

function decodeSegments(parts: string[]): string[] | null {
  try {
    return parts.map(decodeURIComponent)
  } catch {
    return null
  }
}

async function runLookMutation(
  ctx: Ctx,
  action: "put-look" | "put-order" | "put-title",
  segments: string[],
  sent: Record<string, unknown>,
): Promise<Result<unknown>> {
  if (action === "put-order") return setOrder(ctx, sent.ids)
  if (action === "put-look") {
    const unknown = Object.keys(sent).find(
      (key) => !["color", "label", "hidden", "artifacts"].includes(key),
    )
    if (unknown !== undefined)
      return err({ code: "bad_args", message: `unknown field "${unknown}"` })
    return setLook(ctx, segments[3] ?? "", sent as LookPatch)
  }
  const found = await locate(ctx, segments[2] ?? "")
  return found.ok ? renameTask(ctx, found.data.task, sent.title) : found
}

async function dispatchLookAction(
  ctx: Ctx,
  action: LookRouteAction,
  segments: string[],
  request: Request,
  hooks: { changed: () => void; opener: Opener },
): Promise<Response> {
  if (action === "get-looks") return answer({ ok: true, data: await readLooks(ctx) })
  if (action === "reveal") return answer(await revealProject(ctx, segments[2] ?? "", hooks.opener))
  const sent = await input(request)
  if (typeof sent === "string") return bad(sent)
  const result = await runLookMutation(ctx, action, segments, sent)
  if (result.ok) hooks.changed()
  return answer(result)
}

/**
 * `GET /api/projects/look`, `PUT /api/projects/look/<id>`, `PUT /api/projects/order` and
 * `PUT /api/tasks/<id>/title`, and `POST /api/projects/<id>/reveal` (the project's folder in the file
 * manager). Null for any other request. `changed` tells open Apps to read again; `opener` is replaced
 * by a test, as the other routes that open files are.
 */
export async function projectLookRoute(
  ctx: Ctx,
  guard: GuardConfig,
  request: Request,
  changed: () => void = () => {},
  opener: Opener = systemOpener(),
): Promise<Response | null> {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean)
  const action = matchLookRoute(parts, request.method)
  if (action === null) return null
  const refusal = refuse(request, guard, true)
  if (refusal !== null) return new Response(refusal.reason, { status: refusal.status })

  const segments = decodeSegments(parts)
  if (segments === null) return bad("malformed URL encoding")
  return dispatchLookAction(ctx, action, segments, request, { changed, opener })
}
