import {
  encodeFrame,
  FrameDecoder,
  type HostFrame,
  LIMITS,
  type ServerFrame,
  type ViewerState,
  validSize,
} from "../../core/run/protocol.ts"
import { TerminalReceiver } from "./terminal-receiver.ts"
import {
  buildTerminalSocketUrl,
  clearPendingFresh,
  createPendingFresh,
  FRESH_REJECT_CODES,
  isControlAllowed,
  type PendingFresh,
  parseViewerStateMessage,
  publishedViewerState,
  revokedViewerState,
  type TerminalCallbacks,
} from "./transport-helpers.ts"
import type { FreshResult, TerminalControl, TerminalControlSender } from "./view.ts"

export { TerminalReceiver }

export type TransportOptions = {
  watching: boolean
  phone?: boolean
  generation: number
  resizeDisplay(cols: number, rows: number): void
  onEvent?: (frame: HostFrame) => void
  onInput?: (text: string) => void
  onViewer?: (state: ViewerState) => void
  onControl?: (sender: TerminalControlSender | undefined) => void
}

export class AgentTransport {
  private socket: WebSocket | undefined
  private callbacks: TerminalCallbacks = {}
  private decoder = new FrameDecoder("host")
  private receiver: TerminalReceiver | undefined
  private displayResize = false
  private retired = false
  private viewer: ViewerState | undefined
  private replayComplete = false
  private ended = false
  private reportedError = false
  private pendingFresh?: PendingFresh

  constructor(private options: TransportOptions) {}

  private publishViewer() {
    if (!this.viewer) return
    this.options.onViewer?.(publishedViewerState(this.viewer, this.replayComplete))
  }

  private revokeViewer() {
    if (!this.viewer) return
    this.viewer = revokedViewerState(this.viewer)
    this.options.onViewer?.(this.viewer)
  }

  private reportError(code: string, message: string) {
    if (this.reportedError || this.ended) return
    this.reportedError = true
    this.options.onEvent?.({ type: "error", code, message })
    this.callbacks.onError?.(message)
  }

  private rejectPendingFresh(message: string) {
    const pending = this.pendingFresh
    this.pendingFresh = undefined
    clearPendingFresh(pending, message)
  }

  private resolvePendingFresh(frame: Extract<HostFrame, { type: "fresh-result" }>) {
    const pending = this.pendingFresh
    if (
      !pending ||
      frame.generation !== this.options.generation ||
      frame.request !== pending.request
    )
      return
    clearTimeout(pending.timer)
    this.pendingFresh = undefined
    pending.resolve(frame)
  }

  private handleHostFrame(frame: HostFrame, callbacks: TerminalCallbacks) {
    if (frame.type === "fresh-result") this.resolvePendingFresh(frame)
    else if (frame.type === "replay-begin") {
      this.replayComplete = false
      if (this.viewer) delete this.viewer.pickerProof
      this.publishViewer()
    } else if (frame.type === "replay-end") {
      this.replayComplete = true
      this.publishViewer()
    } else if (frame.type === "exit") {
      this.ended = true
    } else if (
      frame.type === "status" &&
      (frame.status === "stopped" || frame.status === "failed")
    ) {
      this.ended = true
      this.replayComplete = false
      this.revokeViewer()
    } else if (frame.type === "error") {
      this.reportedError = true
      if (FRESH_REJECT_CODES.has(frame.code)) this.rejectPendingFresh(frame.message)
    }
    this.options.onEvent?.(frame)
    if (frame.type === "replay-end") callbacks.onConnect?.()
    if (frame.type === "error") callbacks.onError?.(frame.message)
    if (frame.type === "exit") callbacks.onExit?.(frame.code)
  }

  private handleSocketMessage(socket: WebSocket, message: MessageEvent) {
    if (this.socket !== socket) return
    try {
      if (typeof message.data === "string") {
        this.viewer = parseViewerStateMessage(
          message.data,
          this.replayComplete,
          this.options.generation,
        )
        this.publishViewer()
        return
      }
      if (!(message.data instanceof ArrayBuffer)) throw new Error("terminal frame must be binary")
      for (const frame of this.decoder.push(new Uint8Array(message.data)))
        this.receiver?.receive(frame as HostFrame)
    } catch (error) {
      this.reportError("protocol_error", String(error))
      socket.close(1002, "terminal protocol error")
    }
  }

  private handleSocketDisconnect(
    socket: WebSocket,
    closeEvent: boolean,
    callbacks: TerminalCallbacks,
  ) {
    if (this.socket !== socket) return
    if (closeEvent) {
      this.socket = undefined
      this.rejectPendingFresh(
        "The connection closed before fresh was confirmed. Your draft is kept; inspect the session before retrying.",
      )
    }
    this.replayComplete = false
    this.options.onControl?.(undefined)
    this.revokeViewer()
    this.reportError("disconnected", "The agent's window disconnected. Reconnect to continue.")
    if (closeEvent) callbacks.onDisconnect?.()
    else socket.close()
  }

  connect({ url, callbacks }: { url: string; callbacks: TerminalCallbacks }) {
    this.disconnect()
    this.retired = false
    this.callbacks = callbacks
    this.decoder = new FrameDecoder("host")
    this.viewer = undefined
    this.replayComplete = false
    this.ended = false
    this.reportedError = false
    this.receiver = new TerminalReceiver(
      {
        write: (text) => callbacks.onData?.(text),
        resize: (cols, rows) => {
          this.displayResize = true
          try {
            this.options.resizeDisplay(cols, rows)
          } finally {
            this.displayResize = false
          }
        },
      },
      (frame) => this.handleHostFrame(frame, callbacks),
    )
    const target = buildTerminalSocketUrl(url)
    const protocols = [this.options.watching ? "qualitylayer-watch-v1" : "qualitylayer-control-v1"]
    if (this.options.phone) protocols.push("qualitylayer-phone-v1")
    const socket = new WebSocket(target, protocols)
    this.socket = socket
    socket.binaryType = "arraybuffer"
    socket.onopen = () => {
      if (this.socket === socket)
        this.options.onControl?.((action) => this.socket === socket && this.control(action))
    }
    socket.onmessage = (message) => this.handleSocketMessage(socket, message)
    socket.onclose = () => this.handleSocketDisconnect(socket, true, callbacks)
    socket.onerror = () => this.handleSocketDisconnect(socket, false, callbacks)
  }

  private send(frame: ServerFrame) {
    if (!this.isConnected()) return false
    const bytes = encodeFrame(frame)
    if ((this.socket?.bufferedAmount ?? 0) + bytes.length > LIMITS.inboundBytes) return false
    this.socket?.send(new Uint8Array(bytes).buffer)
    return true
  }

  private canStartFresh(): boolean {
    const controlled = Boolean(this.viewer?.controller && this.viewer.canTakeControl)
    return !this.pendingFresh && controlled && this.isConnected()
  }

  fresh(sequence: number): Promise<FreshResult> {
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      return Promise.reject(new Error("This conversation has no verified fresh-session boundary."))
    if (!this.canStartFresh())
      return Promise.reject(
        new Error("This window must control the session before starting fresh."),
      )
    const request = crypto.randomUUID().replaceAll("-", "")
    return createPendingFresh({
      request,
      send: () =>
        this.send({ type: "fresh", generation: this.options.generation, sequence, request }),
      getPending: () => this.pendingFresh,
      setPending: (next) => {
        this.pendingFresh = next
      },
    })
  }

  sendInput(text: string) {
    if (!this.viewer?.canType || !this.replayComplete || !this.isConnected()) return false
    const bytes = new TextEncoder().encode(text)
    if (!bytes.length) return true
    if (bytes.length * 1.5 + (this.socket?.bufferedAmount ?? 0) > LIMITS.inboundBytes) return false
    for (let offset = 0; offset < bytes.length; offset += LIMITS.inputBytes)
      if (!this.send({ type: "input", data: bytes.slice(offset, offset + LIMITS.inputBytes) }))
        return false
    this.options.onInput?.(text)
    return true
  }

  private canResizeNow(): boolean {
    const activeControl = !this.displayResize && this.replayComplete && !this.options.phone
    return activeControl && this.viewer?.canResize === true
  }

  resize(cols: number, rows: number) {
    return this.canResizeNow() && validSize(cols, rows) && this.send({ type: "resize", cols, rows })
  }

  setPhone(phone: boolean) {
    this.options.phone = phone
  }

  control(action: TerminalControl) {
    return (
      isControlAllowed(this.viewer, action) &&
      this.send({ type: "control", action, generation: this.options.generation })
    )
  }

  isConnected() {
    return !this.retired && this.socket?.readyState === WebSocket.OPEN
  }

  disconnect() {
    this.retired = true
    this.rejectPendingFresh(
      "The session disconnected before fresh was confirmed. No automatic retry was started.",
    )
    this.replayComplete = false
    this.options.onControl?.(undefined)
    this.revokeViewer()
    const socket = this.socket
    this.socket = undefined
    socket?.close()
  }

  destroy() {
    this.disconnect()
    this.callbacks = {}
    this.receiver = undefined
  }
}
