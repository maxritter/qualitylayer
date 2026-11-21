import { precommitRoute } from "./precommit.ts"
// `qualitylayer serve`: the human's window onto the files. One instance per
// machine on 127.0.0.1, guarded by Host, Origin and a per-launch token. It
// exits by itself after an idle period with no open gates. Server → agent is
// only ever a file write, so a crashed server can never wedge a task.

import { existsSync } from "node:fs"
import { release } from "node:os"
import { setAgentEffort, setSubagentModel, subagentModels } from "../core/agents/subagent-model.ts"
import { artifactAppRoute } from "../core/app-routes.ts"
import { ARTIFACT_NAME } from "../core/artifact/format.ts"
import { buildId } from "../core/build-id.ts"
import { readConfig, type Theme } from "../core/config.ts"
import { DEFAULT_CONFIG } from "../core/config-values.ts"
import { stopAllViewing } from "../core/conversation/approvals.ts"
import { warmDiagnostics } from "../core/feedback/diagnostics.ts"
import { appPointer, ownApp } from "../core/install/where.ts"
import { readPersonal, saveInstructions } from "../core/instructions.ts"
import { integrationsRoute } from "../core/integrations/route.ts"
import { addressOverride } from "../core/licence/address-policy.ts"
import { accessPath, licencePath } from "../core/licence/cache.ts"
import { status as licenceStatus, uncheckedMessage } from "../core/licence/verify.ts"
import { installSpawnRecorder, isUnderTempDir, screenOf } from "../core/platform.ts"
import { personName } from "../core/profile/name.ts"
import { startRetention } from "../core/retention.ts"
import { touchesProtectedSettings } from "../core/run/contracts.ts"
import { isAgentRunsRoute } from "../core/run/protocol.ts"
import { PORT_ENV, PORT_TRIES } from "../core/server-port.ts"
import { VERSION } from "../core/version.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { FAVICON } from "../ui/brand/mark.ts"
import { agentHistoryRoute } from "./agent-history.ts"
import { agentSessionsRoute, idleDeadline, startIdleDeadline } from "./agent-sessions.ts"
import { agentSetupRoute } from "./agent-setup.ts"
import * as api from "./api.ts"
import { resolveArtifactAgentContext } from "./artifact-agent.ts"
import { type ArtifactFeedbackAction, artifactFeedbackRoute } from "./artifact-feedback.ts"
import * as library from "./artifact-library.ts"
import { newLasting } from "./artifact-new.ts"
import * as artifacts from "./artifacts.ts"
import { automationsRoute, automationsWaiting, startAutomations } from "./automations.ts"
import { coalescing } from "./coalesce.ts"
import { crashLine, testFault } from "./crash.ts"
import { diskUseRoute } from "./disk-use.ts"
import { docSections } from "./doc-sections.ts"
import {
  type AppSocketData,
  type EventAccess,
  eventSockets,
  isAgentSocket,
  isEventSocket,
  watchEventSession,
} from "./event-socket.ts"
import { exportFile } from "./export-files.ts"
import { diagnosticsPreview, feedbackWho, postFeedback, startOutboxRetry } from "./feedback.ts"
import {
  publicFeedbackCancel,
  publicFeedbackConfirm,
  publicFeedbackImage,
  publicFeedbackReview,
  publicFeedbackStatus,
  publicFeedbackSystem,
} from "./feedback-public.ts"
import { type FolderPicker, systemFolderPicker } from "./folder-picker.ts"
import { foundProjectsRoute } from "./found-projects.ts"
import { cachingGit } from "./git-cache.ts"
import { type GuardConfig, hasKeyHeader, refuse, sessionAuthority, sessionOf } from "./guard.ts"
import { HANDOFF_ATTACHMENTS_PATH, handoffAttachmentsRoute } from "./handoff-attachments.ts"
import { body, json } from "./http-result.ts"
import { interactionRoute, readInteraction } from "./interaction.ts"
import { limitResume, startLimitResume } from "./limit-resume.ts"
import { limitsRoute, startLimitTurns } from "./limits.ts"
import {
  clearLock,
  clearLockSync,
  cockpitToken,
  cockpitUrl,
  liveLock,
  startServer,
  writeLock,
} from "./lock.ts"
import { sshConnector } from "./machines/connect-ssh.ts"
import { hostedSessionRunning, mayStop } from "./machines/idle-rule.ts"
import { createMachines, fixtureConnector, type Machines } from "./machines/manager.ts"
import { machinesRoute } from "./machines/routes.ts"
import { servedSince } from "./machines/served.ts"
import { type Ssh, systemSsh } from "./machines/ssh.ts"
import { MACHINE_FRAME_SOURCES } from "./machines/store.ts"
import { createMemoryHandler } from "./memory.ts"
import { type Opener, openFile, systemOpener } from "./open-file.ts"
import { watchOrphan } from "./orphan.ts"
import {
  outsideStreamInterest,
  prepareOutsideConversationWatch,
} from "./outside-conversation-watch.ts"
import { waitForPort } from "./port-wait.ts"
import { projectLookRoute } from "./project-look.ts"
import { projectFolderRoute } from "./projects.ts"
import { pullRequestWatched, startPullRequestPoll } from "./pull-request-poll.ts"
import { wakeDeps } from "./pull-request-wake.ts"
import { readAnswerRequest } from "./question-files.ts"
import { findChrome, stopRenderBrowsers } from "./render.ts"
import { readArtifactBody } from "./request-body.ts"
import { Pace, startResourceGuard } from "./resource-guard.ts"
import { attachRunId, RunAttachments } from "./runs.ts"
import { runtimeRecordRoute } from "./runtime-records.ts"
import { type ServerLifecycle, serverPortRoute, viewOf, wantedPort } from "./server-port.ts"
import { loadSessions, Sessions, sessionCookie } from "./sessions.ts"
import { runSetup, type SetupEvent, setupLicence, setupState } from "./setup.ts"
import { createStaticAssets } from "./static-assets.ts"
import { taskDecisionRoute } from "./task-decision-route.ts"
import { taskScreens } from "./task-screens.ts"
import { Thumbs } from "./thumbs.ts"
import {
  UI_CSS_PATH,
  UI_DIFFS_PATH,
  UI_DIFFS_WORKER_PATH,
  UI_FRAGMENTS_PATH,
  UI_JS_PATH,
  UI_MERMAID_PATH,
  UI_TERMINAL_FONTS,
  UI_TERMINAL_PATH,
  UI_TOUR_PATH,
} from "./ui-assets.ts"
import { getReleases, getUpdate, postUpdate, startUpdateWatch } from "./update.ts"
import { Hub, watchRuntime } from "./watch.ts"

/**
 * The serve-time Bun settings, kept or dropped by the soak (PERFORMANCE.md): a setting is on only
 * where it lowered peak private memory by 10% or more. A measurement or a test sets one with
 * `QUALITYLAYER_TUNING=<name>=0` (off) or `=1` (on), honoured only under a temp home.
 */
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

/**
 * Whether a request may wait longer than Bun's 10 s idle timeout, so its connection is exempt from it:
 * the two event streams and every write (it can run git, `gh`, a download or the network). A plain
 * read answers at once and keeps the default.
 */
export function holdsOpen(method: string, path: string): boolean {
  if (path === "/stream" || path === "/api/setup/events" || path === "/api/agents/sign-in")
    return true
  return path.startsWith("/api/") && method !== "GET" && method !== "HEAD"
}

const SHELL_CSP = [
  "default-src 'self'",
  // Inline script is needed by sandboxed artifact frames, which inherit this policy and then
  // tighten it with their own meta tag. Document markdown is sanitised before it is rendered.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  // Besides its own documents the page may frame the machines' listeners and nothing else on this
  // computer: not its own routes, not another local program.
  `frame-src blob: data: ${MACHINE_FRAME_SOURCES}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ")

const ICON = FAVICON

/**
 * The shell page; an explicit light or dark choice is on the root from the first paint. `app`: this
 * machine has the App, which a link opened in a browser hands over to.
 */
const indexHtml = (theme: Theme, app: boolean) => `<!doctype html>
<html lang="en"${app ? ' data-app="1"' : ""}${theme === "system" ? "" : ` data-theme="${theme}" class="${theme === "dark" ? "dark" : ""}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>QualityLayer</title>
<link rel="icon" href="${ICON}">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`

/** A request that threw: one short JSON answer, one crash.log line, and nothing of the failure in the response. */
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

/** Each asset's tag, by the file's size and time, so a rebuilt bundle gets a new one. */

/**
 * The page's script, styles and diagram script: the browser keeps them and asks whether they
 * changed (a 304 when not), so a reload neither fetches nor compiles megabytes of script again.
 */
const asset = createStaticAssets().serve

export type Gatekeeper = (ctx: Ctx) => Promise<Result<unknown>>

export type HandlerOptions = {
  /** The explicit native chooser; tests supply an owned recorder. */
  folderPicker?: FolderPicker
  /** The App this server's command line belongs to; by default the one this process runs from. */
  appFolder?: string | null
  /** Starts Open and Reveal; a test hands in a recorder. */
  opener?: Opener
  /** Draws the Artifacts tab's pictures; a test hands in its own. */
  thumbs?: Thumbs
  /** How the running server stands on its port and restarts; `serve` supplies it. */
  server?: ServerLifecycle
  /** The other computers this one reaches over ssh; `serve` supplies it. */
  machines?: Machines
  /** The runner the machines routes check a machine with; none where a test starts no ssh. */
  ssh?: Ssh
}

/**
 * An artifact's routes, the same under a task (`/api/tasks/<id>/artifacts/…`) and a project
 * (`/api/projects/<id>/artifacts/…`): the list, one artifact's page, its picture, a comment, resolving
 * one, and opening it. `rest` is what follows `artifacts`; the file is one encoded segment.
 */
async function artifactRoute(
  ctx: Ctx,
  thumbs: Thumbs,
  opener: Opener,
  scope: "task" | "project",
  id: string,
  rest: string[],
  method: string,
  request: Request,
  url: URL,
  browser?: artifacts.ArtifactBrowser,
): Promise<Response | null> {
  const [file, action] = rest
  const pictures = url.searchParams.get("thumbnails") === "0" ? undefined : thumbs
  // Lasting artifacts: keep one (a project's), its history (named by the artifact, not a file), and the
  // fold of a task's draft into one (a task's).
  if (scope === "project" && file === "keep" && action === undefined && method === "POST")
    return json(await library.keepLasting(ctx, id, await body(request)))
  if (scope === "project" && file === "new" && action === undefined && method === "POST")
    return json(await newLasting(ctx, id, await body(request)))
  if (scope === "project" && file !== undefined && action === "manage" && method === "POST")
    return json(await library.manageLasting(ctx, id, file, await body(request)))
  if (
    scope === "project" &&
    file !== undefined &&
    action === "history" &&
    method === "GET" &&
    ARTIFACT_NAME.test(file)
  )
    return json(await library.lastingArtifactHistory(ctx, id, file))
  // One lasting artifact as the Artifacts place lists it, read on its own (an artifact opens from this).
  if (
    scope === "project" &&
    file !== undefined &&
    action === "lasting" &&
    method === "GET" &&
    ARTIFACT_NAME.test(file)
  )
    return json(await library.lastingArtifactOf(ctx, id, file, pictures))
  if (scope === "task" && file === "fold" && action === undefined) {
    if (method === "GET")
      return json(await library.foldPreviewOfTask(ctx, id, url.searchParams.get("draft") ?? ""))
    if (method === "POST") return json(await library.foldTaskDraft(ctx, id, await body(request)))
  }
  if (scope === "task" && file === "draft-on" && action === undefined && method === "POST")
    return json(await library.draftOnOfTask(ctx, id, await body(request)))
  if (file === undefined && method === "GET") {
    return json(
      scope === "task"
        ? await artifacts.taskArtifacts(ctx, id, pictures)
        : await artifacts.projectArtifacts(ctx, id, pictures),
    )
  }
  if (file === undefined) return null
  if (scope === "project" && action === "records")
    return runtimeRecordRoute(ctx, { scope: "artifact", id, file }, rest.slice(2), method)
  if (
    action === "feedback" &&
    rest[2] !== undefined &&
    ["threads", "thread", "resolve", "reopen", "helper", "attachment"].includes(rest[2])
  )
    return artifactFeedbackRoute(
      ctx,
      { scope, id, file },
      rest[2] as ArtifactFeedbackAction,
      request,
    )
  if (action === "agent-context" && method === "GET") {
    const context = await resolveArtifactAgentContext(ctx, { scope, id, file, request: "" })
    return json(
      context.ok
        ? ok({
            revision: context.data.revision,
            prompt: context.data.prompt,
            folder: context.data.binding.folder,
          })
        : context,
    )
  }
  if ((action === "source" || action === "history") && method === "GET")
    return json(await artifacts.artifactWorkspaceRead(ctx, scope, id, file, action))
  if (action === "workspace" && method === "POST")
    return json(await artifacts.artifactWorkspaceWrite(ctx, scope, id, file, await body(request)))
  if (action === undefined && method === "GET")
    return json(await artifacts.artifactPage(ctx, scope, id, file))
  if (action === "thumb" && method === "GET")
    return artifacts.artifactThumb(ctx, thumbs, scope, id, file, url.searchParams.get("k") ?? "")
  if (action === "comments" && method === "POST")
    return json(await artifacts.postArtifactComment(ctx, scope, id, file, await body(request)))
  if (action === "resolve" && method === "POST")
    return json(await artifacts.resolveArtifact(ctx, scope, id, file, await body(request)))
  if (action === "open" && method === "POST")
    return json(
      await artifacts.openArtifact(ctx, scope, id, file, await body(request), opener, browser),
    )
  return null
}

/** When the licence files last changed: a key activated in a terminal changes it at once. */
async function licenceStamp(ctx: Ctx): Promise<string> {
  const stamps = await Promise.all(
    [licencePath(ctx), accessPath(ctx)].map(async (path) => {
      const seen = await ctx.fs.stat?.(path).catch(() => null)
      return seen === null || seen === undefined ? "-" : `${seen.mtimeMs}:${seen.size}`
    }),
  )
  return stamps.join("|")
}

export function createHandler(
  ctx: Ctx,
  guard: GuardConfig,
  hub: Hub,
  gatekeeper?: Gatekeeper,
  options: HandlerOptions = {},
) {
  let entitlement: { at: number; result: Result<unknown>; stamp: string } | null = null
  let entitlementPending: Promise<Result<unknown>> | null = null
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
  const openArtifactBrowser = async (
    request: Request,
    scope: "task" | "project",
    id: string,
    file: string,
    section?: string,
  ) => {
    const route = artifactAppRoute(scope, id, file, section)
    if (!route)
      return err({
        code: "bad_args" as const,
        message: "This artifact page or section has no valid browser route",
      })
    const code = await sessions.pair(false, sessionAuthority(request, checked)?.keyPaired === true)
    return openFile(
      "browser",
      `http://127.0.0.1:${guard.port}/pair/${code}?in=browser#/${route}`,
      opener.platform,
      opener.run,
    )
  }
  const memory = createMemoryHandler(ctx)
  // A planned, cancelled or settled resume also changes what the task's live status shows.
  const resume = limitResume(ctx, () => {
    hub.publish({ type: "run-changed" })
    hub.publish({ type: "live-changed" })
  })
  const idleStop = idleDeadline(ctx, () => hub.publish({ type: "run-changed" }))
  const runs = new RunAttachments(ctx, checked)
  const stopSettingsChanges = hub.observe((event) => {
    if (event.type === "run-changed" && event.path)
      void runs.processSettingsChange(event.path).catch(() => {
        console.error(
          "A queued session-settings change could not be processed; it remains on its run.",
        )
      })
  })
  // The page reads the list and the open task again on every file event: reads of the same one share.
  const lists = coalescing<api.TaskSummary[]>()
  const details = coalescing<Result<api.TaskDetail>>()
  const changes = coalescing<Result<api.TaskChanges>>()
  // The Artifacts tab's pictures, drawn in the background by a local Chrome when there is one.
  const thumbs = options.thumbs ?? new Thumbs(ctx, () => findChrome((name) => ctx.env.get(name)))
  const handle = async (request: Request): Promise<Response> => {
    // The address is built from the Host header: one no socket can have (port 99999) cannot be read.
    const url = URL.parse(request.url)
    if (url === null) return new Response("foreign host", { status: 403 })
    const path = url.pathname
    const isApi = path.startsWith("/api/") || path === "/stream"

    const refusal = refuse(request, checked, isApi)
    if (refusal !== null) return new Response(refusal.reason, { status: refusal.status })

    if (!isApi) {
      if (path.startsWith("/pair/") && request.method === "GET")
        return pairBrowser(request, sessions, checked.token)
      if (path === "/app.js") return asset(request, UI_JS_PATH, "text/javascript; charset=utf-8")
      if (path === "/mermaid.js")
        return asset(request, UI_MERMAID_PATH, "text/javascript; charset=utf-8")
      if (path === "/fragments.js")
        return asset(request, UI_FRAGMENTS_PATH, "text/javascript; charset=utf-8")
      if (path === "/terminal.js")
        return asset(request, UI_TERMINAL_PATH, "text/javascript; charset=utf-8")
      if (path === "/diffs.js")
        return asset(request, UI_DIFFS_PATH, "text/javascript; charset=utf-8")
      if (path === "/diffs-worker.js")
        return asset(request, UI_DIFFS_WORKER_PATH, "text/javascript; charset=utf-8")
      if (path.startsWith("/terminal-fonts/")) {
        const font = UI_TERMINAL_FONTS.get(path.slice("/terminal-fonts/".length))
        return font === undefined
          ? new Response("not found", { status: 404 })
          : asset(request, font, "font/woff2")
      }
      if (path === "/app.css") return asset(request, UI_CSS_PATH, "text/css; charset=utf-8")
      if (path === "/tour.js") return asset(request, UI_TOUR_PATH, "text/javascript; charset=utf-8")
      const app = await ctx.fs.exists(appPointer(ctx))
      return new Response(indexHtml((await readConfig(ctx)).theme, app), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": SHELL_CSP,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        },
      })
    }

    // How many Cockpit pages hold the event stream: the CLI opens a page for a gate only when
    // none does. Asked before the activity mark, so the question alone keeps no idle server up.
    if (path === "/api/viewers" && request.method === "GET") {
      return json(ok({ tabs: hub.size }))
    }

    hub.lastActivity = Date.now()

    // How a browser gets in without the key in its address; the setup page needs it before any licence.
    if (path === "/api/pair" && request.method === "POST") {
      const remember = (await body(request)).remember === true
      return json(ok({ code: await sessions.pair(remember, hasKeyHeader(request, checked)) }))
    }
    if (path === "/api/session" && request.method === "POST") {
      // A browser that holds a session keeps it (and may now remember it); the key starts one.
      const held = sessionOf(request, checked.token)
      const id = await sessions.reuse(held, hasKeyHeader(request, checked))
      const answer = json(ok({}))
      answer.headers.append(
        "set-cookie",
        sessionCookie(id, (await body(request)).remember === true, checked.token),
      )
      return answer
    }
    if (path === "/api/sessions" && request.method === "DELETE") {
      await sessions.forget()
      return json(ok({ forgotten: true }))
    }

    // First-start setup: before the licence gate, since getting a licence is one of its steps.
    if (path === "/api/setup/events" && request.method === "GET")
      return stream(request, setupEvents, browserStreamSession(request))
    if (path === "/api/setup" && request.method === "GET")
      return json(ok({ setup: await setupState(ctx, appFolder) }))
    if (path === "/api/setup" && request.method === "POST")
      return json(await runSetup(ctx, appFolder, setupEvents))
    if (path === "/api/setup/licence" && request.method === "POST") {
      const taken = await setupLicence(ctx, String((await body(request)).key ?? ""))
      // The licence just changed: the gate's kept answer ("a licence is required") would hold
      // every screen shut for up to a minute after the key was accepted.
      entitlement = null
      return json(taken)
    }

    // Updates and feedback work without an entitlement: an expired trial can still update and report.
    // The shell owns the update; these read its update.json and leave it a request file.
    if (path === "/api/update" && request.method === "GET") return json(await getUpdate(ctx))
    if (path === "/api/update/releases" && request.method === "GET")
      return json(await getReleases(ctx))
    if (path.startsWith("/api/update/") && request.method === "POST")
      return json(await postUpdate(ctx, path.slice("/api/update/".length)))
    if (path === "/api/feedback" && request.method === "GET")
      return json(ok({ who: await feedbackWho(ctx) }))
    if (path === "/api/feedback" && request.method === "POST")
      return json(await postFeedback(ctx, request))
    if (path === "/api/feedback/diagnostics" && request.method === "POST")
      return json(await diagnosticsPreview(ctx, await body(request)))
    if (path === "/api/feedback/public/system" && request.method === "GET")
      return json(await publicFeedbackSystem())
    if (path === "/api/feedback/public/preview" && request.method === "POST")
      return json(await publicFeedbackReview(ctx, request))
    if (path === "/api/feedback/public/submit" && request.method === "POST")
      return json(await publicFeedbackConfirm(ctx, await body(request)))
    if (path === "/api/feedback/public/cancel" && request.method === "POST")
      return json(await publicFeedbackCancel(ctx, await body(request)))
    const publicImageMatch =
      /^\/api\/feedback\/public\/image\/([A-Za-z0-9_-]{1,64})\/([0-4])$/.exec(path)
    if (publicImageMatch && request.method === "GET")
      return publicFeedbackImage(ctx, publicImageMatch[1] ?? "", Number(publicImageMatch[2]))
    const publicStatusMatch = /^\/api\/feedback\/public\/status\/([A-Za-z0-9_-]{1,64})$/.exec(path)
    if (publicStatusMatch && request.method === "GET")
      return json(await publicFeedbackStatus(ctx, publicStatusMatch[1] ?? ""))

    // The settings page shows the licence, entitled or not; it never touches the network.
    if (path === "/api/licence" && request.method === "GET") {
      // The Cockpit's footer shows who is licensed, on which plan, and which version runs.
      return json(
        ok({
          licence: {
            ...(await licenceStatus(ctx)),
            version: VERSION,
            name: await personName(ctx),
          },
        }),
      )
    }

    const agentAnswer = await agentSetupRoute(
      ctx,
      request,
      path,
      () => sessionAuthority(request, checked)?.keyPaired === true,
      () => body(request),
    )
    if (agentAnswer !== null)
      return agentAnswer instanceof Response ? agentAnswer : json(agentAnswer)

    // The licence check covers the Cockpit because it is the same binary. The answer is kept
    // for a minute: a page makes many requests, and an offline revalidation is slow.
    // A check that could not run is not kept: once its files are mended, the next request passes.
    if (gatekeeper !== undefined) {
      // A key activated or removed in a terminal rewrites these files: the kept answer ends then.
      const stamp = await licenceStamp(ctx)
      let answer = entitlement?.result ?? null
      if (
        entitlement === null ||
        entitlement.stamp !== stamp ||
        Date.now() - entitlement.at > 60_000
      ) {
        entitlementPending ??= gatekeeper(ctx)
          .catch((cause): Result<unknown> => {
            crashLine(ctx.home, "licence", cause)
            return err({ code: "licence_unchecked", message: uncheckedMessage(ctx, cause) })
          })
          .then((result) => {
            entitlement =
              !result.ok && result.error.code === "licence_unchecked"
                ? null
                : { at: Date.now(), result, stamp }
            return result
          })
          .finally(() => {
            entitlementPending = null
          })
        answer = await entitlementPending
      }
      if (answer !== null && !answer.ok) return json(answer)
    }

    if (path === "/api/export" && request.method === "POST") {
      const bytes = await readArtifactBody(request, 28 * 1024 * 1024)
      let input: unknown
      try {
        input = JSON.parse(new TextDecoder().decode(bytes))
      } catch {
        return json(err({ code: "bad_args", message: "The export request could not be read." }))
      }
      return json(await exportFile(ctx, input))
    }

    const machinesAnswer = await machinesRoute(
      request,
      options.machines === undefined
        ? undefined
        : { ctx, machines: options.machines, ssh: options.ssh ?? null },
      () =>
        hasKeyHeader(request, checked) || sessionAuthority(request, checked)?.keyPaired === true,
    )
    if (machinesAnswer !== null) return machinesAnswer
    const projectFolder =
      (await foundProjectsRoute(ctx, checked, request)) ??
      (await agentHistoryRoute(ctx, checked, request)) ??
      (await projectFolderRoute(ctx, checked, request, folderPicker))
    const projectLook = await projectLookRoute(ctx, checked, request, () =>
      hub.publish({ type: "task-changed" }),
    )
    if (projectLook !== null) return projectLook
    const diskUse = await diskUseRoute(ctx, checked, request)
    if (diskUse !== null) return diskUse
    const serverPort = await serverPortRoute(checked, request, options.server)
    if (serverPort !== null) return serverPort
    const keyPaired = sessionAuthority(request, checked)?.keyPaired === true
    // Memory, then plan limits and usage (read when asked, never on a timer).
    const appReply =
      (await memory(request, keyPaired)) ??
      (await limitsRoute(ctx, request, resume, keyPaired)) ??
      (await agentSessionsRoute(ctx, request, keyPaired))
    if (appReply !== null) return appReply
    const automationsReply = await automationsRoute(
      ctx,
      request,
      keyPaired || hasKeyHeader(request, checked),
    )
    if (automationsReply !== null) return automationsReply
    if (projectFolder !== null) return projectFolder
    if (path === HANDOFF_ATTACHMENTS_PATH) return handoffAttachmentsRoute(ctx, checked, request)
    if (isAgentRunsRoute(path)) return runs.route(request)
    if (path === "/stream") {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        if (
          request.method !== "GET" ||
          request.headers.get("origin") !== `http://${request.headers.get("host")}` ||
          outsideStreamInterest(url) === false ||
          request.headers.has("x-qualitylayer-token") ||
          !sessionAuthority(request, checked)
        )
          return new Response("event stream requires a same-origin browser session", {
            status: 403,
          })
        return new Response(null, { status: 426 })
      }
      return stream(request, hub, browserStreamSession(request))
    }

    let parts: string[]
    try {
      parts = path.split("/").filter(Boolean).map(decodeURIComponent)
    } catch {
      // A malformed percent-encoding is the caller's mistake, not a server error.
      return json({ ok: false, error: { code: "bad_args", message: "malformed URL encoding" } })
    }
    const method = request.method
    if (parts[1] === "interaction") {
      const response = await interactionRoute(ctx, null, parts.slice(2), request)
      if (response !== null) return response
    }

    // Every project's lasting artifacts, personal artifacts and open tasks' drafts (the Artifacts place).
    if (parts[1] === "artifacts" && parts.length === 2 && method === "GET")
      return json(
        await library.artifactsOverview(
          ctx,
          url.searchParams.get("thumbnails") === "0" ? undefined : thumbs,
        ),
      )
    if (parts[1] === "projects" && parts[2] !== undefined && parts[3] === "artifacts") {
      const answer = await artifactRoute(
        ctx,
        thumbs,
        opener,
        "project",
        parts[2],
        parts.slice(4),
        method,
        request,
        url,
        (scope, id, file, section) => openArtifactBrowser(request, scope, id, file, section),
      )
      if (answer !== null) {
        if (method === "POST" && answer.ok) {
          hub.publish({ type: "task-changed" })
          hub.publish({ type: "artifact-changed" })
        }
        return answer
      }
    }
    if (parts[1] === "projects" && parts.length <= 2 && method === "GET")
      return json(ok({ projects: await api.listProjects(ctx) }))
    // The home page's question (a taskless Home or team ask): read, answered, cancelled, changed.
    if (parts[1] === "home-questions" && parts.length === 2 && method === "GET")
      return json(ok({ questions: await api.homeQuestions(ctx) }))
    if (
      parts[1] === "projects" &&
      parts[2] !== undefined &&
      parts[3] === "question" &&
      (parts[4] === "answer" || parts[4] === "cancel" || parts[4] === "change") &&
      parts.length === 5 &&
      method === "POST"
    ) {
      if (parts[4] === "answer") {
        const parsed = await readAnswerRequest(request)
        return json(
          parsed.ok
            ? await api.postHomeQuestion(
                ctx,
                parts[2],
                "answer",
                parsed.data.body,
                parsed.data.files,
              )
            : parsed,
        )
      }
      return json(await api.postHomeQuestion(ctx, parts[2], parts[4], await body(request)))
    }
    if (parts[1] === "find" && method === "GET") {
      return json(ok({ results: await api.findAll(ctx, url.searchParams.get("q") ?? "") }))
    }
    if (parts[1] === "integrations") {
      // The person's own logins and the tickets they read: the key or a key-paired browser only.
      if (!hasKeyHeader(request, checked) && sessionAuthority(request, checked)?.keyPaired !== true)
        return new Response("This browser may only watch", { status: 403 })
      const answer = await integrationsRoute(ctx, method, parts.slice(2), url)
      if (answer !== null) return json(answer)
    }
    if (parts[1] === "config") {
      if (method === "GET") return json(ok({ config: await api.getConfig(ctx) }))
      if (method === "PUT") {
        const patch = await body(request)
        if (
          touchesProtectedSettings(patch) &&
          sessionAuthority(request, checked)?.keyPaired !== true
        )
          return new Response("Only the App and browsers it opened may change run settings.", {
            status: 403,
          })
        const saved = await api.putConfig(ctx, patch)
        return json(saved.ok ? ok({ config: saved.data }) : saved)
      }
    }
    // Your own instructions file: read by anyone on the page, written only by a key-paired session.
    if (parts[1] === "instructions") {
      if (method === "GET") {
        const mine = await readPersonal(ctx)
        return Response.json(
          { text: mine?.text ?? "", updated: mine?.updated ?? 0 },
          { headers: { "cache-control": "no-store" } },
        )
      }
      if (method === "PUT") {
        if (sessionAuthority(request, checked)?.keyPaired !== true)
          return new Response("Only the App and browsers it opened may change your instructions.", {
            status: 403,
          })
        const input = await body(request)
        const saved = await saveInstructions(ctx, input.text, input.base)
        return Response.json(saved.body, {
          status: saved.status,
          headers: { "cache-control": "no-store" },
        })
      }
    }
    // The subagent model of each installed agent, written where the agent reads it.
    if (parts[1] === "subagents") {
      if (method === "GET") return json(ok({ agents: await subagentModels(ctx) }))
      if (method === "PUT") {
        const input = await body(request)
        const agent = String(input.agent ?? "")
        return json(
          input.effort !== undefined
            ? await setAgentEffort(ctx, agent, String(input.effort))
            : await setSubagentModel(ctx, agent, String(input.model ?? "")),
        )
      }
    }
    if (parts[1] === "tasks") {
      const id = parts[2]
      if (id === undefined) {
        if (method === "POST") {
          // A new task that waits on Home, from a request or a ticket link (`task start` from a script).
          if (
            !hasKeyHeader(request, checked) &&
            sessionAuthority(request, checked)?.keyPaired !== true
          )
            return new Response("This browser may only watch", { status: 403 })
          return json(await api.postTask(ctx, await body(request)))
        }
        if (method !== "GET") return new Response("method not allowed", { status: 405 })
        const project = url.searchParams.get("project") ?? undefined
        return json(ok({ tasks: await lists(project ?? "", () => api.listAllTasks(ctx, project)) }))
      }
      const sub = parts[3]
      if (sub === "precommit" && parts.length === 4)
        return precommitRoute(ctx, id, request, url, keyPaired || hasKeyHeader(request, checked))
      if (sub === "records")
        return runtimeRecordRoute(ctx, { scope: "task", id }, parts.slice(4), method)
      if (sub === "chat" && parts[4] === "promote" && parts.length === 5) {
        if (method === "GET") return json(await api.chatPromotionState(ctx, id))
        if (method === "POST") {
          const input = await body(request)
          if (typeof input === "object" && input !== null && "native" in input)
            return runs.startChatWorkflow(request, id, input)
          return json(await api.postChatPromote(ctx, id, input))
        }
      }
      if (sub === "picker" && parts.length === 4 && method === "POST") {
        const canAnswer = async () => {
          const config = await readConfig(ctx)
          const authority = sessionAuthority(request, checked)
          return authority !== null && (authority.keyPaired || config.typeFrom === "anyPaired")
        }
        if (!(await canAnswer()))
          return new Response("This browser may only watch", { status: 403 })
        return json(await api.postTaskPicker(ctx, id, await body(request), canAnswer))
      }
      if (sub === "screens" && parts.length === 4 && method === "GET")
        return json(await taskScreens(ctx, id))
      if (sub === "interaction") {
        if (parts.length === 4 && method === "GET")
          return json(
            await readInteraction(ctx, id, () =>
              details(id, () => api.taskDetail(ctx, id, { shown: true })),
            ),
          )
        const response = await interactionRoute(ctx, id, parts.slice(4), request)
        if (response !== null) return response
      }
      if (sub === undefined && method === "GET") {
        const detail = await details(`shell:${id}`, () =>
          api.taskDetail(ctx, id, { proofFiles: false, shown: true }),
        )
        return json(detail.ok ? ok({ task: detail.data }) : detail)
      }
      if (sub === "doc" && parts[4] !== undefined && method === "GET")
        return json(await api.docContent(ctx, id, parts[4]))
      // The same document cut into sections, each with where the step page and the Reader show it.
      if (sub === "sections" && parts[4] !== undefined && method === "GET")
        return json(await docSections(ctx, id, parts[4]))
      if (sub === "artifacts") {
        const answer = await artifactRoute(
          ctx,
          thumbs,
          opener,
          "task",
          id,
          parts.slice(4),
          method,
          request,
          url,
          (scope, id, file, section) => openArtifactBrowser(request, scope, id, file, section),
        )
        if (answer !== null) return answer
      }
      if (sub === "artifact" && parts[4] !== undefined && method === "GET")
        return json(await api.artifactContent(ctx, id, parts[4]))
      if (sub === "evidence" && parts[4] !== undefined && method === "GET") {
        const evidence = await api.evidenceContent(ctx, id, parts[4])
        return json(evidence.ok ? ok({ evidence: evidence.data }) : evidence)
      }
      if (sub === "viewing" && parts.length === 4 && method === "POST")
        return json(await api.postViewing(ctx, id, await body(request)))
      if (sub === "open" && method === "POST")
        return json(await api.openTaskFile(ctx, id, await body(request), opener))
      if (sub === "cost" && method === "GET") {
        const cost = await api.taskCostOf(ctx, id)
        return json(cost.ok ? ok({ cost: cost.data }) : cost)
      }
      if (sub === "changes" && parts.length === 4 && method === "DELETE")
        return json(await api.clearTaskChanges(ctx, id))
      if (sub === "changes" && method === "GET") {
        if (parts[4] === "source")
          return json(
            await api.taskReviewFileSource(
              ctx,
              id,
              {
                path: url.searchParams.get("path") ?? "",
                stamp: url.searchParams.get("stamp") ?? "",
                side: url.searchParams.get("side") as "old" | "new",
              },
              url.searchParams.get("checked") ?? undefined,
            ),
          )
        if (parts[4] === "file")
          return json(
            await api.taskFileDiff(ctx, id, url.searchParams.get("path") ?? "", {
              ...(url.searchParams.has("after")
                ? { after: url.searchParams.get("after") ?? "" }
                : {}),
              ...(url.searchParams.has("revision")
                ? { revision: url.searchParams.get("revision") ?? "" }
                : {}),
              ...(url.searchParams.has("checked")
                ? { checked: url.searchParams.get("checked") ?? "" }
                : {}),
            }),
          )
        const withDiff = url.searchParams.get("preview") !== "0"
        const changed = await changes(`${id}:${withDiff}`, () =>
          api.taskChanges(ctx, id, { withDiff }),
        )
        return json(changed.ok ? ok({ changes: changed.data }) : changed)
      }
      if (sub === "walkthrough" && method === "GET") {
        const view = await api.taskWalkthrough(
          ctx,
          id,
          url.searchParams.get("checked") ?? undefined,
        )
        return json(view.ok ? ok({ walkthrough: view.data }) : view)
      }
      if (sub === "comments" && parts[4] === "build" && method === "POST")
        return json(await api.postBuildComment(ctx, id, await body(request)))
      if (sub === "comments" && method === "PUT")
        return json(await api.putComments(ctx, id, await body(request)))
      if (sub === "findings" && parts[4] !== undefined && method === "POST")
        return json(
          await api.postFinding(ctx, id, decodeURIComponent(parts[4]), await body(request)),
        )
      if (sub === "another-review" && method === "POST")
        return json(await api.postAnotherReview(ctx, id, await body(request)))
      if (sub === "comments" && parts[5] === "ask-again" && method === "POST")
        return json(await api.postAskAgain(ctx, id, decodeURIComponent(parts[4] ?? "")))
      if (sub === "review" && method === "POST")
        return json(await api.postReview(ctx, id, await body(request)))
      if (sub === "question" && method === "POST") {
        if (parts[4] === "answer" && parts.length === 5) {
          const parsed = await readAnswerRequest(request)
          return json(
            parsed.ok
              ? await api.postQuestionAnswer(ctx, id, parsed.data.body, parsed.data.files)
              : parsed,
          )
        }
        if (parts[4] === "cancel" && parts.length === 5)
          return json(await api.postQuestionCancel(ctx, id))
        if (parts[4] === "change" && parts.length === 5)
          return json(await api.postQuestionChange(ctx, id, await body(request)))
      }
      const decision = await taskDecisionRoute(
        ctx,
        id,
        parts,
        request,
        keyPaired || hasKeyHeader(request, checked),
      )
      if (decision) return decision
      if (sub === "gate" && method === "POST")
        return json(await api.postGate(ctx, id, await body(request)))
      if (sub === "needs" && parts[4] !== undefined && parts[5] === "set" && method === "POST")
        return json(await api.postNeedSet(ctx, id, parts[4], await body(request)))
      if (sub === "start" && method === "POST")
        return json(await api.postStart(ctx, id, await body(request)))
      if (sub === "build-here" && method === "POST")
        return json(await api.postBuildHere(ctx, id, await body(request)))

      if (sub === "push" && method === "POST") return json(await api.postPush(ctx, id))
      if (sub === "pull-request" && parts[4] === "leave" && method === "POST")
        return json(await api.postLeavePullRequest(ctx, id))
      if (sub === "landing" && parts[4] === "merged" && method === "POST")
        return json(await api.postMarkMerged(ctx, id, await body(request)))
      if (sub === "landing" && parts[4] === "diff" && method === "GET")
        return json(await api.getLandingDiff(ctx, id))
      if (sub === "landing" && parts[4] === "approve-change" && method === "POST")
        return json(await api.postApproveChange(ctx, id, await body(request)))
      if (sub === "branch" && method === "GET") return json(await api.taskBranch(ctx, id))
      if (sub === "branch" && method === "POST")
        return json(await api.postBranch(ctx, id, await body(request)))
      if (sub === "archive" && method === "PUT")
        return json(await api.putArchived(ctx, id, await body(request)))
      if (sub === "profile" && method === "PUT")
        return json(await api.putProfile(ctx, id, await body(request)))
      if (sub === undefined && method === "DELETE") return json(await api.removeTask(ctx, id))
      // Stop checking and review, retired in 13.0: an App page loaded before it still offers it.
      if (sub === "accept" && method === "POST")
        return json(
          err({
            code: "bad_args",
            message:
              "This App page is older than QualityLayer, which no longer has Stop checking. Reload the App. When Verify cannot go on by itself, it asks you how to go on.",
          }),
        )
    }
    return new Response("not found", { status: 404 })
  }
  // An answer, a decision or a comment given in the App shows in the task's documents.
  // One catch for every route, so a route added later is covered too.
  const handler = async (request: Request): Promise<Response> => {
    try {
      const path = URL.parse(request.url)?.pathname ?? ""
      testFault(ctx, "route", path)
      testFault(ctx, "rejection")
      testFault(ctx, "exception")
      const response = await handle(request)
      if (path === "/api/config" && request.method === "PUT" && response.ok) {
        await runs.refreshCapabilities()
        // A new idle-stop period applies to the sessions that are already idle.
        idleStop.start()
      }
      const task = path.match(/^\/api\/tasks\/([^/]+)\/[a-z]/)?.[1]
      if (
        task !== undefined &&
        decodeURIComponent(path.split("/")[4] ?? "") !== "viewing" &&
        request.method !== "GET" &&
        response.ok
      )
        await api.refreshTaskPages(ctx, decodeURIComponent(task))
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

/** A saved local link opens its destination; authentication stays with the session cookie. */
async function pairBrowser(request: Request, sessions: Sessions, token: string): Promise<Response> {
  const code = new URL(request.url).pathname.slice("/pair/".length)
  const redeemed = sessions.redeem(code)
  if (redeemed === null) {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/?in=browser",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    })
  }
  const held = sessionOf(request, token)
  const id = await sessions.reuse(held, redeemed.keyPaired)
  // The page's own address, the fragment of the pairing link carried along by the browser. The App's
  // window says so in its address, so its page never hands over to the App it is.
  const query = new URL(request.url).searchParams
  const inApp = query.get("in") === "app"
  // After an update the shell opens the page with the version it updated to; the page shows its toast.
  const updated = query.get("updated")
  const forward = updated !== null && /^[0-9A-Za-z.+-]{1,40}$/.test(updated) ? updated : null
  return new Response(null, {
    status: 302,
    headers: {
      location: inApp
        ? `/?in=app${forward !== null ? `&updated=${forward}` : ""}`
        : query.get("in") === "browser"
          ? "/?in=browser"
          : "/",
      "set-cookie": sessionCookie(id, redeemed.remember, token),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  })
}

export const SSE_BUFFER_BYTES = 64 * 1024
function stream<E extends { type: string }>(
  request: Request,
  hub: Hub<E>,
  browser?: { access: EventAccess; session: string | null },
): Response {
  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let keepAlive: ReturnType<typeof setInterval> | undefined
  let finish = () => {}
  let closed = false
  let authority: ReturnType<typeof watchEventSession> | undefined
  const readable = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const aborted = () => finish()
        finish = () => {
          if (closed) return
          closed = true
          unsubscribe()
          authority?.stop()
          clearInterval(keepAlive)
          request.signal.removeEventListener("abort", aborted)
          try {
            controller.close()
          } catch {
            /* A cancelled reader is already closed. */
          }
        }
        const enqueue = (bytes: Uint8Array) => {
          if (closed || (authority !== undefined && !authority.valid())) return
          if (bytes.byteLength > (controller.desiredSize ?? 0)) {
            finish()
            return
          }
          try {
            controller.enqueue(bytes)
          } catch {
            finish()
          }
        }
        const send = (event: unknown) => {
          enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        unsubscribe = hub.subscribe(send, finish)
        request.signal.addEventListener("abort", aborted, { once: true })
        if (request.signal.aborted) {
          finish()
          return
        }
        if (browser) {
          authority = watchEventSession(browser.access, browser.session, finish)
          if (closed) {
            authority.stop()
            return
          }
        }
        send({ type: "hello" })
        if (!closed)
          keepAlive = setInterval(() => enqueue(encoder.encode(": keep-alive\n\n")), 25_000)
      },
      cancel() {
        finish()
      },
    },
    { highWaterMark: SSE_BUFFER_BYTES, size: (bytes) => bytes?.byteLength ?? 0 },
  )
  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  })
}

export type ServeOptions = { port?: number; gatekeeper?: Gatekeeper; foreground?: boolean }

/** Start an optional helper: its stop function, or one that does nothing when it cannot start. */
function attempt(start: () => () => void): () => void {
  try {
    return start()
  } catch {
    return () => {}
  }
}

/** Start the server and hold the lock until it exits. Resolves when it stops. */
export async function serve(
  given: Ctx,
  options: ServeOptions = {},
): Promise<Result<{ url: string; already?: true }>> {
  // Tests count every child process the server starts: first, so that none escapes the count.
  const spawnLogPath = process.env.QUALITYLAYER_SPAWN_LOG
  if (spawnLogPath !== undefined && spawnLogPath !== "")
    installSpawnRecorder(given.home, spawnLogPath)
  const running = await liveLock(given)
  if (running !== null && running.pid !== process.pid) {
    return ok({ url: cockpitUrl(running), already: true })
  }

  // The page reads again on every file event: the server's git answers what it already knows.
  const git = cachingGit(given)
  const ctx: Ctx = { ...given, git }
  const tuning = tuningFor(ctx)
  // A rejection nobody awaited costs a log line; Bun's default (exit 1) would end every open page's
  // server. An exception leaves the process in an unknown state: log it, free the lock, exit.
  const onRejection = (reason: unknown) => crashLine(ctx.home, "rejection", reason)
  const onException = (error: Error) => {
    crashLine(ctx.home, "exception", error)
    clearLockSync(ctx.home, process.pid)
    process.exit(1)
  }
  process.on("unhandledRejection", onRejection)
  process.on("uncaughtException", onException)
  // Hashing the program's bytes takes a while on a busy machine: it runs beside the start-up.
  const building = buildId(ctx.env)
  const config = await readConfig(ctx)
  const token = await cockpitToken(ctx)
  const hub = new Hub()
  // A change in a checkout (its plans or artifacts) may change what git says of the working tree.
  const unobserveTree = hub.observe((event) => {
    if (event.path !== undefined && !event.path.startsWith(ctx.home)) git.treeChanged()
  })
  const sessions = await loadSessions(ctx)
  // No window of an earlier server is still open: nothing is looked at until a view says so again.
  await stopAllViewing(ctx)
  const guard: GuardConfig = { port: 0, token, sessions }
  let server: Bun.Server<AppSocketData> | null = null
  const screen = screenOf({
    os: process.platform,
    release: release(),
    env: ctx.env,
    exists: existsSync,
  })
  // The port to try first: QUALITYLAYER_PORT, else the setting. `--port` (the App's start of a
  // server that replaces one) goes before both. Settings › About reads what became of it.
  const wanted = wantedPort({
    setting: config.cockpit.port,
    env: ctx.env.get(PORT_ENV),
    screen,
    defaultPort: DEFAULT_CONFIG.cockpit.port,
  })
  const first = options.port ?? wanted.port
  // Settings › About: the port in use and a restart on the setting's port. The restart takes this
  // server's lock down and its listener away, starts the replacement (it reads the setting) and ends
  // this server once the answer is on its way: the App's window follows the new server by itself.
  let endServing: () => void = () => {}
  let restarting = false
  const lifecycle: ServerLifecycle = {
    view: () => viewOf(wanted, guard.port),
    restart: async () => {
      const current = server
      if (restarting || current === null)
        return err({ code: "bad_args", message: "The server is already restarting." })
      restarting = true
      await clearLock(ctx, process.pid)
      void current.stop()
      const replacement = await startServer(ctx, undefined, 20_000)
      setTimeout(() => endServing(), 100)
      return replacement === null
        ? err({
            code: "bad_args",
            message: "The server did not start again. Open the QualityLayer App to start it.",
          })
        : ok({
            port: replacement.port,
            url: cockpitUrl(replacement),
            wanted: replacement.wanted ?? replacement.port,
          })
    },
  }
  // The port a replaced server held may take a moment to come back; this server asked for it by name.
  if (options.port !== undefined) await waitForPort(options.port, 5_000)
  const pace = new Pace()
  // A run with its own ssh config (the machines proof) names it; only builds that allow overrides read it.
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
  const eventSocket = eventSockets(hub, { sessions, now: () => ctx.clock.now() })
  for (let port = first; port < first + PORT_TRIES && server === null; port++) {
    try {
      server = Bun.serve<AppSocketData>({
        hostname: "127.0.0.1",
        port,
        // Bun's default (10 s) closes a connection that is silent for that long. Only the requests
        // that wait are exempt; with the setting off the whole server is, as before.
        idleTimeout: tuning.streamOnlyNoTimeout ? undefined : 0,
        fetch: async (request, bun) => {
          if (
            tuning.streamOnlyNoTimeout &&
            holdsOpen(request.method, new URL(request.url).pathname)
          )
            bun.timeout(request, 0)
          const response = await handler(request)
          if (response.status === 426 && new URL(request.url).pathname === "/stream") {
            const authority = sessionAuthority(request, guard)
            if (authority === null)
              return new Response("event session expired or revoked", { status: 401 })
            const interest = outsideStreamInterest(new URL(request.url))
            const outside = interest
              ? await prepareOutsideConversationWatch(ctx, interest, pace)
              : undefined
            if (interest && outside === null)
              return new Response("outside conversation binding changed", { status: 409 })
            if (
              bun.upgrade(request, {
                data: { kind: "events", session: authority.id, ...(outside ? { outside } : {}) },
              })
            )
              return
          }
          if (response.status === 426 && attachRunId(new URL(request.url).pathname) !== undefined) {
            const data = handler.runs.prepare(request)
            if (data instanceof Response) return data
            const protocol = (request.headers.get("sec-websocket-protocol") ?? "")
              .split(",")
              .map((value) => value.trim())
              .find((value) =>
                [
                  "qualitylayer-watch-v1",
                  "qualitylayer-control-v1",
                  "qualitylayer-phone-v1",
                ].includes(value),
              )
            if (
              bun.upgrade(request, {
                data,
                headers: protocol ? { "sec-websocket-protocol": protocol } : undefined,
              })
            )
              return
          }
          return response
        },
        websocket: {
          open: (ws) => {
            if (isEventSocket(ws)) eventSocket.open(ws)
            else if (isAgentSocket(ws)) void handler.runs.open(ws)
          },
          message: (ws, message) => {
            if (isEventSocket(ws)) eventSocket.message(ws)
            else if (isAgentSocket(ws)) void handler.runs.message(ws, message)
          },
          close: (ws) => {
            if (isEventSocket(ws)) eventSocket.close(ws)
            else if (isAgentSocket(ws)) handler.runs.close(ws)
          },
          drain: (ws) => {
            if (isAgentSocket(ws)) handler.runs.drain(ws)
          },
          maxPayloadLength: 256 * 1024,
          backpressureLimit: 1024 * 1024,
          closeOnBackpressureLimit: true,
        },
        error: (error) => requestFailed(ctx, error),
      })
      guard.port = server.port ?? port
    } catch {
      server = null
    }
  }
  if (server === null) {
    return {
      ok: false,
      error: {
        code: "bad_args",
        message: `no free port from ${first} to ${first + PORT_TRIES - 1}. Choose another with qualitylayer settings set cockpit.port <port>, or ${PORT_ENV}=<port> for one start.`,
      },
    }
  }

  // An unavailable optional helper costs its own feature, never the server.
  const nothing = () => {}
  // The server's own budget (resource-guard.ts): over it for a while, the page's events and the
  // polls below slow down until it is calm again.
  const stopGuard = attempt(() =>
    startResourceGuard(ctx, git, pace, { dropOnMemoryPressure: tuning.dropOnMemoryPressure }),
  )
  const watching = await watchRuntime(ctx, hub, pace).catch(() => null)
  const stopWatching = watching?.stop ?? nothing
  // Discovering the server must not race the runtime root's watcher: every task, run and ask is
  // written there. The other folders are watched right after (see `watchRuntime`).
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
  // A page that opened before those folders were watched may have missed a change in them.
  void watching?.settle().then(
    () => {
      if (hub.size > 0) hub.publishClients({ type: "publication-changed" })
    },
    () => {},
  )
  const stopPullRequestPoll = attempt(() =>
    startPullRequestPoll(
      ctx,
      hub,
      pace,
      wakeDeps(ctx, (run) => handler.runs.resumeDetached(run)),
    ),
  )
  const stopLimitResume = attempt(() => startLimitResume(handler.resume, hub))
  const stopLimitTurns = attempt(() => startLimitTurns(ctx, hub))
  const stopIdleDeadline = attempt(() => startIdleDeadline(handler.idleStop, hub))
  const stopUpdateWatch = attempt(() => startUpdateWatch(ctx, hub))
  // The home's limits: two minutes after start (out of the start-up idle window), then every 6 h, the
  // server checks with folder listings whether archiving is due and only then starts a sweep process.
  // It never sweeps itself: its memory stays flat while one runs.
  const stopRetention = attempt(() => startRetention(ctx))
  // Reports that waited for the network go out now and every few minutes.
  const stopOutbox = attempt(() => startOutboxRetry(ctx))
  // Events the writers queued for the person's automations go out now and as they are queued.
  const stopAutomations = attempt(() => startAutomations(ctx))
  // Machines need this server's port for the pages they pass back, so they connect once it is bound.
  void machines.start()
  api.warmTasks(ctx).catch(() => {})
  // The agents' versions for diagnostics are asked now, off the request path.
  warmDiagnostics(ctx).catch(() => {})
  const url = cockpitUrl({ port: guard.port })
  // A person who runs the server in a terminal signs their browser in with the link it prints.
  if (options.foreground === true)
    console.log(
      `QualityLayer App: http://127.0.0.1:${guard.port}/pair/${await sessions.pair(false)}`,
    )

  // Stops on a signal or after the idle period. Whichever comes first, the idle
  // timer is cleared: a live interval would keep the process running after SIGTERM.
  let idle: ReturnType<typeof setInterval> | undefined
  let stopOrphanWatch = () => {}
  await new Promise<void>((resolve) => {
    const stop = () => resolve()
    endServing = stop
    // A server nothing points at any more (its lock gone or taken over, its program deleted or
    // replaced) ends itself: quitting the App never stops it.
    const every = Number(ctx.env.get("QUALITYLAYER_ORPHAN_CHECK_MS"))
    watchOrphan(ctx, stop, Number.isFinite(every) && every > 0 ? every : undefined).then(
      (end) => {
        stopOrphanWatch = end
      },
      () => {},
    )
    process.once("SIGTERM", stop)
    process.once("SIGINT", stop)
    const idleMs = Math.max(1, config.cockpit.idleMinutes) * 60_000
    idle = setInterval(async () => {
      const stop = await mayStop({
        pages: () => hub.size,
        terminals: () => handler.runs.size,
        sinceActivityMs: () => Date.now() - hub.lastActivity,
        idleMs,
        // A check that fails counts as a gate being open: the server stays.
        openGate: () => api.anyOpenGate(ctx),
        // A delivery waiting for a retry keeps the server up until the schedule ends.
        automationWaiting: () => automationsWaiting(ctx),
        // Only a computer another one added as a machine stays for work nobody here looks at.
        served: () => servedSince(ctx.home) !== null,
        sessionRunning: () => hostedSessionRunning(ctx.home),
        resumePlanned: () => handler.resume.scheduled().length > 0,
        pullRequestWatched,
      })
      if (stop) resolve()
    }, 30_000)
  })
  clearInterval(idle)
  stopOrphanWatch()

  stopGuard()
  stopWatching()
  unobserveTree()
  stopPullRequestPoll()
  stopLimitResume()
  stopLimitTurns()
  stopIdleDeadline()
  stopRetention()
  stopUpdateWatch()
  stopOutbox()
  stopAutomations()
  await machines.stop().catch(() => {})
  await stopRenderBrowsers()
  hub.close()
  const handlerClosed = handler.close().then(
    () => null,
    (cause: unknown) => cause,
  )
  // Let closed event streams flush, then release clients that never finish their requests.
  let grace: ReturnType<typeof setTimeout> | undefined
  try {
    const drained = await Promise.race([
      server.stop().then(() => true),
      new Promise<boolean>((resolve) => {
        grace = setTimeout(() => resolve(false), 1000)
      }),
    ])
    if (!drained) await server.stop(true)
  } finally {
    clearTimeout(grace)
  }
  await clearLock(ctx, process.pid)
  process.off("unhandledRejection", onRejection)
  process.off("uncaughtException", onException)
  const closeFailure = await handlerClosed
  if (closeFailure !== null) throw closeFailure
  return ok({ url })
}
