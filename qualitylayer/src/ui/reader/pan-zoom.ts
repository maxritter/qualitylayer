// The arithmetic of a pan-and-zoom view, with no DOM in it: where a drawing sits in its viewport, how
// a drag, a wheel, a pinch or a key moves it, and the limits that keep it within reach. The
// fullscreen diagram (PanZoomViewport.tsx) wires events to it.
//
// A view is a transform of the drawing's own pixels: a point `p` of the drawing lands at
// `(x + scale * p.x, y + scale * p.y)` in the viewport. "Fit" is the view that shows the whole drawing
// centred; the zoom shown to the person (100 %, 125 %) is the scale relative to it.

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export type View = { scale: number; x: number; y: number }

/** The range of zoom, relative to the fitted view, and one step of the buttons and keys. */
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 4
export const ZOOM_STEP = 1.25

/** The room kept around the drawing when it is fitted. */
export const FIT_PADDING = 24
/** How much of the drawing stays inside the viewport at the least, so it can always be found again. */
export const MIN_VISIBLE = 96
/** One arrow key moves the view this far; with Shift, four times as far. */
export const KEY_STEP = 48
/** A press that moves less than this is a click, not the start of a drag. */
export const DRAG_THRESHOLD = 3

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The scale at which the whole drawing fits the viewport with its padding. */
export function fitScale(
  room: Size,
  content: Size,
  padding = FIT_PADDING,
  maxScale = Number.POSITIVE_INFINITY,
): number {
  const width = Math.max(1, room.width - padding * 2)
  const height = Math.max(1, room.height - padding * 2)
  return Math.min(maxScale, width / content.width, height / content.height)
}

/** The whole drawing, as large as the viewport allows and centred in it. */
export function fitView(room: Size, content: Size, maxScale = Number.POSITIVE_INFINITY): View {
  const scale = fitScale(room, content, FIT_PADDING, maxScale)
  return {
    scale,
    x: (room.width - content.width * scale) / 2,
    y: (room.height - content.height * scale) / 2,
  }
}

/** The zoom the person reads: the view's scale relative to the fitted one (1 is the fitted view). */
export function zoomLevel(
  view: View,
  room: Size,
  content: Size,
  maxScale = Number.POSITIVE_INFINITY,
): number {
  return view.scale / fitScale(room, content, FIT_PADDING, maxScale)
}

/** Move the view back until some of the drawing is inside the viewport on each axis. */
export function keepInReach(view: View, room: Size, content: Size): View {
  const width = content.width * view.scale
  const height = content.height * view.scale
  const across = Math.min(MIN_VISIBLE, width / 2, room.width / 2)
  const down = Math.min(MIN_VISIBLE, height / 2, room.height / 2)
  return {
    scale: view.scale,
    x: clamp(view.x, across - width, room.width - across),
    y: clamp(view.y, down - height, room.height - down),
  }
}

/** Move the drawing by `dx`, `dy` viewport pixels (a drag: the drawing follows the pointer). */
export function moveBy(view: View, dx: number, dy: number, room: Size, content: Size): View {
  return keepInReach({ scale: view.scale, x: view.x + dx, y: view.y + dy }, room, content)
}

export type ZoomBounds = { room: Size; content: Size; maxScale?: number }

/** Zoom to `scale` within fitted bounds so `at` stays under the pointer. */
export function zoomInBounds(view: View, scale: number, at: Point, bounds: ZoomBounds): View {
  const { room, content, maxScale = Number.POSITIVE_INFINITY } = bounds
  const base = fitScale(room, content, FIT_PADDING, maxScale)
  const next = clamp(scale, base * ZOOM_MIN, Math.max(base * ZOOM_MAX, 2))
  const ratio = next / view.scale
  return keepInReach(
    { scale: next, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio },
    room,
    content,
  )
}

/** Zoom by a factor around `at`. */
export function zoomBy(view: View, factor: number, at: Point, room: Size, content: Size): View {
  return zoomInBounds(view, view.scale * factor, at, { room, content })
}

/** The middle of the viewport: where the buttons and keys zoom around, so the view stays centred. */
export const centreOf = (room: Size): Point => ({ x: room.width / 2, y: room.height / 2 })

type Wheel = { deltaX: number; deltaY: number; deltaMode: number }

/**
 * The zoom factor of one wheel event: a mouse wheel's notch, a trackpad's two-finger scroll or its pinch (which
 * the browser sends as a wheel with Ctrl held). Small deltas zoom smoothly; a notch is no more than about
 * one zoom step. Scrolling up zooms in. A wheel cannot be told from a trackpad's scroll for certain, so
 * both zoom; the drag and the arrow keys pan.
 */
export function wheelFactor(wheel: Wheel): number {
  const unit = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? 100 : 1
  // Shift turns a wheel sideways in some systems: the travel is then in deltaX.
  const travel = (wheel.deltaY !== 0 ? wheel.deltaY : wheel.deltaX) * unit
  return Math.exp(-clamp(travel, -20, 20) * 0.0125)
}

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/**
 * How far an arrow key moves the drawing: the view moves the way the arrow points, as a scrolled page does,
 * so the drawing moves the other way. Null for any other key.
 */
export function keyTravel(key: string, shift: boolean): Point | null {
  const arrow = ARROWS[key]
  if (arrow === undefined) return null
  const step = shift ? KEY_STEP * 4 : KEY_STEP
  return { x: 0 - arrow.x * step, y: 0 - arrow.y * step }
}
