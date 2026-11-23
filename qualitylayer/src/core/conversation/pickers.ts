import type { Ctx } from "../../ctx.ts"
import { PICKER_RECORD_MAX_BYTES } from "../home-caps.ts"
import { HOOK_BEAT_MS, isViewed, readViewing, VIEW_CONFIRM_MS, VIEW_LEASE_MS } from "./approvals.ts"
import {
  admitPicker,
  cleanPickerAnswers,
  isPickerObject,
  isPickerSessionValid,
  listPickers,
  type PendingPicker,
  type PickerAnswers,
  pickerFile,
  pickerFolder,
  readPickerJson,
} from "./pickers-store.ts"
import { questionCall, questionState } from "./questions.ts"

export { cleanPickerAnswers, listPickers }

async function writePickerDecision(
  ctx: Ctx,
  target: { session: string; callId: string; clean: PickerAnswers; additionalContext?: string },
  authorize: () => Promise<boolean>,
  onWritten?: () => void,
): Promise<boolean> {
  await ctx.fs.mkdir(`${pickerFolder(ctx, target.session)}/decisions`, { mode: 0o700 })
  const path = pickerFile(ctx, target.session, target.callId, "decisions")
  if (!(await authorize()) || !(await isViewed(ctx, "claude-code", target.session))) return false
  await ctx.fs.writeFile(
    path,
    JSON.stringify({
      callId: target.callId,
      answers: target.clean,
      ...(target.additionalContext ? { additionalContext: target.additionalContext } : {}),
    }),
    { mode: 0o600, exclusive: true },
  )
  onWritten?.()
  const stillPending = await ctx.fs.exists(
    pickerFile(ctx, target.session, target.callId, "pending"),
  )
  if (!(await authorize()) || !stillPending) {
    await ctx.fs.remove(path)
    return false
  }
  return true
}

export async function decidePicker(
  ctx: Ctx,
  session: string,
  callId: string,
  answers: unknown,
  ...rest: [
    authorize?: () => Promise<boolean>,
    supporting?: { additionalContext?: string; onWritten?(): void },
  ]
): Promise<boolean> {
  const [authorize = async () => true, supporting = {}] = rest
  try {
    if (!(await isViewed(ctx, "claude-code", session))) return false
    const pending = (await listPickers(ctx, session)).find((p) => p.callId === callId)
    const clean = pending ? cleanPickerAnswers(pending, answers) : null
    const additionalContext = supporting.additionalContext
    const contextTooLarge =
      additionalContext !== undefined &&
      Buffer.byteLength(additionalContext) > PICKER_RECORD_MAX_BYTES / 4
    if (!clean || contextTooLarge) return false
    return await writePickerDecision(
      ctx,
      { session, callId, clean, additionalContext },
      authorize,
      supporting.onWritten,
    )
  } catch {
    return false
  }
}

function buildPendingPicker(
  ctx: Ctx,
  payload: { session_id?: unknown; tool_use_id?: unknown; tool_input?: unknown },
): { session: string; toolInput: Record<string, unknown>; pending: PendingPicker } | null {
  const session = payload.session_id
  const callId = payload.tool_use_id
  if (typeof session !== "string" || !isPickerSessionValid(session)) return null
  if (typeof callId !== "string" || !isPickerObject(payload.tool_input)) return null
  const state = questionState()
  questionCall(state, callId, "claude-code", payload.tool_input)
  if (!state.value?.answerable) return null
  const uniqueQuestions = new Set(state.value.questions.map((q) => q.question)).size
  if (uniqueQuestions !== state.value.questions.length) return null
  return {
    session,
    toolInput: payload.tool_input,
    pending: {
      callId,
      question: state.value,
      original: payload.tool_input.questions as unknown[],
      at: ctx.clock.now(),
      pid: process.pid,
    },
  }
}

function formatPickerOutput(
  pending: PendingPicker,
  toolInput: Record<string, unknown>,
  decision: unknown,
): Record<string, unknown> | null {
  const answers =
    isPickerObject(decision) && decision.callId === pending.callId
      ? cleanPickerAnswers(pending, decision.answers)
      : null
  if (!answers) return null
  const result: Record<string, string> = {}
  for (const q of pending.question.questions) result[q.question] = (answers[q.id] ?? []).join(", ")
  const hasContext =
    isPickerObject(decision) &&
    typeof decision.additionalContext === "string" &&
    Buffer.byteLength(decision.additionalContext) <= PICKER_RECORD_MAX_BYTES / 4
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...toolInput, questions: pending.original, answers: result },
      ...(hasContext ? { additionalContext: decision.additionalContext } : {}),
    },
  }
}

async function writeBeat(ctx: Ctx, session: string, callId: string, now: number): Promise<boolean> {
  await ctx.fs.mkdir(`${pickerFolder(ctx, session)}/beats`, { mode: 0o700 })
  await ctx.fs.atomicWrite(pickerFile(ctx, session, callId, "beats"), JSON.stringify({ at: now }))
  return ctx.fs.exists(pickerFile(ctx, session, callId, "pending"))
}

type PollStep =
  | { status: "continue"; alive: boolean; beat: number }
  | { status: "done"; output: Record<string, unknown> | null }

async function pollPickerStep(
  ctx: Ctx,
  target: { session: string; toolInput: Record<string, unknown>; pending: PendingPicker },
  loop: { alive: boolean; beat: number },
): Promise<PollStep> {
  const { session, pending, toolInput } = target
  const now = ctx.clock.now()
  const view = await readViewing(ctx, "claude-code", session)
  const alive = loop.alive || (view !== null && view.at > pending.at)
  const expired =
    !view || (alive ? now - view.at > VIEW_LEASE_MS : now - pending.at >= VIEW_CONFIRM_MS)
  if (expired || !(await ctx.fs.exists(pickerFile(ctx, session, pending.callId, "pending"))))
    return { status: "done", output: null }
  const decisionPath = pickerFile(ctx, session, pending.callId, "decisions")
  const decision = await readPickerJson(ctx, decisionPath)
  if (decision !== null || (await ctx.fs.exists(decisionPath))) {
    return {
      status: "done",
      output: decision !== null ? formatPickerOutput(pending, toolInput, decision) : null,
    }
  }
  let beat = loop.beat
  if (now - beat >= HOOK_BEAT_MS) {
    beat = now
    if (!(await writeBeat(ctx, session, pending.callId, now)))
      return { status: "done", output: null }
  }
  return { status: "continue", alive, beat }
}

export async function awaitPicker(
  ctx: Ctx,
  payload: { session_id?: unknown; tool_use_id?: unknown; tool_input?: unknown },
  options: { maxMs?: number } = {},
): Promise<Record<string, unknown> | null> {
  const built = buildPendingPicker(ctx, payload)
  if (!built || !(await readViewing(ctx, "claude-code", built.session))) return null
  const { session, pending } = built
  let filed = false
  try {
    filed = await admitPicker(ctx, session, pending)
    if (!filed) return null
    let loop = { alive: false, beat: pending.at }
    while (ctx.clock.now() - pending.at < (options.maxMs ?? 570_000)) {
      const step = await pollPickerStep(ctx, built, loop)
      if (step.status === "done") return step.output
      loop = { alive: step.alive, beat: step.beat }
      await ctx.clock.sleep(250)
    }
    return null
  } catch {
    return null
  } finally {
    if (filed) {
      for (const kind of ["pending", "beats", "decisions"])
        await ctx.fs.remove(pickerFile(ctx, session, pending.callId, kind)).catch(() => {})
    }
  }
}
