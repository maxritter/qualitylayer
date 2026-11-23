import {
  CHECKLIST_BYTES,
  CHECKLIST_ITEMS,
  type ChecklistChange,
  type ChecklistItem,
  checklistBytes,
  checklistIdentity,
  checklistObject,
  parseChecklistChange,
} from "./checklist-parse.ts"
import type { ConversationChecklist } from "./types.ts"

export type ChecklistState = {
  value: ConversationChecklist | null
  pending: Record<string, ChecklistChange>
  revision: number
  seen: string[]
}

export const checklistState = (): ChecklistState => ({
  value: null,
  pending: Object.create(null),
  revision: 0,
  seen: [],
})

const CHECKLIST_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "update_plan"])
const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled"])

/**
 * Whether a tool result says its call went through: not an error, not interrupted, failed or
 * cancelled, and not text that opens with "error" or "cancelled".
 */
export function checklistToolOk(
  isError: boolean,
  text: string,
  result?: Record<string, unknown>,
): boolean {
  if (isError || result?.interrupted === true) return false
  if (typeof result?.status === "string" && FAILED_STATUSES.has(result.status)) return false
  return !/^(?:error|cancelled|canceled)\b/i.test(text.trim())
}

/** Normalize the full native input before event rows shorten it. Pending calls share the session budget. */
export function checklistCall(
  state: ChecklistState,
  callId: string,
  name: string,
  input: Record<string, unknown>,
): boolean {
  if (!CHECKLIST_TOOLS.has(name)) return false
  if (
    !checklistIdentity(callId) ||
    state.seen.includes(callId) ||
    Object.hasOwn(state.pending, callId)
  )
    return true
  state.seen.push(callId)
  if (state.seen.length > CHECKLIST_ITEMS) state.seen.shift()
  while (checklistBytes(state) > CHECKLIST_BYTES - 512 && state.seen.length > 1) state.seen.shift()
  const available = Math.max(0, CHECKLIST_BYTES - checklistBytes(state) - 512)
  const change = parseChecklistChange(name, input, available)
  if (checklistBytes(change) <= available && Object.keys(state.pending).length < CHECKLIST_ITEMS)
    state.pending[callId] = change
  return true
}

function applyCreate(
  items: ChecklistItem[],
  change: ChecklistChange,
  output: string,
  result?: Record<string, unknown>,
): boolean {
  const task = checklistObject(result?.task)
  const id =
    checklistIdentity(result?.taskId ?? result?.id ?? task?.id) ??
    checklistIdentity(output.match(/Task #([^\s]+) created successfully/)?.[1])
  if (!id || !change.text || items.some((item) => item.id === id)) return true
  items.push({ id, text: change.text, status: "pending" })
  return false
}

function applyUpdate(items: ChecklistItem[], change: ChecklistChange): boolean {
  const index = items.findIndex((item) => item.id === change.id)
  const item = items[index]
  if (!item) return true
  if (change.status === "deleted") {
    items.splice(index, 1)
    return false
  }
  items[index] = {
    ...item,
    ...(change.text ? { text: change.text } : {}),
    ...(change.status ? { status: change.status } : {}),
  }
  return false
}

function enforceBudget(state: ChecklistState, value: ConversationChecklist): void {
  while (value.items.length > CHECKLIST_ITEMS || checklistBytes(state) > CHECKLIST_BYTES - 1024) {
    value.coverage = "incomplete"
    if (value.items.length) value.items.pop()
    else {
      state.pending = Object.create(null)
      break
    }
  }
}

/** A result is the only evidence that the native tool changed its list. */
export function checklistResult(
  state: ChecklistState,
  callId: string,
  ok: boolean,
  output: string,
  result?: Record<string, unknown>,
): void {
  const change = Object.hasOwn(state.pending, callId) ? state.pending[callId] : undefined
  delete state.pending[callId]
  if (!change || !ok) return
  const previous = state.value
  const items = change.kind === "snapshot" ? change.items : [...(previous?.items ?? [])]
  let incomplete =
    change.incomplete || (change.kind !== "snapshot" && previous?.coverage === "incomplete")
  if (change.kind === "create")
    incomplete = applyCreate(items, change, output, result) || incomplete
  else if (change.kind === "update") incomplete = applyUpdate(items, change) || incomplete
  const value: ConversationChecklist = {
    scope: "session",
    revision: String(++state.revision),
    coverage: incomplete
      ? "incomplete"
      : change.kind === "snapshot"
        ? "snapshot"
        : (previous?.coverage ?? "observed"),
    items,
  }
  state.value = value
  enforceBudget(state, value)
}
