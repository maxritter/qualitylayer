// The routes under `/api/machines`. Reading the list needs what any API call needs; everything that
// starts ssh or changes the list needs the App or a browser it opened, as the folder routes do.

import type { Ctx } from "../../ctx.ts"
import type { ThisLicence } from "./licence.ts"
import type { LocalRun } from "./local.ts"
import type { Machines } from "./manager.ts"
import {
  containersRoute,
  hostKeyRoute,
  listPairingsRoute,
  nearbyHostsRoute,
  pairingActRoute,
  sessionsRoute,
  startPairingRoute,
} from "./routes-pairing.ts"
import {
  addMachineRoute,
  checkMachineRoute,
  hostsRoute,
  removeMachineRoute,
  renameMachineRoute,
  routesJson,
  routesRefused,
  updateMachineRoute,
} from "./routes-setup.ts"
import type { Ssh } from "./ssh.ts"

const MACHINES_PATH = "/api/machines"

export type MachineRoutes = {
  ctx: Ctx
  machines: Machines
  /** Null where this server starts no ssh (a test without one). */
  ssh: Ssh | null
  /** What this computer holds as a licence; its own licence file when not named (a test names one). */
  thisLicence?: (ctx: Ctx) => Promise<ThisLicence>
  /** The programs pairing runs here (docker, ssh-keygen, dns-sd); the real ones when not named. */
  local?: LocalRun
}

type RouteHandler = () => Promise<Response>

const COLLECTION_ROUTES: Record<
  string,
  (routes: MachineRoutes, request: Request) => Promise<Response>
> = {
  "POST:": (routes, request) => addMachineRoute(routes, request),
  "GET:hosts": (routes) => hostsRoute(routes),
  "POST:check": (routes, request) => checkMachineRoute(routes, request),
  "GET:containers": (routes) => containersRoute(routes),
  "GET:nearby": (routes) => nearbyHostsRoute(routes),
}

function matchPairingRoute(
  routes: MachineRoutes,
  request: Request,
  rest: string[],
): RouteHandler | null {
  if (rest.length === 1) {
    if (request.method === "POST") return () => startPairingRoute(routes, request)
    if (request.method === "GET") return () => listPairingsRoute(routes)
    return null
  }
  const [, id, act] = rest
  return id !== undefined && rest.length <= 3
    ? () => pairingActRoute(routes, request, id, act)
    : null
}

function matchMachineItemSubroute(
  routes: MachineRoutes,
  request: Request,
  id: string,
  sub: string,
): RouteHandler | null {
  const { method } = request
  if (sub === "host-key" && (method === "GET" || method === "POST"))
    return () => hostKeyRoute(routes, id, request)
  if (sub === "sessions" && method === "GET") return () => sessionsRoute(routes, id)
  if (sub === "update" && method === "POST") return () => updateMachineRoute(routes, id)
  if (sub === "retry" && method === "POST") {
    return async () =>
      routes.machines.retry(id) ? routesJson({ ok: true }) : routesRefused(404, "No such machine.")
  }
  return null
}

function matchMachineItemRoute(
  routes: MachineRoutes,
  request: Request,
  rest: string[],
): RouteHandler | null {
  const [id, sub] = rest
  if (id === undefined || rest.length > 2) return null
  if (sub !== undefined) return matchMachineItemSubroute(routes, request, id, sub)
  if (request.method === "PATCH") return () => renameMachineRoute(routes, id, request)
  return request.method === "DELETE" ? () => removeMachineRoute(routes, id, request) : null
}

/** A route that starts ssh or changes the list; null when the path and method name none. */
function changing(routes: MachineRoutes, request: Request, rest: string[]): RouteHandler | null {
  if (rest[0] === "pairings") return matchPairingRoute(routes, request, rest)
  if (rest.length <= 1) {
    const direct = COLLECTION_ROUTES[`${request.method}:${rest[0] ?? ""}`]
    if (direct) return () => direct(routes, request)
  }
  return matchMachineItemRoute(routes, request, rest)
}

/** The answer to a request under `/api/machines`, or null for any other path. */
export async function machinesRoute(
  request: Request,
  routes: MachineRoutes | undefined,
  keyPaired: () => boolean,
): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (path !== MACHINES_PATH && !path.startsWith(`${MACHINES_PATH}/`)) return null
  if (path === MACHINES_PATH && request.method === "GET")
    return routesJson({ ok: true, machines: routes?.machines.list() ?? [] })
  const rest = path.slice(MACHINES_PATH.length).split("/").filter(Boolean)
  const route = routes === undefined ? null : changing(routes, request, rest)
  if (route === null) return new Response("No such machines route.", { status: 404 })
  if (!keyPaired())
    return routesRefused(
      403,
      "Only the QualityLayer App or a browser it opened may change machines.",
    )
  return route()
}
