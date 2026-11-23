import { WORKING_EVENTS_MAX } from "../../core/git/working-limits.ts"

export type DiffPage = { diff: string; revision?: string; next?: string }
export type DiffCursor = { after?: string; revision?: string }
export type DiffReadOptions = { signal?: AbortSignal; revision?: string }

function validateDiffPage(page: DiffPage, revision: string | undefined): string | undefined {
  if (typeof page.diff !== "string" || (page.next !== undefined && typeof page.next !== "string")) {
    throw new Error("The diff response is incomplete.")
  }
  if (revision !== undefined && page.revision !== revision) {
    throw new Error("The file revision changed. Refresh Review.")
  }
  return revision ?? page.revision
}

/** One user-requested file read; closing it cancels continuations and all buffers stay bounded. */
export async function readDiffPages(
  load: (cursor: DiffCursor, signal: AbortSignal) => Promise<DiffPage>,
  options: DiffReadOptions = {},
): Promise<string> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener("abort", abort, { once: true })
  if (options.signal?.aborted) abort()
  const timer = setTimeout(abort, 30_000)
  const chunks: string[] = []
  const seen = new Set<string>()
  let after: string | undefined
  let revision = options.revision
  let bytes = 0
  try {
    for (let n = 0; n < WORKING_EVENTS_MAX; n++) {
      controller.signal.throwIfAborted()
      const page = await load({ after, revision }, controller.signal)
      revision = validateDiffPage(page, revision)
      bytes += new TextEncoder().encode(page.diff).length
      if (bytes > 8 * 1024 * 1024) break
      chunks.push(page.diff)
      if (page.next === undefined) return chunks.join("\n")
      if (!revision || !page.next || seen.has(page.next))
        throw new Error("The diff continuation did not advance.")
      seen.add(page.next)
      after = page.next
    }
    throw new Error(
      "This file's diff exceeds the reading limit. Open an individual version in Full file.",
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", abort)
  }
}
