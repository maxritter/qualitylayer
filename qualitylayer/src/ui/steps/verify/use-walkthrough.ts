// The Review page's walkthrough in the App: the view the server draws from the records, read again
// when the Review document is rewritten (`stamp`).

import type { Walkthrough as WalkthroughView } from "../../../core/review/walkthrough.ts"
import { type Query, useQuery } from "../../hooks.ts"
import { loadWalkthrough, type WalkthroughApi } from "../../timeline/walkthrough-api.ts"

/**
 * The first read of a large change after the server started diffs every changed file once; later
 * reads are quick. The page keeps showing that it is loading for that long instead of giving up.
 */
export const WALKTHROUGH_READ_MS = 120_000

export function useWalkthrough(
  api: WalkthroughApi | undefined,
  taskId: string,
  stamp: string,
  checked?: string,
): Query<WalkthroughView | null> {
  return useQuery(
    () => (api === undefined ? Promise.resolve(null) : loadWalkthrough(api, taskId, checked)),
    [api, taskId, stamp, checked],
    false,
    WALKTHROUGH_READ_MS,
  )
}
