// The Cockpit can approve an agent's work, so another web page must never be
// able to reach it: bind to loopback, accept only our own Host and Origin, and
// require the key or a paired browser's session cookie on every API call.

import { timingSafeEqual } from "node:crypto"

import { type SessionAuthority, type Sessions, sessionCookieName } from "./sessions.ts"

export type GuardConfig = {
  port: number
  token: string
  /** The browsers paired so far; without it only the key opens the API. */
  sessions?: Sessions
}

export type Refusal = { status: number; reason: string }

/**
 * The session id the request's cookie carries for the server that holds `token`, or null. Another
 * server's cookie (same host name, other port) is not ours and is never read.
 */
export function sessionOf(request: Request, token: string): string | null {
  const own = sessionCookieName(token)
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=")
    if (value.length > 0 && name === own) return value.join("=")
  }
  return null
}

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Pairing proof comes from the key header itself, never a query token or cookie. */
export function hasKeyHeader(request: Request, config: Pick<GuardConfig, "token">): boolean {
  const key = request.headers.get("x-qualitylayer-token")
  return key !== null && key !== "" && safeEqual(key, config.token)
}

/** Current cookie authority, rechecked for each terminal frame so revocation takes effect. */
export function sessionAuthority(
  request: Request,
  config: GuardConfig,
): (SessionAuthority & { id: string }) | null {
  const id = sessionOf(request, config.token)
  const authority = id === null ? null : config.sessions?.authority(id)
  return id === null || authority == null ? null : { id, ...authority }
}

// The loopback names on any port: VS Code and SSH forwards renumber the port the browser uses.
// The name is what a DNS-rebinding page cannot fake, so only the name is checked.
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost):(\d{1,5})$/

/** The loopback name on a port a socket can have (1–65535); anything else is no address of ours. */
const isLoopbackHost = (host: string): boolean => {
  const port = Number(LOOPBACK_HOST.exec(host)?.[2] ?? 0)
  return port >= 1 && port <= 65535
}

function refuseRequestOrigin(request: Request, needsToken: boolean): Refusal | null {
  const host = request.headers.get("host") ?? ""
  if (!isLoopbackHost(host)) return { status: 403, reason: "foreign host" }

  // An Origin is the page's own address: another local port is another site.
  const origin = request.headers.get("origin")
  if (origin !== null && origin !== `http://${host}`)
    return { status: 403, reason: "foreign origin" }
  // A cross-site request that a browser tags as such is refused even without an Origin header.
  // The one exception is opening the page itself: the URL is clicked in a terminal, a chat or
  // another tab, which is a cross-site navigation to a static shell that holds no data.
  const site = request.headers.get("sec-fetch-site")
  const crossSite = site !== null && site !== "same-origin" && site !== "none"
  const opensThePage =
    !needsToken && request.method === "GET" && request.headers.get("sec-fetch-mode") === "navigate"
  if (crossSite && !opensThePage) return { status: 403, reason: "cross-site request" }
  return null
}

function hasValidTokenOrSession(request: Request, config: GuardConfig): boolean {
  const key = request.headers.get("x-qualitylayer-token") || ""
  if (key !== "" && safeEqual(key, config.token)) return true
  const session = sessionOf(request, config.token)
  return session !== null && config.sessions?.valid(session) === true
}

/** Null when the request may proceed. `needsToken` is false for the static shell only. */
export function refuse(request: Request, config: GuardConfig, needsToken: boolean): Refusal | null {
  const originRefusal = refuseRequestOrigin(request, needsToken)
  if (originRefusal !== null) return originRefusal
  if (!needsToken || hasValidTokenOrSession(request, config)) return null
  return { status: 401, reason: "missing or wrong token" }
}
