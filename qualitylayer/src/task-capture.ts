// What a task leaves behind as lessons: standing human decisions and accepted or checked technical
// findings. Each source is saved once, under a key that names it (`q:q1`, `review:verify:2`,
// `amend:<time>`), so a later reply updates a lesson instead of adding a
// second one, and a crash retries only what is missing. `memory-captured.json` in the task's runtime
// folder maps each key to the hash of the text it was saved from.

import { basename, join } from "node:path"
import { MEMORY_CAPTURED_MAX_BYTES } from "./core/home-caps.ts"
import { MEMORY_RETIRED, type MemoryService } from "./core/memory/index.ts"
import { hash, relativeFile } from "./core/memory/validation.ts"
import { recordMemoryActivity } from "./core/memory-activity.ts"
import { inPersonReview } from "./core/review/in-review.ts"
import { readEvents, type Task } from "./core/task/store.ts"
import type { Ctx } from "./ctx.ts"
import { ANSWER_TAG } from "./memory-contracts.ts"
import { memoryService } from "./memory-runtime.ts"
import { type CaptureSource, sourcesOf } from "./task-capture-sources.ts"
import { namedFiles } from "./task-memory.ts"

export type CaptureCounts = { saved: number; unchanged: number; failed: number }

/** Deferral and a spent judge budget leave technical records in the task, not project knowledge. */
async function captureStatus(
  ctx: Ctx,
  task: Task,
): Promise<{ verified: boolean; accepted: boolean }> {
  // Verified: Verify's last judgement passed (a kept-red review or a spent budget passed none).
  const judged = (await readEvents(ctx, task)).findLast((event) => event.event === "verify_result")
  const verified = judged?.passed === true
  // Accepted: checked or shipped.
  return { verified, accepted: verified || task.stage === "shipped" }
}

type Captured = { keys: Record<string, string> }

async function readCaptured(ctx: Ctx, path: string): Promise<Captured> {
  if (!(await ctx.fs.exists(path))) return { keys: {} }
  const entry = await ctx.fs.lstat?.(path)
  if (entry && entry.kind !== "file") throw new Error("Captured lessons must be a regular file")
  if (((await ctx.fs.stat?.(path))?.size ?? 0) > MEMORY_CAPTURED_MAX_BYTES)
    throw new Error("Captured lessons exceed their limit")
  const saved: unknown = JSON.parse(await ctx.fs.readFile(path))
  const keys = (saved as { keys?: unknown } | null)?.keys
  if (!keys || typeof keys !== "object" || Array.isArray(keys))
    throw new Error("Invalid captured lessons file")
  return {
    keys: Object.fromEntries(
      Object.entries(keys).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
    ),
  }
}

async function storeCapturedSource(
  service: MemoryService,
  task: Task,
  source: CaptureSource,
  unverified: boolean,
): Promise<{ status: "saved"; id: string } | { status: "unchanged" | "failed" }> {
  try {
    // The repository paths its own text names are its files; a lesson naming none is untracked.
    const files = namedFiles(source.title, source.content)
      .filter((file) => relativeFile(file))
      .slice(0, 32)
    const record = await service.store({
      project: task.repoId,
      title: source.title,
      content: source.content,
      kind: source.kind,
      ...(files.length ? { files } : {}),
      ...(source.answer ? { tags: [ANSWER_TAG], local: true as const } : {}),
      task: task.slug,
      key: source.key,
      ...(unverified ? { unverified: true as const } : {}),
    })
    return { status: "saved", id: record.id }
  } catch (cause) {
    if (cause instanceof Error && cause.message === MEMORY_RETIRED) return { status: "unchanged" }
    return { status: "failed" }
  }
}

async function persistCapturedKeys(
  ctx: Ctx,
  path: string,
  keys: Record<string, string>,
): Promise<void> {
  const text = `${JSON.stringify({ keys })}\n`
  if (Buffer.byteLength(text) > MEMORY_CAPTURED_MAX_BYTES)
    throw new Error("Captured lessons exceed their limit")
  await ctx.fs.atomicWrite(path, text)
}

async function processCapturedSource(
  ctx: Ctx,
  target: { task: Task; path: string; service: MemoryService },
  state: {
    keys: Record<string, string>
    counts: CaptureCounts
    savedIds: string[]
    status: { verified: boolean; accepted: boolean }
  },
  source: CaptureSource,
): Promise<void> {
  if (source.needsChecks && !state.status.accepted) return
  const unverified = source.needsChecks && !state.status.verified
  const digest = hash(JSON.stringify([source.kind, source.title, source.content, unverified]))
  if (state.keys[source.key] === digest) {
    state.counts.unchanged++
    return
  }
  const result = await storeCapturedSource(target.service, target.task, source, unverified)
  if (result.status === "failed") {
    state.counts.failed++
    return
  }
  if (result.status === "saved") {
    state.savedIds.push(result.id)
    state.counts.saved++
  } else {
    state.counts.unchanged++
  }
  // A key is written only after its lesson is saved, so a crash retries only what is missing.
  state.keys[source.key] = digest
  await persistCapturedKeys(ctx, target.path, state.keys)
}

async function captureAllSources(
  ctx: Ctx,
  task: Task,
  service: MemoryService,
  status: { verified: boolean; accepted: boolean },
): Promise<{ counts: CaptureCounts; savedIds: string[] }> {
  const counts: CaptureCounts = { saved: 0, unchanged: 0, failed: 0 }
  const savedIds: string[] = []
  const sources = await sourcesOf(ctx, task)
  const path = join(task.runtimeDir, "memory-captured.json")
  await ctx.fs.assertSafeDirectory?.(task.runtimeDir)
  await ctx.fs.withLock(`${path}.lock`, async () => {
    const { keys } = await readCaptured(ctx, path)
    for (const source of sources) {
      await processCapturedSource(
        ctx,
        { task, path, service },
        { keys, counts, savedIds, status },
        source,
      )
    }
  })
  return { counts, savedIds }
}

/**
 * Saves the lessons a task's records hold and have not saved yet. Runs on every reply while the task
 * is in Review and at the ship step. A source whose lesson the person retired stays retired: its key
 * is settled with the source's current hash and a later change to it is skipped too.
 */
export async function captureTaskLessons(
  ctx: Ctx,
  task: Task,
  open?: MemoryService,
): Promise<CaptureCounts> {
  const empty = { saved: 0, unchanged: 0, failed: 0 }
  if (task.stage !== "shipped" && !(await inPersonReview(ctx, task))) return empty
  const service = open ?? memoryService(ctx)
  try {
    await service.registerProject({
      id: task.repoId,
      automatic: true,
      name: basename(task.repoRoot),
      root: task.repoRoot,
    })
    if (!(await service.overview(task.repoId)).enabled) return empty
    const status = await captureStatus(ctx, task)
    const { counts, savedIds } = await captureAllSources(ctx, task, service, status)
    if (savedIds.length > 0) {
      await recordMemoryActivity(ctx, task, "saves", savedIds.length, savedIds)
      // The saves stand even when the exchange with Git cannot finish now; the next sync retries it.
      await service.exchange(task.repoId).catch(() => {})
    }
    return counts
  } finally {
    if (open === undefined) await service.close()
  }
}
