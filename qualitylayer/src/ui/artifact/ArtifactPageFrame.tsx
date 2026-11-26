// An artifact in its sandbox: an iframe with allow-scripts and no allow-same-origin, its page given as
// srcdoc with the no-network policy first, so it cannot reach the App, its token or the network. The
// bridge the server put into the page is its only voice: layout, deliberate feedback, selected words
// and the App's keys pressed inside it, accepted from this frame's own window only.

import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import type { ArtifactElementRef } from "../../core/artifact/format.ts"
import { type BridgeMessage, onScreen, readBridge } from "./artifact-frame-bridge.ts"
import { buildFrameSource } from "./artifact-frame-source.ts"

export { onScreen, readBridge }

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
/** What the person marked on the page: a spot, an element, a dragged region or selected words. */
export type ArtifactMark = {
  mark: "spot" | "element" | "region" | "text"
  /** In page pixels: the spot, or the element's, region's or passage's top left. */
  x: number
  y: number
  width?: number
  height?: number
  /** The `data-screen-label` of the part it is in. */
  section?: string
  /** Identified DOM element when clicking an element in Annotate mode (#268). */
  target?: ArtifactElementRef
  /** Identified DOM elements inside a dragged rectangle (#268). */
  targets?: ArtifactElementRef[]
  quote: string
  /** The passage's lines or the region, in the App's viewport pixels once `onMark` hears them. */
  boxes: { x: number; y: number; width: number; height: number }[]
  /** The spot on screen, for the pin. */
  point?: { x: number; y: number }
}

/** Persistent overlay drawn inside the artifact frame for multi-place annotations (#268). */
export type ArtifactPinOverlay = {
  num: number
  kind: "element" | "region" | "spot"
  x: number
  y: number
  width: number
  height: number
  active?: boolean
}
export type ArtifactScroll = { x: number; y: number; unit: 0 | 1 | 2 | 3 }

type FrameHandlers = {
  onMark?: (mark: ArtifactMark) => void
  onSelection?: (selection: ArtifactMark | null) => void
  onLayout?: (layout: ArtifactLayout) => void
  onKey?: (key: string) => void
  onScroll?: (scroll: ArtifactScroll) => void
  onAnchor?: (position: { x: number; y: number }) => void
  onPage?: (page: string, section?: string) => void
  onRuntimeError?: (message: string) => void
}

type Props = FrameHandlers & {
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
  /** Stay armed across multiple element/region marks for batch screen feedback (#268). */
  multi?: boolean
  /** Numbered pin/region overlays rendered inside the frame (#268). */
  pins?: readonly ArtifactPinOverlay[]
  className?: string
  theme?: "light" | "dark"
  /**
   * An inline preview: the page cannot take focus or scroll anything into view, so an artifact that
   * autofocuses its own controls never moves the page around it. Cards and full size stay interactive.
   */
  still?: boolean
}

/** The margin of the dotted canvas around the page's card, in px (`.dg-cvs` pads by the same). */
export const CANVAS_PAD = 24

/** The width a page may fill in a canvas `room` px wide: the room less the margin on both sides. */
export const fitRoom = (room: number): number => Math.max(room - 2 * CANVAS_PAD, room / 2)

function dispatchSelectionMessage(
  selection: ArtifactMark | null,
  frame: HTMLIFrameElement,
  handlers: FrameHandlers,
  live: { marking: boolean; armed: boolean },
) {
  if (!live.marking || live.armed || selection === null) {
    handlers.onSelection?.(null)
    return
  }
  handlers.onSelection?.({ ...selection, boxes: onScreen(frame, selection.boxes) })
}

function dispatchMarkMessage(
  mark: ArtifactMark,
  frame: HTMLIFrameElement,
  handlers: FrameHandlers,
  live: { marking: boolean; armed: boolean },
) {
  if (!live.marking || !live.armed) return
  const [point] = onScreen(frame, [{ x: mark.x, y: mark.y, width: 0, height: 0 }])
  handlers.onMark?.({
    ...mark,
    boxes: onScreen(frame, mark.boxes),
    ...(point ? { point: { x: point.x, y: point.y } } : {}),
  })
}

function dispatchBridgeMessage(
  said: BridgeMessage,
  frame: HTMLIFrameElement,
  handlers: FrameHandlers,
  live: { marking: boolean; armed: boolean },
) {
  switch (said.kind) {
    case "layout":
      handlers.onLayout?.(said.layout)
      break
    case "selection":
      dispatchSelectionMessage(said.selection, frame, handlers, live)
      break
    case "scroll":
      handlers.onScroll?.(said.scroll)
      break
    case "anchor":
      handlers.onAnchor?.({ x: said.x, y: said.y })
      break
    case "page":
      handlers.onPage?.(said.page, said.section)
      break
    case "runtime-error":
      handlers.onRuntimeError?.(said.message)
      break
    case "mark":
      dispatchMarkMessage(said.mark, frame, handlers, live)
      break
    case "key":
      handlers.onKey?.(said.key)
      break
  }
}

export function ArtifactPageFrame({
  query,
  html,
  title,
  width,
  height,
  scale,
  armed = false,
  multi = false,
  pins,
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
  const source = useMemo(
    () => buildFrameSource(html, query, still, initialTheme.current),
    [html, query, still],
  )
  const handlers = useRef<FrameHandlers>({
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
      if (said !== null) dispatchBridgeMessage(said, frame.current, handlers.current, live.current)
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
        multi: marking && multi,
        theme,
        pan: onScroll !== undefined,
        ...(pins !== undefined ? { pins } : {}),
      },
      "*",
    )
  // biome-ignore lint/correctness/useExhaustiveDependencies: the mode and pins are what is said
  useLayoutEffect(() => {
    tell()
  }, [armed, marking, multi, theme, pins])
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
