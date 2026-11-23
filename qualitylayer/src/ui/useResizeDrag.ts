import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react"

type DragOptions = {
  axis: "x" | "y"
  size: number
  direction: 1 | -1
  onResize(size: number): void
  onDragging?(active: boolean): void
}

type DragListeners = {
  move: (e: PointerEvent) => void
  up: (e: PointerEvent) => void
  blur: () => void
  key: (e: KeyboardEvent) => void
}

function attachDragListeners(target: HTMLElement, listeners: DragListeners): () => void {
  window.addEventListener("pointermove", listeners.move)
  window.addEventListener("pointerup", listeners.up)
  window.addEventListener("pointercancel", listeners.up)
  window.addEventListener("blur", listeners.blur)
  window.addEventListener("keydown", listeners.key, true)
  target.addEventListener("lostpointercapture", listeners.blur)
  return () => {
    window.removeEventListener("pointermove", listeners.move)
    window.removeEventListener("pointerup", listeners.up)
    window.removeEventListener("pointercancel", listeners.up)
    window.removeEventListener("blur", listeners.blur)
    window.removeEventListener("keydown", listeners.key, true)
    target.removeEventListener("lostpointercapture", listeners.blur)
  }
}

function buildDragListeners(opts: {
  pointerId: number
  axis: "x" | "y"
  size: number
  origin: number
  direction: 1 | -1
  state: { next: number; frame: number | null }
  apply: () => void
  stop: (revert?: boolean) => void
}): DragListeners {
  return {
    move: (nextEvent) => {
      if (nextEvent.pointerId !== opts.pointerId) return
      const coord = opts.axis === "x" ? nextEvent.clientX : nextEvent.clientY
      opts.state.next = Math.round(opts.size + (coord - opts.origin) * opts.direction)
      if (opts.state.frame === null) opts.state.frame = window.requestAnimationFrame(opts.apply)
    },
    up: (nextEvent) => {
      if (nextEvent.pointerId === opts.pointerId) opts.stop()
    },
    blur: () => opts.stop(),
    key: (nextEvent) => {
      if (nextEvent.key !== "Escape") return
      nextEvent.preventDefault()
      nextEvent.stopPropagation()
      opts.stop(true)
    },
  }
}

function createResizeSession(
  event: ReactPointerEvent<HTMLElement>,
  latest: RefObject<DragOptions>,
  finish: RefObject<((revert?: boolean) => void) | null>,
  setActive: (active: boolean) => void,
): void {
  const target = event.currentTarget
  const { pointerId } = event
  const { axis, size, direction } = latest.current
  const origin = axis === "x" ? event.clientX : event.clientY
  const prevCursor = document.body.style.cursor
  const prevSelection = document.body.style.userSelect
  const state = { next: size, applied: size, frame: null as number | null }

  const apply = () => {
    state.frame = null
    if (state.next === state.applied) return
    state.applied = state.next
    latest.current.onResize(state.next)
  }

  let detach = () => {}
  const stop = (revert = false) => {
    if (!finish.current) return
    finish.current = null
    detach()
    if (state.frame !== null) window.cancelAnimationFrame(state.frame)
    if (revert) state.next = size
    apply()
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
    document.body.style.cursor = prevCursor
    document.body.style.userSelect = prevSelection
    setActive(false)
    latest.current.onDragging?.(false)
  }

  finish.current = stop
  target.setPointerCapture?.(pointerId)
  document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize"
  document.body.style.userSelect = "none"
  setActive(true)
  latest.current.onDragging?.(true)
  detach = attachDragListeners(
    target,
    buildDragListeners({ pointerId, axis, size, origin, direction, state, apply, stop }),
  )
}

export function useResizeDrag(options: DragOptions) {
  const latest = useRef(options)
  latest.current = options
  const finish = useRef<((revert?: boolean) => void) | null>(null)
  const [active, setActive] = useState(false)
  useEffect(() => () => finish.current?.(), [])

  const start = (event: ReactPointerEvent<HTMLElement>) => {
    if (finish.current || event.button > 0) return
    event.preventDefault()
    createResizeSession(event, latest, finish, setActive)
  }

  return { active, start, cancel: () => finish.current?.(true) }
}
