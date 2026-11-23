import { type Ctx, err } from "../ctx.ts"
import { type FolderPicker, FolderPickerError } from "./folder-picker.ts"
import { type GuardConfig, hasKeyHeader, sessionAuthority } from "./guard.ts"
import {
  browseProjectFolder,
  chooseProjectFolder,
  type FolderPick,
  knownProjectFolders,
  projectDirectory,
} from "./projects-folders.ts"

export {
  browseProjectFolder,
  chooseProjectFolder,
  type FolderPick,
  KNOWN_PROJECT_FOLDERS_MAX,
  type KnownProjectFolders,
  knownProjectFolders,
  type ProjectFolder,
} from "./projects-folders.ts"

const NO_STORE = { headers: { "cache-control": "no-store" } }

function isAuthorized(request: Request, guard: GuardConfig): boolean {
  return hasKeyHeader(request, guard) || sessionAuthority(request, guard)?.keyPaired === true
}

async function readFolderJson<T>(request: Request): Promise<T> {
  const text = await request.text()
  if (text.length > 8192) throw new Error("The folder request is too large.")
  return JSON.parse(text) as T
}

async function handlePickFolder(
  ctx: Ctx,
  guard: GuardConfig,
  request: Request,
  picker?: FolderPicker,
): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Use POST to choose a folder.", { status: 405 })
  const input = await readFolderJson<{ path?: unknown }>(request)
  const initial = await projectDirectory(input.path ?? ctx.env.get("HOME") ?? ctx.env.cwd())
  if (!picker) {
    throw new FolderPickerError(
      "picker_unavailable",
      "The native folder picker is unavailable. Enter an absolute folder path.",
    )
  }
  const selected = await picker.pick(initial, request.signal)
  if (!isAuthorized(request, guard))
    return new Response("Folder access was revoked.", { status: 403 })
  if (selected === null) {
    const result: FolderPick = { kind: "cancelled" }
    return Response.json({ ok: true, ...result }, NO_STORE)
  }
  const { path, checkout, canInitialize } = await browseProjectFolder(ctx, selected)
  const result: FolderPick = { kind: "selected", folder: { path, checkout, canInitialize } }
  return Response.json({ ok: true, ...result }, NO_STORE)
}

async function handleFolderAction(ctx: Ctx, request: Request, url: URL): Promise<Response> {
  if (request.method === "GET") {
    const folder = await browseProjectFolder(ctx, url.searchParams.get("path") ?? undefined)
    return Response.json({ ok: true, ...folder }, NO_STORE)
  }
  const input = await readFolderJson<{ path?: unknown; initialize?: unknown }>(request)
  const chosen = await chooseProjectFolder(ctx, input.path, input.initialize === true)
  return Response.json({ ok: true, ...chosen }, NO_STORE)
}

const FOLDER_ROUTES = new Set([
  "/api/projects/folders",
  "/api/projects/folders/pick",
  "/api/projects/folders/known",
])

async function dispatchFolderRoute(
  ctx: Ctx,
  guard: GuardConfig,
  request: Request,
  url: URL,
  picker?: FolderPicker,
): Promise<Response> {
  if (url.pathname === "/api/projects/folders/known") {
    return request.method === "GET"
      ? Response.json({ ok: true, ...(await knownProjectFolders(ctx)) }, NO_STORE)
      : new Response("Use GET to inspect known folders.", { status: 405 })
  }
  if (url.pathname === "/api/projects/folders/pick")
    return handlePickFolder(ctx, guard, request, picker)
  return handleFolderAction(ctx, request, url)
}

export async function projectFolderRoute(
  ctx: Ctx,
  guard: GuardConfig,
  request: Request,
  picker?: FolderPicker,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!FOLDER_ROUTES.has(url.pathname) || !["GET", "POST"].includes(request.method)) return null
  if (!isAuthorized(request, guard))
    return new Response("Folder access requires the App or a browser it opened.", { status: 403 })
  try {
    return await dispatchFolderRoute(ctx, guard, request, url, picker)
  } catch (cause) {
    if (cause instanceof FolderPickerError)
      return Response.json({ ok: false, error: { code: cause.code, message: cause.message } })
    return Response.json(
      err({
        code: "bad_args",
        message: cause instanceof Error ? cause.message : "The folder could not be opened.",
      }),
    )
  }
}
