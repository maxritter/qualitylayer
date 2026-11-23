import type { ConversationQuestion } from "./types.ts"

export type QuestionState = { value: ConversationQuestion | null; seen: string[] }
export const questionState = (): QuestionState => ({ value: null, seen: [] })
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= limit

type QuestionEntry = ConversationQuestion["questions"][number]
type QuestionOption = QuestionEntry["options"][number]

function parseQuestionOption(
  rawOption: unknown,
  labels: Set<string>,
): { option: QuestionOption; duplicate: boolean } | undefined {
  const option = object(rawOption)
  if (!option || !text(option.label, 2000)) return undefined
  if (option.description !== undefined) {
    if (typeof option.description !== "string" || option.description.length > 4000) return undefined
  }
  const duplicate = labels.has(option.label)
  labels.add(option.label)
  return {
    duplicate,
    option: {
      label: option.label,
      ...(typeof option.description === "string" ? { description: option.description } : {}),
    },
  }
}

function isValidQuestionRow(row: Record<string, unknown> | undefined): row is Record<
  string,
  unknown
> & {
  question: string
  header: string
  options: unknown[]
} {
  if (!row || !text(row.question, 8000) || !text(row.header, 256)) return false
  if (!Array.isArray(row.options) || row.options.length < 1 || row.options.length > 20) return false
  return row.multiSelect === undefined || typeof row.multiSelect === "boolean"
}

function parseQuestionRow(
  raw: unknown,
  context: { callId: string; agent: ConversationQuestion["agent"]; index: number },
  ids: Set<string>,
): { entry: QuestionEntry; answerable: boolean } | undefined {
  const row = object(raw)
  if (!isValidQuestionRow(row)) return undefined
  const id =
    context.agent === "claude-code"
      ? `${context.callId}:${context.index}`
      : typeof row.id === "string"
        ? row.id
        : ""
  let answerable = text(id, 256) && !ids.has(id)
  ids.add(id)
  const options: QuestionOption[] = []
  const labels = new Set<string>()
  for (const rawOption of row.options) {
    const parsed = parseQuestionOption(rawOption, labels)
    if (!parsed) return undefined
    if (parsed.duplicate) answerable = false
    options.push(parsed.option)
  }
  return {
    answerable,
    entry: {
      id,
      header: row.header,
      question: row.question,
      multiSelect: row.multiSelect === true,
      options,
    },
  }
}

/** Preserve native text exactly; malformed identities are never answerable. */
export function questionCall(
  state: QuestionState,
  callId: string,
  agent: ConversationQuestion["agent"],
  input: Record<string, unknown>,
): void {
  if (!text(callId, 128) || state.seen.includes(callId)) return
  state.seen.push(callId)
  if (state.seen.length > 100) state.seen.shift()
  const rows = input.questions
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 16) return
  const questions: ConversationQuestion["questions"] = []
  const ids = new Set<string>()
  let answerable = true
  for (const raw of rows) {
    const parsed = parseQuestionRow(raw, { callId, agent, index: questions.length }, ids)
    if (!parsed) return
    if (!parsed.answerable) answerable = false
    questions.push(parsed.entry)
  }
  const value: ConversationQuestion = { id: callId, agent, answerable, questions }
  if (Buffer.byteLength(JSON.stringify(value)) <= 32 * 1024) state.value = value
}

/** Empty native results also expire their matching call. */
export function questionResult(state: QuestionState, callId: string): void {
  if (state.value?.id === callId) state.value = null
  if (text(callId, 128) && !state.seen.includes(callId)) {
    state.seen.push(callId)
    if (state.seen.length > 100) state.seen.shift()
  }
}
