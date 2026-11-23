// Helpers that run side by side report what they are doing, one line each, so
// the Cockpit can show where a step stands. A helper knows only its opaque
// id, which is unique across every task on the machine; the CLI finds the task
// that started it, whatever directory the helper is working in.

import type { Ctx } from "../ctx.ts"
import { type FiledHelper, type Helper, helperMinutes } from "./briefs.ts"
import {
  type Activity,
  activity,
  type BuildLine,
  type BuildReport,
  buildLine,
  buildReports,
  reportBuild,
  runningNow,
} from "./helpers-activity.ts"
import { reportProgress } from "./helpers-progress.ts"
import {
  helperResultFile,
  helperResults,
  pendingHelperOffers,
  rememberHelperOffers,
  saveHelperResult,
} from "./helpers-results.ts"
import {
  archiveSet,
  currentSet,
  endSliceHelpers,
  type HelperFile,
  type HelperLine,
  helperLines,
  helpersLockPath,
  helpersPath,
  missingSliceCheck,
  readHelperFile,
  readPastSets,
  rememberSet,
  unfinishedQualityOffers,
} from "./helpers-store.ts"
import { loadTask, type Task } from "./task/store.ts"

export {
  type Activity,
  activity,
  type BuildLine,
  type BuildReport,
  buildLine,
  buildReports,
  currentSet,
  endSliceHelpers,
  helperLines,
  helperResultFile,
  helperResults,
  missingSliceCheck,
  pendingHelperOffers,
  readPastSets,
  rememberHelperOffers,
  reportBuild,
  reportProgress,
  runningNow,
  saveHelperResult,
  unfinishedQualityOffers,
}

/** Slice owners remain registered until their commit or explicit restart releases them. */
const unfinishedSlices = (file: HelperFile) =>
  file.ids.filter((id) => file.slices?.[id] !== undefined && file.slices[id]?.released !== true)

function carriedHelperIds(previous: HelperFile | null, task: Task): string[] {
  if (previous === null || previous.stage !== task.stage) return []
  const chatOpen =
    task.type === "chat" ? previous.ids.filter((id) => previous.lines[id]?.done !== true) : []
  return [...chatOpen, ...unfinishedSlices(previous)]
}

function mergeHelperRoles(
  kept: readonly string[],
  previous: HelperFile | null,
  helpers: readonly (Helper | FiledHelper)[],
  slices: NonNullable<HelperFile["slices"]>,
): NonNullable<HelperFile["roles"]> {
  const roles: NonNullable<HelperFile["roles"]> = {}
  for (const id of kept) {
    const before = previous?.roles?.[id]
    if (before !== undefined) roles[id] = before
  }
  for (const helper of helpers) {
    if (helper.id !== undefined && slices[helper.id] === undefined) roles[helper.id] = helper.role
  }
  return roles
}

function mergeHelperOffers(
  previous: HelperFile | null,
  current: Set<string>,
  helpers: readonly (Helper | FiledHelper)[],
): Record<string, FiledHelper> {
  const offers = Object.fromEntries(
    Object.entries(previous?.offers ?? {}).filter(([id]) => current.has(id)),
  )
  for (const helper of helpers) {
    if (!helper.id || !helper.brief_file) continue
    const { brief: _brief, gaps: _gaps, ...offer } = helper as Helper
    offers[helper.id] = { ...offer, brief_file: helper.brief_file }
  }
  return offers
}

/**
 * A new set replaces the last one, except unfinished slices and the fix helper of the same
 * stage: they keep their ids and lines, so `progress <id> done` is still accepted.
 * `sliceOf` names the slice each new slice helper builds.
 */
export async function startHelpers(
  ctx: Ctx,
  task: Task,
  helpers: (Helper | FiledHelper)[],
  sliceOf: Record<string, number> = {},
): Promise<void> {
  if (helpers.every((helper) => helper.id === undefined)) return
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.withLock(helpersLockPath(task), async () => {
    if (task.type === "chat") {
      const current = await loadTask(
        ctx,
        { root: task.repoRoot, id: task.repoId, commonDir: "" },
        task.slug,
      )
      if (current?.type !== "chat" || current.stage !== "chat")
        throw new Error("This task left Chat before its helpers could start")
    }
    await startHelpersWithin(ctx, task, helpers, sliceOf)
  })
}

function collectRetired(previous: HelperFile | null, current: Set<string>): string[] {
  if (previous === null) return []
  const unfinished = previous.ids.filter((id) => previous.lines[id]?.done !== true)
  return [...new Set([...(previous.retired ?? []), ...unfinished])].filter((id) => !current.has(id))
}

function buildHelperFile(input: {
  task: Task
  previous: HelperFile | null
  joins: boolean
  now: number
  kept: readonly string[]
  ids: readonly string[]
  helpers: readonly (Helper | FiledHelper)[]
  sliceOf: Record<string, number>
}): HelperFile {
  const { task, previous, joins, now, kept, ids, helpers, sliceOf } = input
  const slices: NonNullable<HelperFile["slices"]> = {}
  const lines: Record<string, HelperLine> = {}
  for (const id of kept) {
    if (previous?.slices?.[id] !== undefined) slices[id] = previous.slices[id]
    if (previous?.lines[id] !== undefined) lines[id] = previous.lines[id]
  }
  for (const [id, n] of Object.entries(sliceOf)) slices[id] = { n, at: now }
  const current = new Set([...kept, ...ids])
  const retired = collectRetired(previous, current)
  const roles = mergeHelperRoles(kept, previous, helpers, slices)
  const offers = mergeHelperOffers(previous, current, helpers)
  const role = helpers[0]?.role
  const minutes = Math.max(
    ...helpers.map((h) => helperMinutes(h.role, h.share, h.minutes)),
    joins ? (previous?.minutes ?? 0) : 0,
  )
  return {
    started: joins && previous !== null ? previous.started : now,
    stage: task.stage,
    ...(role !== undefined ? { role } : {}),
    ...(Object.keys(roles).length > 0 ? { roles } : {}),
    minutes,
    ids: [...current],
    lines,
    ...(Object.keys(offers).length > 0 ? { offers } : {}),
    ...(Object.keys(slices).length > 0 ? { slices } : {}),
    ...(retired.length > 0 ? { retired } : {}),
  }
}

async function startHelpersWithin(
  ctx: Ctx,
  task: Task,
  helpers: (Helper | FiledHelper)[],
  sliceOf: Record<string, number>,
): Promise<void> {
  const ids = helpers.map((h) => h.id).filter((id): id is string => id !== undefined)
  if (ids.length === 0) return
  const previous = await readHelperFile(ctx, task)
  const carried = carriedHelperIds(previous, task)
  // More slices of the same build join the running set; it goes on from where it started.
  const joins = previous !== null && carried.length > 0
  if (previous !== null && !joins) {
    await rememberSet(ctx, previous)
    await archiveSet(ctx, task, previous)
  }
  const file = buildHelperFile({
    task,
    previous,
    joins,
    now: ctx.clock.now(),
    kept: joins ? previous.ids : carried,
    ids,
    helpers,
    sliceOf,
  })
  await ctx.fs.atomicWrite(helpersPath(task), `${JSON.stringify(file, null, 2)}\n`)
}
