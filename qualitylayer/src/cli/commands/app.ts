// app [<route>] · app pair · app ensure · app status · app restart · app stop · app link: the QualityLayer App next to the
// CLI. The App attaches to the one local server through `app ensure`; elsewhere a route opens
// the same page in the browser. `cockpit` keeps working as the older name for the same thing.

import { routeOf } from "../../core/app-routes.ts"

export { artifactAppRoute, routeOf } from "../../core/app-routes.ts"

import { appMain, startApp } from "../../core/install/where.ts"
import { resolveRepo } from "../../core/paths.ts"
import { fellBackWords } from "../../core/server-port.ts"
import { listTasks } from "../../core/task/store.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { APP_CRASH_REASONS, crashLine } from "../../server/crash.ts"
import { cockpitUrl, forgetBrowsers, liveLock, pairingUrl, stopCockpit } from "../../server/lock.ts"
import { markServed, unmarkServed } from "../../server/machines/served.ts"
import { processStartTime } from "../../server/processes.ts"
import { plannedPort } from "../../server/server-port.ts"
import { cockpitCmd, ensureCurrentCockpit, openPage } from "./cockpit.ts"

/**
 * `app status`: the port the server listens on, and whether it had to take another one. Reads the
 * lock and the settings; it never starts a server.
 */
async function status(ctx: Ctx): Promise<Result<unknown>> {
  const planned = await plannedPort(ctx)
  const lock = await liveLock(ctx)
  if (lock === null) {
    const url = cockpitUrl({ port: planned.port })
    return ok({
      running: false,
      port: planned.port,
      url,
      setting: planned.setting,
      message: `The QualityLayer App's server is not running. It will try port ${planned.port}${planned.from === "environment" ? " (QUALITYLAYER_PORT)" : ""} when it starts.`,
    })
  }
  const wanted = lock.wanted ?? lock.port
  const fell = fellBackWords(wanted, lock.port)
  return ok({
    running: true,
    pid: lock.pid,
    port: lock.port,
    url: cockpitUrl(lock),
    setting: planned.setting,
    fellBack: fell !== null,
    message: `The QualityLayer App's server listens on port ${lock.port} (${cockpitUrl(lock)}).${fell === null ? "" : ` ${fell} Your setting stays ${planned.setting}.`}`,
  })
}

/** `app restart`: stop the server and start it again, so a changed port takes effect. */
async function restart(ctx: Ctx): Promise<Result<unknown>> {
  const lock = await liveLock(ctx)
  if (lock !== null && !(await stopCockpit(ctx, lock)))
    return err({
      code: "bad_args",
      message: `cannot stop the QualityLayer App's server (pid ${lock.pid})`,
    })
  const started = await ensureCurrentCockpit(ctx)
  if (started === null)
    return err({ code: "bad_args", message: "the QualityLayer App's server could not be started" })
  return ok({
    restarted: true,
    pid: started.pid,
    port: started.port,
    url: cockpitUrl(started),
  })
}

/** The server of this CLI's version, and the pairing link that signs the App's window in. */
async function ensure(ctx: Ctx, args: string[] = []): Promise<Result<unknown>> {
  // Another computer no longer has this one as a machine: the mark goes, and nothing is started.
  if (args.includes("--not-for-machine")) {
    return ok({ forMachine: false, removed: unmarkServed(ctx.home) })
  }
  const lock = await ensureCurrentCockpit(ctx)
  if (lock === null) {
    return err({ code: "bad_args", message: "the QualityLayer App's server could not be started" })
  }
  const url = await pairingUrl(lock, { inApp: true })
  if (url === null)
    return err({
      code: "bad_args",
      message:
        "Could not create a one-time browser sign-in link. Run `qualitylayer app` again to retry.",
    })
  return ok({
    url,
    pid: lock.pid,
    // What the App compares with its own reading of the pid: a pid another program now holds differs.
    started: processStartTime(lock.pid),
    port: lock.port,
    token: lock.token,
    version: lock.version,
    // Another computer added this one as a machine: its server then stays up while work goes on.
    ...(args.includes("--for-machine")
      ? { forMachine: true, ...markServed(ctx.home, ctx.clock.now()) }
      : {}),
  })
}

/** `app crashed --reason <code>`: the App says it restarted its server, and crash.log keeps the line. */
function crashed(ctx: Ctx, args: string[]): Result<unknown> {
  const at = args.indexOf("--reason")
  const reason = at === -1 ? undefined : args[at + 1]
  const known = APP_CRASH_REASONS.find((code) => code === reason)
  if (known === undefined) {
    return err({
      code: "bad_args",
      message: `app crashed needs --reason ${APP_CRASH_REASONS.join(" or ")}`,
    })
  }
  crashLine(ctx.home, known, "")
  return ok({ recorded: known })
}

const SUBCOMMANDS: Record<
  string,
  (ctx: Ctx, args: string[]) => Promise<Result<unknown>> | Result<unknown>
> = {
  ensure,
  crashed,
  status: (ctx) => status(ctx),
  restart: (ctx) => restart(ctx),
  stop: cockpitCmd,
  link: cockpitCmd,
}

async function openAppRoute(ctx: Ctx, args: string[], browser: boolean): Promise<Result<unknown>> {
  const route = args.slice(browser ? 1 : 0).find((arg) => !arg.startsWith("--"))
  const checked = route === undefined ? null : routeOf(route)
  if (route !== undefined && checked === null) {
    return err({
      code: "bad_args",
      message: `"${route}" is not a place in the App: use task/<id>[/<doc>[/<heading>]], artifacts/<project>/<file>, team/<task>[/<doc>], ask/<task>/<ask> or step/<task>/<step>`,
    })
  }
  const place = checked === null ? null : await withTaskId(ctx, checked)
  const main = browser || args.includes("--no-open") ? null : await appMain(ctx)
  if (main !== null) {
    startApp(main, place === null ? [] : ["--open", `qualitylayer://${place}`])
    return ok({ opened: "app", route: place })
  }
  return openPage(ctx, {
    open: !args.includes("--no-open"),
    browser,
    route: place ?? undefined,
    remember: args.includes("--remember"),
  })
}

export async function appCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub] = args
  const handler = sub === undefined ? undefined : SUBCOMMANDS[sub]
  if (handler) return handler(ctx, args)
  if (args.includes("--forget-browsers")) {
    return (await forgetBrowsers(ctx))
      ? ok({ forgotten: true })
      : err({ code: "bad_args", message: "the running server could not forget the browsers" })
  }
  // `app pair` is the browser path even where the App is installed.
  return openAppRoute(ctx, args, sub === "pair")
}

/**
 * The App knows a task by its id (`<repo>~<slug>`): a task named by its slug alone, as `app <task>`
 * says, is looked up in this repository. A slug that names no task here stays as given.
 */
async function withTaskId(ctx: Ctx, route: string): Promise<string> {
  const [head, slug, ...rest] = route.split("/")
  if (head !== "task" || slug === undefined || slug.includes("~")) return route
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return route
  const task = (await listTasks(ctx, repo.data)).find((t) => t.slug === slug)
  return task === undefined ? route : [head, `${task.repoId}~${task.slug}`, ...rest].join("/")
}
