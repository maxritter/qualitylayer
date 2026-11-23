import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { withCsp } from "./ArtifactFrame.tsx"

const PIN_ID_PATTERN = /^(?:[a-z][a-z0-9-]*|(?:[a-z][a-z0-9-]*|\d+)\/[a-z][a-z0-9-]*)$/

type FrameHandlers = {
  comment: boolean
  ids: ReadonlySet<string>
  onHeight?: (height: number) => void
  onPin?: (id: string, label: string) => void
}

function isValidPinLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    ![...value].some((char) => char.charCodeAt(0) < 32)
  )
}

function handleFencedMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
  handlers: FrameHandlers,
): void {
  if (frame === null || event.source !== frame.contentWindow) return
  if (event.data === null || typeof event.data !== "object") return
  const message = event.data as Record<string, unknown>
  if (
    message.type === "qualitylayer:height" &&
    typeof message.height === "number" &&
    Number.isFinite(message.height)
  ) {
    handlers.onHeight?.(Math.min(2400, Math.max(120, Math.round(message.height))))
  }
  if (message.type !== "qualitylayer:pin" || !handlers.comment || handlers.onPin === undefined)
    return
  if (
    typeof message.id !== "string" ||
    !PIN_ID_PATTERN.test(message.id) ||
    !handlers.ids.has(message.id)
  )
    return
  if (!isValidPinLabel(message.label)) return
  handlers.onPin(message.id, message.label)
}

export function FencedFrame({
  html,
  title,
  width,
  height,
  comment = false,
  ids,
  onHeight,
  onPin,
}: {
  html: string
  title: string
  width: number
  height: number
  comment?: boolean
  ids: ReadonlySet<string>
  onHeight?: (height: number) => void
  onPin?: (id: string, label: string) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const requestHeight = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "qualitylayer:measure" }, "*")
  }, [])
  // One listener for the frame's life reads the current props, so a pin sent right after feedback mode
  // turns on is not judged by a listener from before it (a passive re-subscription leaves that gap).
  const current = useRef<FrameHandlers>({ comment, ids, onHeight, onPin })
  current.current = { comment, ids, onHeight, onPin }
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) =>
      handleFencedMessage(event, frame.current, current.current)
    window.addEventListener("message", receive)
    return () => window.removeEventListener("message", receive)
  }, [])
  // A new feedback mode or id set asks the page for its height again, as a fresh listener used to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the props are the trigger, not inputs
  useEffect(() => requestHeight(), [comment, ids, onHeight, onPin, requestHeight])
  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={withCsp(html)}
      onLoad={requestHeight}
      style={{ display: "block", border: 0, width, height }}
    />
  )
}
