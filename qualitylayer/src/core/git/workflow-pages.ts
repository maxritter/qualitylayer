import type { Ctx } from "../../ctx.ts"
import type { WalkFile } from "../review/walkthrough.ts"
import type { OwnedPart } from "./workflow-parts.ts"
import { WORKING_VIEW_DIFFS_MAX } from "./working-limits.ts"
import { workingObjectPath } from "./working-records.ts"

export type WorkflowPage = { diff: string; revision: string; next?: string }
export type PageRequest = { path: string; after?: string; revision?: string }
export const WORKING_READ_BYTES = 4 * 1024 * 1024
const PAGE_PATCH_BYTES = 2 * 1024 * 1024

function validatePageRequest(file: WalkFile, request: PageRequest) {
  if (!file.stamp || (request.revision !== undefined && request.revision !== file.stamp))
    throw new Error("The file revision changed. Refresh Review before reading its diff.")
  if (request.after !== undefined && request.revision === undefined)
    throw new Error("The diff continuation has no file revision.")
  const ordered = file.parts ?? []
  const previous =
    request.after === undefined ? -1 : ordered.findIndex((part) => part.stamp === request.after)
  if (request.after !== undefined && previous < 0)
    throw new Error("The diff continuation is not part of this file.")
  return { revision: file.stamp, remaining: ordered.slice(previous + 1) }
}

async function nativePartBytes(ctx: Ctx, part: OwnedPart): Promise<number> {
  if (!part.native) return 0
  let needed = 0
  for (const hash of [part.native.operation.before, part.native.operation.after]) {
    if (hash === null) continue
    const size = await ctx.fs.stat?.(workingObjectPath(ctx, hash))
    if (!size) throw new Error("This saved file version is unavailable.")
    needed += size.size
  }
  return needed
}

/** Each continuation binds the complete ordered file inventory, not an index in a moving list. */
export async function workflowPage(
  ctx: Ctx,
  file: WalkFile,
  parts: ReadonlyMap<string, OwnedPart>,
  request: PageRequest,
  read: (part: OwnedPart, budget: { left: number }) => Promise<OwnedPart>,
): Promise<WorkflowPage> {
  const { revision, remaining } = validatePageRequest(file, request)
  const budget = { left: WORKING_READ_BYTES }
  const chunks: string[] = []
  let bytes = 0,
    consumed = 0,
    last = request.after
  for (const descriptor of remaining) {
    if (consumed >= WORKING_VIEW_DIFFS_MAX) return { diff: chunks.join("\n"), revision, next: last }
    const part = parts.get(descriptor.stamp)
    if (!part || part.unavailable) throw new Error("This saved file version is unavailable.")
    if ((await nativePartBytes(ctx, part)) > budget.left && consumed > 0)
      return { diff: chunks.join("\n"), revision, next: last }
    const materialized = await read(part, budget)
    const length = Buffer.byteLength(materialized.patch)
    if (bytes + length > PAGE_PATCH_BYTES) {
      if (consumed === 0) throw new Error("This file version exceeds the diff reading limit.")
      return { diff: chunks.join("\n"), revision, next: last }
    }
    chunks.push(materialized.patch)
    bytes += length
    consumed++
    last = descriptor.stamp
  }
  return { diff: chunks.join("\n"), revision }
}
