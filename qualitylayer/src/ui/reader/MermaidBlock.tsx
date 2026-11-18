// Mermaid ships with the Cockpit (no CDN) as a file of its own, loaded and initialised lazily, strict mode,
// themed from the Cockpit tokens. A render failure shows the parser's message
// and the source instead of an empty box.

import {
  ArrowRightLeftIcon,
  BlocksIcon,
  ChartNetworkIcon,
  ChevronsRightIcon,
  CodeIcon,
  Maximize2Icon,
  MessageSquarePlusIcon,
  ScanIcon,
  SplineIcon,
  WaypointsIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  type DiagramTheme,
  diagramKind,
  endLifelines,
  mermaidConfig,
  titleGroupsLeft,
} from "../../core/docs/mermaid-style.ts"
import { describe, find, markPinnable, type Pinned } from "./diagram-pins.ts"
import { PanZoomViewport, usePanZoom } from "./PanZoomViewport.tsx"
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./pan-zoom.ts"
import { RISK_TIP, VisualLegend } from "./VisualLegend.tsx"
import { FullscreenDialog, VisualAction } from "./VisualParts.tsx"

export type Renderer = (id: string, source: string, theme: string) => Promise<string>

/**
 * One diagram's zoom, shared by the inline block and the fullscreen view: steps
 * of ×1.25 between 0.25 and 4, `fit` back to 1, and the keys + − 0 for a focused view.
 */
export function useDiagramZoom() {
  const [zoom, setZoom] = useState(1)
  const zoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP)), [])
  const zoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP)), [])
  const fit = useCallback(() => setZoom(1), [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") zoomIn()
    if (e.key === "-" || e.key === "−") zoomOut()
    if (e.key === "0") fit()
  }
  return { zoom, zoomIn, zoomOut, fit, onKeyDown }
}

let counter = 0

type MermaidModule = typeof import("mermaid")

/**
 * The Cockpit fetches Mermaid as a file of its own (mermaid-entry.ts), so the page's script stays
 * small; the address is made at run time, so the bundler leaves it out of app.js.
 */
let loadMermaid = (): Promise<MermaidModule> =>
  import(
    /* @vite-ignore */ new URL("/mermaid.js", window.location.href).href
  ) as Promise<MermaidModule>

/** Where Mermaid comes from on a page that is not the Cockpit (the website's demonstration bundles it). */
export function loadMermaidFrom(load: () => Promise<MermaidModule>): void {
  loadMermaid = load
}

export { endLifelines }

/**
 * Mermaid measures a diagram in a temporary element. Left to itself it adds that element to the end
 * of the page, so a render in flight makes the document taller and scrollable for a moment and
 * moves what a person is reading or pressing. It gets an element of its own, off the page's flow.
 */
function drawingRoom(): HTMLElement {
  const known = document.getElementById("mermaid-room")
  if (known !== null) return known
  const room = document.createElement("div")
  room.id = "mermaid-room"
  room.setAttribute("aria-hidden", "true")
  room.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:0;overflow:hidden;visibility:hidden;pointer-events:none"
  document.body.append(room)
  return room
}

/** The theme a drawing is made for: the one asked, else the page's own (its setting, then the system's). */
export function diagramTheme(asked?: string): DiagramTheme {
  if (asked === "light" || asked === "dark") return asked
  const set = typeof document === "undefined" ? undefined : document.documentElement.dataset.theme
  if (set === "light" || set === "dark") return set
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

/**
 * The page's theme, kept current. A diagram is drawn in literal colours, so it is drawn again
 * whenever the page changes theme: its setting (`data-theme`, the App's `dark` class) or, without
 * one, the system's. The page decides, not a surface's own idea of the theme.
 */
export function usePageTheme(): DiagramTheme {
  const [theme, setTheme] = useState<DiagramTheme>(() => diagramTheme())
  useEffect(() => {
    const update = () => setTheme(diagramTheme())
    const watch = new MutationObserver(update)
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    })
    const media =
      typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null
    media?.addEventListener("change", update)
    update()
    return () => {
      watch.disconnect()
      media?.removeEventListener("change", update)
    }
  }, [])
  return theme
}

/**
 * Draws a diagram in QualityLayer's one style (core/docs/mermaid-style.ts), the same in the App,
 * the shared pages and every export. A part the document marks `risk` is drawn in the App's colour
 * for human attention; its legend says it in words.
 */
export const renderWithMermaid: Renderer = async (id, source, theme) => {
  const mermaid = (await loadMermaid()).default
  mermaid.initialize(mermaidConfig(diagramTheme(theme)))
  try {
    const { svg } = await mermaid.render(id, source, drawingRoom())
    return riskTips(titleGroupsLeft(endLifelines(svg)))
  } finally {
    // Mermaid draws in a temporary element of the page and leaves it there when a diagram does
    // not parse: one per failed render, for as long as the Cockpit stays open.
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
  }
}

/** An amber part says why in a tooltip, so no sentence stands under the diagram. */
function riskTips(svg: string): string {
  return svg.replace(
    /(<g\b[^>]*\bclass="[^"]*\b(?:risky|risk)\b[^"]*"[^>]*>)/g,
    `$1<title>Risk: ${RISK_TIP.charAt(0).toLowerCase()}${RISK_TIP.slice(1)}</title>`,
  )
}

/** A comment pinned on the drawing: its anchor (see diagram-pins.ts), how many, and its thread. */
export type DiagramPin = { target: string; count: number; thread?: ReactNode }

export { diagramKind }

/**
 * How a diagram is named in its frame: a plain word and a mark, never the language it is written in.
 * The description is the tooltip. Kinds without a mark of their own use the diagram mark.
 */
const KIND_CAPTION: Record<string, { word: string; icon: typeof SplineIcon; tip: string }> = {
  flow: { word: "Flow", icon: SplineIcon, tip: "A rule and its outcomes" },
  sequence: { word: "Sequence", icon: ArrowRightLeftIcon, tip: "Who talks to whom, in order" },
  state: { word: "State", icon: WaypointsIcon, tip: "What it can be and what moves it" },
  architecture: { word: "Architecture", icon: BlocksIcon, tip: "What exists and how it connects" },
  class: { word: "Class", icon: ChartNetworkIcon, tip: "The types and how they relate" },
  data: { word: "Data", icon: ChartNetworkIcon, tip: "The records and how they relate" },
  commands: { word: "Commands", icon: ChartNetworkIcon, tip: "The commands and their options" },
}

/** The caption of a diagram's frame: its mark, the word for its kind, and what that kind shows as a tooltip. */
export function kindCaption(
  source: string,
  kind?: string,
): { word: string; icon: typeof SplineIcon; tip: string } {
  const own = KIND_CAPTION[diagramKind(source)] ?? KIND_CAPTION.architecture
  if (own === undefined) return { word: "Diagram", icon: ChartNetworkIcon, tip: "" }
  // A kind the document names in the plain words of ours (state, sequence) is that caption.
  const named = kind !== undefined ? KIND_CAPTION[kind] : undefined
  if (named !== undefined) return named
  // A lens the document names (request-lifecycle) is its own word, with the question it answers.
  if (kind !== undefined && kind !== "")
    return { word: kind, icon: own.icon, tip: LENS_QUESTION[kind] ?? own.tip }
  return own
}

/** The question each lens of the house style answers, shown beside its name in the frame. */
const LENS_QUESTION: Record<string, string> = {
  "request-lifecycle": "how a request enters and is handled",
  "data-flow": "where data comes from and lands",
  "state-transitions": "which states exist and what moves between them",
  "route-page-map": "which pages exist and how you move between them",
  "command-surface": "the commands and what they dispatch",
  "external-integrations": "what it talks to outside, and why",
  "dependency-map": "what depends on what",
  orchestration: "who publishes and who listens",
  storage: "how the stores relate",
  architecture: "what exists and how it connects",
  sequence: "who talks to whom, in order",
  state: "what it can be and what moves it",
  data: "the records and how they relate",
  screens: "the pages and how you move between them",
  commands: "the commands and their options",
  services: "what it talks to outside, and why",
  flow: "a rule and its outcomes",
}

const svgMarks = (svg: string) =>
  [...new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll("[class]")].flatMap(
    (element) => (element.getAttribute("class") ?? "").split(/\s+/),
  )

type Props = {
  source: string
  theme: string
  render?: Renderer
  onComment?: () => void
  /** Clicking a node or an arrow pins a comment on it; absent where the diagram takes none. */
  onPin?: (pinned: Pinned) => void
  /** The comments already pinned, each shown as a pin on its node or arrow. */
  pins?: DiagramPin[]
  /** An ask opened this exact node or edge; open its existing thread after drawing. */
  focusedPin?: string
  onLayout?: () => void
  /** The kind named in the frame's bar; the source says it when this is left out. */
  kind?: string
  /** Words for the frame's bar in place of the kind, where the reader needs to know whose diagram it is. */
  caption?: string
  /**
   * A thumbnail (a choice's diagram, a Plan call's, a step page's): the drawing scaled to fit its frame
   * whole, by width and height; the frame grows with the drawing up to 240 px. One Enlarge control (a click
   * on the diagram does the same) opens it fitted to the screen, with zoom. The bar is not drawn, and the
   * thumbnail itself takes no focus.
   */
  enlarge?: boolean
  /** A Plan figure preserves label size, expanding vertically and scrolling on its own x-axis. */
  gallery?: "natural" | "fit"
  /** The name to show to assistive technology in the full-size viewer. */
  title?: string
}

type Placed = { target: string; left: number; top: number }

/** Where each pin sits: the top right corner of the element it names, in the wrapper's own coordinates. */
function placePins(wrap: HTMLElement, pins: DiagramPin[]): Placed[] {
  const origin = wrap.getBoundingClientRect()
  const placed: Placed[] = []
  for (const pin of pins) {
    const el = find(wrap, pin.target)
    if (el === null) continue
    const box = el.getBoundingClientRect()
    placed.push({
      target: pin.target,
      left: box.right - origin.left - 9,
      top: box.top - origin.top - 9,
    })
  }
  return placed
}

/**
 * Fit an SVG that is on the page to what it draws: its viewBox and size. Returns its width, or
 * null when there is nothing to measure yet.
 */
export function fitToDrawing(svg: SVGSVGElement): number | null {
  let box: DOMRect
  try {
    box = svg.getBBox()
  } catch {
    return null
  }
  if (box.width === 0 || box.height === 0) return null
  const pad = 12
  svg.setAttribute(
    "viewBox",
    `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`,
  )
  const width = Math.ceil(box.width + pad * 2)
  svg.setAttribute("width", String(width))
  svg.setAttribute("height", String(Math.ceil(box.height + pad * 2)))
  svg.style.maxWidth = "none"
  return width
}

/** The smallest a diagram is drawn in its column: labels stay at about 11.5 px; a wider one scrolls, with a cue. */
const MIN_SCALE = 0.72
/** The tallest a thumbnail's frame grows (the corner label above the drawing and its padding included). */
const THUMB_MAX_HEIGHT = 240

/**
 * A thumbnail's drawing, scaled into the room its frame gives it, by width and height: the whole drawing
 * is always inside the frame, on a step page and in a choice card alike. Enlarge shows it full size.
 */
export function sizeThumbnail(body: HTMLElement, svg: SVGSVGElement, width: number): void {
  const height = Number(svg.getAttribute("height"))
  svg.style.maxWidth = ""
  svg.style.setProperty("--nat-w", String(width))
  svg.style.setProperty("--nat-h", String(height))
  const style = getComputedStyle(body)
  const room =
    body.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
  const tall =
    THUMB_MAX_HEIGHT - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom)
  if (!(room > 0) || !(height > 0)) return
  const scale = Math.min(1, room / width, tall / height)
  svg.style.width = `${Math.round(width * scale)}px`
  svg.style.height = `${Math.round(height * scale)}px`
}

/**
 * Mermaid sizes its SVG from a measurement taken off-screen; with the page's own
 * fonts and styles the drawing can end up larger than that box and be clipped.
 * Once the diagram is on the page, fit it to what it draws. Returns what stops
 * the refitting, for when the diagram leaves the page.
 */
function updateDiagramOverflow(body: HTMLDivElement | null) {
  if (body === null) return
  const remaining = body.scrollWidth - body.clientWidth - body.scrollLeft
  body.dataset.more = remaining > 4 ? "right" : ""
}

/** The figure can fit a wide drawing, down to 12.1 CSS pixels for its smallest label. */
function galleryWidth(svg: SVGSVGElement, width: number, room: number): number {
  const smallest = Array.from(svg.querySelectorAll("text")).reduce((size, label) => {
    const font = Number.parseFloat(getComputedStyle(label).fontSize)
    return label.textContent?.trim() && font > 0 ? Math.min(size, font) : size
  }, Number.POSITIVE_INFINITY)
  const readable = width * Math.min(1, 12.1 / smallest)
  return Math.min(width, Math.ceil(Math.max(room, readable)))
}

function fitReaderDrawing(body: HTMLDivElement, svg: SVGSVGElement, width: number): void {
  const gallery = body.closest<HTMLElement>("[data-diagram-gallery]")?.dataset.diagramGallery
  const room = body.clientWidth - (gallery ? 24 : 36)
  if (gallery === "natural" || room <= 0 || width <= room) return
  const drawn =
    gallery === "fit"
      ? galleryWidth(svg, width, room)
      : Math.max(room, Math.ceil(width * MIN_SCALE))
  svg.setAttribute("width", String(drawn))
  svg.removeAttribute("height")
}

function fitDiagram(body: HTMLDivElement | null, onLayout?: () => void): () => void {
  if (!body) return () => {}
  const svg = body.querySelector("svg")
  if (svg === null || typeof svg.getBBox !== "function") return () => {}
  const fit = () => {
    const width = fitToDrawing(svg)
    if (width === null) return
    // A thumbnail fits its frame whole, by width and height; the frame grows with it up to 240 px.
    // Enlarge shows the drawing full size.
    if (body.closest('[data-enlarge="true"]')) {
      sizeThumbnail(body, svg, width)
      onLayout?.()
      return
    }
    // Too wide: scale it to the column, down to 72 %, so a label stays at 11 px or more; wider still, keep that
    // size and scroll (the fullscreen view has the natural size and zoom).
    fitReaderDrawing(body, svg, width)
    more()
    onLayout?.()
  }
  // A drawing that runs past the column's right edge fades there until the reader scrolls to its
  // end: an overlay scrollbar (macOS) is hidden until someone scrolls, so the cut looked like the end.
  const more = () => updateDiagramOverflow(body)
  body.addEventListener("scroll", more, { passive: true })
  fit()
  // Web fonts can arrive after the first paint and change the text's width.
  void document.fonts?.ready.then(fit)
  // The column widens and narrows with the panels beside it.
  if (typeof ResizeObserver !== "undefined") {
    let last = body.clientWidth
    const watch = new ResizeObserver(() => {
      if (body.clientWidth === last) return
      last = body.clientWidth
      fit()
    })
    watch.observe(body)
    return () => {
      watch.disconnect()
      body.removeEventListener("scroll", more)
    }
  }
  return () => body.removeEventListener("scroll", more)
}

/** A ref that fits the diagram it is given and stops refitting the one it had before. */
function useFittedDiagram(fit: (el: HTMLDivElement) => () => void) {
  const stop = useRef<() => void>(() => {})
  return useCallback(
    (el: HTMLDivElement | null) => {
      stop.current()
      stop.current = el === null ? () => {} : fit(el)
    },
    [fit],
  )
}

/** A Mermaid diagram of the document, in its frame. */
export function MermaidBlock({
  source,
  theme,
  render = renderWithMermaid,
  onComment,
  onPin,
  pins = [],
  focusedPin,
  onLayout,
  kind,
  caption,
  enlarge = false,
  gallery,
  title,
}: Props) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [full, setFull] = useState(false)
  const view = useDiagramZoom()
  const body = useRef<HTMLDivElement | null>(null)
  const layoutCallback = useRef(onLayout)
  layoutCallback.current = onLayout
  const fit = useCallback(
    (element: HTMLDivElement) => fitDiagram(element, () => layoutCallback.current?.()),
    [],
  )
  const fitted = useFittedDiagram(fit)
  const place = useCallback(
    (el: HTMLDivElement | null) => {
      body.current = el
      fitted(el)
    },
    [fitted],
  )
  // A new drawing (another theme, an edited source) lands in the same element: fit it again, as the
  // first one was, instead of leaving it at its natural size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `svg` is the new drawing to fit
  useEffect(() => {
    if (body.current !== null) fitted(body.current)
  }, [svg, fitted])
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const [placed, setPlaced] = useState<Placed[]>([])
  const [opened, setOpened] = useState<string | null>(null)
  useEffect(() => {
    if (!focusedPin || !svg || !wrap.current) return
    const target = find(wrap.current, focusedPin)
    if (!target) return
    target.setAttribute("data-focused-pin", focusedPin)
    target.scrollIntoView?.({ block: "center", inline: "center" })
    setOpened(focusedPin)
    return () => target.removeAttribute("data-focused-pin")
  }, [focusedPin, svg])
  const marks = useMemo(() => (svg === null ? [] : svgMarks(svg)), [svg])

  // The zoom belongs to the reader, not to the drawing: a new drawing starts at the zoom they chose.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `svg` replaces the drawn element
  useEffect(() => {
    const drawn = body.current?.querySelector("svg")
    if (drawn !== null && drawn !== undefined) {
      drawn.style.zoom = String(view.zoom)
      updateDiagramOverflow(body.current)
    }
  }, [view.zoom, svg])

  // The drawing's colours follow the page's theme as it is (usePageTheme); a surface's own `theme`
  // only tells it when to look again.
  const pageTheme = usePageTheme()
  // biome-ignore lint/correctness/useExhaustiveDependencies: a surface's theme change redraws too
  useEffect(() => {
    let live = true
    counter++
    render(`mermaid-${counter}`, source, pageTheme)
      .then((result) => {
        if (!live) return
        setSvg(result)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!live) return
        setSvg(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      live = false
    }
  }, [source, theme, pageTheme, render])

  const drawn = svg !== null && error === null
  const named = kindCaption(source, kind)
  const pinKey = pins.map((p) => `${p.target}:${p.count}`).join("|")
  // Mark what a click can pin, and put each pin on its element once the drawing is on the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the drawing and the pins decide when to lay them out
  useLayoutEffect(() => {
    const root = wrap.current
    if (root === null || !drawn) return
    if (onPin !== undefined) markPinnable(root)
    setPlaced(placePins(root, pins))
    // Only a diagram that carries pins needs to know when its column changes width.
    if (pins.length === 0 || typeof ResizeObserver === "undefined") return
    const watch = new ResizeObserver(() => setPlaced(placePins(root, pins)))
    watch.observe(root)
    return () => watch.disconnect()
  }, [drawn, svg, view.zoom, pinKey, onPin])
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a border and a legend the block does not want
    <div
      className="visual"
      data-testid="mermaid"
      data-enlarge={enlarge ? "true" : undefined}
      data-diagram-gallery={gallery}
      role="group"
      aria-label={
        gallery ? title : enlarge ? `${named.word} diagram` : "Diagram: + and − zoom, 0 fits"
      }
      // Focus is what lets + − 0 zoom a diagram; a thumbnail has no zoom, so its Enlarge button is the one stop.
      tabIndex={enlarge || gallery ? undefined : 0}
      onKeyDown={(e) => {
        // A thumbnail has no zoom bar; Enlarge opens the view that does.
        if (enlarge || gallery) return
        // The fullscreen dialog is portalled out of this block but its events still bubble to it.
        if (e.currentTarget.contains(e.target as Node)) view.onKeyDown(e)
      }}
    >
      {/* A thumbnail has no bar: its kind and Enlarge stand in the drawing's corners. */}
      {gallery && drawn ? (
        <button type="button" className="q-btn sm gal-full-figure" onClick={() => setFull(true)}>
          <Maximize2Icon aria-hidden="true" />
          Open full size
        </button>
      ) : null}
      {gallery || enlarge ? null : (
        <div className="visual-bar">
          {caption !== undefined ? (
            <span className="visual-kind visual-caption">{caption}</span>
          ) : (
            <span className="visual-kind visual-kind-named" title={named.tip}>
              <named.icon aria-hidden="true" />
              {named.word}
            </span>
          )}
          {error === null ? (
            <span className="visual-ok">
              {onPin !== undefined
                ? (pins ?? []).reduce((n, pin) => n + pin.count, 0) > 0
                  ? `${(pins ?? []).reduce((n, pin) => n + pin.count, 0)} thread${(pins ?? []).reduce((n, pin) => n + pin.count, 0) === 1 ? "" : "s"}`
                  : "click a node to give feedback"
                : null}
            </span>
          ) : (
            <span className="visual-bad">does not parse</span>
          )}
          <span className="visual-spacer" />
          {drawn ? (
            <>
              <VisualAction label="Zoom out" hint="Zoom out (−)" onClick={view.zoomOut}>
                <ZoomOutIcon />
              </VisualAction>
              <VisualAction label="Zoom in" hint="Zoom in (+)" onClick={view.zoomIn}>
                <ZoomInIcon />
              </VisualAction>
              <VisualAction label="Fit" hint="Fit to the block (0)" onClick={view.fit}>
                <ScanIcon />
              </VisualAction>
            </>
          ) : null}
          {onComment !== undefined ? (
            <VisualAction label="Give feedback on this diagram" onClick={onComment}>
              <MessageSquarePlusIcon />
            </VisualAction>
          ) : null}
          <VisualAction
            label="Show the source"
            pressed={showSource}
            onClick={() => setShowSource((v) => !v)}
          >
            <CodeIcon />
          </VisualAction>
          {drawn ? (
            <VisualAction
              label="Open the diagram fullscreen"
              hint="Open fullscreen"
              onClick={() => setFull(true)}
            >
              <Maximize2Icon />
            </VisualAction>
          ) : null}
        </div>
      )}
      {error !== null ? <div className="visual-error">{error}</div> : null}
      {drawn ? (
        <div className="q-diagram" ref={wrap} data-testid="diagram">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useSemanticElements: the diagram is an interactive scrolling group without fieldset chrome; the keyboard has "Give feedback on this diagram" in the bar above */}
          <div
            // A diagram wider than its column scrolls, and a scrolling region takes the keyboard's focus;
            // a thumbnail never scrolls (it holds the whole drawing), so it takes none.
            tabIndex={enlarge ? undefined : 0}
            role="group"
            aria-label={gallery ? "Diagram drawing" : undefined}
            className={view.zoom > 1 ? "mermaid-body zoomed" : "mermaid-body"}
            ref={place}
            onClick={(e) => {
              if (enlarge) {
                setFull(true)
                return
              }
              if (onPin === undefined || wrap.current === null) return
              const pinned = describe(e.target as Element, wrap.current)
              if (pinned !== null) onPin(pinned)
            }}
            // Above zoom 1 the block grows to 70vh and a drag pans it.
            onPointerDown={(e) => {
              if (view.zoom <= 1) return
              pan.current = {
                x: e.clientX,
                y: e.clientY,
                left: e.currentTarget.scrollLeft,
                top: e.currentTarget.scrollTop,
              }
              e.currentTarget.setPointerCapture?.(e.pointerId)
            }}
            onPointerMove={(e) => {
              const from = pan.current
              if (from === null) return
              e.currentTarget.scrollLeft = from.left - (e.clientX - from.x)
              e.currentTarget.scrollTop = from.top - (e.clientY - from.y)
            }}
            onPointerUp={() => {
              pan.current = null
            }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid's own sanitised SVG, strict security level
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {enlarge ? (
            <>
              <span className="visual-corner" aria-hidden="true">
                <named.icon />
                {named.word}
              </span>
              <span className="visual-enlarge">
                <VisualAction
                  label="Enlarge the diagram"
                  hint="Enlarge the diagram"
                  onClick={() => setFull(true)}
                >
                  <Maximize2Icon />
                </VisualAction>
              </span>
            </>
          ) : (
            <span className="visual-scroll" aria-hidden="true">
              Scroll
              <ChevronsRightIcon />
            </span>
          )}
          {placed.map((spot) => {
            const pin = pins.find((p) => p.target === spot.target)
            if (pin === undefined) return null
            return (
              <span key={spot.target}>
                <button
                  type="button"
                  className="q-pin"
                  style={{ left: spot.left, top: spot.top }}
                  aria-label={`${pin.count} ${pin.count === 1 ? "comment" : "comments"} on this part of the diagram`}
                  aria-expanded={opened === spot.target}
                  onClick={() => setOpened(opened === spot.target ? null : spot.target)}
                >
                  {pin.count}
                </button>
                {opened === spot.target && pin.thread !== undefined ? (
                  <div
                    className="q-thread"
                    data-testid="pin-thread"
                    style={{
                      position: "relative",
                      left: Math.max(8, spot.left - 300),
                      marginTop: 8,
                    }}
                  >
                    {pin.thread}
                  </div>
                ) : null}
              </span>
            )
          })}
        </div>
      ) : null}
      {drawn ? <VisualLegend marks={marks} /> : null}
      {showSource || error !== null ? (
        <pre>
          <code>{source}</code>
        </pre>
      ) : null}
      {svg !== null ? (
        <DiagramFullscreen
          svg={svg}
          open={full}
          onClose={() => setFull(false)}
          caption={named}
          title={title}
        />
      ) : null}
    </div>
  )
}

/**
 * The drawing's size for the fullscreen viewport: the SVG fitted to what it draws, at its own pixels.
 * Without a layout (no bounding box yet) it is the size the SVG itself names.
 */
function measureDrawing(layer: HTMLElement): { width: number; height: number } | null {
  const svg = layer.querySelector("svg")
  if (svg === null) return null
  const width = fitToDrawing(svg)
  const height = Number(svg.getAttribute("height"))
  if (width !== null && height > 0) return { width, height }
  const [, , boxWidth, boxHeight] = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number)
  if (boxWidth !== undefined && boxHeight !== undefined && boxWidth > 0 && boxHeight > 0)
    return { width: boxWidth, height: boxHeight }
  return null
}

/**
 * The diagram in a fullscreen dialog, fitted to the screen and centred, in a viewport that pans and
 * zooms (PanZoomViewport): drag, the arrow keys, the wheel or a pinch, + − 0 and the bar's buttons.
 * Escape or the backdrop closes it. The same sanitised SVG, never a new window.
 */
function DiagramFullscreen({
  svg,
  open,
  onClose,
  caption,
  title = "Diagram",
}: {
  svg: string
  open: boolean
  onClose: () => void
  caption: { word: string; icon: typeof SplineIcon; tip: string }
  title: string | undefined
}) {
  const pan = usePanZoom()
  const { zoomIn, zoomOut, fit } = pan
  return (
    <FullscreenDialog
      open={open}
      onClose={onClose}
      title={title}
      testId="diagram-fullscreen"
      onKeyDown={pan.onKeyDown}
      bar={
        <span className="visual-kind visual-kind-named" title={caption.tip}>
          <caption.icon aria-hidden="true" />
          {caption.word}
        </span>
      }
      actions={
        <>
          <VisualAction label="Zoom out" hint="Zoom out (−)" onClick={zoomOut}>
            <ZoomOutIcon />
          </VisualAction>
          <span className="w-12 text-center" data-testid="diagram-zoom">
            {pan.percent}%
          </span>
          <VisualAction label="Zoom in" hint="Zoom in (+)" onClick={zoomIn}>
            <ZoomInIcon />
          </VisualAction>
          <VisualAction label="Fit to the screen" hint="Fit (0)" onClick={fit}>
            <ScanIcon />
          </VisualAction>
        </>
      }
    >
      <PanZoomViewport
        pan={pan}
        measure={measureDrawing}
        contentKey={svg}
        label={`${caption.word} diagram: drag or use the arrow keys to move, the wheel or + − to zoom, 0 to fit`}
        testId="diagram-viewport"
      >
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid's own sanitised SVG, strict security level
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </PanZoomViewport>
    </FullscreenDialog>
  )
}
