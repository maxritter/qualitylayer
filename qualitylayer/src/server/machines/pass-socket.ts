// A machine's terminal and event sockets, passed through its listener. A socket is a page's own:
// this computer's guard, the page's own Origin and a session cookie, never the key, as
// `RunAttachments.prepare` asks of this computer's own sockets.

import type { IncomingMessage, OutgoingHttpHeaders } from "node:http"
import { connect } from "node:net"
import type { Duplex } from "node:stream"

import { type Refusal, refuse, sessionAuthority } from "../guard.ts"
import {
  type Admitted,
  asRequest,
  FOREIGN_HOST,
  headersFor,
  NOT_CONNECTED,
  type PassThroughConfig,
} from "./pass-headers.ts"

/** Why this computer refuses the socket, or the session it came with. */
function sessionOfSocket(
  config: PassThroughConfig,
  incoming: IncomingMessage,
): Refusal | { keyPaired: boolean } {
  const request = asRequest(incoming)
  if (request === null) return FOREIGN_HOST
  const refusal = refuse(request, config.guard, true)
  if (refusal !== null) return refusal
  if (incoming.headers.origin !== `http://${incoming.headers.host}`)
    return { status: 403, reason: "a socket needs this page's own origin" }
  const authority = sessionAuthority(request, config.guard)
  if (authority === null || incoming.headers["x-qualitylayer-token"] !== undefined)
    return { status: 401, reason: "a socket needs this page's session" }
  return { keyPaired: authority.keyPaired }
}

function admitSocket(config: PassThroughConfig, incoming: IncomingMessage): Admitted {
  const session = sessionOfSocket(config, incoming)
  if ("status" in session) return session
  const access = config.access()
  if (access === null) return NOT_CONNECTED
  return { access, proof: session.keyPaired ? "paired" : "plain" }
}

function refuseSocket(socket: Duplex, refusal: Refusal): void {
  socket.end(
    `HTTP/1.1 ${refusal.status} ${refusal.reason}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`,
  )
}

/** The upgrade request as the machine gets it: the same line, the machine's own proof. */
function upgradeHead(incoming: IncomingMessage, headers: OutgoingHttpHeaders): string {
  const lines = [`${incoming.method} ${incoming.url} HTTP/1.1`]
  for (const [name, value] of Object.entries(headers))
    for (const one of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${one}`)
  return `${lines.join("\r\n")}\r\n\r\n`
}

export type PassSocketRequest = {
  incoming: IncomingMessage
  socket: Duplex
  head: Buffer
  track: (socket: Duplex) => void
  trackUpstream?: (socket: Duplex) => void
}

/** Join the browser's socket to the machine's, or refuse it before the machine hears of it. */
export function passSocket(config: PassThroughConfig, req: PassSocketRequest): void {
  const { incoming, socket, head, track, trackUpstream } = req
  track(socket)
  const tcpBrowser = socket as Duplex & { setKeepAlive?: (on: boolean, ms?: number) => void }
  tcpBrowser.setKeepAlive?.(true, 15_000)
  socket.on("error", () => socket.destroy())
  const admitted = admitSocket(config, incoming)
  if ("status" in admitted) {
    refuseSocket(socket, admitted)
    return
  }
  const headers = headersFor(incoming.headers, config.machineHost, admitted.access, admitted.proof)
  let joined = false
  const end = config.end
  // `net` names a socket file `path`, where `http` names it `socketPath`.
  const machine = connect("socket" in end ? { path: end.socket } : end, () => {
    joined = true
    machine.setKeepAlive(true, 15_000)
    machine.write(upgradeHead(incoming, headers))
    if (head.length > 0) machine.write(head)
    machine.pipe(socket)
    socket.pipe(machine)
  })
  track(machine)
  trackUpstream?.(machine)
  machine.on("error", () => {
    if (joined) socket.destroy()
    else refuseSocket(socket, { status: 502, reason: "the machine cannot be reached" })
  })
  machine.on("close", () => socket.destroy())
  socket.on("close", () => machine.destroy())
}
