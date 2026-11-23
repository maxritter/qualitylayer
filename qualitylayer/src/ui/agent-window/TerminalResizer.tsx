import type { KeyboardEvent } from "react"
import { useResizeDrag } from "../useResizeDrag.ts"
import { useTerminalLayout } from "./layout.tsx"

function isPlainEnter(event: KeyboardEvent): boolean {
  const noModifiers = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  return event.key === "Enter" && noModifiers
}

function handleResizerKey(
  event: KeyboardEvent,
  options: {
    size: number
    maxWidth: number
    resize: (width: number) => void
    cancelDrag: () => void
    onCollapse?: () => void
  },
) {
  if (options.onCollapse && isPlainEnter(event)) {
    event.preventDefault()
    event.stopPropagation()
    options.cancelDrag()
    options.onCollapse()
    return
  }
  const increase = event.key === "ArrowLeft"
  const decrease = event.key === "ArrowRight"
  if (increase || decrease) {
    event.preventDefault()
    options.resize(options.size + (increase ? 1 : -1) * (event.shiftKey ? 50 : 10))
    return
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault()
    options.resize(event.key === "Home" ? 320 : options.maxWidth)
  }
}

export function TerminalResizer({
  sidebar = false,
  onCollapse,
}: {
  sidebar?: boolean
  onCollapse?: () => void
}) {
  const layout = useTerminalLayout()
  const size = layout?.width ?? 520
  const drag = useResizeDrag({
    axis: "x",
    size,
    direction: -1,
    onResize: (next) => {
      if (onCollapse && next <= 80) {
        drag.cancel()
        onCollapse()
        return
      }
      layout?.resize(Math.max(320, next))
    },
  })
  if (!layout) return null
  return (
    // biome-ignore lint/a11y/useSemanticElements: the focusable window splitter carries an adjustable value, unlike a static rule
    <div
      role="separator"
      className={`q-terminal-resizer vertical${drag.active ? " dragging" : ""}`}
      tabIndex={0}
      data-terminal-sidebar-resizer={sidebar ? "" : undefined}
      aria-label={sidebar ? "Resize sidebar width" : "Resize terminal width"}
      aria-orientation="vertical"
      aria-valuenow={size}
      aria-valuemin={320}
      aria-valuemax={layout.maxWidth}
      title={
        onCollapse
          ? "Drag towards the outer edge to collapse; Enter collapses; double-click resets"
          : "Drag to resize; use arrow keys or double-click to reset"
      }
      onDoubleClick={layout.reset}
      onPointerDown={drag.start}
      onKeyDown={(event) =>
        handleResizerKey(event, {
          size,
          maxWidth: layout.maxWidth,
          resize: layout.resize,
          cancelDrag: drag.cancel,
          ...(onCollapse ? { onCollapse } : {}),
        })
      }
    />
  )
}
