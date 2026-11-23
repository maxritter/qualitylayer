// A viewport a drawing is panned and zoomed in, with plain pointer, wheel and key events (no library):
// the fullscreen diagram's frame. The arithmetic is in pan-zoom.ts.
//
//   drag (left button, or a finger)  pans; a drag never selects text, a click and a double-click do
//   wheel, trackpad scroll or pinch  zooms around the pointer (Safari sends a pinch as gesture events)
//   arrow keys (Shift: farther)      pan; + - zoom around the centre and 0 fits, as the buttons do
//
// The view starts fitted and centred (zoom 100 %) and follows the viewport's size until the person
// moves it; Fit returns to it. Button and key steps ease (a short transition, none under reduced
// motion); a drag and a wheel follow the hand at once.

import { type ReactNode, useRef, useState } from "react"
import type { Size } from "./pan-zoom.ts"
import {
  type PanZoom,
  usePanZoom,
  usePointerPan,
  useViewportSizeObservers,
  useViewportWheelGestures,
} from "./use-pan-zoom.ts"

export { usePanZoom }

type ViewportProps = {
  pan: PanZoom
  /** Fits the drawing in `layer` to what it draws and returns its size in pixels; null when it cannot yet. */
  measure: (layer: HTMLElement) => Size | null
  /** Another drawing (a new key) is measured again. */
  contentKey: string
  label: string
  testId?: string
  children: ReactNode
}

/** The drawing is the children, drawn at its own size and moved by a transform. */
export function PanZoomViewport({
  pan,
  measure,
  contentKey,
  label,
  testId,
  children,
}: ViewportProps) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  useViewportSizeObservers({ frame, layer, measure, contentKey, inner: pan.inner })
  useViewportWheelGestures(frame, pan.inner)
  const pointer = usePointerPan(frame, pan.inner)
  const view = pan.view
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a border and a legend the viewport does not want
    <div
      ref={setFrame}
      className="q-panzoom"
      data-testid={testId}
      data-panning={pan.panning ? "true" : undefined}
      data-zoom={pan.percent}
      role="group"
      aria-label={label}
      onPointerDown={pointer.onPointerDown}
      onPointerMove={pointer.onPointerMove}
      onPointerUp={pointer.onPointerEnd}
      onPointerCancel={pointer.onPointerEnd}
      onClickCapture={pointer.onClickCapture}
      // A selection dragged by its text would start a drag and drop; a pan is what a drag means here.
      onDragStart={(event) => event.preventDefault()}
    >
      <div
        ref={layer}
        className="q-panzoom-layer"
        data-smooth={pan.smooth && !pan.panning ? "true" : undefined}
        style={{
          width: pan.content?.width,
          height: pan.content?.height,
          visibility: view === null ? "hidden" : undefined,
          transform:
            view === null ? undefined : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
