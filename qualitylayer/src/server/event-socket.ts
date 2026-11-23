import type { ServerWebSocket } from "bun"
import { VERSION } from "../core/version.ts"
import type { OutsideConversationWatch } from "./outside-conversation-watch.ts"
import type { AgentSocketData } from "./runs.ts"
import type { Sessions } from "./sessions.ts"
import type { Hub } from "./watch.ts"

export type EventSocketData = {
  kind: "events"
  session: string
  closed?: boolean
  unsubscribe?: () => void
  authority?: { valid(): boolean; stop(): void }
  outside?: OutsideConversationWatch
  stopOutside?: () => void
}
export type AppSocketData = AgentSocketData | EventSocketData
export const EVENT_SOCKET_BUFFER_BYTES = 64 * 1024
export type EventAccess = {
  sessions: Pick<Sessions, "authority" | "subscribe">
  now(): number
}

/** The existing session's fixed deadline and revocation signal, owned by one live reader. */
export function watchEventSession(access: EventAccess, session: string | null, end: () => void) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe = () => {}
  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    unsubscribe()
  }
  const current = () => {
    if (stopped) return null
    const authority = session === null ? null : access.sessions.authority(session)
    if (authority === null || authority.expiresAt <= access.now()) {
      stop()
      end()
      return null
    }
    return authority
  }
  const deadline = () => {
    timer = undefined
    const authority = current()
    if (authority !== null)
      timer = setTimeout(
        deadline,
        Math.min(2_147_483_647, Math.max(0, authority.expiresAt - access.now())),
      )
  }
  unsubscribe = access.sessions.subscribe(() => {
    current()
  })
  deadline()
  return { valid: () => current() !== null, stop }
}

export const isEventSocket = (
  socket: ServerWebSocket<AppSocketData>,
): socket is ServerWebSocket<EventSocketData> =>
  "kind" in socket.data && socket.data.kind === "events"

export const isAgentSocket = (
  socket: ServerWebSocket<AppSocketData>,
): socket is ServerWebSocket<AgentSocketData> => "run" in socket.data

function finishEventSocket(socket: ServerWebSocket<EventSocketData>) {
  if (socket.data.closed) return
  socket.data.closed = true
  socket.data.stopOutside?.()
  delete socket.data.stopOutside
  delete socket.data.outside
  socket.data.unsubscribe?.()
  delete socket.data.unsubscribe
  socket.data.authority?.stop()
  delete socket.data.authority
}

function endEventSocket(socket: ServerWebSocket<EventSocketData>, code: number, reason?: string) {
  if (socket.data.closed) return
  finishEventSocket(socket)
  socket.close(code, reason)
}

function sendEventFrame(socket: ServerWebSocket<EventSocketData>, event: unknown) {
  if (socket.data.closed || !socket.data.authority?.valid()) return
  const text = JSON.stringify(event)
  if (socket.getBufferedAmount() + Buffer.byteLength(text) > EVENT_SOCKET_BUFFER_BYTES) {
    endEventSocket(socket, 1013, "event reader is too slow")
    return
  }
  if (socket.send(text) === 0) {
    endEventSocket(socket, 1000)
  }
}

function attachEventSocket(
  socket: ServerWebSocket<EventSocketData>,
  hub: Hub,
  access: EventAccess,
) {
  const send = (event: unknown) => sendEventFrame(socket, event)
  socket.data.unsubscribe = hub.subscribe(send, () =>
    endEventSocket(socket, 1001, "server closing"),
  )
  const authority = watchEventSession(access, socket.data.session, () =>
    endEventSocket(socket, 1008, "event session expired or revoked"),
  )
  if (socket.data.closed) {
    authority.stop()
    return
  }
  socket.data.authority = authority
  const stopOutside = socket.data.outside?.start(
    () => send({ type: "live-changed" }),
    () => endEventSocket(socket, 1011, "outside record watch unavailable"),
  )
  if (socket.data.closed) {
    stopOutside?.()
    return
  }
  socket.data.stopOutside = stopOutside
  // The version lets a page loaded from an older server reload itself after an update.
  send({ type: "hello", version: VERSION })
}

export function eventSockets(hub: Hub, access: EventAccess) {
  return {
    open(socket: ServerWebSocket<EventSocketData>) {
      attachEventSocket(socket, hub, access)
    },
    message(socket: ServerWebSocket<EventSocketData>) {
      endEventSocket(socket, 1008, "event stream is read-only")
    },
    close: finishEventSocket,
  }
}
