import type { Clock } from "../../ctx.ts"
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
type Question = ConversationQuestion["questions"][number]
type Submission = {
  picks: PickerRequest["picks"]
  result: PickerResult
  supportingContext?: string
}
type Call = { callId: string; identity?: string; total: number; answers: Map<string, Submission> }
const refused = (reason = "Codex did not take the answer"): PickerResult => ({
  status: "refused",
  message: `${reason}; answer in the terminal`,
})
const expired = (): PickerResult => ({
  status: "expired",
  message: "Codex did not take the answer; answer in the terminal",
})

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

export class CodexPickerAdapter {
  private queues = new Map<string, Promise<unknown>>()
  private calls = new Map<string, Call>()
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
  private async answer(
    run: string,
    request: PickerRequest,
    host: PickerHost,
  ): Promise<PickerResult> {
    const initial = await host.read()
    if (!initial.allowed || host.signal?.aborted)
      return refused("Only the current controller can answer")
    if (!qualifiedCodexPickerVersion(initial.version))
      return refused("This Codex version is not qualified")
    let call = this.calls.get(run)
    if (call?.identity !== initial.identity) call = undefined
    const prior = call?.callId === request.callId ? call.answers.get(request.questionId) : undefined
    if (prior && call) {
      if (
        (prior.supportingContext || request.supportingContext) &&
        (prior.supportingContext !== request.supportingContext ||
          JSON.stringify(prior.picks) !== JSON.stringify(request.picks))
      )
        return refused("This question already has a different submitted answer")
      return initial.result === undefined ? prior.result : settleNative(call, initial.result)
    }
    const batch = initial.question
    if (batch?.availability === "expired") return expired()
    if (!batch || batch.id !== request.callId) {
      const actual = nativeAnswers(initial.result)
      return actual && Object.keys(actual).length === 0
        ? expired()
        : refused("This question is no longer available here")
    }
    if (!batch.answerable) return refused("This question is not ready to answer here")
    if (call?.callId !== request.callId) {
      if (this.calls.size >= 200 && !this.calls.has(run))
        return refused("Too many pending question sessions")
      call = {
        callId: request.callId,
        identity: initial.identity,
        total: batch.questions.length,
        answers: new Map(),
      }
      this.calls.set(run, call)
    }
    if (!call) return refused()
    const index = call.answers.size
    const question = batch.questions[index]
    if (!question || question.id !== request.questionId)
      return refused("Answer the current question first")
    const selection = selectionFor(question, request.picks, request.supportingContext)
    if (!selection) return refused("This selection cannot be typed safely")
    const input = new NativeInput(host, initial, question, index, batch.questions.length, selection)
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
      submission.result = await acknowledge(host, call, batch.questions[index + 1])
      return submission.result
    } catch (cause) {
      const state = await host.read().catch(() => null)
      const actual =
        state?.allowed && state.result !== undefined ? nativeAnswers(state.result) : null
      const result =
        actual && Object.keys(actual).length === 0
          ? expired()
          : refused(cause instanceof Error ? cause.message : undefined)
      if (input.started || (actual && Object.keys(actual).length === 0))
        call.answers.set(request.questionId, {
          picks: structuredClone(request.picks),
          result,
          ...(request.supportingContext ? { supportingContext: request.supportingContext } : {}),
        })
      return result
    }
  }
}

type Selection = { target: number; own?: string }
function selectionFor(
  question: Question,
  picks: PickerRequest["picks"],
  context?: string,
): Selection | null {
  if (question.multiSelect) return null
  if (!Array.isArray(picks))
    return safeOwnText(picks.own + (context ? `\n\n${context}` : ""))
      ? { target: question.options.length, own: picks.own + (context ? `\n\n${context}` : "") }
      : null
  if (picks.length !== 1) return null
  const target = question.options.findIndex((option) => option.label === picks[0])
  if (context && !safeOwnText(context)) return null
  return target < 0 ? null : { target, ...(context ? { own: context } : {}) }
}
export const validPickerSelection = (question: Question, picks: PickerRequest["picks"]) =>
  selectionFor(question, picks) !== null
function safeOwnText(text: string): boolean {
  if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 8000) return false
  return ![...text].some((c) => {
    const n = c.charCodeAt(0)
    return (n < 32 && n !== 9 && n !== 10) || (n >= 127 && n <= 159)
  })
}
function choiceCursor(screen: string, labels: string[]): number | null {
  if (!screen.includes("tab to add notes")) return null
  const rows = screen.split("\n").filter((line) => /^\s*› \d+\. /.test(line))
  if (rows.length !== 1) return null
  const match = rows[0]?.match(/^\s*› (\d+)\. (.*)$/)
  const index = Number(match?.[1]) - 1
  const label = [...labels, "None of the above"][index]
  return match &&
    label !== undefined &&
    (match[2]?.trimEnd() === label || match[2]?.startsWith(`${label}  `))
    ? index
    : null
}

class NativeInput {
  started = false
  private deadline: number
  constructor(
    private host: PickerHost,
    private initial: PickerState,
    private question: Question,
    private index: number,
    private total: number,
    private selection: Selection,
  ) {
    this.deadline = host.clock.now() + 3000
  }
  private async screen(): Promise<string> {
    const state = await this.host.read()
    const position = new RegExp(`Question\\s+${this.index + 1}\\s*/\\s*${this.total}(?:\\D|$)`)
    if (
      !state.allowed ||
      this.host.signal?.aborted ||
      state.version !== this.initial.version ||
      state.identity !== this.initial.identity ||
      state.question?.id !== this.initial.question?.id ||
      !state.screen.includes(this.question.question) ||
      !position.test(state.screen)
    )
      throw new Error("The controller or native question changed")
    return state.screen
  }
  private cursor(screen: string): number {
    const cursor = choiceCursor(
      screen,
      this.question.options.map((option) => option.label),
    )
    if (cursor === null) throw new Error("Native choices focus or cursor is unknown")
    return cursor
  }
  private async write(keys: string, phase: "move" | "notes" | "paste" | "submit"): Promise<void> {
    const screen = await this.screen()
    if (phase === "move") this.cursor(screen)
    else if (phase === "notes" || (phase === "submit" && this.selection.own === undefined)) {
      if (this.cursor(screen) !== this.selection.target)
        throw new Error("Native selection changed before submission")
    } else if (!screen.includes("tab or esc to clear notes"))
      throw new Error("Native notes focus changed")
    if (phase === "paste" || phase === "submit") this.started = true
    await this.host.write(keys)
  }
  private async move(): Promise<void> {
    for (;;) {
      const cursor = this.cursor(await this.screen())
      if (cursor === this.selection.target) return
      if (this.host.clock.now() >= this.deadline) throw new Error("Native navigation timed out")
      await this.write("\u001b[B", "move")
      const sent = this.host.clock.now()
      await observed(
        this.host,
        this.deadline,
        async () =>
          this.cursor(await this.screen()) !== cursor || this.host.clock.now() - sent >= 400,
      )
    }
  }
  async prepare(): Promise<void> {
    await this.move()
    const own = this.selection.own
    if (own === undefined) return
    await this.write("\t", "notes")
    await observed(this.host, this.deadline, async () =>
      (await this.screen()).includes("tab or esc to clear notes"),
    )
    await this.write(`\u001b[200~${own}\u001b[201~`, "paste")
    const fragments = own.split(/\s+/).filter(Boolean)
    await observed(this.host, this.deadline, async () => {
      const screen = await this.screen()
      const visible = screen.replace(/\s+/g, "")
      return fragments.every((fragment) => visible.includes(fragment.replace(/\s+/g, "")))
    })
  }
  enter(): Promise<void> {
    return this.write("\r", "submit")
  }
}

async function observed(
  host: PickerHost,
  deadline: number,
  check: () => Promise<boolean>,
): Promise<void> {
  while (!(await check())) {
    if (host.signal?.aborted) throw new Error("The answer was cancelled")
    if (host.clock.now() >= deadline) throw new Error("Native focus or text was not acknowledged")
    await host.clock.sleep(25)
  }
}
async function acknowledge(host: PickerHost, call: Call, next?: Question): Promise<PickerResult> {
  const until = host.clock.now() + 3000
  for (;;) {
    const state = await host.read()
    if (!state.allowed || host.signal?.aborted || state.identity !== call.identity)
      return refused("Control was revoked before native confirmation")
    if (state.result !== undefined) return settleNative(call, state.result)
    if (next && state.question?.id === call.callId && state.screen.includes(next.question))
      return { status: "submitted" }
    if (!state.question || host.clock.now() >= until)
      return next ? refused("Native confirmation is not available") : { status: "submitted" }
    await host.clock.sleep(25)
  }
}
function settleNative(call: Call, output: unknown): PickerResult {
  const actual = rawNativeAnswers(output)
  const matching =
    actual &&
    call.answers.size === call.total &&
    Object.keys(actual).length === call.total &&
    [...call.answers].every(([id, value]) => {
      const got = actual[id]
      if (!got) return false
      if (value.supportingContext) {
        const expected = Array.isArray(value.picks)
          ? [...value.picks, `user_note: ${value.supportingContext}`]
          : ["None of the above", `user_note: ${value.picks.own}\n\n${value.supportingContext}`]
        return JSON.stringify(got) === JSON.stringify(expected)
      }
      return (
        JSON.stringify(normalizeNativeAnswer(got)) ===
        JSON.stringify(Array.isArray(value.picks) ? value.picks : [value.picks.own])
      )
    })
  const result: PickerResult =
    actual && Object.keys(actual).length === 0
      ? expired()
      : matching
        ? { status: "confirmed" }
        : refused()
  for (const value of call.answers.values()) value.result = result
  return result
}

function rawNativeAnswers(value: unknown): Record<string, string[]> | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.answers ||
      typeof parsed.answers !== "object" ||
      Array.isArray(parsed.answers)
    )
      return null
    const result: Record<string, string[]> = {}
    for (const [id, raw] of Object.entries(parsed.answers)) {
      const answers = (raw as { answers?: unknown }).answers
      if (!Array.isArray(answers) || answers.some((value) => typeof value !== "string")) return null
      result[id] = answers
    }
    return result
  } catch {
    return null
  }
}
function normalizeNativeAnswer(answers: string[]): string[] | null {
  const note = answers.find((value) => value.startsWith("user_note: "))
  if (
    note !== undefined &&
    (answers.length !== 2 || answers[0] !== "None of the above" || answers[1] !== note)
  )
    return null
  return note === undefined ? answers : [note.slice("user_note: ".length)]
}
function nativeAnswers(value: unknown): Record<string, string[]> | null {
  const raw = rawNativeAnswers(value)
  if (!raw) return null
  const result: Record<string, string[]> = {}
  for (const [id, answers] of Object.entries(raw)) {
    const normalized = normalizeNativeAnswer(answers)
    if (!normalized) return null
    result[id] = normalized
  }
  return result
}
