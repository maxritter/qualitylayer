export type Mode = "short" | "full"
export type Place = { chapter: number; beat: number }
export type GuideState = { mode: Mode; at: Place | null; closed: boolean }
export type GuideChapter = {
  id: string
  title: string
  line: string
  url: string
  beats: { note: string; webNote?: string; short?: boolean }[]
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function makeModeButton(mode: Mode, onPick: (mode: Mode) => void) {
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
  button.addEventListener("click", () => onPick(mode))
  return button
}

export interface PanelCallbacks {
  chapters: GuideChapter[]
  getState: () => GuideState
  setState: (patch: Partial<GuideState>) => void
  shown: (mode: Mode) => Place[]
  before: (a: Place, b: Place) => boolean
  isDark: () => boolean
  move: (command: string) => void
}

function buildPanelDom(onPickMode: (mode: Mode) => void) {
  const root = el("aside", "gd")
  root.setAttribute("aria-label", "Guided demo")
  const head = el("div", "gd-head")
  const title = el("p", "gd-title")
  const modes = el("div", "gd-modes")
  modes.setAttribute("role", "radiogroup")
  modes.setAttribute("aria-label", "Tour length")
  const modeButtons = (["short", "full"] as const).map((mode) => makeModeButton(mode, onPickMode))
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
  return { root, title, modes, modeButtons, close, note, problem, fill, count, jump, back, next, pill }
}

type PanelDom = ReturnType<typeof buildPanelDom>

function paintModes(dom: PanelDom, cb: PanelCallbacks) {
  const mode = cb.getState().mode
  dom.modeButtons.forEach((button, i) => button.setAttribute("aria-checked", String((i === 0) === (mode === "short"))))
}

function paintJump(dom: PanelDom, cb: PanelCallbacks) {
  const current = cb.getState()
  const list = cb.shown(current.mode)
  dom.jump.replaceChildren(
    ...cb.chapters.flatMap((chapter, c) => {
      if (!list.some((place) => place.chapter === c)) return []
      const option = el("option", "", `${c + 1} · ${chapter.title}`)
      option.value = String(c)
      return [option]
    }),
  )
  const placeholder = el("option", "", "Chapters")
  placeholder.value = ""
  placeholder.disabled = true
  dom.jump.prepend(placeholder)
  dom.jump.value = current.at === null ? "" : String(current.at.chapter)
}

function paintCount(dom: PanelDom, cb: PanelCallbacks) {
  const current = cb.getState()
  const list = cb.shown(current.mode)
  const at = current.at
  const done = at === null ? 0 : list.filter((place) => !cb.before(at, place)).length
  dom.count.textContent = at === null ? `${list.length} steps` : `${done} of ${list.length}`
  dom.fill.style.width = `${(done / Math.max(list.length, 1)) * 100}%`
}

function refreshPanel(dom: PanelDom, cb: PanelCallbacks) {
  paintJump(dom, cb)
  paintCount(dom, cb)
}

export function createPanel(cb: PanelCallbacks) {
  const dom = buildPanelDom((mode) => {
    cb.setState({ mode })
    paintModes(dom, cb)
    refreshPanel(dom, cb)
  })

  const setClosed = (closed: boolean) => {
    cb.setState({ closed })
    dom.root.hidden = closed
    dom.pill.hidden = !closed
  }
  dom.close.addEventListener("click", () => setClosed(true))
  dom.pill.addEventListener("click", () => setClosed(false))
  dom.back.addEventListener("click", () => cb.move("back"))
  dom.next.addEventListener("click", () => cb.move(dom.next.dataset.again ? "again" : "next"))
  dom.jump.addEventListener("change", () => {
    if (dom.jump.value !== "") cb.move(`chapter:${dom.jump.value}`)
  })

  return {
    mount() {
      const theme = cb.isDark() ? "dark" : "light"
      dom.root.dataset.theme = theme
      dom.pill.dataset.theme = theme
      document.body.append(dom.root, dom.pill)
      const closed = cb.getState().closed
      dom.root.hidden = closed
      dom.pill.hidden = !closed
      paintModes(dom, cb)
      refreshPanel(dom, cb)
    },
    welcome() {
      cb.setState({ at: null })
      dom.title.innerHTML = "<b>Guided tour</b> <span>Usage-based billing, start to finish</span>"
      dom.note.textContent =
        "One task from request to merged pull request in the QualityLayer App. It runs in your browser with example data: no account, no agent, nothing sent anywhere."
      dom.problem.hidden = true
      dom.next.textContent = "Start"
      delete dom.next.dataset.again
      dom.back.disabled = true
      dom.modes.hidden = false
      refreshPanel(dom, cb)
    },
    beat(chapter: number, beat: number, trouble?: string) {
      const current = cb.chapters[chapter]
      const step = current.beats[beat]
      dom.title.innerHTML = ""
      dom.title.append(el("b", "", `${chapter + 1} · ${current.title}`), " ", el("span", "", current.line))
      dom.note.textContent = step.webNote ?? step.note
      dom.problem.hidden = trouble === undefined
      dom.problem.textContent = "This step did not play in your browser. Next goes on."
      dom.next.textContent = "Next"
      delete dom.next.dataset.again
      dom.back.disabled = false
      refreshPanel(dom, cb)
    },
    end() {
      dom.title.innerHTML = "<b>That's the tour</b>"
      dom.note.textContent =
        "Look around on your own: every page of the App works here with the same example data. Or install QualityLayer and run it on your own project."
      dom.problem.hidden = true
      dom.next.textContent = "Start again"
      dom.next.dataset.again = "true"
      refreshPanel(dom, cb)
    },
    busy(on: boolean) {
      dom.root.toggleAttribute("data-busy", on)
      dom.next.disabled = on
      dom.back.disabled = on || cb.getState().at === null
      dom.jump.disabled = on
    },
    waiting(on: boolean) {
      dom.root.toggleAttribute("data-waiting", on)
    },
    /** Out of the way of what the ring frames: above it when it sits low on the screen. */
    avoid(element: Element) {
      const r = element.getBoundingClientRect()
      const low = r.top + r.height / 2 > window.innerHeight * 0.55
      dom.root.dataset.edge = low ? "top" : "bottom"
    },
  }
}
