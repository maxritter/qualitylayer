// The few App requests that go to the server directly rather than through the `Api` the demo hands
// in: the Pull request button's (`turn/GetApproval.tsx`) and the machine dialogs' (`machines/machines-api.ts`).
// The demo has no server, so they are answered here, in the page; every other request goes on as it
// would. Nothing leaves the browser.

import { createDemoOutsideApproval } from "./outside-approval.ts"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const requestHref = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url

const requestMethod = (input: RequestInfo | URL, init?: RequestInit): string =>
  (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()

function matchDemoEndpoint(
  pathname: string,
  method: string,
  approval: ReturnType<typeof createDemoOutsideApproval>,
): Response | null {
  const outside = /^\/api\/tasks\/([^/]+)\/outside-approval$/.exec(pathname)
  if (outside !== null) {
    const task = decodeURIComponent(outside[1] as string)
    return json({ ok: true, ...(method === "GET" ? approval.read(task) : approval.send(task)) })
  }
  const simple: Record<string, unknown> = {
    "/api/machines/hosts": { ok: true, hosts: [] },
    ...(method === "GET" ? { "/api/machines/pairings": { ok: true, pairings: [] } } : {}),
    ...(method === "GET" ? { "/api/schedules": { ok: true, schedules: [] } } : {}),
  }
  if (Object.hasOwn(simple, pathname)) return json(simple[pathname])
  if (/^\/api\/machines\/[^/]+\/sessions$/.test(pathname)) return json({ ok: true, running: 1 })
  return pathname.startsWith("/api/schedules") ? json({ ok: true, cancelled: true }) : null
}

/** The demo's answer to a request, or null for one it leaves alone. */
export function demoAnswers(search: string) {
  const approval = createDemoOutsideApproval(search)
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> => {
    const url = new URL(requestHref(input), window.location.href)
    if (url.origin !== window.location.origin) return null
    return matchDemoEndpoint(url.pathname, requestMethod(input, init), approval)
  }
}

/** Answer the demo's requests before the network sees them; installed once per window. */
export function installDemoFetch(search: string): void {
  const marked = window as { __qualitylayerDemoFetch?: true }
  if (marked.__qualitylayerDemoFetch === true) return
  marked.__qualitylayerDemoFetch = true
  const answer = demoAnswers(search)
  const network = window.fetch.bind(window)
  const answered = async (input: RequestInfo | URL, init?: RequestInit) =>
    (await answer(input, init)) ?? network(input, init)
  window.fetch = answered as typeof fetch
}
