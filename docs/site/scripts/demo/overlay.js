// Injected into the demo page by present.mjs: a drawn cursor (Playwright's mouse has no visible pointer),
// a spotlight that follows one element, the chapter title, a fade between chapters and the presenter's
// keys. It draws above the App and never takes clicks, so the presenter can always click through it.
;(() => {
  // Every frame takes the presenter's keys, an artifact page's too: once the presenter clicks into one,
  // the keys go to that frame. A key or click of their own between beats tells the presenter the page
  // changed, so the next beat rebuilds it first.
  if (!window.__demoKeys) {
    window.__demoKeys = true
    const OPTION_KEYS = {
      ArrowRight: "next",
      ArrowLeft: "back",
      ArrowDown: "chapter-next",
      ArrowUp: "chapter-back",
      KeyR: "restart",
    }
    const presenterCommand = (event) => {
      if (event.key === "PageDown" || event.key === "PageUp") return event.key === "PageDown" ? "next" : "back"
      const onlyOption = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
      return onlyOption ? OPTION_KEYS[event.code] : undefined
    }
    const touched = () => typeof window.__demoTouched === "function" && void window.__demoTouched()
    window.addEventListener(
      "keydown",
      (event) => {
        const command = presenterCommand(event)
        if (!command) return ["Alt", "Shift", "Meta", "Control"].includes(event.key) || touched()
        if (typeof window.__demoCommand !== "function") return
        event.preventDefault()
        event.stopImmediatePropagation()
        void window.__demoCommand(command)
      },
      true,
    )
    window.addEventListener("pointerdown", touched, true)
  }
  if (window !== window.top || window.__demo) return
  // The dev server's error overlay never covers the App on stage; failures show in the terminal.
  const css = `
  vite-error-overlay{display:none!important}
  #demo-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646}
  #demo-veil{position:fixed;inset:0;background:#000;opacity:1;transition:opacity .35s ease;pointer-events:none;z-index:2147483647}
  #demo-veil.off{opacity:0}
  #demo-spot{position:fixed;border-radius:12px;box-shadow:0 0 0 2px rgba(120,170,255,.95),0 0 18px 2px rgba(120,170,255,.35);
    opacity:0;transition:opacity .3s ease,left .35s ease,top .35s ease,width .35s ease,height .35s ease}
  #demo-spot.on{opacity:1}
  #demo-spot.land{animation:demo-land .7s cubic-bezier(.2,.7,.2,1)}
  @keyframes demo-land{0%{box-shadow:0 0 0 2px rgba(120,170,255,.95),0 0 0 0 rgba(120,170,255,.55)}
    60%{box-shadow:0 0 0 2px rgba(120,170,255,.95),0 0 0 14px rgba(120,170,255,0)}
    100%{box-shadow:0 0 0 2px rgba(120,170,255,.95),0 0 18px 2px rgba(120,170,255,.35)}}
  #demo-carry{transition:opacity .55s cubic-bezier(.2,.7,.2,1),transform .55s cubic-bezier(.2,.7,.2,1),filter .55s ease}
  #demo-carry.gone{opacity:0;transform:scale(1.02);filter:blur(8px)}
  #demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;opacity:0;transition:opacity .4s ease;
    transform:translate(70vw,60vh);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  #demo-cursor.on{opacity:1}
  #demo-ring{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid rgba(120,170,255,.95);
    opacity:0;transform:scale(.4)}
  #demo-ring.go{animation:demo-ring .45s ease-out}
  @keyframes demo-ring{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.4)}}
  #demo-chip{position:fixed;left:24px;bottom:24px;padding:10px 16px 11px;border-radius:10px;background:rgba(12,14,18,.92);
    color:#f2f4f7;font:500 15px/1.3 Geist,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);
    opacity:0;transform:translateY(8px);transition:opacity .35s ease,transform .35s ease}
  #demo-chip.on{opacity:1;transform:none}
  #demo-chip b{font-weight:600;margin-right:8px}
  #demo-chip span{color:#a9b1bd}
  #demo-miss{position:fixed;right:10px;top:10px;width:8px;height:8px;border-radius:50%;background:#e5484d;opacity:0;transition:opacity .3s}
  #demo-miss.on{opacity:.9}
  #demo-run{position:fixed;left:0;top:0;width:100%;height:3px;overflow:hidden;opacity:0;transition:opacity .45s ease}
  #demo-run.on{opacity:1}
  #demo-run::before{content:"";position:absolute;top:0;bottom:0;left:0;width:30%;
    background:linear-gradient(90deg,rgba(120,170,255,0),rgba(120,170,255,.95),rgba(120,170,255,0));animation:demo-run 1.1s linear infinite}
  #demo-run.done::before{width:100%;background:rgba(120,170,255,.95);animation:none}
  @keyframes demo-run{from{transform:translateX(-100%)}to{transform:translateX(340%)}}`
  // A beat that opens another page is still playing there: the new page's cue runs on from the start.
  const busyBefore = () => {
    try {
      return sessionStorage.getItem("demo-busy") === "1"
    } catch {
      return false
    }
  }
  const markBusy = (busy) => {
    try {
      if (busy) sessionStorage.setItem("demo-busy", "1")
      else sessionStorage.removeItem("demo-busy")
    } catch {}
  }
  const layer = document.createElement("div")
  layer.id = "demo-layer"
  layer.innerHTML = `<style>${css}</style><div id="demo-spot"></div><div id="demo-ring"></div>
    <svg id="demo-cursor" viewBox="0 0 24 24"><path d="M4 2.5 19.5 13l-7 1.2L9 21z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>
    <div id="demo-chip"></div><div id="demo-miss"></div><div id="demo-run"${busyBefore() ? ' class="on"' : ""}></div>`
  const veil = document.createElement("div")
  veil.id = "demo-veil"
  // The page before this one, kept by present.mjs: it covers this page from its first paint until the
  // director reveals it, so a page change is one crossfade instead of a cut to black.
  let carry = null
  try {
    const src = sessionStorage.getItem("demo-carry")
    sessionStorage.removeItem("demo-carry")
    if (src) {
      carry = document.createElement("img")
      carry.id = "demo-carry"
      carry.decoding = "sync"
      carry.src = src
      carry.style.cssText =
        "position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover;z-index:2147483645;pointer-events:none"
      veil.classList.add("off")
      // This script runs before the page has its <html>: the picture goes in the moment it exists.
      const kept = carry
      const place = () => document.documentElement.append(kept)
      if (document.documentElement) place()
      else
        new MutationObserver((_, watch) => {
          if (!document.documentElement) return
          watch.disconnect()
          place()
        }).observe(document, { childList: true })
    }
  } catch {}
  const mount = () => {
    if (!document.body) return requestAnimationFrame(mount)
    document.body.append(layer, veil)
  }
  mount()
  const $ = (id) => layer.querySelector("#" + id)
  let spotted = null
  let cursorTimer = 0
  // The ring belongs to what the audience can see: once anything covers the middle of its element (a dialog
  // opening above it, a page that moved on), it steps aside instead of framing the wrong thing.
  // It waits a quarter second first, so a sticky header passing over it during a smooth scroll does not count.
  let coveredFrames = 0
  const covered = (element) => {
    const r = element.getBoundingClientRect()
    const top = Math.max(r.top, 0)
    const bottom = Math.min(r.bottom, window.innerHeight)
    if (bottom - top < 8) return false
    const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 2)
    const hit = document.elementFromPoint(x, (top + bottom) / 2)
    return hit !== null && !element.contains(hit) && !hit.closest?.("#demo-layer")
  }
  const follow = () => {
    coveredFrames = spotted?.isConnected && covered(spotted) ? coveredFrames + 1 : 0
    if (coveredFrames > 15) window.__demo.unspot()
    if (spotted?.isConnected) {
      const r = spotted.getBoundingClientRect()
      const pad = 8
      const spot = $("demo-spot")
      const top = Math.max(r.top - pad, 4)
      const bottom = Math.min(r.bottom + pad, window.innerHeight - 4)
      spot.style.left = r.left - pad + "px"
      spot.style.top = top + "px"
      spot.style.width = r.width + pad * 2 + "px"
      spot.style.height = Math.max(bottom - top, 0) + "px"
    } else if (spotted) window.__demo.unspot()
    requestAnimationFrame(follow)
  }
  requestAnimationFrame(follow)
  // The presenter's keys hold Option, so they work even while a field has the focus; they take
  // precedence over the App's only Option keys (⌥↑ ⌥↓ move a sidebar project, which the demo never
  // shows). `code` names the key itself: with Option, `key` is a special character (⌥R gives ®).
  // A click or scroll by the presenter means they took over: the spotlight steps aside.
  for (const type of ["wheel", "pointerdown"])
    window.addEventListener(type, () => window.__demo.busy || window.__demo.unspot(), true)
  // The presenter's cue: a light runs along the window's top edge while a page loads or a beat plays;
  // when the beat is done the line fills and fades out. No line: press next.
  let runTimer = 0
  window.__demo = {
    busy: false,
    begin() {
      this.busy = true
      clearTimeout(cursorTimer)
      clearTimeout(runTimer)
      markBusy(true)
      $("demo-run").classList.remove("done")
      $("demo-run").classList.add("on")
    },
    end() {
      this.busy = false
      markBusy(false)
      cursorTimer = setTimeout(() => $("demo-cursor").classList.remove("on"), 1400)
      const run = $("demo-run")
      run.classList.add("done")
      runTimer = setTimeout(() => run.classList.remove("on"), 450)
    },
    // The director moves the cursor itself: a mouse over an artifact's frame sends this page no events.
    // It shows only while a scripted beat runs; the presenter's own mouse has the system pointer.
    cursor(x, y, ms) {
      const cursor = $("demo-cursor")
      cursor.style.transition = `opacity .4s ease, transform ${ms}ms cubic-bezier(.3,.7,.4,1)`
      cursor.style.transform = `translate(${x - 4}px,${y - 2}px)`
      cursor.classList.add("on")
    },
    spot(element) {
      spotted = element
      const spot = $("demo-spot")
      spot.classList.add("on")
      // A soft ripple as the ring lands on its element.
      spot.classList.remove("land")
      void spot.offsetWidth
      spot.classList.add("land")
    },
    /** `instant` skips the fade, for a picture taken right after. */
    unspot(instant = false) {
      spotted = null
      const spot = $("demo-spot")
      if (instant) spot.style.transition = "none"
      spot.classList.remove("on", "land")
      if (instant) {
        void spot.offsetWidth
        spot.style.transition = ""
      }
    },
    ring(x, y) {
      const ring = $("demo-ring")
      ring.style.left = x + "px"
      ring.style.top = y + "px"
      ring.classList.remove("go")
      void ring.offsetWidth
      ring.classList.add("go")
    },
    chip(title, line, ms = 3200) {
      const chip = $("demo-chip")
      chip.innerHTML = ""
      const strong = document.createElement("b")
      strong.textContent = title
      const rest = document.createElement("span")
      rest.textContent = line
      chip.append(strong, rest)
      chip.classList.add("on")
      setTimeout(() => chip.classList.remove("on"), ms)
    },
    miss() {
      $("demo-miss").classList.add("on")
      setTimeout(() => $("demo-miss").classList.remove("on"), 2500)
    },
    show() {
      veil.classList.add("off")
    },
    /** The new page comes in: the kept picture of the old one dissolves, else the black veil lifts. */
    reveal() {
      this.show()
      const kept = carry
      carry = null
      try {
        sessionStorage.removeItem("demo-carry")
      } catch {}
      if (!kept) return
      requestAnimationFrame(() => kept.classList.add("gone"))
      setTimeout(() => kept.remove(), 700)
    },
    hide() {
      veil.classList.remove("off")
    },
  }
})()
