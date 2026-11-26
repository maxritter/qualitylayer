// An artifact is shown in a sandboxed frame without allow-same-origin, so it cannot reach the App or the
// network. Before it is handed out, two things go into it: a policy that allows no network, first in
// the page, and a small script, the frame's only way to speak, that tells the App the page's natural
// size, its parts, the words selected and, once the person arms Feedback, the spot or area they marked.

/** What an artifact may load: nothing from anywhere; inline styles and scripts, `data:` pictures and fonts. */
export const ARTIFACT_PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"

/**
 * The policy first, before anything the page says can load or run (after a doctype only, which must
 * stay first): the parser puts a meta that stands before every tag into the head it makes itself.
 */
export function withPolicy(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_PAGE_CSP}">`
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? ""
  return `${doctype}${meta}${html.slice(doctype.length)}`
}

/**
 * The frame's side. It posts `{ type: "ql:artifact", kind: "layout", size, sections }` whenever the
 * page's size or parts move, `kind: "selection"` with the selected words (empty when cleared),
 * `kind: "mark"` with the spot or region marked while Feedback is armed, `kind: "key"` for the App's
 * own keys pressed inside the frame, and `kind: "page"` with the file name when the person follows a
 * link to another page of the same folder artifact (the click is stopped, the App switches the page).
 * It listens to its parent only, and only for the mode: marks offered, Feedback armed, theme, panning.
 */
export const BRIDGE = `(() => {
  const post = (data) => parent.postMessage(Object.assign({ type: "ql:artifact" }, data), "*");
  const failed = (value) => { let message; try { message = String(value && value.message || value || "The artifact's script failed"); } catch (_) { message = "The artifact's script failed"; } post({ kind: "runtime-error", message: message.slice(0, 600) }); };
  addEventListener("error", (event) => { if (event.message) failed(event.message); });
  addEventListener("unhandledrejection", (event) => failed(event.reason));
  let panning = false;
  const parts = () => Array.from(document.querySelectorAll("[data-screen-label][id]")).map((el) => {
    const r = el.getBoundingClientRect();
    const part = { id: el.id, label: el.getAttribute("data-screen-label") || "", top: Math.round(r.top + scrollY), left: Math.round(r.left + scrollX), width: Math.round(r.width), height: Math.round(r.height) };
    const marked = Array.from(el.querySelectorAll("[data-ql-focus]")).map((m) => m.getBoundingClientRect()).filter((m) => m.width > 0 && m.height > 0);
    if (marked.length) {
      const top = Math.min(...marked.map((m) => m.top)), left = Math.min(...marked.map((m) => m.left));
      const bottom = Math.max(...marked.map((m) => m.bottom)), right = Math.max(...marked.map((m) => m.right));
      part.focus = { top: Math.round(top + scrollY), left: Math.round(left + scrollX), width: Math.round(right - left), height: Math.round(bottom - top) };
    }
    const drawn = ink(el, r);
    if (drawn) part.ink = drawn;
    return part;
  });
  // What a section draws side to side: its text, pictures, controls and boxes with a border or a fill,
  // so a preview fits the drawing rather than a section box that runs empty to the page's edge.
  const ink = (el, box) => { try { return drawnSpan(el, box); } catch (_) { return null; } };
  const drawnSpan = (el, box) => {
    if (box.width <= 0 || !el.children) return null;
    let left = Infinity, right = -Infinity, seen = 0;
    const take = (rect) => { if (rect.width > 0 && rect.height > 0) { left = Math.min(left, rect.left); right = Math.max(right, rect.right); } };
    const texts = (node) => {
      for (const text of Array.from(node.childNodes || [])) {
        if (text.nodeType === 3 && text.textContent.trim() !== "") { const range = document.createRange(); range.selectNodeContents(text); take(range.getBoundingClientRect()); }
      }
    };
    const walk = (node) => {
      for (const child of Array.from(node.children || [])) {
        if (++seen > 1500) return;
        if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE)$/.test(child.tagName)) continue;
        const css = getComputedStyle(child);
        // A display: contents wrapper has no box of its own: what it holds is still drawn.
        if (css.display === "contents") { texts(child); walk(child); continue; }
        const rect = child.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || css.visibility === "hidden") continue;
        const edge = (side) => parseFloat(css["border" + side + "Width"]) > 0;
        const boxed = edge("Left") || edge("Right") || edge("Top") || edge("Bottom") || !/rgba\\(0, 0, 0, 0\\)|transparent/.test(css.backgroundColor) || (css.backgroundImage && css.backgroundImage !== "none") || css.boxShadow !== "none" || (css.outlineStyle && css.outlineStyle !== "none");
        if (boxed || /^(IMG|SVG|CANVAS|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA|IFRAME|PICTURE|HR|TABLE)$/i.test(child.tagName)) { take(rect); continue; }
        texts(child);
        walk(child);
      }
    };
    texts(el);
    walk(el);
    if (!Number.isFinite(left) || seen > 1500) return null;
    left = Math.max(box.left, left); right = Math.min(box.right, right);
    if (right - left <= 0 || right - left >= box.width - 1) return null;
    return { left: Math.round(left + scrollX), width: Math.round(right - left) };
  };
  let last = "";
  const report = () => {
    const root = document.documentElement, body = document.body;
    // A frame inside a hidden tab has no viewport: its zero-sized parts would replace the real layout.
    if (root.clientWidth === 0 && root.clientHeight === 0) return;
    const size = { width: Math.max(root.scrollWidth, body ? body.scrollWidth : 0), height: Math.max(root.scrollHeight, body ? body.scrollHeight : 0) };
    const visibleChildren = (el) => el.children.length > 2048 ? [el] : Array.from(el.children).filter(child => !/^(SCRIPT|STYLE|LINK|META|TEMPLATE)$/.test(child.tagName) && child.getBoundingClientRect().height > 0);
    let content = body;
    for (let depth = 0; content && depth < 16; depth++) {
      const children = visibleChildren(content);
      if (children.length !== 1 || children[0] === content) break;
      content = children[0];
    }
    if (content) {
      const children = visibleChildren(content);
      const bottom = Math.max(...(children.length ? children : [content]).map(el => el.getBoundingClientRect().bottom + scrollY));
      if (Number.isFinite(bottom) && bottom > 0) size.contentHeight = Math.min(size.height, Math.ceil(bottom + (parseFloat(getComputedStyle(content).paddingBottom) || 0)));
    }
    const text = JSON.stringify({ size, sections: parts() });
    if (text === last) return;
    last = text;
    post(Object.assign({ kind: "layout" }, JSON.parse(text)));
    parent.postMessage({ type: "qualitylayer:height", height: size.height }, "*");
  };
  let queued = false;
  // A hidden cross-origin frame gets no animation frames (the App hides a preview until its first layout),
  // so a timer reports too: whichever comes first.
  const run = () => { if (!queued) return; queued = false; report(); };
  const soon = () => { if (queued) return; queued = true; requestAnimationFrame(run); setTimeout(run, 100); };
  addEventListener("load", report);
  addEventListener("resize", soon);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", report); else report();
  const watch = () => {
    const ro = new ResizeObserver(soon);
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
    const containsPart = (node) => node instanceof Element && (node.matches("[data-screen-label][id]") || node.querySelector("[data-screen-label][id]"));
    const mo = new MutationObserver((changes) => {
      if (changes.some((change) => change.type === "attributes"
        ? change.attributeName === "data-screen-label" || change.target.hasAttribute("data-screen-label")
        : [...change.addedNodes, ...change.removedNodes].some(containsPart))) soon();
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["id", "data-screen-label"] });
    addEventListener("pagehide", (event) => { if (event.persisted) return; ro.disconnect(); mo.disconnect(); });
  };
  if (document.body) watch(); else addEventListener("DOMContentLoaded", watch);
  setTimeout(report, 400);
  const sectionAt = (target, y) => {
    const el = target && target.closest ? target.closest("[data-screen-label]") : null;
    if (el) return el.getAttribute("data-screen-label") || undefined;
    let found;
    for (const p of parts()) if (p.top <= y) found = p.label;
    return found;
  };
  // Feedback is deliberate. Plain clicks, drags and selections always belong to the page. The App's
  // Feedback button arms one mark: while armed the page hears nothing, a click marks a spot, a drag an
  // area, Enter or Space the focused element, and Escape leaves. Selected words are only reported, so
  // the App can offer its Feedback chip beside them.
  let marking = false, armed = false, multi = false;
  const flat = (text, n) => String(text || "").replace(/\\s+/g, " ").trim().slice(0, n);
  const owned = (el) => {
    if (!el) return "";
    const label = el.id ? document.querySelector("label[for='" + CSS.escape(el.id) + "']") : null;
    return flat(label ? label.textContent + " · " + (el.value || "") : (el.value || el.textContent || el.getAttribute && (el.getAttribute("alt") || el.getAttribute("aria-label")) || ""), 300);
  };
  const pickTarget = (el) => {
    if (!el || !el.closest) return el;
    const found = el.closest("[id],[data-testid],button,a,input,select,textarea,[role],section,article,header,nav,form,table");
    return found && found !== document.documentElement && found !== document.body ? found : el;
  };
  const describe = (raw) => {
    const el = pickTarget(raw);
    if (!el || !el.tagName) return null;
    const id = el.id ? flat(el.id, 160) : "";
    const testId = el.getAttribute ? flat(el.getAttribute("data-testid") || "", 160) : "";
    const tag = String(el.tagName || "").toLowerCase().slice(0, 32);
    const role = el.getAttribute ? flat(el.getAttribute("role") || "", 40) : "";
    const text = flat(owned(el), 120);
    const firstClass = typeof el.className === "string" ? el.className.trim().split(/\\s+/)[0] : "";
    const selector = id ? "#" + id : testId ? '[data-testid="' + testId + '"]' : tag + (firstClass ? "." + firstClass.slice(0, 48) : "");
    return Object.assign({ tag, selector }, id ? { id } : {}, testId ? { testId } : {}, role ? { role } : {}, text ? { text } : {});
  };
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
  const armedStyle = document.createElement("style");
  armedStyle.textContent = "*,*::before,*::after{cursor:crosshair !important;user-select:none !important;-webkit-user-select:none !important;touch-action:none !important}[data-ql-hover]{outline:1.5px dashed #2076c5 !important;outline-offset:2px !important}:focus-visible{outline:2px dashed #2076c5 !important;outline-offset:2px !important}";
  let press = null, drawn = null, hovered = null, hoverTag = null, pinLayer = null, trailingPointer = false;
  const heldKeys = new Set();
  const holding = () => armed || trailingPointer;
  const dropHoverTag = () => { if (hoverTag) { hoverTag.remove(); hoverTag = null; } };
  const unhover = () => { if (hovered) { hovered.removeAttribute("data-ql-hover"); hovered = null; } dropHoverTag(); };
  const showHoverTag = (el) => {
    dropHoverTag();
    const info = describe(el);
    if (!info || !info.selector) return;
    const r = el.getBoundingClientRect();
    hoverTag = document.createElement("div");
    hoverTag.setAttribute("aria-hidden", "true");
    hoverTag.setAttribute("data-ql-bridge-ui", "1");
    hoverTag.textContent = info.selector + " · " + Math.round(r.width) + "×" + Math.round(r.height);
    hoverTag.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;padding:2px 6px;border-radius:5px;background:#2076c5;color:#fff;font:500 11px/1.3 ui-monospace,Menlo,monospace;white-space:nowrap;left:" + Math.max(4, Math.round(r.left)) + "px;top:" + Math.max(4, Math.round(r.top - 22)) + "px";
    document.documentElement.appendChild(hoverTag);
  };
  const renderPins = (pins) => {
    if (pinLayer) { pinLayer.remove(); pinLayer = null; }
    if (!Array.isArray(pins) || pins.length === 0) return;
    pinLayer = document.createElement("div");
    pinLayer.setAttribute("aria-hidden", "true");
    pinLayer.setAttribute("data-ql-bridge-ui", "1");
    pinLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2147483646";
    for (const p of pins.slice(0, 40)) {
      const boxEl = document.createElement("div");
      const dashed = p.kind === "element" ? "dashed" : "solid";
      const glow = p.active ? "box-shadow:0 0 0 3px rgb(32 118 197 / 24%);" : "";
      boxEl.style.cssText = "position:absolute;border:1.5px " + dashed + " #2076c5;background:rgb(32 118 197 / 10%);border-radius:6px;left:" + Math.round(p.x) + "px;top:" + Math.round(p.y) + "px;width:" + Math.max(20, Math.round(p.width || 24)) + "px;height:" + Math.max(20, Math.round(p.height || 24)) + "px;" + glow;
      const num = document.createElement("span");
      num.textContent = String(p.num);
      num.style.cssText = "position:absolute;top:-10px;left:-10px;width:20px;height:20px;border-radius:999px;border:2px solid #fff;background:#2076c5;color:#fff;font:600 11px/16px system-ui,sans-serif;text-align:center";
      boxEl.appendChild(num);
      pinLayer.appendChild(boxEl);
    }
    (document.body || document.documentElement).appendChild(pinLayer);
  };
  const drawBox = (a, b) => {
    if (!drawn) { drawn = document.createElement("div"); drawn.setAttribute("aria-hidden", "true"); drawn.setAttribute("data-ql-bridge-ui", "1"); drawn.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:1.5px solid #2076c5;background:rgb(32 118 197 / 10%);border-radius:4px"; document.documentElement.appendChild(drawn); }
    drawn.style.left = Math.min(a.x, b.x) + "px"; drawn.style.top = Math.min(a.y, b.y) + "px";
    drawn.style.width = Math.abs(b.x - a.x) + "px"; drawn.style.height = Math.abs(b.y - a.y) + "px";
  };
  const dropBox = () => { if (drawn) { drawn.remove(); drawn = null; } };
  const arm = (on) => {
    if (armed === on) return;
    press = null; dropBox(); unhover();
    armed = on;
    if (!on) { armedStyle.remove(); return; }
    (document.head || document.documentElement).appendChild(armedStyle);
    const selection = getSelection();
    if (selection) selection.removeAllRanges();
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) {
      const first = document.querySelector("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
      if (first && first.focus) first.focus({ preventScroll: true });
    }
  };
  // One mark ends single-shot mode; multi mode stays armed for pinning several elements/areas.
  const marked = (data) => { if (!multi) arm(false); post(Object.assign({ kind: "mark" }, data)); };
  const spot = (rawEl, px, py) => {
    const el = pickTarget(rawEl);
    const info = describe(el);
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (multi && r && r.width > 0 && r.height > 0 && info) {
      marked({ mark: "element", x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height), section: sectionAt(el, py), quote: owned(el), target: info, boxes: [box(r)] });
      return;
    }
    marked(Object.assign({ mark: "spot", x: Math.round(px), y: Math.round(py), section: sectionAt(el, py), quote: owned(el), boxes: [] }, info ? { target: info } : {}));
  };
  const stop = (event) => {
    if (!holding()) return false;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    if (!armed && event.type === "click") trailingPointer = false;
    return true;
  };
  for (const name of ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "submit", "dragstart", "selectstart", "touchstart", "touchmove", "touchend", "mouseover", "mouseout", "mousemove", "pointerover", "pointerout"]) addEventListener(name, stop, { capture: true, passive: false });
  addEventListener("pointerdown", (event) => {
    if (!armed) trailingPointer = false;
    if (!stop(event) || !armed || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    press = { x: event.clientX, y: event.clientY, px: event.pageX, py: event.pageY, target: event.target };
  }, true);
  addEventListener("pointermove", (event) => {
    if (!stop(event) || !armed) return;
    if (!press) {
      const raw = event.target instanceof Element ? event.target : null;
      const t = raw && !raw.closest("[data-ql-bridge-ui]") ? pickTarget(raw) : null;
      if (t !== hovered) { unhover(); if (t && t !== document.documentElement && t !== document.body) { hovered = t; t.setAttribute("data-ql-hover", ""); showHoverTag(t); } }
      return;
    }
    if (Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) < 8) return;
    unhover();
    drawBox(press, { x: event.clientX, y: event.clientY });
  }, true);
  addEventListener("pointerup", (event) => {
    if (!stop(event) || !armed) return;
    const at = press; press = null;
    if (!at) return;
    trailingPointer = true;
    if (!drawn) { spot(document.elementFromPoint(at.x, at.y) || at.target, at.px, at.py); return; }
    const r = drawn.getBoundingClientRect();
    dropBox();
    const inside = Array.from(document.querySelectorAll("h1,h2,h3,h4,label,p,span,button,input,small,li,td,th,a")).filter((el) => {
      const e = el.getBoundingClientRect();
      return e.width && e.left >= r.left - 2 && e.right <= r.right + 2 && e.top >= r.top - 2 && e.bottom <= r.bottom + 2 && !el.querySelector("label,p,span,button,input,small");
    }).map((el) => el.tagName === "INPUT" ? el.value : flat(el.textContent, 120)).filter(Boolean);
    const centre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const seen = new Set();
    const targets = [];
    for (const el of Array.from(document.querySelectorAll("[id],[data-testid],button,a,input,select,textarea,[role]"))) {
      if (el.closest && el.closest("[data-ql-bridge-ui]")) continue;
      const e = el.getBoundingClientRect();
      if (!e.width || !e.height) continue;
      const ox = Math.max(0, Math.min(e.right, r.right) - Math.max(e.left, r.left));
      const oy = Math.max(0, Math.min(e.bottom, r.bottom) - Math.max(e.top, r.top));
      if (ox * oy > Math.min(e.width * e.height, r.width * r.height) * 0.25) {
        const info = describe(el);
        if (info && info.selector && !seen.has(info.selector)) { seen.add(info.selector); targets.push(info); if (targets.length >= 10) break; }
      }
    }
    marked(Object.assign({ mark: "region", x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height), section: sectionAt(centre, r.top + scrollY), quote: flat(inside.join(" · "), 300) || owned(centre), boxes: [box(r)] }, targets.length ? { targets } : {}));
  }, true);
  addEventListener("pointercancel", () => { press = null; trailingPointer = false; dropBox(); }, true);
  // Keys while armed: Tab moves between the page's controls, Enter or Space marks the focused one,
  // Escape leaves; nothing else reaches the page.
  const keyHold = (event) => {
    if (!armed && event.type === "keydown" && !event.repeat) heldKeys.delete(event.key);
    if (!armed && !heldKeys.has(event.key)) return;
    if (event.key === "Tab") { event.stopImmediatePropagation(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "keyup") { heldKeys.delete(event.key); return; }
    if (!armed) return;
    heldKeys.add(event.key);
    if (event.type !== "keydown") return;
    if (event.key === "Escape") { arm(false); post({ kind: "key", key: "Escape" }); return; }
    if (event.key !== "Enter" && event.key !== " ") return;
    const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.documentElement;
    const r = el.getBoundingClientRect();
    spot(el, r.left + Math.min(r.width, 24) / 2 + scrollX, r.top + Math.min(r.height, 24) / 2 + scrollY);
  };
  for (const name of ["keydown", "keypress", "keyup"]) addEventListener(name, keyHold, true);
  // Selected words are reported, never marked: the App shows its Feedback chip beside them.
  let shown = false, picking = 0;
  const reportSelection = () => {
    picking = 0;
    const selection = getSelection();
    const words = !armed && marking && selection && selection.rangeCount && !selection.isCollapsed ? flat(selection.toString(), 600) : "";
    if (words.length < 3) { if (shown) { shown = false; post({ kind: "selection", quote: "" }); } return; }
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const boxes = Array.from(range.getClientRects()).filter((r) => r.width > 1).map(box);
    const first = range.getBoundingClientRect();
    shown = true;
    post({ kind: "selection", quote: words, x: Math.round(first.left + scrollX), y: Math.round(first.top + scrollY), section: sectionAt(node, first.top + scrollY), boxes });
  };
  document.addEventListener("selectionchange", () => { if (!picking) picking = setTimeout(reportSelection, 120); });
  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || data.type !== "ql:artifact") return;
    if (data.kind === "pins") { renderPins(data.pins); return; }
    if (data.kind !== "mode") return;
    marking = data.mark === true;
    multi = data.multi === true;
    if (data.pins !== undefined) renderPins(data.pins);
    arm(marking && data.armed === true);
    panning = data.pan === true;
    if (data.theme === "light" || data.theme === "dark") {
      document.documentElement.dataset.theme = data.theme;
      document.documentElement.classList.toggle("dark", data.theme === "dark");
      document.documentElement.style.colorScheme = data.theme;
      if (typeof CustomEvent === "function") dispatchEvent(new CustomEvent("ql:artifact-mode", { detail: { theme: data.theme } }));
    }
    reportSelection();
    report();
  });
  // A link to another page of a folder artifact (a relative address of a .html file at the top of the
  // folder) switches the App's page. Fragment links stay in this srcdoc instead of resolving
  // against the embedding App URL; the parent canvas owns the scaled scroll position.
  const pageOf = (href) => {
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\\/|#)/i.test(href)) return null;
    const path = href.split(/[?#]/)[0].replace(/^\\.\\//, "");
    return /^[A-Za-z0-9_][A-Za-z0-9._-]*\\.html$/.test(path) ? path : null;
  };
  addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link || (link.target && link.target !== "_self")) return;
    const href = link.getAttribute("href");
    if (href && href.startsWith("#")) {
      event.preventDefault();
      let id; try { id = decodeURIComponent(href.slice(1)); } catch (_) { return; }
      if (!id) { post({ kind: "anchor", x: 0, y: 0 }); return; }
      const target = document.getElementById(id);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      post({ kind: "anchor", x: Math.max(0, Math.round(rect.left + scrollX)), y: Math.max(0, Math.round(rect.top + scrollY)) });
      if (target.focus) target.focus({ preventScroll: true });
      return;
    }
    const page = pageOf(href);
    if (page === null) return;
    event.preventDefault();
    let section; try { section = href.includes("#") ? decodeURIComponent(href.slice(href.indexOf("#") + 1)) : undefined; } catch (_) { return; }
    if (section !== undefined && !/^[A-Za-z][A-Za-z0-9_-]{0,159}$/.test(section)) return;
    post(Object.assign({ kind: "page", page }, section ? { section } : {}));
  });
  const canScroll = (target, x, y) => {
    let el = target instanceof Element ? target : null;
    for (let depth = 0; el && depth < 40; depth++, el = el.parentElement) {
      const root = el === document.documentElement || el === document.body;
      const css = getComputedStyle(el);
      const hasX = (root || /auto|scroll/.test(css.overflowX)) && el.scrollWidth > el.clientWidth + 1;
      const hasY = (root || /auto|scroll/.test(css.overflowY)) && el.scrollHeight > el.clientHeight + 1;
      if (hasX && ((x < 0 && el.scrollLeft > 0) || (x > 0 && el.scrollLeft < el.scrollWidth - el.clientWidth - 1))) return true;
      if (hasY && ((y < 0 && el.scrollTop > 0) || (y > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - 1))) return true;
    }
    return false;
  };
  const pan = (event, x, y, unit) => {
    if (!panning || event.defaultPrevented || canScroll(event.target, x, y)) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return;
    event.preventDefault();
    post({ kind: "scroll", x: Math.max(-4096, Math.min(4096, x)), y: Math.max(-4096, Math.min(4096, y)), unit });
  };
  addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) return;
    const sideways = event.shiftKey && event.deltaX === 0;
    pan(event, sideways ? event.deltaY : event.deltaX, sideways ? 0 : event.deltaY, event.deltaMode);
  }, { passive: false });
  let touch = null;
  addEventListener("touchstart", (event) => { touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }, { passive: true });
  addEventListener("touchmove", (event) => {
    if (!touch || event.touches.length !== 1) { touch = null; return; }
    const next = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    pan(event, touch.x - next.x, touch.y - next.y, 3);
    touch = next;
  }, { passive: false });
  for (const name of ["touchend", "touchcancel"]) addEventListener(name, () => { touch = null; }, { passive: true });
  addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const t = event.target;
    // The artifact's modal owns its keys, including the browser's native Escape/cancel path.
    if (Array.from(document.querySelectorAll("dialog[open], [role='dialog'][aria-modal='true']")).some((el) => el.getClientRects().length > 0)) return;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const offsets = { ArrowDown: [0, 40], ArrowUp: [0, -40], ArrowLeft: [-40, 0], ArrowRight: [40, 0], PageDown: [0, innerHeight], PageUp: [0, -innerHeight], Home: [0, -innerHeight], End: [0, innerHeight] };
    const offset = offsets[event.key];
    if (panning && offset && !canScroll(t, offset[0], offset[1])) { post({ kind: "key", key: event.key }); event.preventDefault(); return; }
    if (["c", "C", "f", "F", "Escape", "+", "=", "-", "0"].includes(event.key)) { post({ kind: "key", key: event.key }); if (event.key === "Escape") event.preventDefault(); }
  }, true);
})();`

/** Install diagnostics before authored scripts can throw, with the no-network policy first. */
export function withBridge(html: string): string {
  const script = `<script>${BRIDGE}</script>`
  const head = /<head\b[^>]*>/i.exec(html)
  const at = head
    ? head.index + head[0].length
    : (html.match(/^\s*<!doctype[^>]*>/i)?.[0].length ?? 0)
  const placed = `${html.slice(0, at)}${script}${html.slice(at)}`
  return withPolicy(placed)
}
