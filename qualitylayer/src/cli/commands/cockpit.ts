// serve · cockpit · cockpit stop · cockpit link — and the helper that starts the
// Cockpit for an active task and returns the task's URL for `next` and `gate open`.

import { createHash } from "node:crypto"
import { join } from "node:path"
import { headingSlug } from "../../core/docs/anchor.ts"
import { loginPath, mergedPath } from "../../core/login-path.ts"
import { resolveRepo } from "../../core/paths.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import {
  cockpitUrl,
  ensureCockpit,
  type Lock,
  liveLock,
  pairingUrl,
  stopCockpit,
} from "../../server/lock.ts"
import { appLinkOpensHere } from "../../server/machines/served.ts"
import type { Gatekeeper } from "../../server/serve.ts"
import { openInBrowser } from "../browser.ts"
import { requireTask } from "./shared.ts"

export function serveCmd(gatekeeper?: Gatekeeper) {
  return async (ctx: Ctx, args: string[]): Promise<Result<unknown>> => {
    const portFlag = args.indexOf("--port")
    const port = portFlag !== -1 ? Number(args[portFlag + 1]) : undefined
    // Started from the Dock the server has a bare PATH: git needs the user's tools for its filters.
    const login = await loginPath(ctx)
    if (login !== null) process.env.PATH = mergedPath(process.env.PATH, login)
    // Loaded on demand: only the server needs the embedded SPA.
    const { serve } = await import("../../server/serve.ts")
    return serve(ctx, {
      port: Number.isFinite(port) ? port : undefined,
      gatekeeper,
      foreground: true,
    })
  }
}

async function stopApp(ctx: Ctx): Promise<Result<unknown>> {
  const lock = await liveLock(ctx)
  if (lock === null) return ok({ stopped: false, message: "the QualityLayer App is not running" })
  if (!(await stopCockpit(ctx, lock)))
    return err({
      code: "bad_args",
      message: `cannot stop the QualityLayer App's server (pid ${lock.pid})`,
    })
  return ok({ stopped: true, pid: lock.pid })
}

async function cockpitLink(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [, doc, ...heading] = args.filter((a) => a !== "--no-open")
  if (doc === undefined) {
    return err({
      code: "bad_args",
      message: 'usage: qualitylayer app link <doc> ["<heading>"]',
    })
  }
  const task = await requireTask(ctx)
  if (!task.ok) return task
  const base = await taskCockpitUrl(ctx, task.data.slug)
  if (base === undefined) {
    return err({
      code: "bad_args",
      message: appLinkOpensHere(ctx.home)
        ? "the QualityLayer App's server could not be started"
        : "this computer is a machine of the person's own App, where no link from here opens: name the task and its section instead",
    })
  }
  const words = heading
    .join(" ")
    .replace(/^#+\s*/, "")
    .trim()
  const at = words !== "" ? `/${encodeURIComponent(headingSlug(words))}` : ""
  return ok({ url: `${base}/${encodeURIComponent(doc)}${at}` })
}

export async function cockpitCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args[0] === "stop") return stopApp(ctx)
  // `cockpit link <doc> ["<heading>"]`: the link that opens the task's document at
  // that heading and marks its section, for the agent to put beside a question.
  if (args[0] === "link") return cockpitLink(ctx, args)
  return openPage(ctx, { open: !args.includes("--no-open") })
}

/**
 * The server of this CLI's own build, replacing one of another build on its port; null when none
 * starts.
 */
export function ensureCurrentCockpit(ctx: Ctx): Promise<Lock | null> {
  return ensureCockpit(ctx, { explicit: true })
}

/**
 * Start the server if needed and open its page in the browser, at `route` when given
 * (`task/<id>`). The link pairs the browser (one-time code, no key); a failed pairing request
 * returns an error instead of opening a page that cannot sign the browser in.
 */
export async function openPage(
  ctx: Ctx,
  options: { open: boolean; route?: string; remember?: boolean; browser?: boolean },
): Promise<Result<unknown>> {
  const lock = await ensureCurrentCockpit(ctx)
  if (lock === null) {
    return err({ code: "bad_args", message: "the QualityLayer App's server could not be started" })
  }
  const url = await pairingUrl(lock, options)
  if (url === null)
    return err({
      code: "bad_args",
      message:
        "Could not create a one-time browser sign-in link. Run `qualitylayer app` again to retry.",
    })
  if (options.open && !(await openInBrowser(ctx.env, url)))
    return err({
      code: "open_failed",
      message: `The browser launcher did not finish successfully. Open this link manually: ${url}`,
    })
  return ok({ url, pid: lock.pid, port: lock.port })
}

/**
 * True the first time a task's URL is handed out by the running Cockpit. A new
 * launch on another port starts over; the URL carries no key, so the port is all
 * that tells launches apart. Only a hash of the launch is kept.
 */
export async function firstMention(ctx: Ctx, url: string): Promise<boolean> {
  const path = join(ctx.home, "cockpit.mentioned")
  const [base = url, route = ""] = url.split("#")
  const launch = createHash("sha256").update(base).digest("hex").slice(0, 16)
  let seen: { launch: string; routes: string[] } = { launch, routes: [] }
  try {
    const stored = JSON.parse(await ctx.fs.readFile(path)) as typeof seen
    if (stored.launch === launch && Array.isArray(stored.routes)) seen = stored
  } catch {
    // nothing mentioned yet
  }
  if (seen.routes.includes(route)) return false
  seen.routes.push(route)
  await ctx.fs.writeFile(path, `${JSON.stringify(seen, null, 2)}\n`)
  return true
}

/** The Cockpit URL for a task, starting the server when autostart allows it. Never fails the command. */
export async function taskCockpitUrl(ctx: Ctx, slug: string): Promise<string | undefined> {
  try {
    const repo = await resolveRepo(ctx)
    if (!repo.ok) return undefined
    const lock = await ensureCockpit(ctx, { explicit: false })
    // A machine's own address opens nothing where the person sits: no link, and no page opened here.
    if (lock === null || !appLinkOpensHere(ctx.home)) return undefined
    return cockpitUrl(lock, `${repo.data.id}~${slug}`)
  } catch {
    return undefined
  }
}
