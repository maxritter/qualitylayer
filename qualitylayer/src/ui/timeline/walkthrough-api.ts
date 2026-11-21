// The Review page's walkthrough of a task: the one read the page makes beside the task itself
// (`GET /api/tasks/:id/walkthrough`, core/review/walkthrough.ts). The demo adapter serves it in memory
// through a `walkthrough` method of its own; a stub `Api` without one has none, and the page then
// draws the document as it is.

import type { Walkthrough } from "../../core/review/walkthrough.ts"
import { type Api, ApiError, api as liveApi } from "../api.ts"

/** An `Api` that may also serve the walkthrough (the demo does). */
export type WalkthroughApi = Api & { walkthrough?: (id: string) => Promise<Walkthrough> }

/** The walkthrough of a task; null when this `Api` serves none. */
export async function loadWalkthrough(
  api: WalkthroughApi,
  id: string,
  checked?: string,
): Promise<Walkthrough | null> {
  if (api.walkthrough !== undefined) return api.walkthrough(id)
  if (api !== liveApi) return null
  const scope = checked ? `?${new URLSearchParams({ checked })}` : ""
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}/walkthrough${scope}`)
  let payload: {
    ok?: boolean
    walkthrough?: Walkthrough
    error?: { message?: string; code?: string }
  }
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    payload = {}
  }
  if (!response.ok || payload.ok !== true || payload.walkthrough === undefined)
    throw new ApiError(
      payload.error?.message ?? "The change could not be read. Try again.",
      response.status,
      payload.error?.code ?? "http",
    )
  return payload.walkthrough
}
