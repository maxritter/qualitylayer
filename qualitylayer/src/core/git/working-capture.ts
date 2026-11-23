import type { Ctx } from "../../ctx.ts"
import {
  WORKING_CAPTURE_MS,
  WORKING_EVENT_PATHS,
  WORKING_EVENT_READ_BYTES,
  WORKING_FILE_MAX_BYTES,
} from "../home-caps.ts"
import type { HookPayload } from "../live/record.ts"
import type { RunEvent } from "../run/contracts.ts"
import { gitCall, gitEnv } from "../run/turn-git.ts"
import type { Task } from "../task/store.ts"
import { type NativeEdit, nativeEdits, replayNativeEdit } from "./native-edit.ts"
import { type BoundCapture, captureBinding, captureCompleted } from "./working-capture-binding.ts"
import { currentWorkingText, operationsMatchDisk, workingPath } from "./working-capture-io.ts"
import {
  admitWorkingRecord,
  digest,
  updateWorkingLedger,
  type WorkingOperation,
  workingTaskKey,
} from "./working-records.ts"

export { currentWorkingText, workingPath } from "./working-capture-io.ts"

const sourceBytes = (value: string | null) => Buffer.byteLength(value ?? "")

function saveWorkingText(contents: Map<string, string>, content: string | null) {
  if (content === null) return null
  const hash = digest(content)
  contents.set(hash, content)
  return hash
}

async function moveTargetExists(ctx: Ctx, task: Task, { from, path }: NativeEdit) {
  return from !== undefined && (await currentWorkingText(ctx, task, path)) !== null
}

async function workingPreimages(ctx: Ctx, task: Task, edits: NativeEdit[], until: number) {
  const operations: WorkingOperation[] = []
  const contents = new Map<string, string>()
  let bytes = 0
  for (const edit of edits) {
    const path = edit.path
    if (ctx.clock.now() >= until) return null
    const before = await currentWorkingText(ctx, task, edit.from ?? path)
    if (await moveTargetExists(ctx, task, edit)) return null
    const after = replayNativeEdit(edit, before)
    if (after === undefined) return null
    const afterBytes = sourceBytes(after)
    bytes += sourceBytes(before) + afterBytes
    if (bytes > WORKING_EVENT_READ_BYTES || afterBytes > WORKING_FILE_MAX_BYTES) return null
    if (before === after && !edit.from) continue
    operations.push({
      path,
      ...(edit.from ? { from: edit.from } : {}),
      before: saveWorkingText(contents, before),
      after: saveWorkingText(contents, after),
    })
  }
  return { operations, contents }
}

async function begin(ctx: Ctx, task: Task, payload: HookPayload, bound: BoundCapture) {
  const at = ctx.clock.now()
  const edits = nativeEdits(payload.tool_name, payload.tool_input)
  if (!edits.length || edits.length > WORKING_EVENT_PATHS) return
  const cwd = typeof payload.cwd === "string" ? payload.cwd : ctx.env.cwd()
  const scoped = edits.map((edit) => ({
    ...edit,
    path: workingPath(task.repoRoot, cwd, edit.path),
    from: edit.from ? workingPath(task.repoRoot, cwd, edit.from) : undefined,
  }))
  if (scoped.some((edit) => edit.path === null || edit.from === null)) return
  const named = scoped as NativeEdit[]
  const paths = named.flatMap(({ path, from }) => [path, from]).filter((path) => path !== undefined)
  const until = at + WORKING_CAPTURE_MS
  const env = gitEnv()
  const query = Promise.withResolvers<string>()
  const stop = new AbortController()
  // Start Git while the ignore check runs, then resolve HEAD only after the safe preimage reads.
  const headJob = gitCall(
    task.repoRoot,
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    { ...env, GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
    { until, maxBytes: 128, input: query.promise, signal: stop.signal },
  )
  try {
    const ignored = await gitCall(
      task.repoRoot,
      ["check-ignore", "--no-index", "--", ...paths],
      env,
      { until, maxBytes: 64 * 1024 },
    )
    if (typeof ignored === "string" || ![0, 1].includes(ignored.code) || ignored.stdout !== "")
      return
    const saved = await workingPreimages(ctx, task, named, until)
    if (!saved?.operations.length) return
    const { operations, contents } = saved
    query.resolve("HEAD^{commit}\n")
    const result = await headJob
    const head =
      typeof result !== "string" && result.code === 0
        ? /^([a-f0-9]{40,64}) commit$/.exec(result.stdout.trim())?.[1]
        : undefined
    if (!head || ctx.clock.now() >= until) return
    await admitWorkingRecord(
      ctx,
      {
        ...bound,
        task: workingTaskKey(task),
        repository: task.repoId,
        at,
        head,
        state: "pending",
        operations,
      },
      contents,
    )
  } finally {
    stop.abort()
    query.resolve("")
    await headJob
  }
}

async function finish(ctx: Ctx, task: Task, payload: HookPayload, bound: BoundCapture) {
  await updateWorkingLedger(ctx, async (ledger) => {
    const row = ledger.records.find(
      (record) => record.id === bound.id && record.task === workingTaskKey(task),
    )
    if (!row || row.end !== undefined || row.input !== bound.input) return
    row.end = ctx.clock.now()
    if (!captureCompleted(payload, bound.agent)) {
      row.state = "failed"
      return
    }
    if (!(await operationsMatchDisk(ctx, task, row.operations))) {
      row.state = "ambiguous"
      return
    }
    if (row.state === "pending") {
      row.state = "verified"
      row.verified = true
    }
  })
}

/** Passive evidence capture never selects a task, blocks a tool or infers ownership from a shell. */
export async function captureWorkingEdit(
  ctx: Ctx,
  task: Task,
  payload: HookPayload,
  event: RunEvent | null = null,
): Promise<void> {
  try {
    if (nativeEdits(payload.tool_name, payload.tool_input).length === 0) return
    const bound = await captureBinding(ctx, task, payload, event)
    if (!bound) return
    if (payload.hook_event_name === "PreToolUse") await begin(ctx, task, payload, bound)
    else if (["PostToolUse", "PostToolUseFailure"].includes(String(payload.hook_event_name)))
      await finish(ctx, task, payload, bound)
  } catch {
    // Missing or contested evidence stays unavailable; the native tool keeps its own result.
  }
}
