import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { detectAgent } from "../agents/detect.ts"
import {
  WORKING_CAPTURE_MS,
  WORKING_EVENT_PATHS,
  WORKING_EVENT_READ_BYTES,
  WORKING_FILE_MAX_BYTES,
} from "../home-caps.ts"
import type { HookPayload } from "../live/record.ts"
import type { RunEvent } from "../run/contracts.ts"
import { readRun } from "../run/registry.ts"
import { gitCall, gitEnv } from "../run/turn-git.ts"
import { isArchived } from "../task/archive.ts"
import { boundSlug, keyOf } from "../task/binding.ts"
import type { Task } from "../task/store.ts"
import { type NativeEdit, nativeEdits, replayNativeEdit } from "./native-edit.ts"
import {
  admitWorkingRecord,
  digest,
  updateWorkingLedger,
  type WorkingOperation,
  workingTaskKey,
} from "./working-records.ts"

const SUPPORTED = new Set([
  "claude-code",
  "codex",
  "pi",
  "opencode",
  "grok",
  "copilot",
  "cursor",
  "antigravity",
])
const EXCLUDED =
  /^docs\/plans(?:\/|$)|(?:^|\/)(?:\.git|\.qualitylayer|node_modules|\.ssh|\.aws|\.azure|\.config|secrets?|credentials?|auth)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|id_[^/]+|[^/]*(?:credentials|tokens?)[^/]*\.json)$|\.(?:pem|key|p12|pfx|keystore)$/i

export function workingPath(root: string, cwd: string, path: string): string | null {
  const inside = relative(root, isAbsolute(path) ? path : resolve(cwd, path))
    .split(sep)
    .join("/")
  return !inside ||
    isAbsolute(inside) ||
    inside.split(/[\\/]/).some((part) => !part || part === "." || part === "..") ||
    EXCLUDED.test(inside)
    ? null
    : inside
}

export async function currentWorkingText(
  ctx: Ctx,
  task: Task,
  path: string,
  max = WORKING_FILE_MAX_BYTES,
): Promise<string | null> {
  if (!ctx.fs.forPublication || !ctx.fs.lstat)
    throw new Error("Safe working source reads unavailable")
  const safe = ctx.fs.forPublication(task.repoRoot, task.repoRoot)
  if (!(await safe.exists(join(task.repoRoot, path)))) return null
  const entry = await safe.lstat?.(join(task.repoRoot, path))
  if (entry === null) return null
  if (!entry || entry.kind !== "file" || !safe.readRegularFile)
    throw new Error("Working source is not a regular file")
  const bytes = await safe.readRegularFile(join(task.repoRoot, path), max)
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (content.includes("\0")) throw new Error("Binary working source")
  return content
}

type Bound = {
  agent: string
  session: string
  run: string
  generation: number
  id: string
  input: string
}
async function captureBinding(
  ctx: Ctx,
  task: Task,
  payload: HookPayload,
  event: RunEvent | null,
): Promise<Bound | null> {
  const agent = detectAgent(ctx.env)
  const session = typeof payload.session_id === "string" ? payload.session_id : ""
  const call = typeof payload.tool_use_id === "string" ? payload.tool_use_id : ""
  if (
    !SUPPORTED.has(agent) ||
    !session ||
    !call ||
    !["feature", "bugfix", "chat"].includes(task.type) ||
    ["shipped", "abandoned"].includes(task.stage)
  )
    return null
  if (boundSlug(ctx, task.repoId, keyOf(session)) !== task.slug) return null
  if (await isArchived(ctx, task)) return null
  const binding = JSON.parse(
    await ctx.fs.readFile(
      join(ctx.home, "projects", task.repoId, "sessions", `${keyOf(session)}.json`),
    ),
  ) as { at?: number; source?: string; slug?: string }
  if (
    binding.source !== "workflow" ||
    binding.slug !== task.slug ||
    typeof binding.at !== "number" ||
    binding.at > ctx.clock.now()
  )
    return null
  const run = ctx.env.get("QUALITYLAYER_RUN")
  if (run) {
    const recorded = readRun(ctx.home, run)
    const target =
      recorded?.task ?? (recorded?.purpose.kind === "task" ? recorded.purpose.task : undefined)
    if (
      !recorded ||
      ["artifact", "ask"].includes(recorded.purpose.kind) ||
      !["starting", "running"].includes(recorded.status) ||
      !event ||
      event.nativeSession !== session ||
      event.generation !== recorded.generation ||
      ![task.slug, `${task.repoId}~${task.slug}`].includes(target ?? "")
    )
      return null
  }
  const generation = event?.generation ?? binding.at
  const input = JSON.stringify([payload.tool_name, payload.tool_input])
  if (Buffer.byteLength(input) > WORKING_EVENT_READ_BYTES) return null
  return {
    agent,
    session: keyOf(session),
    run: run ?? `native-${keyOf(session)}`,
    generation,
    input: digest(input),
    id: digest(JSON.stringify([workingTaskKey(task), session, run, generation, call])),
  }
}

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

async function begin(ctx: Ctx, task: Task, payload: HookPayload, bound: Bound) {
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

function completed(payload: HookPayload, agent: string): boolean {
  if (
    payload.hook_event_name === "PostToolUseFailure" ||
    payload.is_error === true ||
    payload.tool_response === undefined ||
    payload.tool_response === null
  )
    return false
  const reply =
    typeof payload.tool_response === "object"
      ? (payload.tool_response as Record<string, unknown>)
      : {}
  const valid =
    reply.is_error !== true &&
    reply.isError !== true &&
    reply.success !== false &&
    reply.status !== "failed" &&
    reply.status !== "declined" &&
    !reply.error
  if (!valid) return false
  if (agent === "pi" || agent === "opencode")
    return (
      payload.is_error === false &&
      (typeof payload.tool_response === "string"
        ? payload.tool_response.trim() !== ""
        : Array.isArray(reply.content) ||
          typeof reply.output === "string" ||
          typeof reply.metadata === "object")
    )
  if (agent === "claude-code") return typeof reply.filePath === "string" || reply.success === true
  // Grok's and Antigravity's replies have no known success mark (Antigravity names only an `error`,
  // read above); the file's own digest decides in `finish`. Cursor's Write says `success`.
  if (agent === "grok" || agent === "antigravity") return true
  const output = typeof payload.tool_response === "string" ? payload.tool_response : reply.output
  return reply.success === true || (typeof output === "string" && /^Success\b/.test(output.trim()))
}

async function finish(ctx: Ctx, task: Task, payload: HookPayload, bound: Bound) {
  await updateWorkingLedger(ctx, async (ledger) => {
    const row = ledger.records.find(
      (record) => record.id === bound.id && record.task === workingTaskKey(task),
    )
    if (!row || row.end !== undefined || row.input !== bound.input) return
    row.end = ctx.clock.now()
    if (!completed(payload, bound.agent)) {
      row.state = "failed"
      return
    }
    for (const op of row.operations) {
      const current = await currentWorkingText(ctx, task, op.path)
      if (
        (current === null ? null : digest(current)) !== op.after ||
        (op.from && (await currentWorkingText(ctx, task, op.from)) !== null)
      ) {
        row.state = "ambiguous"
        return
      }
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
