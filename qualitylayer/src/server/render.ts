// An artifact drawn to a PNG by a Chrome or Chromium on this machine, driven over its DevTools socket:
// `artifact shot` for the agent to look at its own work, and the Artifacts tab's thumbnails. The page is
// loaded from a file in a throwaway profile with a policy that allows no network, so an artifact shows
// exactly what the App shows. One browser draws a whole batch, then ends with its profile.

import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { projectArtifactsRuntime } from "../core/artifact/store.ts"
import { fencePage } from "../core/docs/fence-page.ts"
import { folderDoc } from "../core/docs/names.ts"
import { ARTIFACT_REVISIONS_KEPT, capFolder } from "../core/home-caps.ts"
import {
  devtoolsAddress,
  endWithThisProcess,
  renameWithRetry,
  stopOwnedSubprocess,
} from "../core/platform.ts"
import { namedPlanFences } from "../core/review/mockup-shots.ts"
import type { Task } from "../core/task/store.ts"
import type { Ctx } from "../ctx.ts"
import panelCSS from "../ui/reader/panel.css" with { type: "text" }
import wireCSS from "../ui/reader/wire.css" with { type: "text" }
import { withPolicy } from "./artifact-bridge.ts"
import { openStates } from "./render-states.ts"

/**
 * The runtime's own socket, taken when this module loads: the server registers a DOM for its
 * diagram checks later, and that DOM's WebSocket reaches no browser.
 */
const Socket = globalThis.WebSocket
const fetchPage = globalThis.fetch

/** Where a Chrome or Chromium usually is, per platform; QUALITYLAYER_CHROME names one (or `none`). */
export function findChrome(get: (name: string) => string | undefined): string | null {
  const named = get("QUALITYLAYER_CHROME")
  if (named !== undefined && named !== "") {
    if (named === "none") return null
    return existsSync(named) ? named : null
  }
  const places =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        ]
      : process.platform === "win32"
        ? [
            join(
              get("PROGRAMFILES") ?? "C:\\Program Files",
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
            join(
              get("PROGRAMFILES(X86)") ?? "C:\\Program Files (x86)",
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
            join(get("LOCALAPPDATA") ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ]
  for (const place of places) if (place !== "" && existsSync(place)) return place
  for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = Bun.which(command)
    if (found !== null) return found
  }
  return null
}

export const NO_CHROME =
  "drawing an artifact needs Chrome or Chromium on this computer, and none was found; install one, or set QUALITYLAYER_CHROME to its path"

export type ShotSpec = {
  /** File export prints the ready page instead of taking a screenshot. */
  format?: "pdf"
  imagePages?: boolean
  /** Exports refuse a truncated page; ordinary thumbnails retain their height cap. */
  refuseClipped?: boolean
  query?: string
  /** The page's width in CSS pixels; the artifact's own width when it names one, else 1280. */
  width: number
  theme: "light" | "dark"
  /** Only this part: a section's id or its `data-screen-label`. */
  section?: string
  /** A picture of the top of the page only, this tall (a thumbnail); otherwise the whole page. */
  height?: number
  /** Below 1 draws a smaller picture (a thumbnail). */
  scale?: number
  /** Sharing refuses an empty script mount; this is readiness, not visual approval. */
  requireVisibleContent?: boolean
  /** The visible DOM used for the same picture, for a Terminal mode text sketch. */
  onRendered?: (html: string) => void
  /** What the page reported while it was drawn; called once per shot, also when the shot fails. */
  onDiagnostics?: (found: ShotDiagnostics) => void
  /** After the picture, ask the page once whether its main thread still answers (needs `onDiagnostics`). */
  probeResponsive?: boolean
}

/**
 * Runtime errors the page raised and URLs the no-network policy refused, as one shot saw them;
 * `unresponsive` when the page's scripts no longer let it answer after the picture.
 */
export type ShotDiagnostics = {
  errors: string[]
  blocked: string[]
  unresponsive?: true
  clipped?: { pageHeight: number; capturedHeight: number }
}

/** The tallest picture drawn; a longer page is cut there. */
const MAX_HEIGHT = 16_000
/** At most this many entries of each diagnostics list, each at most this long. */
const DIAGNOSTICS_KEPT = 50
const DIAGNOSTIC_CHARS = 500
/**
 * The responsiveness probe: a moment for scripts that start after the picture (a lazy section, an
 * observer), then the time a trivial evaluation may take. A healthy page answers in milliseconds.
 */
const PROBE_SETTLE_MS = 750
const PROBE_ANSWER_MS = 2_000

type PageEvent = { method: string; params: Record<string, unknown> }

type Send = ((
  method: string,
  params?: object,
  session?: string,
) => Promise<Record<string, unknown>>) & {
  allowDocument(session: string, url: string): void
  allowOrigin(session: string, origin: string): void
  /** Events of one session, until the returned function is called; `QL.blocked` is a request the policy failed. */
  onEvent(session: string, handler: (event: PageEvent) => void): () => void
}

/** Collects a session's errors and blocked requests from its DevTools events. */
function diagnosticsCollector() {
  const errors: string[] = []
  const blocked = new Set<string>()
  const requested = new Map<string, string>()
  let unresponsive = false
  const clip = (text: string) => text.slice(0, DIAGNOSTIC_CHARS)
  const note = (text: string) => {
    if (errors.length < DIAGNOSTICS_KEPT) errors.push(clip(text))
  }
  const block = (url: string) => {
    if (url !== "" && blocked.size < DIAGNOSTICS_KEPT) blocked.add(clip(url))
  }
  const handle = ({ method, params }: PageEvent) => {
    if (method === "QL.blocked") block(String(params.url ?? ""))
    else if (method === "Network.requestWillBeSent") {
      const url = (params.request as { url?: string } | undefined)?.url ?? ""
      if (/^(https?|wss?):/.test(url) && requested.size < 500)
        requested.set(String(params.requestId), url)
    } else if (method === "Network.loadingFailed") {
      if (params.blockedReason !== undefined) block(requested.get(String(params.requestId)) ?? "")
    } else if (method === "Runtime.exceptionThrown") {
      const details = (params.exceptionDetails ?? {}) as {
        text?: string
        lineNumber?: number
        exception?: { description?: string; value?: unknown }
      }
      const text =
        details.exception?.description?.split("\n")[0] ??
        (details.exception?.value !== undefined ? String(details.exception.value) : undefined) ??
        details.text ??
        "exception"
      note(
        `${text}${typeof details.lineNumber === "number" ? ` (line ${details.lineNumber + 1})` : ""}`,
      )
    } else if (method === "Runtime.consoleAPICalled") {
      if (params.type !== "error" && params.type !== "assert") return
      const args = (params.args ?? []) as { value?: unknown; description?: string }[]
      const text = args
        .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? "")))
        .join(" ")
      note(`console.${String(params.type)}: ${text}`.trim())
    } else if (method === "Log.entryAdded") {
      const entry = (params.entry ?? {}) as {
        level?: string
        source?: string
        text?: string
        url?: string
        lineNumber?: number
      }
      // The console API arrives through Runtime; a request the policy refused is `blocked`, not an error.
      const text = entry.text ?? ""
      if (entry.level !== "error" || entry.source === "console-api") return
      if (/ERR_BLOCKED_BY_CLIENT/.test(text)) return block(entry.url ?? "")
      // The page's Content Security Policy refusing a request: one entry names it, the next repeats it.
      if (entry.source === "security" && /Content Security Policy/.test(text))
        return block(text.match(/'(\w+:[^']+)'/)?.[1] ?? text)
      if (/Refused to \w+ because it violates the document's Content Security Policy/.test(text))
        return
      note(
        `${entry.text ?? "error"}${entry.url ? ` (${entry.url}${typeof entry.lineNumber === "number" ? `:${entry.lineNumber + 1}` : ""})` : ""}`,
      )
    }
  }
  return {
    handle,
    markUnresponsive: () => {
      unresponsive = true
    },
    result: (): ShotDiagnostics => ({
      errors,
      blocked: [...blocked],
      ...(unresponsive ? { unresponsive: true as const } : {}),
    }),
  }
}

async function startChrome(
  executable: string,
  profile: string,
  onExit: () => void,
  options: string[] = [],
) {
  let child: Bun.Subprocess
  try {
    child = Bun.spawn(
      [
        executable,
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--hide-scrollbars",
        "--mute-audio",
        // A drawing needs no saved passwords: macOS's keychain would be asked, and slowly.
        "--use-mock-keychain",
        "--password-store=basic",
        ...options,
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        "about:blank",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
    )
  } catch (cause) {
    onExit()
    throw cause
  }
  const release = endWithThisProcess(child)
  void child.exited.then(() => {
    release()
    onExit()
  })
  // A browser that does not come up is ended, never left behind.
  const ended = async (cause: unknown): Promise<never> => {
    await stopOwnedSubprocess(child)
    throw cause
  }
  const address = await new Promise<string>((done, fail) => {
    const timer = setTimeout(() => fail(new Error("Chrome did not start in 20 s")), 20_000)
    const reader = (child.stderr as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let seen = ""
    const pump = async () => {
      for (;;) {
        const { value, done: ended } = await reader.read()
        if (ended) {
          const code = await child.exited
          clearTimeout(timer)
          const signal = child.signalCode
          const detail = seen.trim()
          return fail(
            new Error(
              `Chrome stopped before it was ready (exit ${code}${signal ? `, ${signal}` : ""})${detail ? `: ${detail}` : "; no startup diagnostics were produced. If your agent sandbox restricts Chrome, use its approved browser or request rendering outside that sandbox."}`,
            ),
          )
        }
        seen = (seen + decoder.decode(value)).slice(-4096)
        const found = devtoolsAddress(seen)
        if (found !== null) {
          clearTimeout(timer)
          // The rest of its output is not read: let it drain.
          void (async () => {
            for (;;) if ((await reader.read()).done) return
          })().catch(() => {})
          return done(found)
        }
      }
    }
    pump().catch((cause) => {
      clearTimeout(timer)
      fail(cause)
    })
  }).catch(ended)
  const socket = new Socket(address)
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error("Chrome's DevTools socket did not open")), 10_000)
    socket.addEventListener("open", () => {
      clearTimeout(timer)
      done()
    })
    socket.addEventListener("error", () => {
      clearTimeout(timer)
      fail(new Error("Chrome's DevTools socket did not open"))
    })
  }).catch(ended)
  let id = 0
  const waiting = new Map<number, (reply: Record<string, unknown>) => void>()
  const documents = new Map<string, string>()
  const origins = new Map<string, string>()
  const listeners = new Map<string, (event: PageEvent) => void>()
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>
    if (typeof message.id === "number") waiting.get(message.id)?.(message)
    else if (typeof message.method === "string" && typeof message.sessionId === "string") {
      const listener = listeners.get(message.sessionId)
      if (message.method !== "Fetch.requestPaused")
        listener?.({
          method: message.method,
          params: (message.params ?? {}) as Record<string, unknown>,
        })
    }
    if (
      typeof message.id !== "number" &&
      message.method === "Fetch.requestPaused" &&
      typeof message.sessionId === "string"
    ) {
      const request = message.params as { requestId: string; request: { url: string } }
      const allowed = documents.get(message.sessionId)
      const url = request.request.url.split("#")[0] ?? ""
      const origin = origins.get(message.sessionId)
      const safe =
        origin !== undefined
          ? captureRequestAllowed(origin, url)
          : allowed !== undefined && (url === allowed || /^(data:|blob:)/.test(url))
      if (!safe) listeners.get(message.sessionId)?.({ method: "QL.blocked", params: { url } })
      void send(
        safe ? "Fetch.continueRequest" : "Fetch.failRequest",
        {
          requestId: request.requestId,
          ...(!safe ? { errorReason: "BlockedByClient" } : {}),
        },
        message.sessionId,
      ).catch(() => {})
    }
  })
  const send = Object.assign(
    (method: string, params: object = {}, session?: string): Promise<Record<string, unknown>> =>
      new Promise((done, fail) => {
        const n = ++id
        const timer = setTimeout(() => {
          waiting.delete(n)
          fail(new Error(`${method} took too long`))
        }, 30_000)
        waiting.set(n, (message) => {
          clearTimeout(timer)
          waiting.delete(n)
          const error = message.error as { message?: string } | undefined
          if (error !== undefined) fail(new Error(`${method}: ${error.message ?? "failed"}`))
          else done((message.result ?? {}) as Record<string, unknown>)
        })
        socket.send(
          JSON.stringify({ id: n, method, params, ...(session ? { sessionId: session } : {}) }),
        )
      }),
    {
      allowDocument: (session: string, url: string) => {
        documents.set(session, url)
      },
      allowOrigin: (session: string, origin: string) => {
        origins.set(session, origin)
      },
      onEvent: (session: string, handler: (event: PageEvent) => void) => {
        listeners.set(session, handler)
        return () => {
          listeners.delete(session)
        }
      },
    },
  )
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      openBrowsers.delete(stop)
      try {
        await stopOwnedSubprocess(child, () => {
          if (socket.readyState === Socket.OPEN)
            socket.send(JSON.stringify({ id: ++id, method: "Browser.close" }))
        })
      } finally {
        socket.close()
      }
    })()
    return stopping
  }
  openBrowsers.add(stop)
  return { send, stop }
}

/** The browsers renders have open now, by their stop. */
const openBrowsers = new Set<() => Promise<void>>()

/** Ends every browser a render still has open: a server that stops leaves no Chrome behind. */
export async function stopRenderBrowsers(): Promise<void> {
  await Promise.allSettled([...openBrowsers].map((stop) => stop()))
}

async function shootOne(
  send: Send,
  page: string,
  spec: ShotSpec,
  capture?: UrlShotSpec,
): Promise<Uint8Array> {
  const { targetId } = (await send("Target.createTarget", { url: "about:blank" })) as {
    targetId: string
  }
  const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as {
    sessionId: string
  }
  const collector = spec.onDiagnostics ? diagnosticsCollector() : null
  let clipped: ShotDiagnostics["clipped"]
  const stopListening = collector ? send.onEvent(sessionId, collector.handle) : null
  try {
    await send("Page.enable", {}, sessionId)
    if (collector) {
      await send("Runtime.enable", {}, sessionId)
      await send("Log.enable", {}, sessionId)
    }
    await send("Network.enable", {}, sessionId)
    await send(
      "Network.setBlockedURLs",
      { urls: capture ? ["ws://*", "wss://*"] : ["http://*", "https://*", "ws://*", "wss://*"] },
      sessionId,
    )
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width: spec.width, height: spec.height ?? 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )
    await send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-color-scheme", value: spec.theme }] },
      sessionId,
    )
    // An artifact is drawn as the App frames it: the theme is also a signal on the page, not only a media query.
    if (!capture)
      await send(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: themeSignals(spec.theme) },
        sessionId,
      )
    const documentUrl = pathToFileURL(page)
    if (spec.query !== undefined) documentUrl.search = spec.query
    const url = capture ? page : documentUrl.href
    if (capture) send.allowOrigin(sessionId, loopbackUrl(url).origin)
    else send.allowDocument(sessionId, url)
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId)
    const navigation = await send("Page.navigate", { url }, sessionId)
    if (navigation.errorText) throw new Error(`Page unavailable: ${navigation.errorText}`)
    const evaluate = async <T>(expression: string): Promise<T> =>
      (
        (await send(
          "Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        )) as { result?: { value?: T } }
      ).result?.value as T
    // Loaded: the page is the artifact's and its load is over.
    let loaded = false
    const deadline = Date.now() + (capture?.timeoutMs ?? 15_000)
    for (; Date.now() < deadline; await Bun.sleep(40)) {
      const state = await evaluate<string>(
        `${capture ? `location.origin === ${JSON.stringify(loopbackUrl(url).origin)}` : `location.href.split("#")[0] === ${JSON.stringify(url)}`} ? document.readyState : "navigating"`,
      ).catch(() => "navigating")
      if (
        state === "complete" &&
        (await evaluate<boolean>(
          `(() => { const selector = ${JSON.stringify(capture?.waitFor ?? "")} || document.querySelector('meta[name="ql:ready-selector"]')?.content; if (!selector) return true; if (selector.length > 512) return false; try { const e = document.querySelector(selector); return !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden'; } catch (_) { return false; } })()`,
        ))
      ) {
        loaded = true
        break
      }
    }
    if (!loaded)
      throw new Error(
        capture
          ? `Page unavailable: ${capture.waitFor ? `selector ${capture.waitFor} unavailable` : "loading timed out or navigated away"}`
          : "The artifact navigated away or did not finish loading",
      )
    // Fonts and a first frame of whatever the page draws with its own script.
    await evaluate(
      `Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, ${Math.max(1, Math.min(1500, deadline - Date.now()))}))])`,
    )
    await openStates(evaluate, capture, deadline)
    const stillHere = () =>
      evaluate<boolean>(
        capture
          ? `location.origin === ${JSON.stringify(loopbackUrl(url).origin)}`
          : `location.href.split("#")[0] === ${JSON.stringify(url)}`,
      )
    if (!(await stillHere())) throw new Error("The artifact navigated away before its picture")
    if (spec.requireVisibleContent) {
      const content = await evaluate<boolean>(`(() => {
        const body = document.body;
        if (!body) return false;
        const visible = element => {
          const box = element.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) return false;
          for (let node=element;node;node=node.parentElement) {
            const style=getComputedStyle(node);
            if (style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0) return false;
          }
          return true;
        };
        return [body,...body.querySelectorAll('*')].some(element => !['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','META','LINK'].includes(element.tagName) && visible(element) && (element instanceof HTMLImageElement ? element.complete && element.naturalWidth > 0 : element instanceof HTMLCanvasElement ? element.width > 0 && element.height > 0 : element.tagName.toLowerCase()==='svg' ? element.childElementCount > 0 : [...element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE && node.textContent.trim().length > 0) || (element.getAttribute('aria-label') || element.value || '').trim().length > 0));
      })()`)
      if (!content)
        throw new Error("The artifact did not render visible content. Nothing new was shared.")
    }
    const boxExpression = `(() => {
      const want = ${JSON.stringify(spec.section ?? "")}
      const root = document.documentElement
      const crop = ${JSON.stringify(capture?.crop ?? "")}
      if (crop) { const el = document.querySelector(crop); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } : null }
      if (want === "") return { x: 0, y: 0, w: Math.max(root.scrollWidth, ${spec.width}), h: root.scrollHeight }
      const el = document.getElementById(want) ??
        [...document.querySelectorAll("[data-screen-label]")].find((e) => e.getAttribute("data-screen-label") === want)
      if (!el) return null
      const shown = () => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      for (let node = el; !shown() && node; node = node.parentElement) {
        const tab = node.id ? document.querySelector('[role="tab"][aria-controls="' + CSS.escape(node.id) + '"]') : null
        if (tab instanceof HTMLElement) tab.click()
        if (node instanceof HTMLDetailsElement) node.open = true
        if (!shown() && node.hidden) node.hidden = false
      }
      if (!shown()) return "hidden"
      const r = el.getBoundingClientRect()
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
    })()`
    let box = await evaluate<{ x: number; y: number; w: number; h: number } | "hidden" | null>(
      boxExpression,
    )
    if (box === "hidden")
      throw new Error(`the artifact's part "${spec.section}" is hidden and could not be shown`)
    if (box === null)
      throw new Error(
        capture
          ? `crop selector ${capture.crop} unavailable`
          : `the artifact has no part "${spec.section}"`,
      )
    const assets = await evaluate<boolean>(`(async () => {
      const want = ${JSON.stringify(spec.section ?? "")};
      const scope = want ? document.getElementById(want) ?? [...document.querySelectorAll('[data-screen-label]')].find(e => e.getAttribute('data-screen-label') === want) : document.body;
      if (!scope) return false;
      if (want) scope.scrollIntoView({ block: 'start', inline: 'nearest' });
      const images = [...scope.querySelectorAll('img')].filter(image => {
        if (!image.getAttribute('src') && !image.getAttribute('srcset')) return false;
        for (let node=image;node;node=node.parentElement) { const s=getComputedStyle(node); if (s.display==='none'||s.visibility==='hidden') return false; }
        return true;
      });
      for (const image of images) image.loading = 'eager';
      let timer;
      try {
        const ready = await Promise.race([Promise.all(images.map(image => image.decode())).then(() => true, () => false), new Promise(resolve => { timer=setTimeout(() => resolve(false), ${Math.max(1, deadline - Date.now())}); })]);
        if (!ready) return false;
        if (${capture === undefined}) for (const animation of document.getAnimations()) {
          if (animation.effect?.getTiming().iterations !== Infinity) { try { animation.finish(); } catch (_) {} }
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      } finally { clearTimeout(timer); }
    })()`)
    if (!assets)
      throw new Error(
        "A visible artifact image could not be decoded before the picture; no capture was recorded",
      )
    box = await evaluate<{ x: number; y: number; w: number; h: number } | "hidden" | null>(
      boxExpression,
    )
    if (box === null || box === "hidden")
      throw new Error("The selected artifact part changed before its picture")
    if ((spec.section || capture?.crop) && (box.x < -0.5 || box.y < -0.5))
      throw new Error(
        "The selected part begins outside the page; use a wider viewport or fix its position instead of recording a clipped picture",
      )
    if (spec.onRendered) {
      const html = await evaluate<string>(`(() => {
        const copy = document.documentElement.cloneNode(true);
        const originals = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
        const copies = [copy, ...copy.querySelectorAll('*')];
        originals.forEach((element, index) => {
          const clone = copies[index], style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || (element instanceof HTMLElement && style.display !== 'contents' && element.getClientRects().length === 0)) clone.setAttribute('hidden', '');
          if (element instanceof HTMLInputElement) clone.setAttribute('value', element.value);
          if (element instanceof HTMLTextAreaElement) clone.textContent = element.value;
        });
        return copy.outerHTML;
      })()`)
      spec.onRendered(html)
    }
    if (spec.format === "pdf") {
      if (spec.imagePages) {
        const sized = await evaluate<boolean>(`(() => {
          const sheets = [...document.querySelectorAll('[data-export-image-page]')];
          const style = document.createElement('style'); let css = '';
          for (const [index, sheet] of sheets.entries()) {
            const box = sheet.getBoundingClientRect(), width = Math.ceil(box.width), height = Math.ceil(box.height);
            if (width < 1 || width > 8000 || height < 1 || height > 18500) return false;
            const name = 'exportImage' + index; sheet.style.page = name;
            css += '@page ' + name + '{size:' + width + 'px ' + height + 'px;margin:0}';
          }
          style.textContent = css; document.head.append(style); return sheets.length > 0;
        })()`)
        if (!sized) throw new Error("The export page exceeds the PDF size limit")
      }
      const printed = (await send(
        "Page.printToPDF",
        {
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: false,
          marginTop: 0,
          marginBottom: 0,
          marginLeft: 0,
          marginRight: 0,
        },
        sessionId,
      )) as { data: string }
      return Uint8Array.from(Buffer.from(printed.data, "base64"))
    }
    if (spec.refuseClipped && (box.h > MAX_HEIGHT || box.w > 8_000))
      throw new Error(
        "This page is too large for a complete image export; use a paginated document",
      )
    const height = Math.max(
      1,
      Math.min(spec.height ?? Math.ceil(box.h), MAX_HEIGHT, Math.ceil(box.h) || 1),
    )
    if (spec.height === undefined && height < Math.ceil(box.h))
      clipped = { pageHeight: Math.ceil(box.h), capturedHeight: height }
    const shot = (await send(
      "Page.captureScreenshot",
      {
        format: "png",
        captureBeyondViewport: true,
        clip: {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: Math.max(1, Math.min(Math.ceil(box.w), 8_000)),
          height,
          scale: spec.scale ?? 1,
        },
      },
      sessionId,
    )) as { data: string }
    const png = Uint8Array.from(Buffer.from(shot.data, "base64"))
    // A script that keeps the main thread busy (often one reacting to its own DOM changes) still
    // draws a picture, but the viewer can neither scroll it nor stop it using a whole CPU core.
    if (spec.probeResponsive && collector) {
      await Bun.sleep(PROBE_SETTLE_MS)
      const answered = await Promise.race([
        evaluate<number>("1").then(
          () => true,
          () => true,
        ),
        Bun.sleep(PROBE_ANSWER_MS).then(() => false),
      ])
      if (!answered) {
        collector.markUnresponsive()
        return png
      }
    }
    if (!(await stillHere())) throw new Error("The artifact navigated away during its picture")
    return png
  } finally {
    stopListening?.()
    try {
      if (collector)
        spec.onDiagnostics?.({ ...collector.result(), ...(clipped ? { clipped } : {}) })
    } catch {}
    await send("Target.closeTarget", { targetId }).catch(() => {})
  }
}

/**
 * What ArtifactPageFrame sets on the page: `data-theme`, the `dark` class and `color-scheme` on the root,
 * as soon as the root exists and before the page's own scripts. The root may not exist yet at this point.
 */
function themeSignals(theme: "light" | "dark"): string {
  const t = JSON.stringify(theme)
  return `(() => { const set = () => { const root = document.documentElement; if (!root) return false; root.dataset.theme = ${t}; root.classList.toggle("dark", ${t} === "dark"); root.style.colorScheme = ${t}; return true }; if (!set()) { const watch = new MutationObserver(() => { if (set()) watch.disconnect() }); watch.observe(document, { childList: true }) } })()`
}

export type UrlShotSpec = ShotSpec & {
  waitFor?: string
  crop?: string
  /** Selectors clicked in order once the page is loaded: how a dialog or another state is reached. */
  clicks?: string[]
  timeoutMs?: number
}

/** No DNS names beyond localhost, credentials, alternate protocols or remote origins. */
export function loopbackUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Capture requires a loopback HTTP URL")
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Capture requires a loopback HTTP URL without credentials")
  return url
}

export function captureRequestAllowed(origin: string, value: string): boolean {
  try {
    const url = loopbackUrl(value)
    return url.origin === origin
  } catch {
    return false
  }
}

let activeCaptures = 0
const waitingCaptures: (() => void)[] = []

async function takeCaptureSlot(): Promise<() => void> {
  if (activeCaptures >= 2) await new Promise<void>((resolve) => waitingCaptures.push(resolve))
  else activeCaptures++
  return () => {
    const next = waitingCaptures.shift()
    if (next) next()
    else activeCaptures--
  }
}

/** Capture a built page with a private profile and one origin, independently of artifact rendering. */
export async function renderUrl(
  chrome: string,
  value: string,
  spec: UrlShotSpec,
): Promise<Uint8Array> {
  const url = loopbackUrl(value)
  if (!Number.isInteger(spec.width) || spec.width < 240 || spec.width > 8000)
    throw new Error("Invalid capture width")
  const release = await takeCaptureSlot()
  let profile: string | undefined
  let browser: Awaited<ReturnType<typeof startChrome>> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const requests = new AbortController()
  // DevTools' URL blocklist does not cover WebSocket handshakes. Every HTTP request, including
  // those from child frames and workers, also crosses a proxy that refuses upgrades and tunnels.
  let pageFailure: string | undefined
  let proxy: Bun.Server<undefined> | undefined
  try {
    profile = await mkdtemp(join(tmpdir(), "ql-screen-chrome-"))
    proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (
          request.method === "CONNECT" ||
          request.headers.has("upgrade") ||
          !captureRequestAllowed(url.origin, request.url)
        )
          return new Response("Blocked by capture policy", { status: 403 })
        const headers = new Headers(request.headers)
        for (const name of ["connection", "proxy-connection", "proxy-authorization", "host"])
          headers.delete(name)
        try {
          const response = await fetchPage(request.url, {
            method: request.method,
            headers,
            ...(request.method !== "GET" && request.method !== "HEAD"
              ? { body: await request.arrayBuffer() }
              : {}),
            redirect: "manual",
            proxy: "",
            signal: requests.signal,
          })
          if (
            response.status >= 400 &&
            (request.url === url.href || request.headers.get("sec-fetch-dest") === "document")
          )
            pageFailure = `Page answered HTTP ${response.status}`
          const outgoing = new Headers(response.headers)
          outgoing.delete("content-encoding")
          outgoing.delete("content-length")
          outgoing.delete("transfer-encoding")
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: outgoing,
          })
        } catch {
          if (request.url === url.href || request.headers.get("sec-fetch-dest") === "document")
            pageFailure = "Page unavailable"
          return new Response("Page unavailable", { status: 502 })
        }
      },
    })
    browser = await startChrome(chrome, profile, () => {}, [
      `--proxy-server=http://127.0.0.1:${proxy.port}`,
      "--proxy-bypass-list=<-loopback>",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ])
    const timeoutMs = Math.min(spec.timeoutMs ?? 20_000, 20_000)
    const picture = await Promise.race([
      shootOne(browser.send, url.href, spec, { ...spec, timeoutMs }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                spec.waitFor
                  ? `Page capture timed out: selector ${spec.waitFor} unavailable`
                  : "Page capture timed out",
              ),
            ),
          timeoutMs,
        )
      }),
    ])
    if (pageFailure) throw new Error(pageFailure)
    return picture
  } finally {
    clearTimeout(timer)
    try {
      await browser?.stop()
    } finally {
      requests.abort()
      try {
        await proxy?.stop(true)
      } finally {
        try {
          if (profile) await rm(profile, { recursive: true, force: true })
        } finally {
          release()
        }
      }
    }
  }
}

/**
 * Draw each artifact of a batch with one browser. An artifact that fails is an Error in its place; a
 * browser that does not start fails the whole batch.
 */
export async function renderArtifacts(
  chrome: string,
  jobs: { html: string; spec: ShotSpec }[],
  budget?: { maxBytes: number; maxPixels: number; timeoutMs: number },
): Promise<(Uint8Array | Error)[]> {
  const profile = await mkdtemp(join(tmpdir(), "ql-artifact-chrome-"))
  let exited = false
  try {
    const browser = await startChrome(chrome, profile, () => {
      exited = true
    })
    try {
      const out: (Uint8Array | Error)[] = []
      const deadline = Date.now() + (budget?.timeoutMs ?? Number.POSITIVE_INFINITY)
      let totalBytes = 0,
        totalPixels = 0
      for (const [index, job] of jobs.entries()) {
        const page = join(profile, `artifact-${index}.html`)
        await writeFile(page, withPolicy(job.html), "utf8")
        try {
          let timer: ReturnType<typeof setTimeout> | undefined
          const remaining = deadline - Date.now()
          if (remaining <= 0) throw new Error("Export rendering timed out")
          try {
            const picture = await (budget
              ? Promise.race([
                  shootOne(browser.send, page, job.spec),
                  new Promise<never>((_, reject) => {
                    timer = setTimeout(
                      () => reject(new Error("Export rendering timed out")),
                      remaining,
                    )
                  }),
                ])
              : shootOne(browser.send, page, job.spec))
            totalBytes += picture.byteLength
            if (budget && job.spec.format !== "pdf" && picture.byteLength >= 24) {
              const size = new DataView(picture.buffer, picture.byteOffset, picture.byteLength)
              totalPixels += size.getUint32(16) * size.getUint32(20)
            }
            if (budget && (totalBytes > budget.maxBytes || totalPixels > budget.maxPixels))
              throw new Error("Export rendering exceeds its size limit")
            out.push(picture)
          } finally {
            clearTimeout(timer)
          }
        } catch (cause) {
          if (budget) throw cause
          out.push(cause instanceof Error ? cause : new Error(String(cause)))
        }
      }
      return out
    } finally {
      await browser.stop()
    }
  } finally {
    // Only the profile this call made, in the system's temporary folder.
    if (exited && profile.startsWith(`${tmpdir()}${sep}ql-artifact-chrome-`))
      await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

/** Write a picture where it was asked for. */
export async function writePicture(path: string, png: Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, png, { flag: "wx", mode: 0o600 })
    await renameWithRetry(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Capture current named fences before the reviewer starts reading the draft. */
export async function renderPlanFences(ctx: Ctx, task: Task): Promise<void> {
  if (task.stage !== "plan") return
  const plan = join(task.dir, folderDoc("plan"))
  if (!(await ctx.fs.exists(plan))) return
  const fences = namedPlanFences(task, await ctx.fs.readFile(plan))
  if (fences.length === 0) return
  const chrome = findChrome((name) => ctx.env.get(name))
  if (chrome === null) return
  const folder = join(projectArtifactsRuntime(ctx, task.repoId), "shots")
  await ctx.fs.mkdir(folder)
  const jobs = fences.map((fence) => ({
    html: fencePage("wireframe", fence.source, "light", { wire: wireCSS, panel: panelCSS }) ?? "",
    spec: { width: fence.width, theme: "light" as const },
  }))
  // A browser failure leaves source-only review available; no older digest can stand in for it.
  const pictures = await renderArtifacts(chrome, jobs).catch(() => [])
  for (const [index, fence] of fences.entries()) {
    const picture = pictures[index]
    if (picture === undefined || picture instanceof Error) continue
    await writePicture(join(folder, `${fence.prefix}${fence.width}.png`), picture)
  }
  await capFolder(ctx, folder, ARTIFACT_REVISIONS_KEPT, (name) =>
    /^fence-.+-light-\d+\.png$/.test(name),
  )
}
