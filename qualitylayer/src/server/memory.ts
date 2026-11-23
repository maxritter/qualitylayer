import { readMemoryActivity } from "../core/memory-activity.ts"
import type { Ctx } from "../ctx.ts"
import type { MemoryOverview } from "../memory-contracts.ts"
import { memoryService } from "../memory-runtime.ts"
import { enrichActivityTitles } from "./memory-activity.ts"
import {
  type MemoryHandlerService,
  MemoryRequestError,
  memoryReply,
  parseMemoryQuery,
  readMemoryBody,
  requireFlag,
  requireText,
} from "./memory-http.ts"
import {
  createProjectRegistrar,
  handlePilotImport,
  type MemoryRegistration,
} from "./memory-projects.ts"
import { repositoryReply } from "./memory-repository.ts"
import { listMemoryRecords } from "./memory-search.ts"
import { PilotMemoryMigration } from "./pilot-memory.ts"

type RouteContext = {
  ctx: Ctx
  service: MemoryHandlerService
  request: Request
  url: URL
  path: string[]
  readable: MemoryRegistration[]
  projectIssues: NonNullable<MemoryOverview["projectIssues"]>
}

function isActivityRoute(method: string, path: string[]): boolean {
  if (method !== "GET" || path.length !== 5) return false
  return path[0] === "projects" && path[2] === "tasks" && path[4] === "activity"
}

async function handleGetSingle(route: RouteContext): Promise<Response | null> {
  const input = parseMemoryQuery(route.url)
  if (route.path[0] === "overview") {
    const overview = await route.service.overview(input.project)
    const issues = input.project
      ? route.projectIssues.filter((project) => project.id === input.project)
      : route.projectIssues
    return memoryReply({
      ...overview,
      ...(issues.length > 0 ? { projectIssues: issues } : {}),
    })
  }
  if (route.path[0] === "projects") return memoryReply(await route.service.projects(input))
  if (route.path[0] === "records") return memoryReply(await listMemoryRecords(route.service, input))
  return null
}

async function handleGetRoute(route: RouteContext): Promise<Response | null> {
  const { ctx, service, path, readable } = route
  if (isActivityRoute("GET", path)) {
    if (!readable.some((project) => project.id === path[1]))
      throw new MemoryRequestError("Project not found.", 404)
    const project = requireText(path[1], "Project")
    const activity = await readMemoryActivity(ctx, project, requireText(path[3], "Task"))
    return memoryReply(await enrichActivityTitles(service, project, activity))
  }
  if (path.length === 1) return handleGetSingle(route)
  if (path[0] === "projects" && path[2] === "pinned" && path.length === 3)
    return memoryReply({ items: await service.pinned(requireText(path[1], "Project")) })
  if (path[0] === "records" && path.length === 2)
    return memoryReply(await service.read(requireText(path[1], "Memory id")))
  return null
}

async function handlePutSettings(
  service: MemoryHandlerService,
  request: Request,
): Promise<Response> {
  const input = await readMemoryBody(request)
  if (input.enabled === undefined && input.sessions === undefined)
    throw new MemoryRequestError("Send enabled or sessions as true or false.")
  return memoryReply(
    await service.settings({
      ...(input.enabled === undefined ? {} : { enabled: requireFlag(input.enabled, "enabled") }),
      ...(input.sessions === undefined
        ? {}
        : { sessions: requireFlag(input.sessions, "sessions") }),
    }),
  )
}

async function handlePutSubresource(
  service: MemoryHandlerService,
  request: Request,
  path: string[],
): Promise<Response | null> {
  if (path[0] === "records" && path[2] === "pin") {
    return memoryReply(
      await service.pin(
        requireText(path[1], "Memory id"),
        requireFlag((await readMemoryBody(request)).pinned, "pinned"),
      ),
    )
  }
  if (path[0] === "records" && path[2] === "confirm") {
    const input = await readMemoryBody(request)
    return memoryReply(
      await service.confirm(
        requireText(path[1], "Memory id"),
        input.reason === undefined ? undefined : requireText(input.reason, "Reason", 300),
      ),
    )
  }
  if (path[0] === "projects" && path[2] === "sharing") {
    return memoryReply(
      await service.sharing(
        requireText(path[1], "Project"),
        requireFlag((await readMemoryBody(request)).enabled, "enabled"),
      ),
    )
  }
  return null
}

async function handlePutRoute(
  service: MemoryHandlerService,
  request: Request,
  path: string[],
): Promise<Response | null> {
  if (path[0] === "settings" && path.length === 1) return handlePutSettings(service, request)
  if (path[0] === "records" && path.length === 2) {
    const id = requireText(path[1], "Memory id")
    const active = requireFlag((await readMemoryBody(request)).active, "active")
    return memoryReply(await service.retire(id, active))
  }
  return path.length === 3 ? handlePutSubresource(service, request, path) : null
}

async function dispatchMemoryRoute(
  route: RouteContext,
  pilotMigration: PilotMemoryMigration,
): Promise<Response> {
  const { service, request, path } = route
  const method = request.method
  if (path[0] === "repository" && service.repository)
    return repositoryReply(service.repository, request, path.slice(1), readMemoryBody, memoryReply)
  if (method === "POST" && path[0] === "import" && path[1] === "pilot" && path.length === 3) {
    const action = path[2] ?? ""
    return memoryReply(
      await pilotMigration.handle(action, await readMemoryBody(request), service, request.signal),
    )
  }
  if (method === "POST" && path.join("/") === "import/pilot")
    return handlePilotImport(service, request)
  const answer =
    method === "GET"
      ? await handleGetRoute(route)
      : method === "PUT"
        ? await handlePutRoute(service, request, path)
        : null
  return answer ?? new Response("Memory route not found.", { status: 404 })
}

/** Called only after the App's origin, session and entitlement guards. */
export function createMemoryHandler(
  ctx: Ctx,
  make: () => MemoryHandlerService = () => memoryService(ctx),
) {
  const pilotMigration = new PilotMemoryMigration(() => ctx.clock.now())
  const syncProjects = createProjectRegistrar(ctx)
  return async (request: Request, keyPaired: boolean): Promise<Response | null> => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/api/memory/")) return null
    if (request.method !== "GET" && !keyPaired) {
      return new Response("Only the App and browsers it opened may change memories.", {
        status: 403,
      })
    }
    let service: MemoryHandlerService | null = null
    try {
      service = make()
      const { readable, projectIssues } = await syncProjects(service)
      const path = url.pathname.slice("/api/memory/".length).split("/").map(decodeURIComponent)
      return await dispatchMemoryRoute(
        { ctx, service, request, url, path, readable, projectIssues },
        pilotMigration,
      )
    } catch (cause) {
      const status = cause instanceof MemoryRequestError ? cause.status : 400
      return Response.json(
        {
          ok: false,
          error: {
            code: "bad_args",
            message: cause instanceof Error ? cause.message : "Memory request could not finish.",
          },
        },
        { status, headers: { "cache-control": "no-store" } },
      )
    } finally {
      await service?.close()
    }
  }
}
