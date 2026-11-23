// The local server's part of Automations: it sends what the writers queued, hears a command's
// flush call, does not stop for being idle while a delivery waits for a retry, and answers the
// routes of Settings › Automations. Those routes sit behind the server's guard; reading is for every
// paired browser, changing only for the key or a browser the App opened (a watch-only one gets 403).

import { wakeSender } from "../core/automations/queue.ts"
import { automationsWaiting, startAutomationSender } from "../core/automations/sender.ts"
import type { Ctx } from "../ctx.ts"
import {
  addAutomationRoute,
  automationReply,
  changeAutomationRoute,
  removeAutomationRoute,
  secretAutomationRoute,
  testAutomationRoute,
  testDraftAutomationRoute,
} from "./automations-mutations.ts"
import { automationDeliveriesOf, automationsViewOf } from "./automations-views.ts"

export type {
  AutomationsReply,
  AutomationView,
  DeliveryView,
} from "./automations-views.ts"
export { automationsWaiting }

/** Start sending queued events; returns the way to stop, as the server's other starts do. */
export function startAutomations(ctx: Ctx): () => void {
  return startAutomationSender(ctx)
}

const ID = "([^/]+)"
const FIXED = new Set(["test", "deliveries", "flush"])

function readOnlyAutomationRoute(ctx: Ctx, url: URL, method: string): Promise<Response> | null {
  if (url.pathname === "/api/automations/flush" && method === "POST") {
    wakeSender()
    return Promise.resolve(Response.json({ ok: true }))
  }
  if (url.pathname === "/api/automations" && method === "GET")
    return automationsViewOf(ctx).then((view) => automationReply(view))
  if (url.pathname === "/api/automations/deliveries" && method === "GET")
    return automationDeliveriesOf(ctx, url.searchParams.get("automation")).then((deliveries) =>
      automationReply({ deliveries }),
    )
  return null
}

const ITEM_HANDLERS: Record<string, (ctx: Ctx, id: string, request: Request) => Promise<Response>> =
  {
    "PUT:": (ctx, id, request) => changeAutomationRoute(ctx, id, request),
    "DELETE:": (ctx, id) => removeAutomationRoute(ctx, id),
    "POST:test": (ctx, id) => testAutomationRoute(ctx, id),
    "GET:secret": (ctx, id) => secretAutomationRoute(ctx, id),
  }

function itemAutomationRoute(
  ctx: Ctx,
  pathname: string,
  request: Request,
): Promise<Response> | null {
  const match = new RegExp(`^/api/automations/${ID}(?:/(test|secret))?$`).exec(pathname)
  const id = match?.[1]
  if (id === undefined || FIXED.has(id)) return null
  const handler = ITEM_HANDLERS[`${request.method}:${match?.[2] ?? ""}`]
  return handler ? handler(ctx, id, request) : null
}

function mutableAutomationRoute(
  ctx: Ctx,
  pathname: string,
  request: Request,
): Promise<Response> | null {
  if (pathname === "/api/automations")
    return request.method === "POST" ? addAutomationRoute(ctx, request) : null
  if (pathname === "/api/automations/test" && request.method === "POST")
    return testDraftAutomationRoute(ctx, request)
  return itemAutomationRoute(ctx, pathname, request)
}

/**
 * The routes of Settings › Automations and the flush call a command makes after it queued an event;
 * null for any other request. (The server's guard has already checked the key or the paired browser.)
 * The flush answer does not wait for the deliveries, so a slow receiver never slows the command.
 * `mayChange` is the key itself or a browser paired with it: a command automation runs a program
 * and a secret signs events, so a browser that may only watch reads the list and the deliveries
 * and gets 403 for everything else, as it does for starting a run.
 */
export async function automationsRoute(
  ctx: Ctx,
  request: Request,
  mayChange: boolean,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/automations")) return null
  const readonly = readOnlyAutomationRoute(ctx, url, request.method)
  if (readonly !== null) return readonly
  if (!mayChange) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message:
            "This browser can watch; change automations from the App or a browser it opened.",
        },
      },
      { status: 403 },
    )
  }
  return mutableAutomationRoute(ctx, url.pathname, request)
}
