import { isDeepStrictEqual } from "node:util"
import type { Ctx } from "../../ctx.ts"
import { sessionAnswers } from "./session-proof-answers.ts"
import { callIn, hookedCallIds } from "./session-proof-hooked-calls.ts"
import { nativeCalls } from "./session-proof-native-calls.ts"
import { readSessionRecords } from "./session-proof-records.ts"
import {
  type Call,
  emptySelection,
  pickerCallInput,
  RECORDED_PICKERS,
  type SessionAnswer,
  type SessionProof,
  type SessionRequest,
  sessionInputDigest,
} from "./session-proof-types.ts"

export { sessionAnswers } from "./session-proof-answers.ts"
export { latestUserMessage, userMessages } from "./session-proof-messages.ts"
export {
  pickerCallInput,
  type SessionAnswer,
  type SessionProof,
  type SessionRequest,
  sessionInputDigest,
  type UserMessageProof,
} from "./session-proof-types.ts"

/**
 * The picker calls in an agent's own record, oldest first. Poll and wait read those of an agent
 * with no answer hook (Antigravity, Grok, Copilot); `gate decide` reads any agent's.
 */
export async function pickerCalls(
  ctx: Ctx,
  request: SessionRequest,
): Promise<{ callId: string; recordedAt: number }[]> {
  return (await observedPickerCalls(ctx, request)).map(({ callId, recordedAt }) => ({
    callId,
    recordedAt,
  }))
}

export async function observedPickerCalls(
  ctx: Ctx,
  request: SessionRequest,
): Promise<{ callId: string; recordedAt: number; input: unknown }[]> {
  try {
    const rows = await readSessionRecords(ctx, request)
    if (rows === null) return []
    const calls = RECORDED_PICKERS.has(request.agent)
      ? nativeCalls(rows, request.agent)
      : hookedCallIds(rows, request.agent).flatMap((id) => {
          const call = callIn(rows, request.agent, id)
          return call === null ? [] : [{ id, ...call }]
        })
    return calls.flatMap((call) =>
      call.recordedAt === null
        ? []
        : [{ callId: call.id, recordedAt: call.recordedAt, input: call.input }],
    )
  } catch {
    return []
  }
}

const issued = new WeakMap<SessionProof, string>()

/** Consumers reject objects manufactured by a caller rather than read from the native store. */
export const isSessionProof = (proof: SessionProof): boolean => {
  try {
    return issued.has(proof) && issued.get(proof) === JSON.stringify(proof)
  } catch {
    return false
  }
}

async function pollCompletedCall(
  ctx: Ctx,
  request: SessionRequest & { callId: string; waitMs?: 0 | 2000 },
): Promise<Call | null> {
  const start = ctx.clock.now()
  for (;;) {
    const rows = await readSessionRecords(ctx, request)
    const call = rows ? callIn(rows, request.agent, request.callId) : null
    if (call?.recordedAt !== null && call?.result !== undefined) return call
    if (ctx.clock.now() - start >= (request.waitMs ?? 2000)) return null
    await ctx.clock.sleep(100)
  }
}

function answersMatchClaims(
  answers: SessionAnswer[],
  claims: SessionAnswer[] | undefined,
): boolean {
  if (!claims) return true
  return claims.every((claim) =>
    answers.some(
      (own) =>
        own.question === claim.question &&
        own.answer === claim.answer &&
        own.notes === claim.notes &&
        (claim.labels === undefined || isDeepStrictEqual(own.labels, claim.labels)),
    ),
  )
}

function buildVerifiedProof(
  request: SessionRequest & { callId: string; answers?: SessionAnswer[]; input?: unknown },
  call: Call & { recordedAt: number },
): SessionProof | null {
  const asked = call.questions ?? call.input
  const answers = sessionAnswers(asked, call.result)
  const inputMismatch = request.input !== undefined && !isDeepStrictEqual(request.input, call.input)
  if ((!answers.length && !emptySelection(asked, call.result)) || inputMismatch) return null
  if (!answersMatchClaims(answers, request.answers)) return null
  const proof: SessionProof = {
    agent: request.agent,
    session: request.session,
    callId: request.callId,
    recordedAt: call.recordedAt,
    input: call.input,
    answers,
  }
  if (
    request.agent === "claude-code" &&
    pickerCallInput(request.agent, call.result) !== call.result &&
    isDeepStrictEqual(pickerCallInput(request.agent, call.result), call.input)
  )
    proof.completionDigest = sessionInputDigest(call.result)
  issued.set(proof, JSON.stringify(proof))
  return proof
}

export async function readSessionProof(
  ctx: Ctx,
  request: SessionRequest & {
    callId: string
    answers?: SessionAnswer[]
    input?: unknown
    waitMs?: 0 | 2000
  },
): Promise<SessionProof | null> {
  try {
    if (!request.callId || request.callId.length > 256) return null
    const call = await pollCompletedCall(ctx, request)
    if (!call || call.recordedAt === null) return null
    return buildVerifiedProof(request, { ...call, recordedAt: call.recordedAt })
  } catch {
    return null
  }
}
