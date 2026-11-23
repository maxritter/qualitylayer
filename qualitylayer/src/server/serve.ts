// `qualitylayer serve`: the human's window onto the files. One instance per
// machine on 127.0.0.1, guarded by Host, Origin and a per-launch token. It
// exits by itself after an idle period with no open gates. Server → agent is
// only ever a file write, so a crashed server can never wedge a task.

import { existsSync } from "node:fs"
import { release } from "node:os"
import { artifactAppRoute } from "../core/app-routes.ts"
import { buildId } from "../core/build-id.ts"
import { readConfig } from "../core/config.ts"
import { DEFAULT_CONFIG } from "../core/config-values.ts"
import { stopAllViewing } from "../core/conversation/approvals.ts"
import { warmDiagnostics } from "../core/feedback/diagnostics.ts"
import { ownApp } from "../core/install/where.ts"
import { addressOverride } from "../core/licence/address-policy.ts"
import { installSpawnRecorder, isUnderTempDir, screenOf } from "../core/platform.ts"
import { PORT_ENV } from "../core/server-port.ts"
import { VERSION } from "../core/version.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { idleDeadline } from "./agent-sessions.ts"
import * as api from "./api.ts"
import { coalescing } from "./coalesce.ts"
import { crashLine, testFault } from "./crash.ts"
import type { AppSocketData, EventAccess } from "./event-socket.ts"
import { type FolderPicker, systemFolderPicker } from "./folder-picker.ts"
import { cachingGit } from "./git-cache.ts"
import { type GuardConfig, hasKeyHeader, refuse, sessionAuthority, sessionOf } from "./guard.ts"
import { json } from "./http-result.ts"
import { limitResume } from "./limit-resume.ts"
import { clearLock, clearLockSync, cockpitToken, cockpitUrl, liveLock, writeLock } from "./lock.ts"
import { sshConnector } from "./machines/connect-ssh.ts"
import { createMachines, fixtureConnector, type Machines } from "./machines/manager.ts"
import { type Ssh, systemSsh } from "./machines/ssh.ts"
import { createMemoryHandler } from "./memory.ts"
import { type Opener, openFile, systemOpener } from "./open-file.ts"
import { waitForPort } from "./port-wait.ts"
import { findChrome, stopRenderBrowsers } from "./render.ts"
import { Pace } from "./resource-guard.ts"
import { RunAttachments } from "./runs.ts"
import {
  type AppRoutesDeps,
  handleAppSubsystemRoutes,
  handleGlobalApiRoute,
} from "./serve-app-routes.ts"
import {
  createEntitlementCache,
  type EntitlementCache,
  handlePreEntitlementRoute,
  type PreEntitlementDeps,
} from "./serve-public.ts"
import {
  bindBunServer,
  createServerLifecycle,
  noFreePortError,
  startBackgroundServices,
  stopBunServerGracefully,
  waitForServerStop,
} from "./serve-runtime.ts"
import { serveStaticShell } from "./serve-stream.ts"
import { handleTasksApiRoute, type TaskRouteDeps } from "./serve-task-writes.ts"
import { type ServerLifecycle, wantedPort } from "./server-port.ts"
import { loadSessions, Sessions } from "./sessions.ts"
import type { SetupEvent } from "./setup.ts"
import { Thumbs } from "./thumbs.ts"
import { Hub, watchRuntime } from "./watch.ts"

export { SSE_BUFFER_BYTES } from "./serve-stream.ts"

export const TUNING = { streamOnlyNoTimeout: false, dropOnMemoryPressure: false }

export function tuningFor(ctx: Pick<Ctx, "env" | "home">): typeof TUNING {
  const tuning = { ...TUNING }
  const asked = ctx.env.get("QUALITYLAYER_TUNING")
  if (asked === undefined || !isUnderTempDir(ctx.home)) return tuning
  for (const item of asked.split(",")) {
    const [name, value] = item.split("=")
    if (name !== undefined && name in tuning && (value === "0" || value === "1"))
      tuning[name as keyof typeof TUNING] = value === "1"
  }
  return tuning
}

export function holdsOpen(method: string, path: string): boolean {
  if (path === "/stream" || path === "/api/setup/events" || path === "/api/agents/sign-in")
    return true
  return path.startsWith("/api/") && method !== "GET" && method !== "HEAD"
}

export function requestFailed(ctx: Ctx, error: unknown): Response {
  crashLine(ctx.home, "request", error)
  return Response.json(
    {
      ok: false,
      error: { code: "internal", message: "The server could not answer this request." },
    },
    { status: 500, headers: { "cache-control": "no-store" } },
  )
}

export type Gatekeeper = (ctx: Ctx) => Promise<Result<unknown>>

export type HandlerOptions = {
  folderPicker?: FolderPicker
  appFolder?: string | null
  opener?: Opener
  thumbs?: Thumbs
  server?: ServerLifecycle
  machines?: Machines
  ssh?: Ssh
}

function decodePathParts(path: string): string[] | null {
  try {
    return path.split("/").filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
}

async function openArtifactInBrowser(
  deps: { guard: GuardConfig; checked: GuardConfig; sessions: Sessions; opener: Opener },
  request: Request,
  target: { scope: "task" | "project"; id: string; file: string; section?: string },
) {
  const route = artifactAppRoute(target.scope, target.id, target.file, target.section)
  if (!route)
    return err({
      code: "bad_args" as const,
      message: "This artifact page or section has no valid browser route",
    })
  const code = await deps.sessions.pair(
    false,
    sessionAuthority(request, deps.checked)?.keyPaired === true,
  )
  return openFile(
    "browser",
    `http://127.0.0.1:${deps.guard.port}/pair/${code}?in=browser#/${route}`,
    deps.opener.platform,
    deps.opener.run,
  )
}

async function runPostRequestEffects(
  ctx: Ctx,
  runs: RunAttachments,
  idleStop: ReturnType<typeof idleDeadline>,
  request: Request,
  meta: { path: string; ok: boolean },
) {
  if (!meta.ok) return
  if (meta.path === "/api/config" && request.method === "PUT") {
    await runs.refreshCapabilities()
    idleStop.start()
  }
  const task = meta.path.match(/^\/api\/tasks\/([^/]+)\/[a-z]/)?.[1]
  if (
    task !== undefined &&
    decodeURIComponent(meta.path.split("/")[4] ?? "") !== "viewing" &&
    request.method !== "GET"
  ) {
    await api.refreshTaskPages(ctx, decodeURIComponent(task))
  }
}

async function dispatchApiRequest(
  appDeps: AppRoutesDeps,
  taskDeps: TaskRouteDeps,
  request: Request,
  url: URL,
): Promise<Response> {
  const subsystem = await handleAppSubsystemRoutes(appDeps, request, url)
  if (subsystem !== null) return subsystem
  const parts = decodePathParts(url.pathname)
  if (parts === null)
    return json({ ok: false, error: { code: "bad_args", message: "malformed URL encoding" } })
  const globalReply = await handleGlobalApiRoute(appDeps, parts, request, url)
  if (globalReply !== null) return globalReply
  const taskReply =
    parts[1] === "tasks" ? await handleTasksApiRoute(taskDeps, parts, request, url) : null
  return taskReply ?? new Response("not found", { status: 404 })
}

type RequestPipeline = {
  ctx: Ctx
  checked: GuardConfig
  hub: Hub
  sessions: Sessions
  entitlement: EntitlementCache
  preDeps: PreEntitlementDeps
  appDeps: AppRoutesDeps
  taskDeps: TaskRouteDeps
}

async function handleApiOrShell(
  pipe: RequestPipeline,
  request: Request,
  url: URL,
): Promise<Response> {
  const path = url.pathname
  const isApi = path.startsWith("/api/") || path === "/stream"
  const refusal = refuse(request, pipe.checked, isApi)
  if (refusal !== null) return new Response(refusal.reason, { status: refusal.status })
  if (!isApi) return serveStaticShell(pipe.ctx, request, path, pipe.sessions, pipe.checked.token)
  if (path === "/api/viewers" && request.method === "GET") return json(ok({ tabs: pipe.hub.size }))
  pipe.hub.lastActivity = Date.now()
  return handleAuthorizedApi(pipe, request, url)
}

async function handleAuthorizedApi(
  pipe: RequestPipeline,
  request: Request,
  url: URL,
): Promise<Response> {
  const preReply = await handlePreEntitlementRoute(pipe.preDeps, request, url.pathname)
  if (preReply !== null) return preReply
  const ent = await pipe.entitlement.check()
  if (ent !== null && !ent.ok) return json(ent)
  return dispatchApiRequest(pipe.appDeps, pipe.taskDeps, request, url)
}

export function createHandler(
  ctx: Ctx,
  guard: GuardConfig,
  hub: Hub,
  gatekeeper?: Gatekeeper,
  options: HandlerOptions = {},
) {
  const entitlement = createEntitlementCache(ctx, gatekeeper)
  const appFolder = options.appFolder === undefined ? ownApp() : options.appFolder
  const opener = options.opener ?? systemOpener()
  const folderPicker = options.folderPicker ?? systemFolderPicker()
  const setupEvents = new Hub<SetupEvent>()
  const sessions = guard.sessions ?? new Sessions(ctx)
  sessions.bindServer(guard.token)
  const checked: GuardConfig = { ...guard, sessions }
  const eventAccess: EventAccess = { sessions, now: () => ctx.clock.now() }
  const browserStreamSession = (request: Request) =>
    hasKeyHeader(request, checked)
      ? undefined
      : { access: eventAccess, session: sessionOf(request, checked.token) }
  const openArtifactBrowser =
    (request: Request) => (scope: "task" | "project", id: string, file: string, section?: string) =>
      openArtifactInBrowser({ guard, checked, sessions, opener }, request, {
        scope,
        id,
        file,
        section,
      })
  const resume = limitResume(ctx, () => {
    hub.publish({ type: "run-changed" })
    hub.publish({ type: "live-changed" })
  })
  const idleStop = idleDeadline(ctx, () => hub.publish({ type: "run-changed" }))
  const runs = new RunAttachments(ctx, checked)
  const stopSettingsChanges = hub.observe((event) => {
    if (event.type === "run-changed" && event.path) {
      void runs.processSettingsChange(event.path).catch(() => {
        console.error(
          "A queued session-settings change could not be processed; it remains on its run.",
        )
      })
    }
  })
  const thumbs = options.thumbs ?? new Thumbs(ctx, () => findChrome((name) => ctx.env.get(name)))
  const pipe: RequestPipeline = {
    ctx,
    checked,
    hub,
    sessions,
    entitlement,
    preDeps: { ctx, checked, sessions, appFolder, setupEvents, entitlement, browserStreamSession },
    appDeps: {
      ctx,
      checked,
      hub,
      opener,
      folderPicker,
      thumbs,
      memory: createMemoryHandler(ctx),
      resume,
      runs,
      server: options.server,
      machines: options.machines,
      ssh: options.ssh,
      browserStreamSession,
      openArtifactBrowser,
    },
    taskDeps: {
      ctx,
      checked,
      thumbs,
      opener,
      runs,
      lists: coalescing<api.TaskSummary[]>(),
      details: coalescing<Result<api.TaskDetail>>(),
      changes: coalescing<Result<api.TaskChanges>>(),
      openArtifactBrowser,
    },
  }
  const handler = async (request: Request): Promise<Response> => {
    try {
      const url = URL.parse(request.url)
      const path = url?.pathname ?? ""
      testFault(ctx, "route", path)
      testFault(ctx, "rejection")
      testFault(ctx, "exception")
      const response =
        url === null
          ? new Response("foreign host", { status: 403 })
          : await handleApiOrShell(pipe, request, url)
      await runPostRequestEffects(ctx, runs, idleStop, request, { path, ok: response.ok })
      return response
    } catch (error) {
      return requestFailed(ctx, error)
    }
  }
  return Object.assign(handler, {
    runs,
    resume,
    idleStop,
    close: async () => {
      stopSettingsChanges()
      setupEvents.close()
      idleStop.dispose()
      runs.dispose()
      await folderPicker.close()
    },
  })
}

export type ServeOptions = { port?: number; gatekeeper?: Gatekeeper; foreground?: boolean }

function registerProcessCrashHandlers(home: string) {
  const onRejection = (reason: unknown) => crashLine(home, "rejection", reason)
  const onException = (error: Error) => {
    crashLine(home, "exception", error)
    clearLockSync(home, process.pid)
    process.exit(1)
  }
  process.on("unhandledRejection", onRejection)
  process.on("uncaughtException", onException)
  return () => {
    process.off("unhandledRejection", onRejection)
    process.off("uncaughtException", onException)
  }
}

/** Start the server and hold the lock until it exits. Resolves when it stops. */
export async function serve(
  given: Ctx,
  options: ServeOptions = {},
): Promise<Result<{ url: string; already?: true }>> {
  const spawnLogPath = process.env.QUALITYLAYER_SPAWN_LOG
  if (spawnLogPath !== undefined && spawnLogPath !== "")
    installSpawnRecorder(given.home, spawnLogPath)
  const running = await liveLock(given)
  if (running !== null && running.pid !== process.pid)
    return ok({ url: cockpitUrl(running), already: true })
  const git = cachingGit(given)
  const ctx: Ctx = { ...given, git }
  const tuning = tuningFor(ctx)
  const detachCrashHandlers = registerProcessCrashHandlers(ctx.home)
  const building = buildId(ctx.env)
  const config = await readConfig(ctx)
  const token = await cockpitToken(ctx)
  const hub = new Hub()
  const unobserveTree = hub.observe((event) => {
    if (event.path !== undefined && !event.path.startsWith(ctx.home)) git.treeChanged()
  })
  const sessions = await loadSessions(ctx)
  await stopAllViewing(ctx)
  const guard: GuardConfig = { port: 0, token, sessions }
  let server: Bun.Server<AppSocketData> | null = null
  let endServing: () => void = () => {}
  const screen = screenOf({
    os: process.platform,
    release: release(),
    env: ctx.env,
    exists: existsSync,
  })
  const wanted = wantedPort({
    setting: config.cockpit.port,
    env: ctx.env.get(PORT_ENV),
    screen,
    defaultPort: DEFAULT_CONFIG.cockpit.port,
  })
  const first = options.port ?? wanted.port
  const lifecycle = createServerLifecycle(ctx, guard, wanted, {
    getServer: () => server,
    endServing: () => endServing(),
  })
  if (options.port !== undefined) await waitForPort(options.port, 5_000)
  const pace = new Pace()
  const sshConfig = addressOverride(ctx.env, "QUALITYLAYER_SSH_CONFIG")
  const ssh = systemSsh(
    ctx.home,
    (line) => console.error(`QualityLayer machines: ${line}`),
    sshConfig === undefined || sshConfig === "" ? undefined : ["-F", sshConfig],
  )
  const machines = createMachines(
    ctx,
    guard,
    () => hub.publish({ type: "machines-changed" }),
    fixtureConnector(ctx) ?? sshConnector(ssh),
  )
  const handler = createHandler(ctx, guard, hub, options.gatekeeper, {
    server: lifecycle,
    machines,
    ssh,
  })
  server = bindBunServer(
    {
      ctx,
      guard,
      hub,
      sessions,
      pace,
      handler,
      streamOnlyNoTimeout: tuning.streamOnlyNoTimeout,
      holdsOpen,
      requestFailed,
    },
    first,
  )
  if (server === null) return noFreePortError(first)
  const watching = await watchRuntime(ctx, hub, pace).catch(() => null)
  const stopWatching = watching?.stop ?? (() => {})
  await writeLock(ctx, {
    pid: process.pid,
    port: guard.port,
    token,
    started: Date.now(),
    version: VERSION,
    build: await building,
    exe: process.execPath,
    wanted: wanted.port,
  })
  void watching?.settle().then(
    () => {
      if (hub.size > 0) hub.publishClients({ type: "publication-changed" })
    },
    () => {},
  )
  const stopBackground = startBackgroundServices({
    ctx,
    git,
    hub,
    pace,
    handler,
    machines,
    dropOnMemoryPressure: tuning.dropOnMemoryPressure,
  })
  api.warmTasks(ctx).catch(() => {})
  warmDiagnostics(ctx).catch(() => {})
  const url = cockpitUrl({ port: guard.port })
  if (options.foreground === true)
    console.log(
      `QualityLayer App: http://127.0.0.1:${guard.port}/pair/${await sessions.pair(false)}`,
    )
  await waitForServerStop({
    ctx,
    hub,
    handler,
    idleMinutes: config.cockpit.idleMinutes,
    onRegisterEnd: (stop) => {
      endServing = stop
    },
  })
  stopBackground()
  stopWatching()
  unobserveTree()
  await machines.stop().catch(() => {})
  await stopRenderBrowsers()
  hub.close()
  const handlerClosed = handler.close().then(
    () => null,
    (cause: unknown) => cause,
  )
  await stopBunServerGracefully(server)
  await clearLock(ctx, process.pid)
  detachCrashHandlers()
  const closeFailure = await handlerClosed
  if (closeFailure !== null) throw closeFailure
  return ok({ url })
}
