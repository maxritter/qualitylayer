import type { Ctx } from "../../ctx.ts"
import { sessionIdentity } from "../agents/detect.ts"
import type { NativeAgent } from "../agents/ids.ts"
import { isArchived } from "./archive.ts"
import { terminalTaskFor } from "./chat-questions.ts"
import { pickedCallComplete } from "./picked-calls.ts"
import {
  activeBoundTask,
  applyPickerProof,
  isProofApplicable,
  pickerStateFromRecord,
} from "./picker-record.ts"
import {
  emptyPickerState,
  MAX_PICKER_AGE,
  type PickerPayload,
  type PickerReference,
  type PickerState,
  pickerAgent,
  pickerRefFile,
  readPickerReferences,
  samePickerRef,
  updatePickerReferences,
} from "./picker-references.ts"
import {
  pickerCallInput,
  readSessionProof,
  type SessionProof,
  sessionInputDigest,
} from "./session-proof.ts"
import { inAgent } from "./sides.ts"
import { isTerminal, type Task } from "./store.ts"

export { applyPickerProof, picksFromRecord } from "./picker-record.ts"
export {
  type PickerPayload,
  type PickerState,
  pickerAgent,
  pickerPending,
} from "./picker-references.ts"

async function syncProofDigest(
  ctx: Ctx,
  task: Task,
  ref: PickerReference,
  proof: SessionProof,
): Promise<boolean> {
  const digest = sessionInputDigest(proof.input)
  if (digest === ref.inputDigest) return true
  if (ref.agent !== "claude-code" || proof.completionDigest !== ref.inputDigest) return false
  await updatePickerReferences(ctx, task, (refs) =>
    refs.map((known) => {
      if (!samePickerRef(known, ref)) return known
      if (known.inputDigest !== ref.inputDigest && known.inputDigest !== digest)
        throw new Error("Native picker call input changed")
      return { ...known, inputDigest: digest }
    }),
  )
  return true
}

async function settle(
  ctx: Ctx,
  task: Task,
  ref: PickerReference,
  waitMs: 0 | 2000,
): Promise<PickerState> {
  if (ctx.clock.now() - ref.seenAt >= MAX_PICKER_AGE) return { pending: 1, expired: 1, recorded: 0 }
  const proof = await readSessionProof(ctx, {
    agent: ref.agent,
    session: ref.session,
    callId: ref.callId,
    waitMs,
  })
  if (!proof || !(await syncProofDigest(ctx, task, ref, proof)))
    return { pending: 1, expired: 0, recorded: 0 }
  // A picker that closed with no answer is not an answer, and nothing will come later: ask in the chat.
  if (proof.answers.length === 0) {
    await updatePickerReferences(ctx, task, (refs) => refs.filter((k) => !samePickerRef(k, ref)))
    return { pending: 0, expired: 0, recorded: 0, unanswered: 1 }
  }
  const recorded = await applyPickerProof(ctx, task, proof)
  if (!(await pickedCallComplete(ctx, task, proof)) && (await isProofApplicable(ctx, task, proof)))
    return { pending: 1, expired: 0, recorded }
  await updatePickerReferences(ctx, task, (refs) => refs.filter((k) => !samePickerRef(k, ref)))
  return { pending: 0, expired: 0, recorded }
}

async function validObservation(
  ctx: Ctx,
  task: Task,
  payload: PickerPayload,
): Promise<{ agent: NativeAgent; session: string; callId: string } | null> {
  const agent = pickerAgent(payload.tool_name)
  if (!inAgent(task) || !agent || payload.is_error === true) return null
  if (isTerminal(task.stage) || (await isArchived(ctx, task))) return null
  const session = payload.session_id
  const callId = payload.tool_use_id
  const validSession = typeof session === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(session)
  const validCall = typeof callId === "string" && callId.length > 0 && callId.length <= 256
  if (!validSession || !validCall) return null
  const bound = await terminalTaskFor(ctx, session)
  return bound?.runtimeDir === task.runtimeDir ? { agent, session, callId } : null
}

/** Store call identity only; the hook payload never becomes answer or approval authority. */
export async function observePickerCompletion(
  ctx: Ctx,
  task: Task,
  payload: PickerPayload,
  waitMs: 0 | 2000 = 0,
): Promise<PickerState> {
  const valid = await validObservation(ctx, task, payload)
  if (!valid) return emptyPickerState()
  try {
    let ref: PickerReference = {
      ...valid,
      inputDigest: sessionInputDigest(pickerCallInput(valid.agent, payload.tool_input)),
      seenAt: ctx.clock.now(),
    }
    await updatePickerReferences(ctx, task, (refs) => {
      const known = refs.find((value) => samePickerRef(value, ref))
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

/** Poll/wait can finish a receipt after a native client cancelled its background hook at teardown. */
export async function reconcilePickerCompletions(
  ctx: Ctx,
  host: Pick<Task, "runtimeDir">,
): Promise<PickerState> {
  const own = sessionIdentity(ctx.env)
  if (own && RECORD_ONLY.has(own.agent)) return await pickerStateFromRecord(ctx, host, own)
  if (!own || !(await ctx.fs.exists(pickerRefFile(host)))) return emptyPickerState()
  const task = await activeBoundTask(ctx, host, own.id)
  if (!task) return emptyPickerState()
  try {
    const refs = (await readPickerReferences(ctx, task)).filter(
      (ref) => ref.agent === own.agent && ref.session === own.id,
    )
    const state = emptyPickerState()
    const active = refs.filter((ref) => ctx.clock.now() - ref.seenAt < MAX_PICKER_AGE)
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
      await updatePickerReferences(ctx, task, (all) => [
        ...all.filter((ref) => !tried.some((known) => samePickerRef(known, ref))),
        ...all.filter((ref) => tried.some((known) => samePickerRef(known, ref))),
      ])
    return state
  } catch {
    return { pending: 1, expired: 0, recorded: 0, unavailable: true }
  }
}
