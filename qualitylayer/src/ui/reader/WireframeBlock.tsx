import {
  CodeIcon,
  CopyIcon,
  Maximize2Icon,
  MessageSquarePlusIcon,
  ScanIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { type FragmentKind, SURFACES } from "../../core/docs/fence-header.ts"
import { elementPin, type Pinned } from "./diagram-pins.ts"
import { FencedFrame } from "./FencedFrame.tsx"
import { FenceRenderer } from "./FenceRenderer.ts"
import { type FragmentsModule, useFragments } from "./fragments.ts"
import { useDiagramZoom } from "./MermaidBlock.tsx"
import { VisualLegend } from "./VisualLegend.tsx"
import { FullscreenDialog, VisualAction } from "./VisualParts.tsx"

type WireframeProps = {
  source: string
  theme: string
  kind?: FragmentKind
  identity?: string
  onPin?: (pin: Pinned) => void
}

export function WireframeBlock(props: WireframeProps) {
  const render = useContext(FenceRenderer)
  return render === null ? (
    <LocalWireframeBlock {...props} />
  ) : (
    render(props.kind ?? "wireframe", props.source)
  )
}

/**
 * The parsers ride in /fragments.js, fetched the first time a block needs them. Until they arrive it keeps its frame space and shows
 * its bar, as a diagram does while Mermaid loads; if they cannot be fetched it says why and shows
 * the source, as a diagram that cannot be drawn does. Nothing is drawn without validation.
 */
function LocalWireframeBlock(props: WireframeProps) {
  const { fragments, error } = useFragments()
  if (fragments !== null) return <DrawnWireframe {...props} fragments={fragments} />
  const kind = props.kind ?? "wireframe"
  return (
    <div
      className="visual fenced-visual"
      data-testid={kind}
      aria-busy={error === null ? "true" : undefined}
      // The frame's default space is kept while the parsers are on their way, so nothing jumps.
      style={error === null ? { minHeight: 280 } : undefined}
    >
      <div className="visual-bar">
        <span className="visual-kind">{kind}</span>
        <span>{props.identity ?? kind}</span>
      </div>
      {error !== null ? (
        <>
          <p className="visual-error">{error}</p>
          <pre>
            <code>{props.source}</code>
          </pre>
        </>
      ) : null}
    </div>
  )
}

function WireframeBar({
  kind,
  title,
  surfaceOrLens,
  scale,
  state,
  comment,
  showSource,
  canPin,
  canFullscreen,
  onToggleComment,
  onToggleSource,
  onOpenFullscreen,
}: {
  kind: FragmentKind
  title: string
  surfaceOrLens: string | undefined
  scale: number
  state: string | undefined
  comment: boolean
  showSource: boolean
  canPin: boolean
  canFullscreen: boolean
  onToggleComment: () => void
  onToggleSource: () => void
  onOpenFullscreen: () => void
}) {
  return (
    <div className="visual-bar max-sm:[&_button]:size-11" style={{ flexWrap: "wrap" }}>
      <span className="visual-kind">{kind}</span>
      <span>{title}</span>
      <span>{surfaceOrLens}</span>
      {scale < 1 ? <span>shown at {Math.round(scale * 100)}%</span> : null}
      {state ? <span>{state}</span> : null}
      {comment ? <span>click a box to give feedback</span> : null}
      <span className="visual-spacer" />
      {canPin ? (
        <VisualAction
          label={`Give feedback on this ${kind}`}
          pressed={comment}
          onClick={onToggleComment}
        >
          <MessageSquarePlusIcon />
        </VisualAction>
      ) : null}
      <VisualAction label="Show the source" pressed={showSource} onClick={onToggleSource}>
        <CodeIcon />
      </VisualAction>
      <VisualAction
        label={`Open the ${kind} fullscreen`}
        disabled={!canFullscreen}
        onClick={onOpenFullscreen}
      >
        <Maximize2Icon />
      </VisualAction>
    </div>
  )
}

function WireframeFullscreen({
  open,
  onClose,
  kind,
  title,
  width,
  height,
  comment,
  canPin,
  onToggleComment,
  zoom,
  frame,
}: {
  open: boolean
  onClose: () => void
  kind: FragmentKind
  title: string
  width: number
  height: number
  comment: boolean
  canPin: boolean
  onToggleComment: () => void
  zoom: ReturnType<typeof useDiagramZoom>
  frame: React.ReactNode
}) {
  return (
    <FullscreenDialog
      open={open}
      onClose={onClose}
      title={`${kind}: ${title}`}
      testId="fence-fullscreen"
      onKeyDown={zoom.onKeyDown}
      bar={
        <span>
          {kind} · {title}
        </span>
      }
      actions={
        <>
          {kind === "panel" ? (
            <>
              <VisualAction label="Zoom out" onClick={zoom.zoomOut}>
                <ZoomOutIcon />
              </VisualAction>
              <span>{Math.round(zoom.zoom * 100)}%</span>
              <VisualAction label="Zoom in" onClick={zoom.zoomIn}>
                <ZoomInIcon />
              </VisualAction>
              <VisualAction label="Fit" onClick={zoom.fit}>
                <ScanIcon />
              </VisualAction>
            </>
          ) : null}
          {canPin ? (
            <VisualAction
              label={`Give feedback on this ${kind}`}
              pressed={comment}
              onClick={onToggleComment}
            >
              <MessageSquarePlusIcon />
            </VisualAction>
          ) : null}
        </>
      }
    >
      <div style={{ width: width * zoom.zoom, height: height * zoom.zoom }}>
        <div style={{ width, transform: `scale(${zoom.zoom})`, transformOrigin: "top left" }}>
          {frame}
        </div>
      </div>
    </FullscreenDialog>
  )
}

function DrawnWireframe({
  source,
  theme,
  kind = "wireframe",
  identity,
  onPin,
  fragments,
}: WireframeProps & { fragments: FragmentsModule }) {
  const { fencedPage, fragmentIds, panelNodes, parseFence } = fragments
  const parsed = useMemo(() => parseFence(kind, source), [kind, source, parseFence])
  const [comment, setComment] = useState(false)
  const [full, setFull] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [room, setRoom] = useState(840)
  const [height, setHeight] = useState(280)
  const zoom = useDiagramZoom()
  const host = useRef<HTMLDivElement>(null)
  const width = kind === "panel" ? room : (SURFACES[parsed.header.surface ?? "desktop"] ?? 840)
  const scale = Math.min(1, room / width)
  const ids = useMemo(
    () => fragmentIds(kind, parsed.fragment),
    [kind, parsed.fragment, fragmentIds],
  )
  const marks = useMemo(
    () => (kind === "panel" ? panelNodes(parsed.fragment).flatMap((node) => node.marks) : []),
    [kind, parsed.fragment, panelNodes],
  )
  const html = useMemo(
    () => fencedPage(kind, source, theme, comment && onPin !== undefined),
    [kind, source, theme, comment, onPin, fencedPage],
  )
  useEffect(() => {
    const el = host.current
    if (el === null || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width
      if (nextWidth !== undefined && nextWidth > 0) setRoom(nextWidth)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const name = parsed.header.name ?? identity ?? kind
  const title = parsed.header.title ?? name
  const pin = (id: string, label: string) => {
    const target = elementPin(name, id)
    if (target !== null) onPin?.({ target, label })
  }
  const frame = (
    <FencedFrame
      html={html ?? ""}
      title={title}
      width={width}
      height={height}
      ids={ids}
      comment={comment}
      onHeight={setHeight}
      onPin={pin}
    />
  )
  return (
    <div className="visual fenced-visual" data-testid={kind}>
      <WireframeBar
        kind={kind}
        title={title}
        surfaceOrLens={parsed.header.surface ?? parsed.header.lens}
        scale={scale}
        state={parsed.header.state}
        comment={comment}
        showSource={showSource}
        canPin={onPin !== undefined}
        canFullscreen={html !== null}
        onToggleComment={() => setComment((v) => !v)}
        onToggleSource={() => setShowSource((v) => !v)}
        onOpenFullscreen={() => setFull(true)}
      />
      {html === null ? (
        <>
          <p className="visual-error">
            {parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join("; ")}
          </p>
          <pre>
            <code>{source}</code>
          </pre>
        </>
      ) : (
        <div ref={host} style={{ overflow: "hidden", height: height * scale }}>
          <div style={{ width, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            {frame}
          </div>
        </div>
      )}
      {showSource && html !== null ? (
        <div>
          <VisualAction
            label="Copy source"
            onClick={() => {
              void navigator.clipboard.writeText(source)
            }}
          >
            <CopyIcon />
          </VisualAction>
          <pre>
            <code>{source}</code>
          </pre>
        </div>
      ) : null}
      {html !== null && kind === "panel" ? <VisualLegend marks={marks} /> : null}
      {html !== null ? (
        <WireframeFullscreen
          open={full}
          onClose={() => setFull(false)}
          kind={kind}
          title={title}
          width={width}
          height={height}
          comment={comment}
          canPin={onPin !== undefined}
          onToggleComment={() => setComment((v) => !v)}
          zoom={zoom}
          frame={frame}
        />
      ) : null}
    </div>
  )
}
