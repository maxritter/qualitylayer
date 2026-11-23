import { realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { editedPaths, shellPatchedPaths } from "../git/session-edits.ts"
import { capFolder, QUALITY_HOOK_PENDING_MAX, QUALITY_HOOK_SESSIONS_KEPT } from "../home-caps.ts"
import { claimPendingBatch, recordBatchOutcome, runBatchChecks } from "./hook-batch.ts"
import {
  asObject,
  cleanHookPath,
  HOOK_LOCK,
  hookIdentity,
  type Payload,
  readQueue,
  writeQueue,
} from "./hook-queue.ts"
import { qualityProject, qualityStatus } from "./project.ts"

/** Records only named writes from this native session; no checker runs on a tool event. */
export async function recordQualityEdit(ctx: Ctx, raw: unknown): Promise<void> {
  const payload = asObject(raw)
  if (!payload || payload.is_error === true || asObject(payload.tool_response)?.isError === true)
    return
  const key = hookIdentity(ctx, payload)
  const paths = key
    ? [
        ...editedPaths(payload.tool_name, payload.tool_input),
        ...shellPatchedPaths(payload.tool_name, payload.tool_input),
      ]
    : []
  if (!key || !paths.length) return
  const project = await qualityProject(ctx)
  if (!project) return
  const givenCwd = typeof payload.cwd === "string" ? payload.cwd : ctx.env.cwd()
  const cwd = await realpath(givenCwd).catch(() => givenCwd)
  const canonical = await Promise.all(
    paths.map((path) => realpath(resolve(cwd, path)).catch(() => path)),
  )
  const local = canonical.flatMap((path) => cleanHookPath(project.root, cwd, path) ?? [])
  if (!local.length) return
  await enqueueHookEdits(ctx, join(project.folder, "hooks"), key, local)
}

async function enqueueHookEdits(
  ctx: Ctx,
  folder: string,
  key: string,
  local: string[],
): Promise<void> {
  const file = join(folder, `${key}.json`)
  await ctx.fs.mkdir(folder)
  const first = !(await ctx.fs.exists(file))
  await ctx.fs.withLock(
    `${file}.lock`,
    async () => {
      const queue = await readQueue(ctx, file)
      queue.sequence++
      const pending = new Map(queue.pending.map((entry) => [entry.path, entry]))
      for (const path of local) {
        if (!pending.has(path) && pending.size >= QUALITY_HOOK_PENDING_MAX) {
          queue.overflow = true
          continue
        }
        pending.set(path, { path, version: queue.sequence })
      }
      queue.pending = [...pending.values()]
      await writeQueue(ctx, file, queue)
    },
    HOOK_LOCK,
  )
  if (first)
    await ctx.fs.withLock(
      join(folder, ".cap.lock"),
      () =>
        capFolder(
          ctx,
          folder,
          QUALITY_HOOK_SESSIONS_KEPT - 1,
          (name) => name !== `${key}.json` && /^[a-f0-9]{64}\.json$/.test(name),
        ),
      HOOK_LOCK,
    )
}

async function existingHookTarget(
  ctx: Ctx,
  payload: Payload,
): Promise<{ root: string; file: string } | null> {
  const key = hookIdentity(ctx, payload)
  const project = key ? await qualityProject(ctx, { existingHook: key }) : null
  if (!key || !project) return null
  const file = join(project.folder, "hooks", `${key}.json`)
  return (await ctx.fs.exists(file)) ? { root: project.root, file } : null
}

/** Only prompt/tool context can deliver an advisory without continuing the finished turn. */
export async function takeQualityFeedback(ctx: Ctx, raw: unknown): Promise<string | null> {
  const payload = asObject(raw)
  const allowed =
    payload !== null &&
    (payload.hook_event_name === "UserPromptSubmit" || payload.hook_event_name === "PostToolUse")
  if (!allowed) return null
  const target = await existingHookTarget(ctx, payload)
  if (!target || (await qualityStatus(ctx)).enabled !== true) return null
  return ctx.fs.withLock(
    `${target.file}.lock`,
    async () => {
      const queue = await readQueue(ctx, target.file)
      if (!queue.feedback) return null
      const feedback = queue.feedback
      queue.feedback = ""
      await writeQueue(ctx, target.file, queue)
      return feedback
    },
    HOOK_LOCK,
  )
}

function isInterruptedTurn(payload: Payload | null): boolean {
  if (!payload || payload.stop_hook_active === true) return true
  return payload.reason === "interrupted" || payload.reason === "user_interrupt"
}

/** A completed turn checks one batch; failed batches stay queued without retrying the same edit. */
export async function qualityTurnFeedback(ctx: Ctx, raw: unknown): Promise<string | null> {
  const payload = asObject(raw)
  if (isInterruptedTurn(payload)) return null
  const target = await existingHookTarget(ctx, payload as Payload)
  if (!target) return null
  const batch = await claimPendingBatch(ctx, target.file)
  if (!batch.length) return null
  const outcome = await runBatchChecks(
    ctx,
    target.root,
    batch.map((entry) => entry.path),
  )
  return recordBatchOutcome(ctx, target.file, batch, outcome)
}
