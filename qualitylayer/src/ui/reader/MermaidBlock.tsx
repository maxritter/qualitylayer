// Mermaid ships with the Cockpit (no CDN) as a file of its own, loaded and initialised lazily, strict mode,
// themed from the Cockpit tokens. A render failure shows the parser's message
// and the source instead of an empty box.

import { Maximize2Icon } from "lucide-react"
import { type ReactNode, type RefObject, useMemo, useRef, useState } from "react"
import { describe, type Pinned } from "./diagram-pins.ts"
import {
  DiagramFullscreen,
  MermaidBar,
  MermaidOverlayControls,
  MermaidPins,
} from "./MermaidParts.tsx"
import { useDiagramBodyFit, useDiagramPins, useMermaidRender } from "./mermaid-hooks.ts"
import { fitToDrawing, type Placed, sizeThumbnail } from "./mermaid-layout.ts"
import {
  diagramKind,
  diagramTheme,
  endLifelines,
  type KindCaption,
  kindCaption,
  loadMermaidFrom,
  type Renderer,
  renderWithMermaid,
  svgMarks,
  useDiagramZoom,
  usePageTheme,
} from "./mermaid-runtime.ts"
import { VisualLegend } from "./VisualLegend.tsx"

export {
  diagramKind,
  diagramTheme,
  endLifelines,
  fitToDrawing,
  kindCaption,
  loadMermaidFrom,
  type Renderer,
  renderWithMermaid,
  sizeThumbnail,
  useDiagramZoom,
  usePageTheme,
}

/** A comment pinned on the drawing: its anchor (see diagram-pins.ts), how many, and its thread. */
export type DiagramPin = { target: string; count: number; thread?: ReactNode }

type Props = {
  source: string
  theme: string
  render?: Renderer
  onComment?: () => void
  onPin?: (pinned: Pinned) => void
  pins?: DiagramPin[]
  focusedPin?: string
  onLayout?: () => void
  kind?: string
  caption?: string
  enlarge?: boolean
  gallery?: "natural" | "fit"
  title?: string
}

function MermaidCanvas({
  wrap,
  place,
  svg,
  zoom,
  enlarge,
  gallery,
  named,
  pins,
  placed,
  opened,
  onTogglePin,
  onEnlarge,
  onPin,
}: {
  wrap: RefObject<HTMLDivElement | null>
  place: (el: HTMLDivElement | null) => void
  svg: string
  zoom: number
  enlarge: boolean
  gallery?: "natural" | "fit"
  named: KindCaption
  pins: readonly DiagramPin[]
  placed: readonly Placed[]
  opened: string | null
  onTogglePin: (target: string) => void
  onEnlarge: () => void
  onPin?: (pinned: Pinned) => void
}) {
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  return (
    <div className="q-diagram" ref={wrap} data-testid="diagram">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useSemanticElements: the diagram is an interactive scrolling group without fieldset chrome; the keyboard has "Give feedback on this diagram" in the bar above */}
      <div
        tabIndex={enlarge ? undefined : 0}
        role="group"
        aria-label={gallery ? "Diagram drawing" : undefined}
        className={zoom > 1 ? "mermaid-body zoomed" : "mermaid-body"}
        ref={place}
        onClick={(e) => {
          if (enlarge) onEnlarge()
          else if (onPin !== undefined && wrap.current !== null) {
            const pinned = describe(e.target as Element, wrap.current)
            if (pinned !== null) onPin(pinned)
          }
        }}
        onPointerDown={(e) => {
          if (zoom <= 1) return
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
      <MermaidOverlayControls enlarge={enlarge} named={named} onEnlarge={onEnlarge} />
      <MermaidPins placed={placed} pins={pins} opened={opened} onToggle={onTogglePin} />
    </div>
  )
}

function diagramAriaLabel(
  gallery: Props["gallery"],
  enlarge: boolean,
  title: string | undefined,
  word: string,
): string | undefined {
  if (gallery) return title
  return enlarge ? `${word} diagram` : "Diagram: + and − zoom, 0 fits"
}

function MermaidHeaderBar({
  gallery,
  enlarge,
  drawn,
  caption,
  named,
  error,
  canPin,
  pins,
  view,
  onComment,
  showSource,
  onToggleSource,
  onOpenFullscreen,
}: {
  gallery: Props["gallery"]
  enlarge: boolean
  drawn: boolean
  caption?: string
  named: KindCaption
  error: string | null
  canPin: boolean
  pins: readonly DiagramPin[]
  view: ReturnType<typeof useDiagramZoom>
  onComment?: () => void
  showSource: boolean
  onToggleSource: () => void
  onOpenFullscreen: () => void
}) {
  if (gallery) {
    return drawn ? (
      <button type="button" className="q-btn sm gal-full-figure" onClick={onOpenFullscreen}>
        <Maximize2Icon aria-hidden="true" />
        Open full size
      </button>
    ) : null
  }
  if (enlarge) return null
  return (
    <MermaidBar
      caption={caption}
      named={named}
      error={error}
      canPin={canPin}
      pins={pins}
      drawn={drawn}
      view={view}
      onComment={onComment}
      showSource={showSource}
      onToggleSource={onToggleSource}
      onOpenFullscreen={onOpenFullscreen}
    />
  )
}

function MermaidExtras({
  source,
  svg,
  error,
  drawn,
  marks,
  showSource,
  full,
  onCloseFull,
  named,
  title,
}: {
  source: string
  svg: string | null
  error: string | null
  drawn: boolean
  marks: ReturnType<typeof svgMarks>
  showSource: boolean
  full: boolean
  onCloseFull: () => void
  named: ReturnType<typeof kindCaption>
  title?: string
}) {
  return (
    <>
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
          onClose={onCloseFull}
          caption={named}
          title={title}
        />
      ) : null}
    </>
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
  const { svg, error } = useMermaidRender(source, theme, render)
  const [showSource, setShowSource] = useState(false)
  const [full, setFull] = useState(false)
  const view = useDiagramZoom()
  const wrap = useRef<HTMLDivElement | null>(null)
  const place = useDiagramBodyFit(svg, view.zoom, onLayout)
  const drawn = svg !== null && error === null
  const marks = useMemo(() => (svg === null ? [] : svgMarks(svg)), [svg])
  const named = kindCaption(source, kind)
  const interactive = !enlarge && !gallery
  const { placed, opened, setOpened } = useDiagramPins({
    wrap,
    drawn,
    svg,
    zoom: view.zoom,
    pins,
    focusedPin,
    onPin,
  })
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a border and a legend the block does not want
    <div
      className="visual"
      data-testid="mermaid"
      data-enlarge={enlarge ? "true" : undefined}
      data-diagram-gallery={gallery}
      role="group"
      aria-label={diagramAriaLabel(gallery, enlarge, title, named.word)}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(e) => {
        if (interactive && e.currentTarget.contains(e.target as Node)) view.onKeyDown(e)
      }}
    >
      <MermaidHeaderBar
        gallery={gallery}
        enlarge={enlarge}
        drawn={drawn}
        caption={caption}
        named={named}
        error={error}
        canPin={onPin !== undefined}
        pins={pins}
        view={view}
        onComment={onComment}
        showSource={showSource}
        onToggleSource={() => setShowSource((v) => !v)}
        onOpenFullscreen={() => setFull(true)}
      />
      {error !== null ? <div className="visual-error">{error}</div> : null}
      {drawn ? (
        <MermaidCanvas
          wrap={wrap}
          place={place}
          svg={svg}
          zoom={view.zoom}
          enlarge={enlarge}
          gallery={gallery}
          named={named}
          pins={pins}
          placed={placed}
          opened={opened}
          onTogglePin={(target) => setOpened(opened === target ? null : target)}
          onEnlarge={() => setFull(true)}
          onPin={onPin}
        />
      ) : null}
      <MermaidExtras
        source={source}
        svg={svg}
        error={error}
        drawn={drawn}
        marks={marks}
        showSource={showSource}
        full={full}
        onCloseFull={() => setFull(false)}
        named={named}
        title={title}
      />
    </div>
  )
}
