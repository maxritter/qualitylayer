/**
 * A machine's connection as a pure function of state and event. Only a refused sign-in ("needs
 * you") and an unknown host key wait for the person; an offline machine is retried by itself.
 */

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "needs-you"
  | "unknown-host"

/** Why a connection attempt did not end as connected. */
export type Failure = Exclude<ConnectionState, "connecting" | "connected" | "reconnecting">

export type ConnectionEvent =
  /** The forward is up and the machine's server answers. */
  | { type: "up" }
  /** The attempt ended without a connection. */
  | { type: "failed"; as: Failure }
  /** A connected machine's forward ended. */
  | { type: "ended" }
  /** The wait of an offline machine is over. */
  | { type: "retry" }
  /** The person chose Try again. */
  | { type: "try-again" }

export interface Connection {
  state: ConnectionState
  /** Attempts in a row that left the machine offline; chooses the next wait. */
  misses: number
}

export const FIRST: Connection = { state: "connecting", misses: 0 }

/** Seconds before the first, second and third retry; every later one waits `LATER_WAIT`. */
const WAITS = [2, 4, 8]
const LATER_WAIT = 30

const whileConnecting = (now: Connection, event: ConnectionEvent): Connection => {
  if (event.type === "up") return { state: "connected", misses: 0 }
  if (event.type !== "failed") return now
  return event.as === "offline"
    ? { state: "offline", misses: now.misses + 1 }
    : { state: event.as, misses: 0 }
}

/** Grace retries kept in `reconnecting` before falling back to `offline` (2s + 4s = ~6s). */
const RECONNECT_GRACE_MISSES = 2

const whileConnected = (now: Connection, event: ConnectionEvent): Connection =>
  event.type === "ended" ? { state: "reconnecting", misses: 1 } : now

const whileReconnecting = (now: Connection, event: ConnectionEvent): Connection => {
  if (event.type === "up") return { state: "connected", misses: 0 }
  if (event.type === "retry" || event.type === "try-again") return now
  if (event.type !== "failed") return now
  if (event.as !== "offline") return { state: event.as, misses: 0 }
  const misses = now.misses + 1
  return misses <= RECONNECT_GRACE_MISSES
    ? { state: "reconnecting", misses }
    : { state: "offline", misses }
}

const whileOffline = (now: Connection, event: ConnectionEvent): Connection =>
  event.type === "retry" || event.type === "try-again" ? { ...now, state: "connecting" } : now

const whileWaitingForYou = (now: Connection, event: ConnectionEvent): Connection =>
  event.type === "try-again" ? { state: "connecting", misses: 0 } : now

const STEP: Record<ConnectionState, (now: Connection, event: ConnectionEvent) => Connection> = {
  connecting: whileConnecting,
  connected: whileConnected,
  reconnecting: whileReconnecting,
  offline: whileOffline,
  "needs-you": whileWaitingForYou,
  "unknown-host": whileWaitingForYou,
}

/** The connection after an event; an event that does not fit the state changes nothing. */
export const next = (now: Connection, event: ConnectionEvent): Connection =>
  STEP[now.state](now, event)

/** True when nothing happens until the person acts. */
export const waitsForYou = (now: Connection): boolean =>
  now.state === "needs-you" || now.state === "unknown-host"

/** How long an offline or reconnecting machine waits before its next attempt; null otherwise. */
export const retryAfterSeconds = (now: Connection): number | null =>
  now.state === "offline" || now.state === "reconnecting"
    ? (WAITS[now.misses - 1] ?? LATER_WAIT)
    : null
