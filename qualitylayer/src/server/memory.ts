import { createHash } from "node:crypto"
import { join } from "node:path"
import type { MemoryService } from "../core/memory/index.ts"
import { readMemoryActivity } from "../core/memory-activity.ts"
import type { Ctx } from "../ctx.ts"
import type {
  MemoryApi,
  MemoryOverview,
  MemoryPage,
  MemoryPreview,
  MemoryQuery,
  MemoryRecordView,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryStepLesson,
  MemoryTaskActivity,
  MemoryTaskActivityView,
} from "../memory-contracts.ts"
import { PERSONAL_PROJECT } from "../memory-contracts.ts"
import { memoryService } from "../memory-runtime.ts"
import { registeredProjects } from "./api.ts"
import { PilotMemoryMigration } from "./pilot-memory.ts"

const MAX_BODY = 3 * 1024 * 1024
const MAX_QUERY = 500
type Service = MemoryApi & {
  reviewPilotRecords?: MemoryService["reviewPilotRecords"]
  importPilotRecords?: MemoryService["importPilotRecords"]
  registerProject(project: {
    id: string
    name: string
    root: string
    commonDir?: string
    automatic?: true
  }): Promise<void>
  search(
    project: string,
    query: string,
    limit?: number,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult>
  close(): Promise<void>
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

function reply(data: unknown, status = 200): Response {
  return Response.json(
    { ok: true, ...(data as object) },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  )
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY)
    throw new RequestError("Memory input is too large.", 413)
  const reader = request.body?.getReader()
  if (!reader) throw new RequestError("Send a JSON object.")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_BODY) {
        await reader.cancel()
        throw new RequestError("Memory input is too large.", 413)
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new RequestError("Send valid JSON.")
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new RequestError("Send a JSON object.")
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, max = MAX_QUERY): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    throw new RequestError(`${label} is missing or too long.`)
  return value
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new RequestError(`${label} must be true or false.`)
  return value
}

function query(url: URL): MemoryQuery {
  const input = url.searchParams
  for (const value of input.values())
    if (value.length > MAX_QUERY) throw new RequestError("Memory query is too long.")
  const limit = input.has("limit") ? Number(input.get("limit")) : undefined
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))
    throw new RequestError("Memory page size must be 1–100.")
  const source = input.get("source") ?? undefined
  const scope = input.get("scope") ?? undefined
  if (
    source !== undefined &&
    !["all", "task", "session", "pilot", "repository", "manual"].includes(source)
  )
    throw new RequestError("Unknown memory source.")
  if (scope !== undefined && !["all", "private", "project"].includes(scope))
    throw new RequestError("Unknown memory scope.")
  const sources = input.get("sources") ?? undefined
  if (sources !== undefined && sources !== "changed")
    throw new RequestError("Unknown memory sources filter.")
  const state = input.get("state") ?? undefined
  if (state !== undefined && state !== "active" && state !== "retired")
    throw new RequestError("Unknown memory state.")
  return {
    ...(sources ? { sources } : {}),
    ...(state ? { state } : {}),
    query: input.get("query") ?? undefined,
    project: input.get("project") ?? undefined,
    cursor: input.get("cursor") ?? undefined,
    limit,
    source: source as MemoryQuery["source"],
    scope: scope as MemoryQuery["scope"],
  }
}

/** A query without a project searches the projects that hold a lesson, this many at a time. */
const SEARCHED_PROJECTS = 50
/** The most lessons one project contributes to a query's results. */
const SEARCH_PER_PROJECT = 100

/** Where a ranked search stands: which window of projects, and how far into its merged results. */
type Place = { window: number; offset: number }

function placeKey(words: string, input: MemoryQuery): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        words,
        input.project ?? "",
        input.source ?? "",
        input.scope ?? "",
        input.sources ?? "",
        ...(input.state ? [input.state] : []),
      ]),
    )
    .digest("hex")
    .slice(0, 16)
}

function encodePlace(place: Place, key: string): string {
  return Buffer.from(JSON.stringify({ ...place, key })).toString("base64url")
}

function decodePlace(value: string | undefined, key: string): Place {
  if (!value) return { window: 0, offset: 0 }
  try {
    const raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >
    if (
      raw.key === key &&
      Number.isSafeInteger(raw.window) &&
      Number.isSafeInteger(raw.offset) &&
      (raw.window as number) >= 0 &&
      (raw.offset as number) >= 0
    )
      return { window: raw.window as number, offset: raw.offset as number }
  } catch {
    // Falls through to the error below.
  }
  throw new RequestError("This page of results is no longer valid. Search again.")
}

/** The projects of one window of a query without a project, and whether more follow. */
async function searchWindow(
  service: Service,
  window: number,
): Promise<{ projects: string[]; more: boolean }> {
  const first = window * SEARCHED_PROJECTS
  const holders: string[] = []
  for (let cursor: string | undefined; holders.length <= first + SEARCHED_PROJECTS; ) {
    const page = await service.projects({ cursor, limit: 100 })
    for (const project of page.items) if (project.count > 0) holders.push(project.id)
    if (page.next === null) break
    cursor = page.next
  }
  return {
    projects: holders.slice(first, first + SEARCHED_PROJECTS),
    more: holders.length > first + SEARCHED_PROJECTS,
  }
}

/**
 * The lesson list. A query is ranked by the same fused search the agents use (words and meaning), so
 * a rephrased query finds its lesson; no query, or memory paused, lists by date as before. Unlike
 * the agents' search it includes retired lessons, so one can be found and restored, and a source or
 * scope narrows the matches before any limit. Pages carry a cursor and an exact total for what was
 * searched; across many projects the cursor moves on to the next window of projects.
 */
async function records(service: Service, input: MemoryQuery): Promise<MemoryPage<MemoryPreview>> {
  const words = input.query?.trim()
  if (!words || !(await service.settings({})).enabled) return service.list(input)
  const key = placeKey(words, input)
  const place = decodePlace(input.cursor, key)
  const { projects, more } = input.project
    ? place.window === 0
      ? { projects: [input.project], more: false }
      : { projects: [], more: false }
    : await searchWindow(service, place.window)
  const options = {
    includeRetired: true,
    ...(input.source && input.source !== "all" ? { source: input.source } : {}),
    ...(input.scope && input.scope !== "all" ? { scope: input.scope } : {}),
  }
  const found: MemoryPreview[][] = []
  for (const project of projects)
    found.push(
      (await service.search(project, words, SEARCH_PER_PROJECT, options)).lessons.filter(
        (lesson) =>
          (input.sources !== "changed" || lesson.sources?.state === "changed") &&
          (!input.state || lesson.state === input.state),
      ),
    )
  // Each project's list is in rank order; take one from each in turn so no project crowds the rest.
  const items: MemoryPreview[] = []
  for (let rank = 0; found.some((lessons) => rank < lessons.length); rank++)
    for (const lessons of found) {
      const lesson = lessons[rank]
      if (lesson) items.push(lesson)
    }
  const size = input.limit ?? 20
  const end = place.offset + size
  return {
    items: items.slice(place.offset, end),
    total: items.length,
    next:
      end < items.length
        ? encodePlace({ window: place.window, offset: end }, key)
        : more
          ? encodePlace({ window: place.window + 1, offset: 0 }, key)
          : null,
  }
}

/**
 * A task's activity with each step's lesson ids named. A retired lesson keeps its title and says why;
 * a confirmed one says why it still holds; a foreign or missing lesson has no title.
 */
async function withTitles(
  service: Service,
  project: string,
  activity: MemoryTaskActivity,
): Promise<MemoryTaskActivityView> {
  const lessons = new Map<string, Promise<MemoryRecordView | null>>()
  const lesson = (id: string) => {
    let found = lessons.get(id)
    if (!found) {
      found = service.read(id).then(
        // The person's own lessons belong to every task's activity.
        (read) => (read.project === project || read.project === PERSONAL_PROJECT ? read : null),
        () => null,
      )
      lessons.set(id, found)
    }
    return found
  }
  const named = (ids: string[], confirmed = false) =>
    Promise.all(
      ids.map(async (id): Promise<MemoryStepLesson> => {
        const read = await lesson(id)
        if (!read) return { id, title: null }
        const reason =
          read.state === "retired"
            ? read.retired?.reason
            : confirmed
              ? read.checked?.reason
              : undefined
        return {
          id,
          title: read.title,
          ...(read.state === "retired" ? { retired: true as const } : {}),
          ...(read.project === PERSONAL_PROJECT ? { personal: true as const } : {}),
          ...(reason ? { reason } : {}),
        }
      }),
    )
  const steps: MemoryTaskActivityView["steps"] = {}
  for (const [step, lists] of Object.entries(activity.steps ?? {})) {
    steps[step] = { used: await named(lists.used), saved: await named(lists.saved) }
    for (const list of ["revised", "retired", "confirmed"] as const) {
      const ids = lists[list]
      if (ids?.length)
        (steps[step] as MemoryTaskActivityView["steps"][string])[list] = await named(
          ids,
          list === "confirmed",
        )
    }
  }
  return { ...activity, steps }
}

/** A missing registry folder matters to Memory only while its local catalog still retains it. */
async function retainedMissingProject(
  service: Service,
  project: Parameters<Service["registerProject"]>[0],
) {
  await service.registerProject({ ...project, automatic: true })
  try {
    await service.overview(project.id)
    return true
  } catch {
    return false
  }
}

/** Called only after the App's origin, session and entitlement guards. */
export function createMemoryHandler(ctx: Ctx, make: () => Service = () => memoryService(ctx)) {
  const pilotMigration = new PilotMemoryMigration(() => ctx.clock.now())
  let registeredAt = -Infinity
  let registryStamp = ""
  let registrations: { id: string; name: string; root: string; commonDir?: string }[] = []
  return async (request: Request, keyPaired: boolean): Promise<Response | null> => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/api/memory/")) return null
    if (request.method !== "GET" && !keyPaired)
      return new Response("Only the App and browsers it opened may change memories.", {
        status: 403,
      })
    let service: Service | null = null
    try {
      service = make()
      const registry = await ctx.fs.stat?.(join(ctx.home, "projects"))
      const stamp = registry ? `${registry.mtimeMs}:${registry.size}` : "missing"
      if (stamp !== registryStamp || ctx.clock.now() - registeredAt >= 60_000) {
        registrations = (await registeredProjects(ctx)).flatMap((project) =>
          project.paths[0]
            ? [
                {
                  id: project.id,
                  name: project.name,
                  root: project.paths[0],
                  ...(project.commonDir ? { commonDir: project.commonDir } : {}),
                },
              ]
            : [],
        )
        registeredAt = ctx.clock.now()
        registryStamp = stamp
      }
      const readable: typeof registrations = []
      const projectIssues: NonNullable<MemoryOverview["projectIssues"]> = []
      for (const project of registrations) {
        const name =
          typeof project.name === "string"
            ? project.name.trim().slice(0, 200) || project.id
            : project.id
        try {
          if (!(await ctx.fs.exists(project.root))) {
            if (!(await retainedMissingProject(service, { ...project, name }))) continue
            projectIssues.push({ id: project.id, name, reason: "root-unavailable" })
            readable.push(project)
            continue
          }
          await service.registerProject({ ...project, automatic: true })
          readable.push(project)
        } catch {
          projectIssues.push({
            id: project.id,
            name,
            reason: "registration-failed",
          })
        }
      }
      const path = url.pathname.slice("/api/memory/".length).split("/").map(decodeURIComponent)
      const method = request.method
      if (method === "POST" && path[0] === "import" && path[1] === "pilot" && path.length === 3)
        return reply(
          await pilotMigration.handle(path[2]!, await body(request), service, request.signal),
        )
      if (
        method === "GET" &&
        path[0] === "projects" &&
        path[2] === "tasks" &&
        path[4] === "activity" &&
        path.length === 5
      ) {
        if (!readable.some((project) => project.id === path[1]))
          throw new RequestError("Project not found.", 404)
        const project = text(path[1], "Project")
        return reply(
          await withTitles(
            service,
            project,
            await readMemoryActivity(ctx, project, text(path[3], "Task")),
          ),
        )
      }
      if (method === "GET" && path.length === 1) {
        const input = query(url)
        if (path[0] === "overview") {
          const overview = await service.overview(input.project)
          const issues = input.project
            ? projectIssues.filter((project) => project.id === input.project)
            : projectIssues
          return reply({
            ...overview,
            ...(issues.length > 0 ? { projectIssues: issues } : {}),
          })
        }
        if (path[0] === "projects") return reply(await service.projects(input))
        if (path[0] === "records") return reply(await records(service, input))
      }
      if (method === "GET" && path[0] === "projects" && path[2] === "pinned" && path.length === 3)
        return reply({ items: await service.pinned(text(path[1], "Project")) })
      if (method === "PUT" && path[0] === "records" && path[2] === "pin" && path.length === 3)
        return reply(
          await service.pin(
            text(path[1], "Memory id"),
            flag((await body(request)).pinned, "pinned"),
          ),
        )
      if (method === "PUT" && path[0] === "records" && path[2] === "confirm" && path.length === 3) {
        const input = await body(request)
        return reply(
          await service.confirm(
            text(path[1], "Memory id"),
            input.reason === undefined ? undefined : text(input.reason, "Reason", 300),
          ),
        )
      }
      if (method === "PUT" && path[0] === "settings" && path.length === 1) {
        const input = await body(request)
        if (input.enabled === undefined && input.sessions === undefined)
          throw new RequestError("Send enabled or sessions as true or false.")
        return reply(
          await service.settings({
            ...(input.enabled === undefined ? {} : { enabled: flag(input.enabled, "enabled") }),
            ...(input.sessions === undefined ? {} : { sessions: flag(input.sessions, "sessions") }),
          }),
        )
      }
      if (method === "PUT" && path[0] === "projects" && path[2] === "sharing" && path.length === 3)
        return reply(
          await service.sharing(
            text(path[1], "Project"),
            flag((await body(request)).enabled, "enabled"),
          ),
        )
      if (path[0] === "records" && path.length === 2) {
        const id = text(path[1], "Memory id")
        if (method === "GET") return reply(await service.read(id))
        if (method === "PUT")
          return reply(await service.retire(id, flag((await body(request)).active, "active")))
      }
      if (method === "POST" && path.join("/") === "import/pilot") {
        const input = await body(request)
        const project = text(input.project, "Project")
        if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 32)
          throw new RequestError("Choose 1–32 Pilot files.")
        const files = input.files.map((file: unknown) => {
          if (!file || typeof file !== "object")
            throw new RequestError("Each Pilot file needs a name and content.")
          const raw = file as Record<string, unknown>
          return {
            name: text(raw.name, "File name", 256),
            content: text(raw.content, "File content", 1024 * 1024),
          }
        })
        if (
          files.reduce((total, file) => total + Buffer.byteLength(file.content), 0) >
          2 * 1024 * 1024
        )
          throw new RequestError("Pilot files exceed the 2 MB import limit.", 413)
        return reply(await service.importPilot({ project, files }))
      }
      return new Response("Memory route not found.", { status: 404 })
    } catch (cause) {
      const status = cause instanceof RequestError ? cause.status : 400
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
