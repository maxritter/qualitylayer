// Opening the Cockpit in the user's browser: which launcher this machine has,
// and whether a Cockpit page is open already, so a new task or a gate opens
// one page when none is open and never a second one.

import { existsSync } from "node:fs"
import { release } from "node:os"
import { join } from "node:path"
import { resolveRepo } from "../core/paths.ts"
import { editorBrowser, isSet, screenOf } from "../core/platform.ts"
import { loadTask, type Task } from "../core/task/store.ts"
import type { Ctx, Env } from "../ctx.ts"
import { liveLock, pairingUrl } from "../server/lock.ts"

export type Machine = {
  os: NodeJS.Platform
  /** `os.release()`: WSL's kernel names Microsoft. */
  release: string
  env: Env
  has: (command: string) => boolean
  exists: (path: string) => boolean
}

/** A second open within this time waits for the first page to connect instead. */
const JUST_OPENED_MS = 90_000

function platformLauncher(machine: Machine): string[] | null {
  const screen = screenOf(machine)
  if (screen === "ssh") return null
  if (machine.os === "darwin") return ["open"]
  if (machine.os === "win32") return ["rundll32.exe", "url.dll,FileProtocolHandler"]
  // Under WSL the link goes to the Windows browser.
  if (screen === "wsl") return machine.has("wslview") ? ["wslview"] : ["explorer.exe"]
  return screen === "desktop" ? ["xdg-open"] : null
}

/** The command that opens a link in the default browser, or null where no one would see it. */
export function launcher(machine: Machine): string[] | null {
  if (isSet(machine.env, "QUALITYLAYER_NO_BROWSER") || isSet(machine.env, "CI")) return null
  // In a VS Code remote window (a dev container, SSH, Codespaces) the link reaches the person's
  // own browser through the editor, which forwards the port.
  const editor = editorBrowser(machine.env, machine.exists)
  return editor !== null ? [editor] : platformLauncher(machine)
}

export type OpenOutcome = "opened" | "page-open" | "just-opened" | "unknown" | "no-browser"

export type OpenDeps = {
  /** How many pages hold the Cockpit's event stream; null when the Cockpit cannot say. */
  tabs: () => Promise<number | null>
  open: (url: string) => boolean | Promise<boolean>
  now: number
  lastOpened: () => Promise<number | null>
  remember: (at: number) => Promise<void>
}

/** Open `url` unless a Cockpit page is open, or one was opened moments ago and is still loading. */
export async function openIfClosed(deps: OpenDeps, url: string): Promise<OpenOutcome> {
  const tabs = await deps.tabs()
  if (tabs === null) return "unknown"
  if (tabs > 0) return "page-open"
  const last = await deps.lastOpened()
  if (last !== null && deps.now - last < JUST_OPENED_MS) return "just-opened"
  if (!(await deps.open(url))) return "no-browser"
  await deps.remember(deps.now)
  return "opened"
}

function thisMachine(env: Env): Machine {
  return {
    os: process.platform,
    release: release(),
    env,
    has: (command) => Bun.which(command) !== null,
    exists: existsSync,
  }
}

/** Open `url` with this machine's launcher; false when there is none or it cannot start. */
export async function openInBrowser(env: Env, url: string): Promise<boolean> {
  const command = launcher(thisMachine(env))
  if (command === null) return false
  try {
    // The browser shows its own window: on Windows it must not start hidden.
    const child = Bun.spawn([...command, url], {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: false,
      timeout: 5000,
      killSignal: "SIGKILL",
    })
    return (await child.exited) === 0
  } catch {
    return false
  }
}

/** The pages the running Cockpit has open, asked over its token-guarded API. */
async function cockpitTabs(ctx: Ctx): Promise<number | null> {
  const lock = await liveLock(ctx)
  if (lock === null) return null
  try {
    const response = await fetch(`http://127.0.0.1:${lock.port}/api/viewers`, {
      headers: { "x-qualitylayer-token": lock.token },
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { tabs?: unknown }
    return typeof body.tabs === "number" ? body.tabs : null
  } catch {
    return null
  }
}

/**
 * The page's address as a one-time pairing link, so a browser that never paired (the host's
 * browser of a dev container, the Windows browser of WSL) lands on the page instead of a key
 * prompt. The page's address itself when the server makes no codes.
 */
async function signedIn(ctx: Ctx, url: string): Promise<string> {
  const lock = await liveLock(ctx)
  if (lock === null) return url
  const route = url.split("#/")[1]
  return (await pairingUrl(lock, route === undefined ? {} : { route })) ?? url
}

/** The command that shows a desktop notification, or null where there is none to show. */
export function notifier(machine: Machine, title: string, body: string): string[] | null {
  // Where no browser would open (SSH, CI, switched off), no notification shows either.
  const browser = launcher(machine)
  if (browser === null) return null
  if (machine.os === "darwin") {
    const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    return ["osascript", "-e", `display notification ${quote(body)} with title ${quote(title)}`]
  }
  if (browser[0] === "xdg-open" && machine.has("notify-send")) {
    return ["notify-send", "--app-name=QualityLayer", title, body]
  }
  return null
}

function notifyDesktop(env: Env, title: string, body: string): void {
  const command = notifier(thisMachine(env), title, body)
  if (command === null) return
  try {
    Bun.spawn(command, { stdio: ["ignore", "ignore", "ignore"] }).unref()
  } catch {
    // no notifier: the open page and the printed link remain
  }
}

/**
 * A gate waits for the user: with no Cockpit page open, open one and say so on the desktop.
 * With a page open, that page shows the gate and raises its own browser notification.
 */
export async function needsYou(
  ctx: Ctx,
  url: string,
  what: { title: string; body: string },
): Promise<OpenOutcome> {
  const outcome = await openCockpit(ctx, url)
  if (outcome === "opened" || outcome === "just-opened")
    notifyDesktop(ctx.env, what.title, what.body)
  return outcome
}

/** When the user is needed (a task starts, a gate opens): the Cockpit, unless it is open already. */
export async function openCockpit(ctx: Ctx, url: string): Promise<OpenOutcome> {
  if ((await taskAtUrl(ctx, url))?.answers === "terminal") return "no-browser"
  if (launcher(thisMachine(ctx.env)) === null) return "no-browser"
  const marker = join(ctx.home, "cockpit.opened")
  return openIfClosed(
    {
      tabs: () => cockpitTabs(ctx),
      open: async (target) => openInBrowser(ctx.env, await signedIn(ctx, target)),
      now: ctx.clock.now(),
      lastOpened: async () => {
        try {
          const at = Number((await ctx.fs.readFile(marker)).trim())
          return Number.isFinite(at) && at > 0 ? at : null
        } catch {
          return null
        }
      },
      remember: async (at) => {
        await ctx.fs.writeFile(marker, `${at}\n`)
      },
    },
    url,
  )
}

async function taskAtUrl(ctx: Ctx, url: string): Promise<Task | null> {
  try {
    const id = decodeURIComponent(new URL(url).hash.split("/")[2] ?? "")
    const split = id.indexOf("~")
    if (split < 1) return null
    const repo = await resolveRepo(ctx)
    if (!repo.ok || repo.data.id !== id.slice(0, split)) return null
    return loadTask(ctx, repo.data, id.slice(split + 1))
  } catch {
    return null
  }
}
