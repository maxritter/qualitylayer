// The guided web demo: plays the presenter's storyboard (scripts/demo/story.mjs) in the visitor's browser,
// one beat per Next, with the drawn cursor and ring of scripts/demo/overlay.js. Short shows about a third
// of the beats, Full all of them, as on stage. The beats in between run without motion behind a veil, so
// every shown beat finds the page it expects.
//
// A beat that opens another page reloads this one, which ends the script: the run in progress is kept in
// sessionStorage first (`demo-guide-run`) and picked up after the reload, skipping the part of the beat
// that already happened.

import "../../scripts/demo/overlay.js"
import { CHAPTERS } from "../../scripts/demo/story.mjs"
import "./guide.css"
import { type Locator, centerOf, page, replay, sleep } from "./locator.ts"

type Mode = "short" | "full"
type Beat = { note: string; webNote?: string; short?: boolean; act: (d: Director) => Promise<unknown> | unknown; web?: (d: Director) => Promise<unknown> | unknown }
type Chapter = { id: string; title: string; line: string; url: string; beats: Beat[] }
type Place = { chapter: number; beat: number }
/** A run toward one shown beat: beats `at`…`to` of `chapter` (`at` -1 opens the chapter's page first). */
type Run = Place & { at: number; to: number; gos: number; retried: boolean }
type State = { mode: Mode; at: Place | null; closed: boolean }
type Director = ReturnType<typeof director>

const chapters = CHAPTERS as unknown as Chapter[]
const STATE = "demo-guide"
const RUN = "demo-guide-run"

type DemoOverlay = {
  cursor(x: number, y: number, ms: number): void
  ring(x: number, y: number): void
  spot(element: Element): void
  unspot(instant?: boolean): void
  begin(): void
  end(): void
  hide(): void
  show(): void
  reveal(): void
}
const overlay = () => (window as unknown as { __demo?: DemoOverlay }).__demo

/** The App's theme as it draws: its stored choice, or the system's when it follows the system. */
function dark(): boolean {
  const chosen = localStorage.getItem("qualitylayer-theme")
  return chosen === "dark" || (chosen !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
}

function read<T>(key: string, fallback: T): T {
  try {
    const value = sessionStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Without sessionStorage a beat that changes pages starts its chapter again; the guide still plays.
  }
}

let state: State = read<State>(STATE, { mode: "short", at: null, closed: false })
const save = () => write(STATE, state)

/** The beats a mode shows, in order. */
function shown(mode: Mode): Place[] {
  return chapters.flatMap((chapter, c) =>
    chapter.beats.flatMap((beat, b) => (mode === "full" || beat.short ? [{ chapter: c, beat: b }] : [])),
  )
}
const before = (a: Place, b: Place) => a.chapter < b.chapter || (a.chapter === b.chapter && a.beat < b.beat)

// ── The page behind the veil ─────────────────────────────────────────────────────────────────────

let hidden = true
function hidePage() {
  if (hidden) return
  hidden = true
  overlay()?.unspot(true)
  overlay()?.hide()
  panel.waiting(true)
}
function showPage() {
  if (!hidden) return
  hidden = false
  overlay()?.reveal()
  panel.waiting(false)
}

// ── The director: what a beat can do, as present.mjs's director does it on stage ────────────────

let run: Run | null = null
let gos = 0

function director(fast: boolean) {
  const pause = (ms: number) => (fast ? Promise.resolve() : sleep(ms))
  const point = async (at: { x: number; y: number }) => {
    if (fast) return
    showPage()
    overlay()?.cursor(at.x, at.y, 520)
    await sleep(560)
  }
  const d = {
    page,
    async go(query: string, _options?: { keep?: boolean }) {
      gos++
      if (replay.skipping) {
        // This page is that page change's result: the beat goes on from here.
        if (gos >= (run?.gos ?? 0)) replay.skipping = false
        return
      }
      if (run) write(RUN, { ...run, gos })
      hidePage()
      await sleep(380)
      location.assign(`${location.pathname}${query.replace(/^\?/, `?guide&demo=${Date.now() % 1e6}&`)}`)
      // The reload ends this script; the run goes on in the next page.
      await new Promise(() => {})
    },
    reveal: async () => {
      if (!fast) showPage()
    },
    async hover(locator: Locator) {
      if (replay.skipping) return { x: 0, y: 0 }
      const at = centerOf(await locator.element())
      await point(at)
      await locator.hover()
      return at
    },
    async click(locator: Locator) {
      if (replay.skipping) return
      const at = await d.hover(locator)
      if (!fast) overlay()?.ring(at.x, at.y)
      await locator.click()
      await pause(450)
    },
    /** A spot inside an artifact's frame: the guide cannot click into it, so it points and leaves it to the visitor. */
    async clickSpot(locator: Locator) {
      await d.click(locator)
    },
    async type(locator: Locator, text: string) {
      if (replay.skipping) return
      await d.click(locator)
      if (fast) await locator.fill(text)
      else {
        if ((await locator.inputValue()) !== "") await locator.selectText()
        await locator.pressSequentially(text, { delay: 26 })
      }
      if ((await locator.inputValue()) !== text) await locator.fill(text)
      await pause(300)
    },
    async focus(locator: Locator) {
      if (replay.skipping) return
      const element = await locator.element()
      if (fast) return
      showPage()
      const tall = element.getBoundingClientRect().height > window.innerHeight * 0.8
      element.scrollIntoView({ block: tall ? "start" : "center", behavior: "smooth" })
      await sleep(350)
      overlay()?.spot(element)
      panel.avoid(element)
      await sleep(150)
    },
    unspot: async () => overlay()?.unspot(),
    wait: pause,
  }
  return d
}

// ── The runner ───────────────────────────────────────────────────────────────────────────────────

/** Plays a run to its shown beat; reports a beat that did not play. */
async function drive(start: Run) {
  run = start
  const chapter = chapters[run.chapter]
  const target = chapter.beats[run.to]
  panel.beat(run.chapter, run.to)
  panel.busy(true)
  let problem: string | null = null
  try {
    replay.skipping = run.gos > 0
    gos = 0
    if (run.at === -1) {
      write(RUN, run)
      await director(true).go(chapter.url)
      run = { ...run, at: 0, gos: 0 }
    }
    for (let index = run.at; index <= run.to; index++) {
      run = { ...run, at: index }
      write(RUN, run)
      const beat = chapter.beats[index]
      const fast = index !== run.to
      const d = director(fast)
      overlay()?.unspot()
      if (!fast) overlay()?.begin()
      try {
        await (beat.web ?? beat.act)(d)
      } catch (error) {
        // A beat that fails on the way usually means the visitor changed the page: start the chapter over once.
        if (!run.retried) {
          replay.skipping = false
          write(RUN, null)
          // Awaited, so this run's `finally` does not clear the retry's saved state while its page reloads.
          return await drive({ ...run, at: -1, gos: 0, retried: true })
        }
        if (!fast) problem = error instanceof Error ? error.message : String(error)
        console.warn(`[guide] ${chapter.id} beat ${index + 1} did not play:`, error)
      } finally {
        overlay()?.end()
      }
      replay.skipping = false
      gos = 0
      run = { ...run, gos: 0 }
    }
  } finally {
    write(RUN, null)
    run = null
    showPage()
  }
  state = { ...state, at: { chapter: start.chapter, beat: start.to } }
  save()
  panel.busy(false)
  panel.beat(start.chapter, start.to, problem ?? undefined)
  void target
}

/** The run that reaches `to` from where the guide is: on from this page within a chapter, else from its start. */
function runTo(to: Place, from: Place | null, onward: boolean): Run {
  const same = onward && from !== null && from.chapter === to.chapter && from.beat < to.beat
  return { chapter: to.chapter, beat: to.beat, at: same ? from.beat + 1 : -1, to: to.beat, gos: 0, retried: !same }
}

let moving = false
async function move(command: string) {
  if (moving || run) return
  moving = true
  try {
    const list = shown(state.mode)
    const at = state.at
    if (command === "next") {
      const to = at === null ? list[0] : list.find((place) => before(at, place))
      if (!to) return panel.end()
      await drive(runTo(to, at, true))
    } else if (command === "back") {
      const earlier = at === null ? [] : list.filter((place) => before(place, at))
      const to = earlier.at(-1)
      if (!to) return panel.welcome()
      await drive(runTo(to, at, false))
    } else if (command === "chapter-next" || command === "chapter-back" || command === "restart") {
      const current = at?.chapter ?? -1
      const wanted = command === "chapter-next" ? current + 1 : command === "chapter-back" ? current - 1 : current
      const to = list.find((place) => place.chapter >= Math.max(wanted, 0))
      if (to) await drive(runTo(to, at, false))
    } else if (command.startsWith("chapter:")) {
      const to = list.find((place) => place.chapter === Number(command.slice(8)))
      if (to) await drive(runTo(to, at, false))
    } else if (command === "again") {
      state = { ...state, at: null }
      save()
      const first = list[0]
      if (first) await drive(runTo(first, null, false))
    }
  } finally {
    moving = false
  }
}

// ── The panel ────────────────────────────────────────────────────────────────────────────────────

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const panel = (() => {
  const root = el("aside", "gd")
  root.setAttribute("aria-label", "Guided demo")
  const head = el("div", "gd-head")
  const title = el("p", "gd-title")
  const modes = el("div", "gd-modes")
  modes.setAttribute("role", "radiogroup")
  modes.setAttribute("aria-label", "Tour length")
  const modeButtons = (["short", "full"] as const).map((mode) => {
    const button = el("button", "gd-mode")
    // Each length leads with its icon: a bolt for the main moments, a list for every step.
    const icon =
      mode === "short"
        ? `<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>`
        : `<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>`
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`
    button.append(mode === "short" ? "Short" : "Full")
    button.type = "button"
    button.setAttribute("role", "radio")
    button.title = mode === "short" ? "The main moments, about 5 minutes" : "Every step and menu, about 15 minutes"
    button.addEventListener("click", () => {
      state = { ...state, mode }
      save()
      paintModes()
      refresh()
    })
    return button
  })
  modes.append(...modeButtons)
  const close = el("button", "gd-icon")
  close.type = "button"
  close.setAttribute("aria-label", "Hide the guide")
  close.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>`
  head.append(title, modes, close)
  const note = el("p", "gd-note")
  note.setAttribute("aria-live", "polite")
  const problem = el("p", "gd-problem")
  const foot = el("div", "gd-foot")
  const bar = el("div", "gd-bar")
  const fill = el("div", "gd-fill")
  bar.append(fill)
  const count = el("span", "gd-count")
  const jump = el("select", "gd-jump")
  jump.setAttribute("aria-label", "Go to a chapter")
  const back = el("button", "gd-button", "Back")
  back.type = "button"
  const next = el("button", "gd-button gd-primary", "Next")
  next.type = "button"
  foot.append(count, jump, back, next)
  root.append(head, note, problem, bar, foot)
  const pill = el("button", "gd-pill", "Show the guide")
  pill.type = "button"

  const paintModes = () =>
    modeButtons.forEach((button, i) => button.setAttribute("aria-checked", String((i === 0) === (state.mode === "short"))))
  const paintJump = () => {
    const list = shown(state.mode)
    jump.replaceChildren(
      ...chapters.flatMap((chapter, c) => {
        if (!list.some((place) => place.chapter === c)) return []
        const option = el("option", "", `${c + 1} · ${chapter.title}`)
        option.value = String(c)
        return [option]
      }),
    )
    const placeholder = el("option", "", "Chapters")
    placeholder.value = ""
    placeholder.disabled = true
    jump.prepend(placeholder)
    jump.value = state.at === null ? "" : String(state.at.chapter)
  }
  const paintCount = () => {
    const list = shown(state.mode)
    const at = state.at
    const done = at === null ? 0 : list.filter((place) => !before(at, place)).length
    count.textContent = at === null ? `${list.length} steps` : `${done} of ${list.length}`
    fill.style.width = `${(done / Math.max(list.length, 1)) * 100}%`
  }
  const refresh = () => {
    paintJump()
    paintCount()
  }

  close.addEventListener("click", () => {
    state = { ...state, closed: true }
    save()
    root.hidden = true
    pill.hidden = false
  })
  pill.addEventListener("click", () => {
    state = { ...state, closed: false }
    save()
    root.hidden = false
    pill.hidden = true
  })
  back.addEventListener("click", () => void move("back"))
  next.addEventListener("click", () => void move(next.dataset.again ? "again" : "next"))
  jump.addEventListener("change", () => {
    if (jump.value !== "") void move(`chapter:${jump.value}`)
  })

  return {
    mount() {
      const theme = dark() ? "dark" : "light"
      root.dataset.theme = theme
      pill.dataset.theme = theme
      document.body.append(root, pill)
      root.hidden = state.closed
      pill.hidden = !state.closed
      paintModes()
      refresh()
    },
    welcome() {
      state = { ...state, at: null }
      save()
      title.innerHTML = "<b>Guided tour</b> <span>Usage-based billing, start to finish</span>"
      note.textContent =
        "One task from request to merged pull request in the QualityLayer App. It runs in your browser with example data: no account, no agent, nothing sent anywhere."
      problem.hidden = true
      next.textContent = "Start"
      delete next.dataset.again
      back.disabled = true
      modes.hidden = false
      refresh()
    },
    beat(chapter: number, beat: number, trouble?: string) {
      const current = chapters[chapter]
      const step = current.beats[beat]
      title.innerHTML = ""
      const strong = el("b", "", `${chapter + 1} · ${current.title}`)
      title.append(strong, " ", el("span", "", current.line))
      note.textContent = step.webNote ?? step.note
      problem.hidden = trouble === undefined
      problem.textContent = "This step did not play in your browser. Next goes on."
      next.textContent = "Next"
      delete next.dataset.again
      back.disabled = false
      refresh()
    },
    end() {
      title.innerHTML = "<b>That's the tour</b>"
      note.textContent =
        "Look around on your own: every page of the App works here with the same example data. Or install QualityLayer and run it on your own project."
      problem.hidden = true
      next.textContent = "Start again"
      next.dataset.again = "true"
      refresh()
    },
    busy(on: boolean) {
      root.toggleAttribute("data-busy", on)
      next.disabled = on
      back.disabled = on || state.at === null
      jump.disabled = on
    },
    waiting(on: boolean) {
      root.toggleAttribute("data-waiting", on)
    },
    /** Out of the way of what the ring frames: above it when it sits low on the screen. */
    avoid(element: Element) {
      const r = element.getBoundingClientRect()
      const low = r.top + r.height / 2 > window.innerHeight * 0.55
      root.dataset.edge = low ? "top" : "bottom"
    },
  }
})()

function keys() {
  // The presenter's keys from overlay.js (⌥→ ⌥← ⌥↓ ⌥↑ ⌥R, Page Down/Up), and → ← when nothing has the focus.
  ;(window as unknown as { __demoCommand?: (command: string) => void }).__demoCommand = (command) => void move(command)
  window.addEventListener("keydown", (event) => {
    const idle = document.activeElement === document.body || document.activeElement?.closest(".gd") !== null
    if (!idle || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
    if (event.key === "ArrowRight") void move("next")
    else if (event.key === "ArrowLeft") void move("back")
    else return
    event.preventDefault()
  })
}

export async function startGuide() {
  const veil = document.getElementById("demo-veil")
  if (veil) {
    // The veil takes the App's own background, and lets the guide's panel stay above it.
    veil.style.background = dark() ? "#0a0a0a" : "#fff"
    veil.style.zIndex = "2147483644"
  }
  panel.mount()
  keys()
  const pending = read<Run | null>(RUN, null)
  // A run that changed pages goes on here: Next waits for it, also while the App is still drawing.
  if (pending) {
    panel.beat(pending.chapter, pending.to)
    panel.busy(true)
  }
  // The App draws itself before a beat looks for anything on it.
  await page.locator("#root > *").first().waitFor({ timeout: 15000 }).catch(() => {})
  await document.fonts?.ready
  if (pending) return drive(pending)
  showPage()
  if (state.at === null) panel.welcome()
  else panel.beat(state.at.chapter, state.at.beat)
  panel.busy(false)
}
