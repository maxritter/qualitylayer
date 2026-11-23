// A drag handle on the inner edge of a side panel. Drag to resize, double-click
// to reset, arrow keys when focused. The width is remembered per browser.

import { cn } from "cn"
import { useCallback, useRef, useState } from "react"
import { applyResizerDrag, handleResizerKeyDown, resizerTitle } from "./resizer-helpers.ts"
import { useResizeDrag } from "./useResizeDrag.ts"

export type StoredWidth = {
  width: number
  min: number
  max: number
  setWidth: (width: number) => void
  reset: () => void
}

export function useStoredWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
): StoredWidth {
  const clamp = useCallback((w: number) => Math.round(Math.min(max, Math.max(min, w))), [min, max])
  const [width, setWidthState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key))
      return Number.isFinite(saved) && saved > 0 ? clamp(saved) : fallback
    } catch {
      return fallback
    }
  })
  const currentWidth = useRef(width)
  currentWidth.current = width
  const setWidth = useCallback(
    (w: number) => {
      const next = clamp(w)
      if (next === currentWidth.current) return
      currentWidth.current = next
      setWidthState(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // a per-browser convenience only
      }
    },
    [key, clamp],
  )
  return { width, setWidth, reset: () => setWidth(fallback), min, max }
}

type Props = {
  /** Which edge of the panel the handle sits on; dragging towards the page grows the panel. */
  side: "right" | "left"
  width: number
  min: number
  max: number
  label: string
  onResize: (width: number) => void
  onReset: () => void
  onDragging?: (dragging: boolean) => void
  onCollapse?: () => void
  onExpand?: () => void
  collapsed?: boolean
  expandedWidth?: number
}

export function Resizer({
  side,
  width,
  min,
  max,
  label,
  onResize,
  onReset,
  onDragging,
  onCollapse,
  onExpand,
  collapsed = false,
  expandedWidth = width,
}: Props) {
  const beforeDrag = useRef(expandedWidth)
  const drag = useResizeDrag({
    axis: "x",
    size: width,
    direction: side === "right" ? 1 : -1,
    onResize: (next) =>
      applyResizerDrag(next, {
        collapsed,
        min,
        beforeDrag: beforeDrag.current,
        onResize,
        onCollapse,
        onExpand,
        cancelDrag: () => drag.cancel(),
      }),
    onDragging: (active) => {
      if (active) beforeDrag.current = expandedWidth
      onDragging?.(active)
    },
  })

  return (
    // biome-ignore lint/a11y/useSemanticElements: the ARIA window-splitter pattern is a focusable separator; <hr> cannot hold focus or a value
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={collapsed ? width : min}
      aria-valuetext={collapsed ? "Collapsed; drag outward or press Enter to expand" : undefined}
      aria-valuemax={max}
      tabIndex={0}
      title={resizerTitle(label, collapsed, Boolean(onCollapse))}
      onPointerDown={(event) => {
        if (onCollapse || onExpand) event.currentTarget.focus({ preventScroll: true })
        drag.start(event)
      }}
      onDoubleClick={() => {
        onReset()
        if (collapsed) onExpand?.()
      }}
      onKeyDown={(e) =>
        handleResizerKeyDown(e, {
          side,
          width,
          collapsed,
          expandedWidth,
          onResize,
          onCollapse,
          onExpand,
          cancelDrag: () => drag.cancel(),
        })
      }
      className={cn(
        "group absolute top-0 bottom-0 z-20 w-4 touch-none cursor-col-resize outline-none",
        side === "right" ? "-right-2" : "-left-2",
      )}
      data-testid={`resize-${side}`}
    >
      <span
        className={cn(
          "absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-mint-line group-focus-visible:bg-mint",
          drag.active && "bg-mint",
        )}
      />
    </div>
  )
}
