import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { capFolder, NATIVE_PLAN_FILE_MAX_BYTES, NATIVE_PLAN_FILES_KEPT } from "../home-caps.ts"
import { checklistCall, checklistResult, checklistState } from "./checklist.ts"
import type { CodexPlanObservation } from "./codex.ts"
import {
  type CompletedPlanReceipt,
  capturePlanFrontier,
  type NativePlanReceipt,
  nativePlanDir,
  nativePlanPath,
  readAsyncNativePlan,
  readStoredNativePlan,
  type StoredNativePlan,
  samePlanSource,
  validPlanSession,
} from "./native-plan-store.ts"
import type { ConversationChecklist } from "./types.ts"

const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled"])

export const nativePlanFile = nativePlanPath

function isReceiptObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function nativePlanReceipt(
  payload: NativePlanReceipt,
  fallback: string,
): payload is CompletedPlanReceipt {
  if (!validPlanSession(payload.session_id)) return false
  if ((payload.hook_event_name || fallback) !== "PostToolUse") return false
  if (payload.tool_name !== "update_plan" || payload.tool_response !== "Plan updated") return false
  if (payload.is_error === true || FAILED_STATUSES.has(String(payload.status))) return false
  const call = payload.tool_use_id
  return (
    typeof call === "string" &&
    call.length > 0 &&
    call.length <= 128 &&
    isReceiptObject(payload.tool_input)
  )
}

function serializePlanRecord(record: StoredNativePlan): string | null {
  let body = JSON.stringify(record)
  if (Buffer.byteLength(body) > NATIVE_PLAN_FILE_MAX_BYTES && record.frontier) {
    delete record.frontier
    record.value = { ...record.value, coverage: "incomplete" }
    body = JSON.stringify(record)
  }
  return Buffer.byteLength(body) <= NATIVE_PLAN_FILE_MAX_BYTES ? body : null
}

/** Called only after managed-run ownership or an outside task binding has been established. */
export async function recordNativePlan(
  ctx: Ctx,
  payload: NativePlanReceipt,
  fallback: string,
): Promise<void> {
  if (!nativePlanReceipt(payload, fallback)) return
  const session = payload.session_id
  const call = payload.tool_use_id
  const frontier = capturePlanFrontier(ctx, payload)
  try {
    const dir = nativePlanDir(ctx)
    await ctx.fs.mkdir(dir)
    await ctx.fs.withLock(join(dir, ".write.lock"), async () => {
      const before = await readAsyncNativePlan(ctx, session)
      if (before?.seen.includes(call)) return
      if (
        before?.frontier &&
        frontier &&
        frontier.offset < before.frontier.offset &&
        samePlanSource(before.frontier, frontier.file)
      )
        return
      const state = checklistState()
      state.seen = before?.seen ?? []
      checklistCall(state, call, "update_plan", payload.tool_input)
      checklistResult(state, call, true, "Plan updated")
      if (!state.value) return
      state.value.scope = session
      state.value.revision = call
      const body = serializePlanRecord({
        session,
        seen: state.seen,
        value: state.value,
        ...(frontier ? { frontier } : {}),
      })
      if (!body) return
      const file = nativePlanFile(ctx, session)
      if (!(await ctx.fs.exists(file)))
        await capFolder(ctx, dir, NATIVE_PLAN_FILES_KEPT - 1, (name) =>
          /^codex-[a-f0-9]+\.json$/.test(name),
        )
      await ctx.fs.atomicWrite(file, body)
    })
  } catch {
    // Recording the App's view must never prevent the native tool from returning.
  }
}

export function readNativePlan(
  ctx: Ctx,
  session: string | undefined,
): ConversationChecklist | null {
  return validPlanSession(session) ? (readStoredNativePlan(ctx, session)?.value ?? null) : null
}

function compareObservedPlan(
  receipt: StoredNativePlan,
  canonical: ConversationChecklist,
  observation: CodexPlanObservation | undefined,
): { checklist: ConversationChecklist | null; captured: boolean } {
  const captured = { checklist: receipt.value, captured: true }
  const uncertain = {
    checklist: { ...receipt.value, coverage: "incomplete" as const },
    captured: true,
  }
  const sameContent =
    observation?.callId === receipt.value.revision ||
    JSON.stringify(canonical.items) === JSON.stringify(receipt.value.items)
  if (sameContent) {
    return canonical.coverage !== "incomplete" && receipt.value.coverage === "incomplete"
      ? { checklist: canonical, captured: false }
      : captured
  }
  const frontier = receipt.frontier
  if (!frontier || !observation) return uncertain
  if (observation.start >= frontier.offset && observation.end > frontier.offset)
    return { checklist: canonical, captured: false }
  return observation.end <= frontier.offset ? captured : uncertain
}

/** Select native observations by their source barrier, never by checklist counters or clocks. */
export function selectNativePlan(
  ctx: Ctx,
  session: string | undefined,
  canonical: ConversationChecklist | null,
  path: string | undefined,
  observation: CodexPlanObservation | undefined,
): { checklist: ConversationChecklist | null; captured: boolean } {
  const receipt = validPlanSession(session) ? readStoredNativePlan(ctx, session) : null
  if (!receipt) return { checklist: canonical, captured: false }
  if (receipt.frontier && (!path || !samePlanSource(receipt.frontier, path))) {
    return { checklist: { ...receipt.value, coverage: "incomplete" }, captured: true }
  }
  if (!canonical) return { checklist: receipt.value, captured: true }
  return compareObservedPlan(receipt, canonical, observation)
}
