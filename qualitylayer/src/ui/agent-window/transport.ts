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
  sendChunkedInput,
  type TerminalCallbacks,
  terminalSocketProtocols,
} from "./transport-helpers.ts"
import { ReconnectScheduler, type ReconnectState } from "./transport-reconnect.ts"
import type { FreshResult, TerminalControl, TerminalControlSender } from "./view.ts"

export { type ReconnectState, TerminalReceiver }

export type TransportOptions = {
  watching: boolean
  phone?: boolean
  generation: number
  resizeDisplay(cols: number, rows: number): void
  onEvent?: (frame: HostFrame) => void
  onInput?: (text: string) => void
  onViewer?: (state: ViewerState) => void
  onControl?: (sender: TerminalControlSender | undefined) => void
  reconnectDelaysMs?: readonly number[]
  onReconnectState?: (state: ReconnectState) => void
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
  private lastArgs?: { url: string; callbacks: TerminalCallbacks }
  private reconnect: ReconnectScheduler

  constructor(private options: TransportOptions) {
    this.reconnect = new ReconnectScheduler(
      () => this.options.reconnectDelaysMs,
      (state) => this.options.onReconnectState?.(state),
    )
  }

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

  private applyHostFrame(frame: HostFrame) {
    switch (frame.type) {
      case "fresh-result":
        this.resolvePendingFresh(frame)
        break
      case "replay-begin":
        this.replayComplete = false
        if (this.viewer) delete this.viewer.pickerProof
        this.publishViewer()
        break
      case "replay-end":
        this.replayComplete = true
        this.reconnect.notifyLive()
        this.publishViewer()
        break
      case "exit":
        this.ended = true
        break
      case "status":
        if (frame.status === "stopped" || frame.status === "failed") {
          this.ended = true
          this.replayComplete = false
          this.revokeViewer()
        }
        break
      case "error":
        this.reportedError = true
        if (FRESH_REJECT_CODES.has(frame.code)) this.rejectPendingFresh(frame.message)
        break
    }
  }

  private handleHostFrame(frame: HostFrame, callbacks: TerminalCallbacks) {
    this.applyHostFrame(frame)
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
    this.replayComplete = false
    this.options.onControl?.(undefined)
    this.revokeViewer()
    if (!closeEvent) {
      socket.close()
      return
    }
    this.socket = undefined
    this.rejectPendingFresh(
      "The connection closed before fresh was confirmed. Your draft is kept; inspect the session before retrying.",
    )
    const canRetry = () => !this.retired && !this.ended && this.lastArgs !== undefined
    if (
      this.reconnect.schedule(canRetry, () => {
        if (this.lastArgs) this.openSocket(this.lastArgs, true)
      })
    ) {
      return
    }
    this.reconnect.notifyDisconnected()
    this.reportError("disconnected", "The agent's window disconnected. Reconnect to continue.")
    callbacks.onDisconnect?.()
  }

  connect(args: { url: string; callbacks: TerminalCallbacks }) {
    this.reconnect.reset()
    this.openSocket(args, false)
  }

  private resetSocketState(args: { url: string; callbacks: TerminalCallbacks }, retry: boolean) {
    this.reconnect.clear()
    if (!retry) this.disconnect()
    else {
      const prev = this.socket
      this.socket = undefined
      prev?.close()
    }
    this.lastArgs = args
    this.retired = false
    this.callbacks = args.callbacks
    this.decoder = new FrameDecoder("host")
    this.viewer = undefined
    this.replayComplete = false
    this.ended = false
    this.reportedError = false
  }

  private openSocket(args: { url: string; callbacks: TerminalCallbacks }, retry: boolean) {
    const { url, callbacks } = args
    this.resetSocketState(args, retry)
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
    const protocols = terminalSocketProtocols(this.options.watching, this.options.phone)
    const socket = new WebSocket(buildTerminalSocketUrl(url), protocols)
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
    const ok = sendChunkedInput(text, this.socket?.bufferedAmount ?? 0, (data) =>
      this.send({ type: "input", data }),
    )
    if (ok && text.length > 0) this.options.onInput?.(text)
    return ok
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
    this.reconnect.clear()
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
    this.lastArgs = undefined
    this.callbacks = {}
    this.receiver = undefined
  }
}
