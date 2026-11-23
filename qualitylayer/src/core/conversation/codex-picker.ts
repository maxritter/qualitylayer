import type { Clock } from "../../ctx.ts"
import { NativePickerInput, type PickerSelection, selectionForPicker } from "./codex-picker-io.ts"
import {
  acknowledgePicker,
  expiredPicker,
  nativeAnswers,
  type PickerCall,
  type PickerQuestion,
  refusedPicker,
  settleNativePicker,
} from "./codex-picker-settle.ts"
import type { ConversationQuestion } from "./types.ts"

export type PickerRequest = {
  callId: string
  questionId: string
  picks: string[] | { own: string }
  /** Derived from guarded uploads by the server, never read from caller JSON. */
  supportingContext?: string
}
export type PickerResult = {
  status: "submitted" | "confirmed" | "expired" | "refused"
  message?: string
}
export type PickerState = {
  allowed: boolean
  version: string
  identity?: string
  question: ConversationQuestion | null
  result?: unknown
  screen: string
}
export type PickerHost = {
  clock: Clock
  signal?: AbortSignal
  read: () => Promise<PickerState>
  write: (keys: string) => Promise<void>
}

export const validPickerSelection = (question: PickerQuestion, picks: PickerRequest["picks"]) =>
  selectionForPicker(question, picks) !== null

/** Preserve diagnostics, but require one unambiguous announcement of the tested native version. */
export function qualifiedCodexPickerVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false
  const versions = version
    .split(/\r?\n/)
    .filter(
      (line) => line.toLowerCase().includes("codex-cli") || /^\s*(?:codex\s+)?v?\d+\./i.test(line),
    )
  return (
    versions.length === 1 &&
    ["codex-cli 0.164.0", "codex-cli 0.165.0", "codex-cli 0.171.0"].includes(versions[0] ?? "")
  )
}

function checkPriorSubmission(
  call: PickerCall,
  request: PickerRequest,
  initial: PickerState,
): PickerResult | null {
  if (call.callId !== request.callId) return null
  const prior = call.answers.get(request.questionId)
  if (!prior) return null
  const hasContext = Boolean(prior.supportingContext || request.supportingContext)
  const differs =
    prior.supportingContext !== request.supportingContext ||
    JSON.stringify(prior.picks) !== JSON.stringify(request.picks)
  if (hasContext && differs)
    return refusedPicker("This question already has a different submitted answer")
  return initial.result === undefined ? prior.result : settleNativePicker(call, initial.result)
}

function checkBatchAvailability(
  initial: PickerState,
  request: PickerRequest,
): ConversationQuestion | PickerResult {
  const batch = initial.question
  if (batch?.availability === "expired") return expiredPicker()
  if (!batch || batch.id !== request.callId) {
    const actual = nativeAnswers(initial.result)
    return actual && Object.keys(actual).length === 0
      ? expiredPicker()
      : refusedPicker("This question is no longer available here")
  }
  return batch.answerable ? batch : refusedPicker("This question is not ready to answer here")
}

async function handleSubmissionError(
  host: PickerHost,
  call: PickerCall,
  request: PickerRequest,
  started: boolean,
  cause: unknown,
): Promise<PickerResult> {
  const state = await host.read().catch(() => null)
  const actual = state?.allowed && state.result !== undefined ? nativeAnswers(state.result) : null
  const isEmpty = actual !== null && Object.keys(actual).length === 0
  const result = isEmpty
    ? expiredPicker()
    : refusedPicker(cause instanceof Error ? cause.message : undefined)
  if (started || isEmpty) {
    call.answers.set(request.questionId, {
      picks: structuredClone(request.picks),
      result,
      ...(request.supportingContext ? { supportingContext: request.supportingContext } : {}),
    })
  }
  return result
}

async function runNativeSubmission(
  args: {
    host: PickerHost
    initial: PickerState
    call: PickerCall
    batch: ConversationQuestion
    request: PickerRequest
  },
  index: number,
  question: PickerQuestion,
  selection: PickerSelection,
): Promise<PickerResult> {
  const { host, initial, call, batch, request } = args
  const input = new NativePickerInput({
    host,
    initial,
    question,
    index,
    total: batch.questions.length,
    selection,
  })
  try {
    await input.prepare()
    const submission = {
      picks: structuredClone(request.picks),
      result: { status: "submitted" } as PickerResult,
      ...(request.supportingContext ? { supportingContext: request.supportingContext } : {}),
    }
    // Persist before Enter: a lost HTTP reply must never submit the next question.
    call.answers.set(request.questionId, submission)
    await input.enter()
    submission.result = await acknowledgePicker(host, call, batch.questions[index + 1])
    return submission.result
  } catch (cause) {
    return handleSubmissionError(host, call, request, input.started, cause)
  }
}

export class CodexPickerAdapter {
  private queues = new Map<string, Promise<unknown>>()
  private calls = new Map<string, PickerCall>()
  async serial<T>(run: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(run) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(action)
    this.queues.set(run, next)
    try {
      return await next
    } finally {
      if (this.queues.get(run) === next) this.queues.delete(run)
    }
  }
  submitted(
    run: string,
    callId: string,
    identity?: string,
  ): { questionId: string; picks: PickerRequest["picks"] }[] {
    const call = this.calls.get(run)
    if (call?.callId !== callId || (identity !== undefined && call.identity !== identity)) return []
    return [...call.answers].map(([questionId, value]) => ({
      questionId,
      picks: structuredClone(value.picks),
    }))
  }
  forget(run: string): void {
    this.calls.delete(run)
  }
  submit(run: string, request: PickerRequest, host: PickerHost): Promise<PickerResult> {
    return this.serial(run, () => this.answer(run, request, host))
  }
  submitWithHost(
    run: string,
    request: PickerRequest,
    open: () => Promise<PickerHost & { close: () => void }>,
    withContext?: (
      submit: (context?: string) => Promise<PickerResult>,
      host: PickerHost,
    ) => Promise<PickerResult>,
  ): Promise<PickerResult> {
    return this.serial(run, async () => {
      const host = await open()
      try {
        const submit = (supportingContext?: string) =>
          this.answer(
            run,
            { ...request, ...(supportingContext ? { supportingContext } : {}) },
            host,
          )
        return withContext ? await withContext(submit, host) : await submit()
      } finally {
        host.close()
      }
    })
  }
  private ensureCall(
    run: string,
    existing: PickerCall | undefined,
    request: PickerRequest,
    batch: ConversationQuestion,
    identity: string | undefined,
  ): PickerCall | PickerResult {
    if (existing?.callId === request.callId) return existing
    if (this.calls.size >= 200 && !this.calls.has(run))
      return refusedPicker("Too many pending question sessions")
    const created: PickerCall = {
      callId: request.callId,
      identity,
      total: batch.questions.length,
      answers: new Map(),
    }
    this.calls.set(run, created)
    return created
  }
  private resolveSubmission(
    run: string,
    request: PickerRequest,
    initial: PickerState,
  ):
    | {
        call: PickerCall
        batch: ConversationQuestion
        index: number
        question: PickerQuestion
        selection: PickerSelection
      }
    | PickerResult {
    const existing = this.calls.get(run)
    const active = existing?.identity === initial.identity ? existing : undefined
    const prior = active ? checkPriorSubmission(active, request, initial) : null
    if (prior) return prior
    const checked = checkBatchAvailability(initial, request)
    if ("status" in checked) return checked
    const call = this.ensureCall(run, active, request, checked, initial.identity)
    if ("status" in call) return call
    const index = call.answers.size
    const question = checked.questions[index]
    if (!question || question.id !== request.questionId)
      return refusedPicker("Answer the current question first")
    const selection = selectionForPicker(question, request.picks, request.supportingContext)
    return selection
      ? { call, batch: checked, index, question, selection }
      : refusedPicker("This selection cannot be typed safely")
  }
  private async answer(
    run: string,
    request: PickerRequest,
    host: PickerHost,
  ): Promise<PickerResult> {
    const initial = await host.read()
    if (!initial.allowed || host.signal?.aborted)
      return refusedPicker("Only the current controller can answer")
    if (!qualifiedCodexPickerVersion(initial.version))
      return refusedPicker("This Codex version is not qualified")
    const resolved = this.resolveSubmission(run, request, initial)
    if ("status" in resolved) return resolved
    return runNativeSubmission(
      { host, initial, call: resolved.call, batch: resolved.batch, request },
      resolved.index,
      resolved.question,
      resolved.selection,
    )
  }
}
