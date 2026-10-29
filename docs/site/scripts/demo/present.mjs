// The live product demo: plays story.mjs on the source App demo (illustrative in-browser data, no account,
// no agent, no network) in a clean Chrome window the presenter shares.
//
//   npm run demo                      present: ⌥→ next beat, ⌥← back, ⌥↓ ⌥↑ chapters, ⌥R restart (or Enter / b here)
//   npm run demo -- --from plan       start at a chapter
//   npm run demo -- --theme light     the App in light theme
//   npm run demo -- --script          print the run sheet: every chapter and beat with what to say
//   npm run demo:check                every beat headless; a picture of each in --out (default: temp folder)
//   npm run demo -- --dev             the source dev server instead of a build, to follow edits as they land
//
// The demo follows the App as the checkout has it: after a UI change, run demo:check and look at the
// pictures. A beat whose control moved fails there with its chapter, not live on stage.
import { createRequire } from "node:module"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { createInterface } from "node:readline"
import { CHAPTERS } from "./story.mjs"
import { TERMINAL_FONTS, terminalFontSource } from "../../../../qualitylayer/src/ui/agent-window/fonts.ts"

const here = dirname(fileURLToPath(import.meta.url))
const site = resolve(here, "../..")
const repo = resolve(site, "../..")
const args = process.argv.slice(2)
const value = (name, fallback) => {
  const at = args.indexOf(name)
  if (at < 0) return fallback
  const given = args[at + 1]
  if (!given || given.startsWith("--")) throw new Error(name + " needs a value")
  return given
}
if (args.includes("--help")) {
  console.log("npm run demo -- [--from <chapter>] [--theme dark|light] [--size 1440x900] [--dev | --base-url http://127.0.0.1:<port>]")
  console.log("npm run demo:check -- [--only plan,review] [--out <folder>] [--dev]")
  console.log("chapters: " + CHAPTERS.map((chapter) => chapter.id).join(", "))
  process.exit(0)
}
if (args.includes("--script")) {
  // The run sheet: every chapter and what to say at each beat, for rehearsing away from the window.
  for (const [index, chapter] of CHAPTERS.entries()) {
    console.log(`\n${index + 1}. ${chapter.title} — ${chapter.line}`)
    for (const [beat, { note }] of chapter.beats.entries()) console.log(`   ${beat + 1}) ${note}`)
  }
  process.exit(0)
}
const check = args.includes("--check")
const theme = value("--theme", "dark")
if (!["dark", "light"].includes(theme)) throw new Error("--theme is dark or light")
const [width, height] = value("--size", "1440x900").split("x").map(Number)
if (!(width >= 800 && height >= 600)) throw new Error("--size is <width>x<height>, at least 800x600")
const chapterIndex = (id) => {
  const index = CHAPTERS.findIndex((chapter) => chapter.id === id)
  if (index < 0) throw new Error(`Unknown chapter ${id}; chapters: ${CHAPTERS.map((c) => c.id).join(", ")}`)
  return index
}
let base = value("--base-url")
if (base && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(base)) throw new Error("Use a loopback source demo")
base = base?.replace(/\/$/, "")

const require = createRequire(resolve(repo, "qualitylayer/package.json"))
const { chromium } = require("@playwright/test")
const overlay = readFileSync(join(here, "overlay.js"), "utf8")
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const freePort = async () => {
  const listener = createServer()
  await new Promise((done) => listener.listen(0, "127.0.0.1", done))
  const port = listener.address().port
  await new Promise((done) => listener.close(done))
  return port
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
}

/**
 * The demo as the website ships it: built once from the checkout into a private folder and served from
 * there. A page change then loads a few files instead of the dev server's hundreds, and a file another
 * session saves mid-edit cannot reach the stage. The App's terminal fonts come from the checkout, as
 * the dev server serves them.
 */
async function startBuilt() {
  const out = resolve(repo, "qualitylayer/dist/.demo-build")
  const build = spawn("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
    cwd: site,
    stdio: ["ignore", "pipe", "pipe"],
  })
  // The build's notices stay out of the presenter's terminal unless the build fails.
  let log = ""
  build.stdout.on("data", (chunk) => (log += chunk))
  build.stderr.on("data", (chunk) => (log += chunk))
  const code = await new Promise((done) => build.once("exit", done))
  if (code !== 0) throw new Error(`The demo did not build (vite exited ${code}):\n${log.slice(-4000)}`)
  const fonts = new Map(TERMINAL_FONTS.map((font) => [`/terminal-fonts/${font.file}`, resolve(repo, "qualitylayer", terminalFontSource(font))]))
  const server = createHttpServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://demo").pathname)
    let file = fonts.get(path) ?? normalize(join(out, path))
    if (!fonts.has(path) && file !== out && !file.startsWith(out + sep)) {
      response.writeHead(403).end()
      return
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html")
      const body = await readFile(file)
      // Built assets carry their hash in the name; pages are read fresh on every visit.
      const cache = path.startsWith("/assets/") || fonts.has(path) ? "public, max-age=3600" : "no-store"
      response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": cache })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  const port = await freePort()
  await new Promise((done) => server.listen(port, "127.0.0.1", done))
  return { url: `http://127.0.0.1:${port}`, stop: () => new Promise((done) => server.close(done)) }
}

/** The source dev server of the checkout, on a free loopback port. */
async function startServer() {
  const port = await freePort()
  const server = spawn("bun", ["run", "scripts/ui-dev.ts", "--port", String(port)], {
    cwd: resolve(repo, "qualitylayer"),
    // Other sessions edit this checkout: the presentation gets its own dependency cache, and the source as
    // the server first read it, so a file saved mid-edit elsewhere cannot leave a chapter's page empty.
    env: {
      ...process.env,
      QUALITYLAYER_UI_CACHE: resolve(repo, "qualitylayer/dist/.ui-dev-cache-demo"),
      QUALITYLAYER_UI_FROZEN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const url = await new Promise((done, fail) => {
    let text = ""
    const timer = setTimeout(() => fail(new Error("The source demo did not start")), 30000)
    server.stdout.on("data", (chunk) => {
      text += chunk
      const match = text.match(/Source UI: (http:\/\/127\.0\.0\.1:\d+)\/app-demo/)
      if (match) {
        clearTimeout(timer)
        done(match[1])
      }
    })
    server.stderr.on("data", (chunk) => {
      // The browser's benign "ResizeObserver loop" notice is no failure; the terminal stays readable on stage.
      if (!/plugin-react-swc|rolldown|ResizeObserver loop/.test(String(chunk))) process.stderr.write(chunk)
    })
    server.once("exit", (code) => {
      clearTimeout(timer)
      fail(new Error("The source demo exited: " + code))
    })
  })
  const stop = () => {
    server.kill("SIGTERM")
    return new Promise((done) => (server.exitCode !== null ? done() : server.once("exit", done)))
  }
  return { url, stop }
}

/**
 * After a page loads: waits until it has fetched nothing new for `quiet` ms (the images and frames React
 * adds after the load event), at most `limit` ms. Network idle would wait half a second on every page.
 */
const settled = (page, quiet = 150, limit = 2500) =>
  page.evaluate(
    async ({ quiet, limit }) => {
      const count = () => performance.getEntriesByType("resource").length
      const end = Date.now() + limit
      let last = count()
      let since = Date.now()
      while (Date.now() < end) {
        await new Promise((done) => setTimeout(done, 40))
        if (count() !== last) {
          last = count()
          since = Date.now()
        } else if (Date.now() - since >= quiet) return
      }
    },
    { quiet, limit },
  )

/** Everything a page does stays on the source demo: a request elsewhere, or to a real API, is refused. */
async function fence(page, refused) {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    // Every App page the window opens stays in the story's world, also one a link inside it opens.
    const app = url.origin === base && url.pathname.startsWith("/app-demo")
    const plain = !["story", "screen", "tour"].some((name) => url.searchParams.has(name))
    if (app && plain && route.request().isNavigationRequest()) {
      url.searchParams.set("story", "")
      return route.fulfill({ status: 302, headers: { location: url.href } })
    }
    if (url.origin === base && !url.pathname.startsWith("/api/")) return route.continue()
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue()
    refused.push(url.origin + url.pathname)
    return route.abort()
  })
  await page.addInitScript((chosen) => {
    if (window !== window.top) return
    // Every page opens from its address alone, as in the check: the App would otherwise reopen the last
    // task it kept (`qualitylayer-route`) on Home's plain `#/`, with the previous chapter's state.
    localStorage.clear()
    localStorage.setItem("qualitylayer-theme", chosen)
    localStorage.setItem("qualitylayer-nav", "true")
  }, theme)
  await page.addInitScript(overlay)
}

/**
 * The page on screen now, kept for the next page to show until it is ready: the overlay lays it over
 * the new page and dissolves it, so a page change reads as one crossfade instead of a cut to black.
 */
async function carryScreen(page) {
  if (!page.url().startsWith(base)) return false
  // The ring leaves at once, not with its fade, so the kept picture never carries it to the next page.
  await page.evaluate(() => window.__demo?.unspot(true)).catch(() => {})
  const shot = await page.screenshot({ type: "jpeg", quality: 82 }).catch(() => null)
  if (!shot) return false
  const src = `data:image/jpeg;base64,${shot.toString("base64")}`
  return page
    .evaluate((image) => {
      sessionStorage.setItem("demo-carry", image)
      return true
    }, src)
    .catch(() => false)
}

/**
 * What a beat can do. `fast` skips the motion, for checks and for replaying up to a beat; `carry`
 * crossfades from the previous page (the live window does; the check has no audience); `hold` keeps
 * that previous page on screen through every page change until `reveal()`.
 */
let loads = 0

function director(page, fast, { carry = !fast, hold = false } = {}) {
  const pause = (ms) => (fast ? Promise.resolve() : sleep(ms))
  // Where an element is on screen. An artifact page is a scaled frame, whose elements Playwright
  // measures unscaled: their place is the frame's box plus their own place times the frame's scale.
  const center = async (locator) => {
    await locator.waitFor({ state: "visible", timeout: 8000 })
    await locator.evaluate((element) => element.scrollIntoView({ block: "nearest", behavior: "instant" }))
    const handle = await locator.elementHandle()
    const inner = await handle.evaluate((element) => {
      const r = element.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    const frame = await (await handle.ownerFrame())?.frameElement().catch(() => null)
    if (!frame) return inner
    const box = await frame.boundingBox()
    const width = await frame.evaluate((element) => element.clientWidth || 1)
    if (!box) throw new Error("The frame has no box on screen")
    const scale = box.width / width
    return { x: box.x + inner.x * scale, y: box.y + inner.y * scale }
  }
  const point = async (at) => {
    await page.evaluate(({ x, y, ms }) => window.__demo?.cursor(x, y, ms), { ...at, ms: fast ? 0 : 520 })
    await page.mouse.move(at.x, at.y, { steps: fast ? 1 : 12 })
    await pause(560)
  }
  const d = {
    page,
    /** Opens another page; with `keep`, the previous one stays over it until `reveal()`. */
    // A replay under `hold` carries a picture of the held picture, so the first page stays throughout.
    async go(query, { keep = hold } = {}) {
      const carried = carry && (await carryScreen(page))
      if (!carried) {
        await page.evaluate(() => window.__demo?.hide()).catch(() => {})
        await pause(300)
      }
      // Each page is a new document: an address that differs only after `#` would otherwise keep the
      // old page, its open dialogs and its ring on screen.
      const fresh = query.replace(/^\?/, `?demo=${++loads}&`)
      await page.goto(`${base}/app-demo/${fresh}`, { waitUntil: "load" })
      // A dev server that is recompiling (another session saved a file) can leave the first load empty:
      // the page is opened once more before the beat gives up.
      const shown = () => page.locator("#root > *").first().waitFor({ state: "visible", timeout: 15000 })
      await shown().catch(async () => {
        await page.goto(`${base}/app-demo/${query.replace(/^\?/, `?demo=${++loads}&`)}`, { waitUntil: "load" })
        await shown()
      })
      await page.evaluate(() => document.fonts.ready)
      await settled(page)
      await pause(250)
      if (!keep) await d.reveal()
    },
    reveal: () => page.evaluate(() => window.__demo?.reveal()),
    async hover(locator) {
      const at = await center(locator)
      await point(at)
      return at
    },
    async click(locator) {
      const at = await d.hover(locator)
      await page.evaluate(({ x, y }) => window.__demo?.ring(x, y), at)
      await locator.click({ timeout: 8000 })
      await pause(450)
    },
    /** A plain mouse click on the element's spot (a feedback pin), measured once scrolling stops. */
    async clickSpot(locator) {
      await center(locator)
      await sleep(350)
      const at = await center(locator)
      await point(at)
      await page.evaluate(({ x, y }) => window.__demo?.ring(x, y), at)
      await page.mouse.click(at.x, at.y)
      await pause(450)
    },
    async type(locator, text) {
      await d.click(locator)
      if (fast) await locator.fill(text)
      else {
        // A field the App filled in (a suggested branch name) is replaced, as a person selects it and types.
        if ((await locator.inputValue()) !== "") await locator.selectText()
        await locator.pressSequentially(text, { delay: 26 })
      }
      // A key lost while the field re-renders would show as a typo on stage: the field ends with the text.
      if ((await locator.inputValue()) !== text) await locator.fill(text)
      await pause(300)
    },
    async focus(locator) {
      await locator.waitFor({ state: "visible", timeout: 8000 })
      await locator.evaluate((element, smooth) => {
        const tall = element.getBoundingClientRect().height > window.innerHeight * 0.8
        element.scrollIntoView({ block: tall ? "start" : "center", behavior: smooth ? "smooth" : "instant" })
        window.__demo?.spot(element)
      }, !fast)
      await pause(500)
    },
    unspot: () => page.evaluate(() => window.__demo?.unspot()),
    wait: pause,
  }
  return d
}

/** Runs one beat; a failure is reported and the presenter can go on. */
async function play(d, chapter, beatIndex) {
  const beat = chapter.beats[beatIndex]
  await d.page.evaluate(() => {
    window.__demo?.unspot()
    window.__demo?.begin()
  })
  try {
    await beat.act(d)
    return null
  } catch (error) {
    await d.page.evaluate(() => window.__demo?.miss()).catch(() => {})
    return error instanceof Error ? error.message.split("\n")[0] : String(error)
  } finally {
    await d.page.evaluate(() => window.__demo?.end()).catch(() => {})
  }
}

/** What a chapter's page shows that must never reach the stage; one line per problem. */
async function pageProblems(page, chapter, refused) {
  const problems = []
  const words = await page.locator("body").innerText()
  const internal = /beta[. -]?\d|(?<!Claude )\bMax\b|Ritter|undefined|NaN/.exec(words)
  if (internal)
    problems.push(`${chapter.id}: internal text "${words.slice(Math.max(0, internal.index - 40), internal.index + 60)}"`)
  if (refused.length) problems.push(`${chapter.id}: requests outside the demo ${[...new Set(refused)].join(", ")}`)
  return problems
}

/** One chapter without a window: every beat, a picture after each. Returns how many problems it had. */
async function checkChapter(browser, index, chapter, out) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    reducedMotion: "no-preference",
  })
  const page = await context.newPage()
  const refused = []
  page.on("pageerror", (error) => console.log(`warn ${chapter.id}: page error ${error.message}`))
  await fence(page, refused)
  const d = director(page, true)
  await d.go(chapter.url)
  let failed = 0
  for (const [beatIndex] of chapter.beats.entries()) {
    const problem = await play(d, chapter, beatIndex)
    await sleep(350)
    const name = `${String(index + 1).padStart(2, "0")}-${chapter.id}-${beatIndex + 1}.png`
    await page.screenshot({ path: join(out, name) })
    if (problem) failed++
    console.log(`${problem ? "FAIL" : "ok  "} ${name}${problem ? "  " + problem : ""}`)
  }
  const problems = await pageProblems(page, chapter, refused)
  for (const problem of problems) console.log(`FAIL ${problem}`)
  await context.close()
  return failed + problems.length
}

async function runCheck(browser) {
  const only = value("--only")?.split(",")
  const out = resolve(value("--out", join(tmpdir(), "qualitylayer-demo-check")))
  await mkdir(out, { recursive: true })
  let failed = 0
  for (const [index, chapter] of CHAPTERS.entries())
    if (!only || only.includes(chapter.id)) failed += await checkChapter(browser, index, chapter, out)
  console.log(`${failed ? failed + " problem(s)" : "All beats ran"}; pictures in ${out}`)
  return failed
}

/** Commands from the window's keys and this terminal, taken one at a time. */
function commandQueue() {
  const commands = []
  let wake = () => {}
  const send = (command) => {
    commands.push(command)
    wake()
  }
  const next = () =>
    commands.length
      ? Promise.resolve(commands.shift())
      : new Promise((done) => {
          wake = () => {
            wake = () => {}
            done(commands.shift())
          }
        })
  return { send, next }
}

const TERMINAL_KEYS = { "": "next", b: "back", r: "restart", q: "quit", l: "list" }

/** This terminal's lines as commands: Enter, b, r, q, l, or a chapter's number or id. */
function readTerminal(send) {
  const terminal = createInterface({ input: process.stdin })
  terminal.on("line", (line) => {
    const text = line.trim()
    if (text in TERMINAL_KEYS) send(TERMINAL_KEYS[text])
    else if (/^\d+$/.test(text)) send(`chapter:${Number(text) - 1}`)
    else if (CHAPTERS.some((chapter) => chapter.id === text)) send(`chapter:${chapterIndex(text)}`)
    else console.log("Enter next · b back · r restart chapter · <number> or <chapter> jump · l list · q quit")
  })
  return terminal
}

const listChapters = () =>
  CHAPTERS.forEach((chapter, index) =>
    console.log(`  ${String(index + 1).padStart(2)}  ${chapter.title.padEnd(20)} ${chapter.beats.length} beats  (${chapter.id})`),
  )

/** Where a command moves the demo from `at`: the new place, or null when it stays where it is. */
function moved(at, command) {
  const beats = (chapter) => CHAPTERS[chapter].beats.length
  const start = (chapter) => (CHAPTERS[chapter] ? { chapter, beat: 0 } : null)
  if (command === "next")
    return at.beat + 1 < beats(at.chapter) ? { chapter: at.chapter, beat: at.beat + 1 } : start(at.chapter + 1)
  if (command === "back") {
    if (at.beat > 0) return { chapter: at.chapter, beat: at.beat - 1 }
    return at.chapter > 0 ? { chapter: at.chapter - 1, beat: beats(at.chapter - 1) - 1 } : null
  }
  const jumps = { restart: at.chapter, "chapter-next": at.chapter + 1, "chapter-back": at.chapter - 1 }
  if (command in jumps) return start(jumps[command])
  return start(command.startsWith("chapter:") ? Number(command.slice(8)) : -1)
}

/** The presentation window: Chrome as an app window, sandboxed, without the automation banner. */
async function openWindow() {
  const profile = await mkdtemp(join(tmpdir(), "qualitylayer-demo-"))
  const context = await chromium.launchPersistentContext(profile, {
    // `--headless` drives the live loop without a window, to test it from this terminal.
    headless: args.includes("--headless"),
    // Chrome's own sandbox, as in everyday use: without it Chrome warns about `--no-sandbox` on screen.
    chromiumSandbox: true,
    viewport: null,
    colorScheme: theme,
    // The App follows the Mac's Reduce motion setting; the stage always plays its full motion.
    reducedMotion: "no-preference",
    ignoreDefaultArgs: ["--enable-automation"],
    args: [`--app=data:text/html,<title>QualityLayer</title><body style="background:#000">`, `--window-size=${width},${height}`, "--window-position=40,40"],
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  })
  return { profile, context, page: context.pages()[0] ?? (await context.newPage()) }
}

/** Plays a beat in the window; a chapter's first beat opens its page and shows its title. The beat's problem, if any. */
async function showBeat(page, { chapter, beat }) {
  const current = CHAPTERS[chapter]
  const d = director(page, false)
  if (beat === 0) {
    await d.go(current.url)
    await page.evaluate(({ title, line }) => window.__demo?.chip(title, line), {
      title: `${chapter + 1} · ${current.title}`,
      line: current.line,
    })
  }
  return play(d, current, beat)
}

/** The run sheet's lines for a beat just shown: what to say, and what comes next. */
function reportBeat({ chapter, beat }, problem) {
  const current = CHAPTERS[chapter]
  const following = current.beats[beat + 1] ?? CHAPTERS[chapter + 1]?.beats[0]
  console.log(`\n[${chapter + 1}/${CHAPTERS.length} ${current.title} · ${beat + 1}/${current.beats.length}] ${current.beats[beat].note}`)
  if (problem) console.log(`  ! this beat did not run: ${problem}. Press next: it opens the page fresh.`)
  console.log(following ? `  next: ${following.note}` : "  That was the last beat.")
}

/**
 * Shows a beat so the demo always moves on. A page the presenter changed (`rebuild`), or a beat that
 * fails, is opened fresh with the chapter's earlier beats replayed, then the beat plays once more.
 * True when the page is the story's page again; false sends the next step through a fresh page too.
 */
async function step(page, at, rebuild) {
  if (rebuild && at.beat > 0) await arrive(page, at)
  let problem = await showBeat(page, at)
  if (problem) {
    if (at.beat > 0) await arrive(page, at)
    problem = await showBeat(page, at)
  }
  reportBeat(at, problem)
  return !problem
}

/** Arrives at a beat in the middle of a chapter: opens it and replays the earlier beats without motion. */
async function arrive(page, { chapter, beat }) {
  // The page it leaves stays on screen while the earlier beats replay, then dissolves into the result.
  const d = director(page, true, { carry: true, hold: true })
  await d.go(CHAPTERS[chapter].url)
  for (let index = 0; index < beat; index++) await play(d, CHAPTERS[chapter], index)
  await d.reveal()
}

async function runLive() {
  const { profile, context, page } = await openWindow()
  const refused = []
  await fence(page, refused)
  const { send, next } = commandQueue()
  await page.exposeBinding("__demoCommand", (_source, command) => send(command))
  // The presenter's own clicks, keys and page changes between beats: the next beat starts on a fresh page.
  let playing = false
  let changed = false
  await page.exposeBinding("__demoTouched", () => {
    if (!playing) changed = true
  })
  page.on("framenavigated", (frame) => {
    if (!playing && frame === page.mainFrame()) changed = true
  })
  page.on("close", () => send("quit"))
  const terminal = readTerminal(send)
  console.log(
    "\nQualityLayer live demo. In the window: ⌥→ next, ⌥← back, ⌥↓ next chapter, ⌥↑ previous chapter, ⌥R chapter again." +
      "\nHere: Enter, b, r, a number or chapter id, l, q.\n",
  )
  listChapters()

  // A page that does not open is reported, never the end of the presentation: the next step opens it fresh.
  const shown = async (rebuild) => {
    playing = true
    try {
      // No step holds the keys for long: one that hangs is given up, and the next opens fresh.
      const stuck = new Promise((_, fail) =>
        setTimeout(() => fail(new Error("the step took longer than a minute")), 60_000).unref(),
      )
      changed = !(await Promise.race([step(page, at, rebuild), stuck]))
    } catch (error) {
      changed = true
      console.log(`  ! the page did not open: ${String(error?.message ?? error).split("\n")[0].replace(/\.+$/, "")}. Press next or r: it opens fresh.`)
    } finally {
      playing = false
    }
  }
  page.on("pageerror", (error) => console.log(`  ! page error: ${error.message.split("\n")[0]}`))
  let at = { chapter: chapterIndex(value("--from", CHAPTERS[0].id)), beat: 0 }
  await shown(false)
  for (let command = await next(); command !== "quit"; command = await next()) {
    if (command === "list") {
      listChapters()
      continue
    }
    const to = moved(at, command)
    if (!to) continue
    at = to
    // "next" plays on from the page as it is, unless the presenter changed it; any other move rebuilds.
    await shown(command !== "next" || changed)
  }
  terminal.close()
  if (refused.length) console.log("Requests outside the demo were refused: " + [...new Set(refused)].join(", "))
  await context.close().catch(() => {})
  await rm(profile, { recursive: true, force: true })
}

/** Whether one chapter's page opens: the App shows, and nothing on the page throws (a half-edited file). */
async function opens(page, chapter, timeout) {
  let error = ""
  const thrown = new Promise((done) =>
    page.on("pageerror", (cause) => {
      error ||= cause.message.split("\n")[0]
      done(false)
    }),
  )
  const opened = await page
    .goto(`${base}/app-demo/${chapter.url}`, { waitUntil: "load" })
    .then(() => Promise.race([page.locator("#root > *").first().waitFor({ state: "visible", timeout }).then(() => !error), thrown]))
    .catch(() => false)
  return opened ? null : `  ! ${chapter.title} does not open${error ? `: ${error}` : ""}`
}

/**
 * Loads every chapter once before the window opens: a chapter whose page does not open is named now,
 * not on stage, and with --dev the server compiles what the live window asks for. The first page waits
 * for that compile. Each page closes before the next opens, keeping one App instance in memory.
 */
async function preflight(browser) {
  const problems = []
  for (const [index, chapter] of CHAPTERS.entries()) {
    const page = await browser.newPage()
    try {
      const problem = await opens(page, chapter, index === 0 ? 20000 : 8000)
      if (problem) problems.push(problem)
    } finally {
      await page.close()
    }
  }
  return problems
}

let server
let browser
try {
  if (!base) {
    const dev = args.includes("--dev")
    console.log(dev ? "Starting the source App demo…" : "Building the App demo…")
    server = dev ? await startServer() : await startBuilt()
    base = server.url
  }
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
  if (check) process.exitCode = (await runCheck(browser)) ? 1 : 0
  else {
    const broken = await preflight(browser)
    console.log(broken.length ? broken.join("\n") + "\nFix the checkout, or present anyway and skip those chapters." : `All ${CHAPTERS.length} chapter pages open.`)
    await browser.close()
    browser = undefined
    await runLive()
  }
} finally {
  await browser?.close()
  await server?.stop()
}
