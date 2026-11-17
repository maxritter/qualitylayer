// An artifact in its sandbox: an iframe with allow-scripts and no allow-same-origin, its page given as
// srcdoc with the no-network policy first, so it cannot reach the App, its token or the network. The
// bridge the server put into the page is its only voice: layout, deliberate feedback, selected words
// and the App's keys pressed inside it, accepted from this frame's own window only.

import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { ARTIFACT_PAGE_NAME } from "../../core/artifact/format.ts"
import { withCsp } from "../reader/ArtifactFrame.tsx"

export type ArtifactPart = {
  id: string
  label: string
  top: number
  left: number
  width: number
  height: number
  /** The area the artifact marks with `data-ql-focus` inside the part, in page pixels. */
  focus?: { top: number; left: number; width: number; height: number }
  /** What the part draws side to side, when narrower than its box, in page pixels. */
  ink?: { left: number; width: number }
}
export type ArtifactLayout = {
  width: number
  height: number
  contentHeight?: number
  parts: ArtifactPart[]
}
/** What the person marked on the page: a spot, a dragged region or selected words. */
export type ArtifactMark = {
  mark: "spot" | "region" | "text"
  /** In page pixels: the spot, or the region's or passage's top left. */
  x: number
  y: number
  width?: number
  height?: number
  /** The `data-screen-label` of the part it is in. */
  section?: string
  quote: string
  /** The passage's lines or the region, in the App's viewport pixels once `onMark` hears them. */
  boxes: { x: number; y: number; width: number; height: number }[]
  /** The spot on screen, for the pin. */
  point?: { x: number; y: number }
}
export type ArtifactScroll = { x: number; y: number; unit: 0 | 1 | 2 | 3 }

type Props = {
  query?: string
  html: string
  title: string
  /** The width the page is laid out at, in its own CSS pixels. */
  width: number
  /** Its height; the page's own once it said so. */
  height: number
  scale: number
  /**
   * Feedback is armed: the page is held and the next click marks a spot, a drag an area. Without it
   * the page works as authored; marks are offered only when `onMark` is given.
   */
  armed?: boolean
  /** A spot or area the person marked with Feedback armed, on the App's screen. */
  onMark?: (mark: ArtifactMark) => void
  /** Words selected on the page (null once cleared), for the Feedback chip beside them. */
  onSelection?: (selection: ArtifactMark | null) => void
  onLayout?: (layout: ArtifactLayout) => void
  onKey?: (key: string) => void
  onScroll?: (scroll: ArtifactScroll) => void
  onAnchor?: (position: { x: number; y: number }) => void
  /** The person followed a link to another page of the same folder artifact: its file name. */
  onPage?: (page: string, section?: string) => void
  onRuntimeError?: (message: string) => void
  className?: string
  theme?: "light" | "dark"
  /**
   * An inline preview: the page cannot take focus or scroll anything into view, so an artifact that
   * autofocuses its own controls never moves the page around it. Cards and full size stay interactive.
   */
  still?: boolean
}

/**
 * Runs before the page's own scripts and markup: focus, scrollIntoView and autofocus do nothing.
 * The frame runs authored scripts, so the host's `inert` cannot stop them; a focused element in a
 * frame scrolls every ancestor to show it.
 */
export const STILL_GUARD = `<script>(() => {
  const none = function () {};
  for (const proto of [HTMLElement.prototype, window.SVGElement && SVGElement.prototype, window.MathMLElement && MathMLElement.prototype]) if (proto) proto.focus = none;
  Element.prototype.scrollIntoView = none;
  if (Element.prototype.scrollIntoViewIfNeeded) Element.prototype.scrollIntoViewIfNeeded = none;
  if (window.HTMLDialogElement) HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  const strip = (node) => {
    if (node.nodeType !== 1) return;
    if (node.hasAttribute("autofocus")) node.removeAttribute("autofocus");
    for (const el of node.querySelectorAll("[autofocus]")) el.removeAttribute("autofocus");
  };
  new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) strip(n); }).observe(document, { childList: true, subtree: true });
})();</script>`

/** The margin of the dotted canvas around the page's card, in px (`.dg-cvs` pads by the same). */
export const CANVAS_PAD = 24

/** The width a page may fill in a canvas `room` px wide: the room less the margin on both sides. */
export const fitRoom = (room: number): number => Math.max(room - 2 * CANVAS_PAD, room / 2)

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

// Change media queries in the live document; changing srcdoc would discard authored state.
// Keep each original query so a second theme choice can reverse the first one.
const MEDIA_THEME = `<script>(() => {
  const originals = new WeakMap();
  const query = (owner, text, theme) => {
    if (!originals.has(owner)) {
      if (!/\\(prefers-color-scheme:\\s*(dark|light)\\)/i.test(text)) return text;
      originals.set(owner, text);
    }
    return originals.get(owner).replace(/\\(prefers-color-scheme:\\s*(dark|light)\\)/gi,
      (_, value) => value.toLowerCase() === theme ? "(min-width: 0px)" : "(max-width: 0px)");
  };
  const rules = (list, theme) => {
    for (const rule of list) {
      if (rule.media) rule.media.mediaText = query(rule.media, rule.media.mediaText, theme);
      if (rule.cssRules) rules(rule.cssRules, theme);
    }
  };
  addEventListener("ql:artifact-mode", (event) => {
    const theme = event.detail && event.detail.theme;
    if (theme !== "light" && theme !== "dark") return;
    for (const sheet of document.styleSheets) rules(sheet.cssRules, theme);
    for (const node of document.querySelectorAll("[media]"))
      node.setAttribute("media", query(node, node.getAttribute("media"), theme));
  });
})();</script>`

/** What the bridge said, checked: anything malformed is dropped. */
export function readBridge(
  data: unknown,
):
  | { kind: "layout"; layout: ArtifactLayout }
  | { kind: "key"; key: string }
  | { kind: "scroll"; scroll: ArtifactScroll }
  | { kind: "anchor"; x: number; y: number }
  | { kind: "page"; page: string; section?: string }
  | { kind: "runtime-error"; message: string }
  | { kind: "mark"; mark: ArtifactMark }
  | { kind: "selection"; selection: ArtifactMark | null }
  | null {
  if (typeof data !== "object" || data === null) return null
  const d = data as Record<string, unknown>
  if (d.type !== "ql:artifact") return null
  if (d.kind === "runtime-error")
    return typeof d.message === "string" && d.message.trim() !== ""
      ? {
          kind: "runtime-error",
          message: Array.from(d.message.slice(0, 600))
            .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char))
            .join(""),
        }
      : null
  if (d.kind === "page")
    return typeof d.page === "string" &&
      ARTIFACT_PAGE_NAME.test(d.page) &&
      (d.section === undefined ||
        (typeof d.section === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,159}$/.test(d.section)))
      ? {
          kind: "page",
          page: d.page,
          ...(typeof d.section === "string" ? { section: d.section } : {}),
        }
      : null
  if (d.kind === "layout") {
    const size = (d.size ?? {}) as Record<string, unknown>
    const width = num(size.width)
    const height = num(size.height)
    if (width === null || height === null) return null
    const parts = (Array.isArray(d.sections) ? d.sections : [])
      .slice(0, 200)
      .flatMap((p): ArtifactPart[] => {
        const s = (p ?? {}) as Record<string, unknown>
        const top = num(s.top)
        if (typeof s.id !== "string" || typeof s.label !== "string" || top === null) return []
        const f = (s.focus ?? {}) as Record<string, unknown>
        // Bounded like the page itself, so a page cannot make its own preview box enormous.
        const within = (value: number | null, most: number) =>
          value === null ? null : Math.min(Math.max(value, -most), most)
        const focus = {
          top: within(num(f.top), 200_000),
          left: within(num(f.left), 8_000),
          width: within(num(f.width), 8_000),
          height: within(num(f.height), 200_000),
        }
        const k = (s.ink ?? {}) as Record<string, unknown>
        const ink = { left: within(num(k.left), 8_000), width: within(num(k.width), 8_000) }
        return [
          {
            id: s.id.slice(0, 200),
            label: s.label.slice(0, 200),
            top,
            left: num(s.left) ?? 0,
            width: num(s.width) ?? 0,
            height: num(s.height) ?? 0,
            ...(ink.left !== null && ink.width !== null && ink.width > 0
              ? { ink: { left: ink.left, width: ink.width } }
              : {}),
            ...(focus.top !== null &&
            focus.left !== null &&
            focus.width !== null &&
            focus.height !== null &&
            focus.width > 0 &&
            focus.height > 0
              ? {
                  focus: {
                    top: focus.top,
                    left: focus.left,
                    width: focus.width,
                    height: focus.height,
                  },
                }
              : {}),
          },
        ]
      })
    return {
      kind: "layout",
      layout: {
        width: Math.min(Math.max(1, width), 8_000),
        height: Math.min(Math.max(1, height), 200_000),
        ...(num(size.contentHeight) !== null && Number(size.contentHeight) > 0
          ? { contentHeight: Math.min(height, Number(size.contentHeight)) }
          : {}),
        parts,
      },
    }
  }
  if (d.kind === "anchor") {
    const x = num(d.x)
    const y = num(d.y)
    if (x === null || y === null || x < 0 || y < 0 || x > 8_000 || y > 200_000) return null
    return { kind: "anchor", x, y }
  }
  if (d.kind === "scroll") {
    const x = num(d.x)
    const y = num(d.y)
    if (x === null || y === null || Math.abs(x) > 4096 || Math.abs(y) > 4096) return null
    if (d.unit !== 0 && d.unit !== 1 && d.unit !== 2 && d.unit !== 3) return null
    return { kind: "scroll", scroll: { x, y, unit: d.unit } }
  }
  // The frame marks only what the person armed Feedback for: a spot or an area. Words become a mark
  // in the App, from the chip beside a reported selection.
  if (d.kind === "mark" || d.kind === "selection") {
    const quote = typeof d.quote === "string" ? d.quote.slice(0, 600) : ""
    if (d.kind === "selection" && quote.trim().length < 3)
      return { kind: "selection", selection: null }
    const x = num(d.x)
    const y = num(d.y)
    const what =
      d.kind === "selection" ? "text" : d.mark === "spot" || d.mark === "region" ? d.mark : null
    if (what === null || x === null || y === null || x > 8_000 || y > 200_000) return null
    const width = num(d.width)
    const height = num(d.height)
    const boxes = (Array.isArray(d.boxes) ? d.boxes : []).slice(0, 40).flatMap((raw) => {
      const b = (raw ?? {}) as Record<string, unknown>
      const box = { x: num(b.x), y: num(b.y), width: num(b.width), height: num(b.height) }
      return box.x !== null && box.y !== null && box.width !== null && box.height !== null
        ? [box as ArtifactMark["boxes"][number]]
        : []
    })
    const mark: ArtifactMark = {
      mark: what,
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      ...(what === "region" && width !== null && height !== null
        ? { width: Math.round(width), height: Math.round(height) }
        : {}),
      ...(typeof d.section === "string" && d.section !== ""
        ? { section: d.section.slice(0, 200) }
        : {}),
      quote,
      boxes,
    }
    return d.kind === "selection" ? { kind: "selection", selection: mark } : { kind: "mark", mark }
  }
  if (d.kind === "key" && typeof d.key === "string" && d.key.length <= 12)
    return { kind: "key", key: d.key }
  return null
}

/** Where a mark's boxes, said in the frame's own viewport pixels, are on the App's screen. */
export function onScreen(
  frame: HTMLIFrameElement,
  boxes: ArtifactMark["boxes"],
): ArtifactMark["boxes"] {
  const at = frame.getBoundingClientRect()
  const scale = at.width / (frame.offsetWidth || at.width) || 1
  return boxes.map((b) => ({
    x: at.left + b.x * scale,
    y: at.top + b.y * scale,
    width: b.width * scale,
    height: b.height * scale,
  }))
}

export function ArtifactPageFrame({
  query,
  html,
  title,
  width,
  height,
  scale,
  armed = false,
  onMark,
  onSelection,
  onLayout,
  onKey,
  onScroll,
  onAnchor,
  onPage,
  onRuntimeError,
  className,
  theme,
  still = false,
}: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const initialTheme = useRef(theme)
  initialTheme.current = theme
  const source = useMemo(() => {
    const seed =
      (still ? STILL_GUARD : "") +
      (query === undefined
        ? ""
        : `<script>window.QL_PREVIEW_QUERY=${JSON.stringify(query).replaceAll("<", "\\u003c")};</script>`)
    const page = !seed
      ? html
      : /<head\b[^>]*>/i.test(html)
        ? html.replace(/<head\b[^>]*>/i, (match) => match + seed)
        : seed + html
    const choice = initialTheme.current
    if (!choice) return withCsp(`${page}${MEDIA_THEME}`)
    const start = `<script>document.documentElement.dataset.theme=${JSON.stringify(choice)};document.documentElement.classList.toggle("dark",${JSON.stringify(choice)}==="dark");document.documentElement.style.colorScheme=${JSON.stringify(choice)};</script>`
    const themed = /<head\b[^>]*>/i.test(page)
      ? page.replace(/<head\b[^>]*>/i, (match) => match + start)
      : start + page
    return withCsp(
      `${themed}${MEDIA_THEME}<script>dispatchEvent(new CustomEvent("ql:artifact-mode",{detail:{theme:${JSON.stringify(choice)}}}));</script>`,
    )
  }, [html, query, still])
  const handlers = useRef({
    onLayout,
    onKey,
    onScroll,
    onAnchor,
    onPage,
    onRuntimeError,
    onMark,
    onSelection,
  })
  handlers.current = {
    onLayout,
    onKey,
    onScroll,
    onAnchor,
    onPage,
    onRuntimeError,
    onMark,
    onSelection,
  }
  const marking = onMark !== undefined
  // Marks the page reports are only heard while they are offered: a stray message after Feedback
  // was cancelled opens nothing.
  const live = useRef({ marking, armed })
  live.current = { marking, armed }
  // Listening from layout, not a passive effect, so a page that reports before effects flush is still heard.
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frame.current === null || event.source !== frame.current.contentWindow) return
      const said = readBridge(event.data)
      if (said === null) return
      if (said.kind === "layout") handlers.current.onLayout?.(said.layout)
      else if (said.kind === "selection") {
        if (!live.current.marking || live.current.armed || said.selection === null) {
          handlers.current.onSelection?.(null)
          return
        }
        handlers.current.onSelection?.({
          ...said.selection,
          boxes: onScreen(frame.current, said.selection.boxes),
        })
      } else if (said.kind === "scroll") handlers.current.onScroll?.(said.scroll)
      else if (said.kind === "anchor") handlers.current.onAnchor?.({ x: said.x, y: said.y })
      else if (said.kind === "page") {
        if (said.section) handlers.current.onPage?.(said.page, said.section)
        else handlers.current.onPage?.(said.page)
      } else if (said.kind === "runtime-error") handlers.current.onRuntimeError?.(said.message)
      else if (said.kind === "mark") {
        if (!live.current.marking || !live.current.armed) return
        // The canvas lays the page out at its whole height, so page pixels are the frame's own.
        const el = frame.current
        const [point] = onScreen(el, [{ x: said.mark.x, y: said.mark.y, width: 0, height: 0 }])
        handlers.current.onMark?.({
          ...said.mark,
          boxes: onScreen(el, said.mark.boxes),
          ...(point ? { point: { x: point.x, y: point.y } } : {}),
        })
      } else handlers.current.onKey?.(said.key)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])
  // The mode is said to the page whenever it changes, and again whenever the page reloads.
  const tell = () =>
    frame.current?.contentWindow?.postMessage(
      {
        type: "ql:artifact",
        kind: "mode",
        mark: marking,
        armed: marking && armed,
        theme,
        pan: onScroll !== undefined,
      },
      "*",
    )
  // biome-ignore lint/correctness/useExhaustiveDependencies: the mode is what is said
  useLayoutEffect(() => {
    tell()
  }, [armed, marking, theme])
  // Armed, the page takes the keyboard: Tab walks its controls, Enter marks, Escape leaves.
  useEffect(() => {
    if (armed && marking) frame.current?.focus({ preventScroll: true })
  }, [armed, marking])
  return (
    <iframe
      ref={frame}
      title={title}
      className={className}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={source}
      onLoad={tell}
      style={{ width, height, transform: `scale(${scale})` }}
      data-testid="artifact-page-frame"
      data-theme={theme}
    />
  )
}
