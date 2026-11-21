import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { sessionIdentity } from "../agents/detect.ts"
import { isNativeAgent, type NativeAgent } from "../agents/ids.ts"
import { recordPickedAnswer } from "../gate/gate.ts"
import { recordPickedNeed } from "../need/need.ts"
import { isArchived } from "./archive.ts"
import { matchesChatQuestion, terminalTaskFor } from "./chat-questions.ts"
import { pickedCallComplete } from "./picked-calls.ts"
import { openQuestion } from "./question.ts"
import { recordPickedQuestionAnswer } from "./question-app.ts"
import { readBatch, recordPickedBatchAnswer } from "./question-batch.ts"
import {
  pickerCallInput,
  pickerCalls,
  readSessionProof,
  type SessionProof,
  sessionInputDigest,
} from "./session-proof.ts"
import { inAgent } from "./sides.ts"
import { isTerminal, type Task } from "./store.ts"

type Reference = {
  agent: NativeAgent
  session: string
  callId: string
  inputDigest: string
  seenAt: number
}
export type PickerState = {
  pending: number
  expired: number
  recorded: number
  unavailable?: boolean
  /** Native pickers that closed with no answer at all (Codex's Default mode resolves an unanswered one after about two minutes). */
  unanswered?: number
}
export type PickerPayload = {
  session_id?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  tool_input?: unknown
  is_error?: unknown
}
const MAX_REFERENCES = 32
const MAX_BYTES = 32 * 1024
const MAX_AGE = 24 * 60 * 60 * 1000
const file = (task: Pick<Task, "runtimeDir">) =>
  join(task.runtimeDir, "native-picker-completions.json")
const empty = (): PickerState => ({ pending: 0, expired: 0, recorded: 0 })
const same = (a: Reference, b: Reference) =>
  a.agent === b.agent && a.session === b.session && a.callId === b.callId

export function pickerAgent(tool: unknown): NativeAgent | null {
  switch (tool) {
    case "AskUserQuestion":
      return "claude-code"
    case "request_user_input":
      return "codex"
    case "ql_ask":
      return "pi"
    case "question":
      return "opencode"
    default:
      return null
  }
}

async function references(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<Reference[]> {
  if (!(await ctx.fs.exists(file(task)))) return []
  const info = await ctx.fs.stat?.(file(task))
  if (info && info.size > MAX_BYTES)
    throw new Error("Native picker references exceed their byte bound")
  const text = await ctx.fs.readFile(file(task))
  if (Buffer.byteLength(text) > MAX_BYTES)
    throw new Error("Native picker references exceed their byte bound")
  const value = JSON.parse(text)
  if (
    value?.version !== 1 ||
    !Array.isArray(value.pending) ||
    value.pending.length > MAX_REFERENCES
  )
    throw new Error("Invalid native picker references")
  for (const ref of value.pending) {
    if (
      !ref ||
      !isNativeAgent(ref.agent) ||
      typeof ref.session !== "string" ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(ref.session)
    )
      throw new Error("Invalid native picker session")
    if (
      typeof ref.callId !== "string" ||
      !ref.callId ||
      ref.callId.length > 256 ||
      !/^[a-f0-9]{64}$/.test(ref.inputDigest)
    )
      throw new Error("Invalid native picker call")
    if (!Number.isFinite(ref.seenAt) || ref.seenAt <= 0)
      throw new Error("Invalid native picker timestamp")
  }
  return value.pending as Reference[]
}

async function update(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  change: (refs: Reference[]) => Reference[],
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.withLock(`${file(task)}.lock`, async () => {
    const next = change(await references(ctx, task))
    const text = `${JSON.stringify({ version: 1, pending: next })}\n`
    if (next.length > MAX_REFERENCES || Buffer.byteLength(text) > MAX_BYTES)
      throw new Error("Native picker reference capacity reached")
    await ctx.fs.atomicWrite(file(task), text)
  })
}

async function applicable(ctx: Ctx, task: Task, proof: SessionProof): Promise<boolean> {
  const questions = [...((await readBatch(ctx, task))?.questions ?? [])]
  const single = await openQuestion(ctx, task)
  if (single) questions.push(single)
  for (const question of questions) {
    if (question.session !== proof.session || question.asked >= proof.recordedAt) continue
    for (const answer of proof.answers)
      if (await matchesChatQuestion(ctx, question, answer.question, proof.agent)) return true
  }
  return false
}

export async function applyPickerProof(ctx: Ctx, task: Task, proof: SessionProof): Promise<number> {
  let count = 0
  for (const answer of proof.answers) {
    const pick = { ...answer, session: proof.session, proof }
    if (await recordPickedBatchAnswer(ctx, pick)) {
      count++
      continue
    }
    if (await recordPickedAnswer(ctx, pick)) {
      count++
      continue
    }
    if (await recordPickedNeed(ctx, task, pick)) {
      count++
      continue
    }
    if (await recordPickedQuestionAnswer(ctx, pick)) count++
  }
  return count
}

async function settle(
  ctx: Ctx,
  task: Task,
  ref: Reference,
  waitMs: 0 | 2000,
): Promise<PickerState> {
  if (ctx.clock.now() - ref.seenAt >= MAX_AGE) return { pending: 1, expired: 1, recorded: 0 }
  const proof = await readSessionProof(ctx, {
    agent: ref.agent,
    session: ref.session,
    callId: ref.callId,
    waitMs,
  })
  if (!proof) return { pending: 1, expired: 0, recorded: 0 }
  const digest = sessionInputDigest(proof.input)
  if (digest !== ref.inputDigest) {
    if (ref.agent !== "claude-code" || proof.completionDigest !== ref.inputDigest)
      return { pending: 1, expired: 0, recorded: 0 }
    await update(ctx, task, (refs) =>
      refs.map((known) => {
        if (!same(known, ref)) return known
        if (known.inputDigest !== ref.inputDigest && known.inputDigest !== digest)
          throw new Error("Native picker call input changed")
        return { ...known, inputDigest: digest }
      }),
    )
  }
  // A picker that closed with no answer is not an answer, and nothing will come later: ask in the chat.
  if (proof.answers.length === 0) {
    await update(ctx, task, (refs) => refs.filter((known) => !same(known, ref)))
    return { pending: 0, expired: 0, recorded: 0, unanswered: 1 }
  }
  const recorded = await applyPickerProof(ctx, task, proof)
  if (!(await pickedCallComplete(ctx, task, proof)) && (await applicable(ctx, task, proof)))
    return { pending: 1, expired: 0, recorded }
  await update(ctx, task, (refs) => refs.filter((known) => !same(known, ref)))
  return { pending: 0, expired: 0, recorded }
}

/** Store call identity only; the hook payload never becomes answer or approval authority. */
export async function observePickerCompletion(
  ctx: Ctx,
  task: Task,
  payload: PickerPayload,
  waitMs: 0 | 2000 = 0,
): Promise<PickerState> {
  const agent = pickerAgent(payload.tool_name),
    session = payload.session_id,
    callId = payload.tool_use_id
  if (
    !inAgent(task) ||
    !agent ||
    payload.is_error === true ||
    isTerminal(task.stage) ||
    (await isArchived(ctx, task))
  )
    return empty()
  if (
    typeof session !== "string" ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(session) ||
    typeof callId !== "string" ||
    !callId ||
    callId.length > 256
  )
    return empty()
  const bound = await terminalTaskFor(ctx, session)
  if (bound?.runtimeDir !== task.runtimeDir) return empty()
  try {
    let ref: Reference = {
      agent,
      session,
      callId,
      inputDigest: sessionInputDigest(pickerCallInput(agent, payload.tool_input)),
      seenAt: ctx.clock.now(),
    }
    await update(ctx, task, (refs) => {
      const known = refs.find((value) => same(value, ref))
      if (known) {
        ref = known
        return refs
      }
      return [...refs, ref]
    })
    return await settle(ctx, task, ref, waitMs)
  } catch {
    return { pending: 1, expired: 0, recorded: 0, unavailable: true }
  }
}

/** Agents whose hooks name no picker call: poll and wait read their picks from the record. */
const RECORD_ONLY = new Set<NativeAgent>(["antigravity", "grok", "copilot"])

/**
 * Antigravity's, Grok's and Copilot's picks, read from the session's own record: each picker call
 * made since the session's oldest open question was asked. The recorders still check the session,
 * the question's time and its side; a later answered call supersedes an earlier unanswered one.
 */
async function fromRecord(
  ctx: Ctx,
  host: Pick<Task, "runtimeDir">,
  identity: { agent: NativeAgent; id: string },
): Promise<PickerState> {
  const task = await terminalTaskFor(ctx, identity.id)
  if (task?.runtimeDir !== host.runtimeDir) return empty()
  if (isTerminal(task.stage) || (await isArchived(ctx, task))) return empty()
  try {
    const single = await openQuestion(ctx, task)
    const open = [...((await readBatch(ctx, task))?.questions ?? []), ...(single ? [single] : [])]
      .filter((question) => question.session === identity.id)
      .map((question) => question.asked)
    if (open.length === 0) return empty()
    const since = Math.min(...open)
    const state = empty()
    const request = { agent: identity.agent, session: identity.id }
    for (const call of await pickerCalls(ctx, request)) {
      if (call.recordedAt <= since) continue
      const proof = await readSessionProof(ctx, { ...request, callId: call.callId, waitMs: 0 })
      if (!proof) state.pending++
      else if (proof.answers.length === 0) state.unanswered = (state.unanswered ?? 0) + 1
      else {
        state.recorded += await applyPickerProof(ctx, task, proof)
        delete state.unanswered
      }
    }
    return state
  } catch {
    return { pending: 1, expired: 0, recorded: 0, unavailable: true }
  }
}

/**
 * This session's picks of its open questions, read from its own record whatever its hooks saw:
 * `gate decide approve` reads them before it refuses, so the person's pick approves as typed words do.
 */
export async function picksFromRecord(ctx: Ctx, task: Task): Promise<number> {
  const own = sessionIdentity(ctx.env)
  const asked = own === null ? null : await openQuestion(ctx, task)
  if (own === null || asked?.session !== own.id) return 0
  const request = { agent: own.agent, session: own.id }
  let recorded = 0
  try {
    for (const call of await pickerCalls(ctx, request)) {
      if (call.recordedAt <= asked.asked) continue
      const proof = await readSessionProof(ctx, { ...request, callId: call.callId, waitMs: 0 })
      if (proof && proof.answers.length > 0) recorded += await applyPickerProof(ctx, task, proof)
    }
  } catch {
    // The record could not be read: nothing is recorded, and the refusal stands.
  }
  return recorded
}

/** Poll/wait can finish a receipt after a native client cancelled its background hook at teardown. */
export async function reconcilePickerCompletions(
  ctx: Ctx,
  host: Pick<Task, "runtimeDir">,
): Promise<PickerState> {
  const own = sessionIdentity(ctx.env)
  if (own && RECORD_ONLY.has(own.agent)) return await fromRecord(ctx, host, own)
  if (!(await ctx.fs.exists(file(host)))) return empty()
  const identity = own
  if (!identity) return empty()
  const task = await terminalTaskFor(ctx, identity.id)
  if (task?.runtimeDir !== host.runtimeDir) return empty()
  if (isTerminal(task.stage) || (await isArchived(ctx, task))) return empty()
  try {
    const refs = (await references(ctx, task)).filter(
      (ref) => ref.agent === identity.agent && ref.session === identity.id,
    )
    const state = empty()
    const active = refs.filter((ref) => ctx.clock.now() - ref.seenAt < MAX_AGE)
    state.expired = refs.length - active.length
    state.pending = state.expired
    const tried = active.slice(0, 4)
    for (const ref of tried) {
      const next = await settle(ctx, task, ref, 0)
      state.pending += next.pending
      state.expired += next.expired
      state.recorded += next.recorded
      if (next.unanswered) state.unanswered = (state.unanswered ?? 0) + next.unanswered
    }
    state.pending += Math.max(0, active.length - 4)
    if (active.length > 4)
      await update(ctx, task, (all) => [
        ...all.filter((ref) => !tried.some((known) => same(known, ref))),
        ...all.filter((ref) => tried.some((known) => same(known, ref))),
      ])
    return state
  } catch {
    return { pending: 1, expired: 0, recorded: 0, unavailable: true }
  }
}

export function pickerPending(
  state: PickerState,
):
  | { native_picker_pending: { count: number; expired: number; status: string } }
  | { native_picker_unanswered: { count: number; status: string } }
  | Record<string, never> {
  if (!state.pending && !state.unavailable && state.unanswered)
    return {
      native_picker_unanswered: {
        count: state.unanswered,
        status:
          "The native picker closed without an answer; that is not an answer. Ask the same question again as numbered chat choices (chat_questions.fallback), then end your turn and record the person's next message with qualitylayer question answered.",
      },
    }
  if (!state.pending && !state.unavailable) return {}
  return {
    native_picker_pending: {
      count: state.pending,
      expired: state.expired,
      status: state.unavailable
        ? "Native picker completion could not be retained or read; no answer was recorded. Retry the picker or inspect the local runtime."
        : state.expired
          ? "Native picker evidence exceeded its 24-hour retry window; ask the pending question again. No answer was inferred."
          : "Waiting for the native client to save its picker result. Run qualitylayer question poll for batch receipts. If a single picker already returned an answer, run qualitylayer question answered --id <question-id> with the exact words it returned.",
    },
  }
}
