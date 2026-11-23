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
import { page, replay, sleep } from "./locator.ts"
import { createDirector, overlay, type Director } from "./director.ts"
import { createPanel, type GuideState } from "./panel.ts"
import { isBefore, isDarkTheme, readStorage, resolveMove, shownBeats, writeStorage, type Run } from "./navigation.ts"

type Beat = { note: string; webNote?: string; short?: boolean; act: (d: Director) => Promise<unknown> | unknown; web?: (d: Director) => Promise<unknown> | unknown }
type Chapter = { id: string; title: string; line: string; url: string; beats: Beat[] }

const chapters = CHAPTERS as unknown as Chapter[]
const STATE = "demo-guide"
const RUN = "demo-guide-run"

let state: GuideState = readStorage<GuideState>(STATE, { mode: "short", at: null, closed: false })
const save = () => writeStorage(STATE, state)

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

let run: Run | null = null
let gos = 0

async function navigatePage(query: string) {
  gos++
  if (replay.skipping) {
    if (gos >= (run?.gos ?? 0)) replay.skipping = false
    return
  }
  if (run) writeStorage(RUN, { ...run, gos })
  hidePage()
  await sleep(380)
  location.assign(`${location.pathname}${query.replace(/^\?/, `?guide&demo=${Date.now() % 1e6}&`)}`)
  await new Promise(() => {})
}

function makeDirector(fast: boolean) {
  return createDirector({
    fast,
    onNavigate: navigatePage,
    showPage,
    avoidElement: (element) => panel.avoid(element),
  })
}

async function runBeat(chapter: Chapter, index: number, fast: boolean): Promise<{ retry?: true; problem?: string }> {
  const beat = chapter.beats[index]
  overlay()?.unspot()
  if (!fast) overlay()?.begin()
  try {
    await (beat.web ?? beat.act)(makeDirector(fast))
    return {}
  } catch (error) {
    if (run && !run.retried) return { retry: true }
    console.warn(`[guide] ${chapter.id} beat ${index + 1} did not play:`, error)
    return fast ? {} : { problem: error instanceof Error ? error.message : String(error) }
  } finally {
    overlay()?.end()
  }
}

/** Plays a run to its shown beat; reports a beat that did not play. */
async function drive(start: Run): Promise<void> {
  run = start
  const chapter = chapters[run.chapter]
  panel.beat(run.chapter, run.to)
  panel.busy(true)
  let problem: string | null = null
  try {
    replay.skipping = run.gos > 0
    gos = 0
    if (run.at === -1) {
      writeStorage(RUN, run)
      await makeDirector(true).go(chapter.url)
      run = { ...run, at: 0, gos: 0 }
    }
    for (let index = run.at; index <= run.to; index++) {
      run = { ...run, at: index }
      writeStorage(RUN, run)
      const outcome = await runBeat(chapter, index, index !== run.to)
      if (outcome.retry) {
        replay.skipping = false
        writeStorage(RUN, null)
        return await drive({ ...run, at: -1, gos: 0, retried: true })
      }
      if (outcome.problem) problem = outcome.problem
      replay.skipping = false
      gos = 0
      run = { ...run, gos: 0 }
    }
  } finally {
    writeStorage(RUN, null)
    run = null
    showPage()
  }
  state = { ...state, at: { chapter: start.chapter, beat: start.to } }
  save()
  panel.busy(false)
  panel.beat(start.chapter, start.to, problem ?? undefined)
}

let moving = false
async function move(command: string) {
  if (moving || run) return
  moving = true
  try {
    const outcome = resolveMove(command, shownBeats(chapters, state.mode), state.at)
    if (outcome.kind === "end") panel.end()
    else if (outcome.kind === "welcome") panel.welcome()
    else if (outcome.kind === "drive") {
      if (outcome.reset) { state = { ...state, at: null }; save() }
      await drive(outcome.run)
    }
  } finally {
    moving = false
  }
}

const panel = createPanel({
  chapters,
  getState: () => state,
  setState: (patch) => { state = { ...state, ...patch }; save() },
  shown: (mode) => shownBeats(chapters, mode),
  before: isBefore,
  isDark: isDarkTheme,
  move: (command) => void move(command),
})

function hasModifier(event: KeyboardEvent): boolean {
  return event.altKey || event.metaKey || event.ctrlKey || event.shiftKey
}

function keys() {
  ;(window as unknown as { __demoCommand?: (command: string) => void }).__demoCommand = (command) => void move(command)
  window.addEventListener("keydown", (event) => {
    const idle = document.activeElement === document.body || document.activeElement?.closest(".gd") !== null
    if (!idle || hasModifier(event)) return
    if (event.key === "ArrowRight") void move("next")
    else if (event.key === "ArrowLeft") void move("back")
    else return
    event.preventDefault()
  })
}

export async function startGuide() {
  const veil = document.getElementById("demo-veil")
  if (veil) {
    veil.style.background = isDarkTheme() ? "#0a0a0a" : "#fff"
    veil.style.zIndex = "2147483644"
  }
  panel.mount()
  keys()
  const pending = readStorage<Run | null>(RUN, null)
  if (pending) {
    panel.beat(pending.chapter, pending.to)
    panel.busy(true)
  }
  await page.locator("#root > *").first().waitFor({ timeout: 15000 }).catch(() => {})
  await document.fonts?.ready
  if (pending) return drive(pending)
  showPage()
  if (state.at === null) panel.welcome()
  else panel.beat(state.at.chapter, state.at.beat)
  panel.busy(false)
}
