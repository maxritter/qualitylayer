// The few App requests that go to the server directly rather than through the `Api` the demo hands
// in: the Pull request button's (`turn/GetApproval.tsx`) and the machine dialogs' (`machines/machines-api.ts`).
// The demo has no server, so they are answered here, in the page; every other request goes on as it
// would. Nothing leaves the browser.

import { createDemoOutsideApproval } from "./outside-approval.ts"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** The demo's answer to a request, or null for one it leaves alone. */
export function demoAnswers(search: string) {
  const approval = createDemoOutsideApproval(search)
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    )
    if (url.origin !== window.location.origin) return null
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    const outside = /^\/api\/tasks\/([^/]+)\/outside-approval$/.exec(url.pathname)
    if (outside !== null) {
      const task = decodeURIComponent(outside[1] as string)
      if (method === "GET") return json({ ok: true, ...approval.read(task) })
      return json({ ok: true, ...approval.send(task) })
    }
    // Add machine lists the ssh config's hosts; Remove asks how many sessions run there.
    if (url.pathname === "/api/machines/hosts") return json({ ok: true, hosts: [] })
    if (url.pathname === "/api/machines/pairings" && method === "GET")
      return json({ ok: true, pairings: [] })
    if (/^\/api\/machines\/[^/]+\/sessions$/.test(url.pathname))
      return json({ ok: true, running: 1 })
    return null
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
