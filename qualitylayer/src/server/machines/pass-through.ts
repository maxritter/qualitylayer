// A machine's page, served on a port of this computer's server. A browser sends every cookie it holds
// for 127.0.0.1 to every local port, so a machine's server must never be reachable by the browser
// itself: this listener checks each request as this computer's own pages are checked, drops what the
// browser sent to sign in (`pass-headers.ts`), and passes the request on with the machine's own
// session. The machine is reached through a local end no browser can address (a socket file, or
// another loopback address). Sockets go through `pass-socket.ts`.

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import type { Duplex } from "node:stream"

import { type Refusal, refuse } from "../guard.ts"
import {
  type Admitted,
  answerHeaders,
  asRequest,
  FOREIGN_HOST,
  headersFor,
  type LocalEnd,
  NOT_CONNECTED,
  type PassThroughConfig,
  proofOf,
} from "./pass-headers.ts"
import { passSocket } from "./pass-socket.ts"

export type { LocalEnd, MachineAccess, PassThroughConfig } from "./pass-headers.ts"

export type PassThrough = {
  port: number
  /** Swap the upstream target behind this bound listener and tear down stale tunnel sockets. */
  swap(next: { end: LocalEnd; machineHost: string; unreachable?: () => void }): void
  close(): Promise<void>
}

const isApi = (path: string): boolean => path.startsWith("/api/") || path === "/stream"

const HOST_ACTION: Refusal = {
  status: 403,
  reason: "this page runs on another computer: what opens a program there is not offered",
}

/**
 * The routes that would open a program or a dialog on the machine's own screen: a task's Open file,
 * Reveal and Open in editor (one route), an artifact's Open in browser and Show in folder, a project's
 * Reveal, the folder dialog, and the home's Reveal.
 * A machine's page offers none of them (`ui/machines/framed.ts`), and nothing passed through here may
 * start one, whatever the method. Matched on the path the way the server routes it: normalised, empty
 * segments dropped, each segment decoded, and by prefix: `serve.ts` routes a task's `open` on its
 * fourth segment and an artifact's `open` on its sixth whatever follows, so `…/open/x` is one too.
 * Every route is matched by prefix, so a machine on another version that reads one a little wider
 * is covered as well; no route a page uses starts with one of these.
 */
// A segment that is not valid encoding is matched as written: the machine may still route on it.
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function isHostAction(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean).map(decodeSegment)
  const [api, place, id, action] = parts
  if (api !== "api") return false
  if (place === "tasks" && action === "open") return true
  // An artifact's Open in browser and Show in folder, of a task or of a project.
  if ((place === "tasks" || place === "projects") && action === "artifacts" && parts[5] === "open")
    return true
  if (place === "projects" && (action === "reveal" || (id === "folders" && action === "pick")))
    return true
  return place === "disk-use" && id === "reveal"
}

function admit(config: PassThroughConfig, incoming: IncomingMessage): Admitted {
  const request = asRequest(incoming)
  if (request === null) return FOREIGN_HOST
  const { pathname } = new URL(request.url)
  const refusal = refuse(request, config.guard, isApi(pathname))
  if (refusal !== null) return refusal
  if (isHostAction(pathname)) return HOST_ACTION
  const access = config.access()
  if (access === null) return NOT_CONNECTED
  return { access, proof: proofOf(request, config.guard) }
}

function probeHealthy(config: PassThroughConfig): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    const end = "socket" in config.end ? { socketPath: config.end.socket } : config.end
    const req = httpRequest(
      {
        ...end,
        path: "/api/config",
        method: "GET",
        headers: { host: config.machineHost },
        timeout: 2_000,
      },
      (res) => {
        const done = () =>
          finish(res.complete && typeof res.statusCode === "number" && res.statusCode > 0)
        res.on("end", done)
        res.on("close", done)
        res.on("error", () => finish(false))
        res.resume()
      },
    )
    req.on("timeout", () => {
      req.destroy()
      finish(false)
    })
    req.on("error", () => finish(false))
    req.end()
  })
}

function passRequest(
  config: PassThroughConfig,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  reportUnreachable: () => void,
): void {
  const admitted = admit(config, incoming)
  if ("status" in admitted) {
    outgoing.writeHead(admitted.status).end(admitted.reason)
    return
  }
  const headers = headersFor(incoming.headers, config.machineHost, admitted.access, admitted.proof)
  const end = "socket" in config.end ? { socketPath: config.end.socket } : config.end
  // The browser gave the request up (a page left, a fetch cancelled): ending the passed request
  // then is this side's doing and says nothing about the machine.
  let left = false
  const passed = httpRequest(
    { ...end, path: incoming.url, method: incoming.method, headers },
    (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answerHeaders(answer.headers, config.guard.port))
      answer.pipe(outgoing)
      // The machine went away in the middle of its answer: `pipe` ends the browser's side only on a
      // whole answer, so a cut-off one would leave the browser's request open for good, and a page
      // that waits for it never finishes loading. End it as cut off, and probe tunnel health before
      // declaring the machine unreachable.
      let cut = false
      const cutOff = () => {
        if (cut || left || answer.complete) return
        cut = true
        outgoing.destroy()
        reportUnreachable()
      }
      answer.on("error", cutOff)
      answer.on("close", cutOff)
    },
  )
  passed.on("error", () => {
    if (left) return
    if (outgoing.headersSent) return void outgoing.destroy()
    outgoing.writeHead(502).end("the machine cannot be reached")
    reportUnreachable()
  })
  outgoing.on("close", () => {
    left = true
    passed.destroy()
  })
  incoming.pipe(passed)
}

/** Start one machine's listener on 127.0.0.1. */
export function startPassThrough(initial: PassThroughConfig): Promise<PassThrough> {
  const config: PassThroughConfig = { ...initial }
  const open = new Set<Duplex>()
  const upstream = new Set<Duplex>()
  let probing = false
  let generation = 0
  const reportUnreachable = () => {
    if (probing || !config.unreachable) return
    probing = true
    const currentGen = generation
    const callback = config.unreachable
    void probeHealthy(config).then((healthy) => {
      probing = false
      if (!healthy && currentGen === generation) callback()
    })
  }
  const track = (socket: Duplex) => {
    open.add(socket)
    socket.once("close", () => open.delete(socket))
  }
  const trackUpstream = (socket: Duplex) => {
    upstream.add(socket)
    socket.once("close", () => upstream.delete(socket))
  }
  const server = createServer((incoming, outgoing) =>
    passRequest(config, incoming, outgoing, reportUnreachable),
  )
  // Long-lived `/stream` SSE and WebSocket bridges must not be cut by Node/Bun's default 5-min timeout.
  server.requestTimeout = 0
  server.timeout = 0
  server.keepAliveTimeout = 60_000
  server.on("upgrade", (incoming, socket, head) =>
    passSocket(config, { incoming, socket, head, track, trackUpstream }),
  )
  server.on("connection", track)
  const swap: PassThrough["swap"] = (next) => {
    generation++
    config.end = next.end
    config.machineHost = next.machineHost
    if (next.unreachable !== undefined) config.unreachable = next.unreachable
    for (const socket of upstream) socket.destroy()
    upstream.clear()
  }
  const close = () =>
    new Promise<void>((closed) => {
      for (const socket of open) socket.destroy()
      server.close(() => closed())
    })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.port, "127.0.0.1", () => {
      server.off("error", reject)
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : config.port
      resolve({ port, swap, close })
    })
  })
}
