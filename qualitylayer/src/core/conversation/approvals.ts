// Answering an agent's permission request from the Conversation view. The agent's PermissionRequest hook
// (`qualitylayer hook approve`) asks here: while the person looks at that session, it leaves a pending
// request, waits for the App's answer and prints it; otherwise it prints nothing and the agent's own
// dialog asks, as before.
//
// Nothing here throws into a hook: a file that is missing, torn or not ours reads as "nothing".

import type { Ctx } from "../../ctx.ts"
import { isNativeAgent, type NativeAgent } from "../agents/ids.ts"
import { procStartChecked } from "../peers/claude.ts"
import {
  addPending,
  beatPending,
  clearCall,
  clearPending,
  clearSession,
  isPending,
  listPending,
  pendingRunApproval,
} from "./approvals-lifecycle.ts"
import { callHash, newApprovalId, readPendingApprovals } from "./approvals-store.ts"
import {
  type ApprovalRequest,
  allowSuggestions,
  approvalRequest,
  hookOutput,
  toolKindAndTarget,
} from "./approvals-tools.ts"
import {
  type ApprovalWhere,
  approvalFolder,
  decisionFile,
  ensureApprovalDir,
  HOOK_BEAT_MS,
  isApprovalObject,
  isOpen,
  isViewed,
  markViewing,
  PENDING_MAX_MS,
  pendingFile,
  readApprovalJson,
  readViewing,
  stopAllViewing,
  stopViewing,
  VIEW_CONFIRM_MS,
  VIEW_LEASE_MS,
  VIEW_MAX_MS,
  validApprovalId,
  validApprovalSession,
  WAIT_MAX_MS,
} from "./approvals-viewing.ts"
import type { ApprovalDecision } from "./types.ts"

export {
  type ApprovalRequest,
  addPending,
  allowSuggestions,
  approvalRequest,
  beatPending,
  callHash,
  clearCall,
  clearPending,
  clearSession,
  HOOK_BEAT_MS,
  hookOutput,
  isOpen,
  isPending,
  isViewed,
  listPending,
  markViewing,
  newApprovalId,
  PENDING_MAX_MS,
  pendingRunApproval,
  readViewing,
  stopAllViewing,
  stopViewing,
  toolKindAndTarget,
  VIEW_CONFIRM_MS,
  VIEW_LEASE_MS,
  VIEW_MAX_MS,
  WAIT_MAX_MS,
}

const POLL_MS = 250
const VIEW_CHECK_MS = 1_000

type StoredDecision = ApprovalDecision & { at: number }

function readDecision(value: unknown, canAllowSession: boolean): ApprovalDecision | null {
  if (!isApprovalObject(value) || (value.behavior !== "allow" && value.behavior !== "deny"))
    return null
  const message =
    typeof value.message === "string" && value.message.trim() !== ""
      ? value.message.trim().slice(0, 2_000)
      : undefined
  if (value.behavior === "deny") return { behavior: "deny", ...(message ? { message } : {}) }
  return {
    behavior: "allow",
    scope: value.scope === "session" && canAllowSession ? "session" : "once",
  }
}

async function writeExclusiveDecision(
  ctx: Ctx,
  where: ApprovalWhere,
  id: string,
  clean: ApprovalDecision,
): Promise<boolean> {
  await ensureApprovalDir(ctx, `${approvalFolder(ctx, where)}/decisions`)
  const row: StoredDecision = { ...clean, at: ctx.clock.now() }
  const path = decisionFile(ctx, where, id)
  try {
    await ctx.fs.writeFile(path, `${JSON.stringify(row)}\n`, { mode: 0o600, exclusive: true })
  } catch (cause) {
    if (!/EEXIST/.test(`${(cause as { code?: string }).code ?? ""} ${String(cause)}`))
      await ctx.fs.remove(path).catch(() => {})
    return false
  }
  if (!(await ctx.fs.exists(pendingFile(ctx, where, id)))) {
    await ctx.fs.remove(path).catch(() => {})
    return false
  }
  return true
}

/**
 * Write the person's answer for a waiting request. False for an id nothing waits on or one already
 * answered. The file is created exclusively, so of two answers at once exactly one wins.
 */
export async function decide(
  ctx: Ctx,
  agent: NativeAgent,
  session: string,
  id: string,
  decision: ApprovalDecision,
): Promise<boolean> {
  try {
    if (!isNativeAgent(agent) || !validApprovalSession(session) || !validApprovalId(id))
      return false
    const where = { agent, session }
    const stored = (await readPendingApprovals(ctx, where, true)).find(
      (entry) => entry.approval.id === id,
    )
    const clean = stored ? readDecision(decision, stored.approval.canAllowSession) : null
    return clean ? await writeExclusiveDecision(ctx, where, id, clean) : false
  } catch {
    return false
  }
}

/** The answer for a request, once: it is removed as it is read. Null while there is none. */
export async function takeDecision(
  ctx: Ctx,
  agent: NativeAgent,
  session: string,
  id: string,
): Promise<ApprovalDecision | null> {
  try {
    if (!isNativeAgent(agent) || !validApprovalSession(session) || !validApprovalId(id)) return null
    const where = { agent, session }
    const path = decisionFile(ctx, where, id)
    const row = await readApprovalJson(ctx, path)
    if (row === null) return null
    await ctx.fs.remove(path)
    const stored = (await readPendingApprovals(ctx, where)).find(
      (entry) => entry.approval.id === id,
    )
    return stored === undefined ? null : readDecision(row, stored.approval.canAllowSession)
  } catch {
    return null
  }
}

export type WaitOptions = {
  pollMs?: number
  maxMs?: number
  /** Called with a function that drops the request, for a signal handler to run. */
  onPending?: (clear: () => Promise<void>) => void
}

type WaitLoopState = { start: number; alive: boolean; checked: number; beat: number; maxMs: number }
type WaitStep =
  | { status: "done"; decision: ApprovalDecision | null }
  | { status: "continue"; state: WaitLoopState }

async function maintainApprovalLease(
  ctx: Ctx,
  target: { agent: NativeAgent; session: string; id: string },
  state: WaitLoopState,
  now: number,
): Promise<WaitLoopState | null> {
  const { agent, session, id } = target
  const marker = await readViewing(ctx, agent, session, now)
  const alive = state.alive || (marker !== null && marker.at > state.start)
  const expired =
    marker === null ||
    (alive ? now - marker.at > VIEW_LEASE_MS : now - state.start >= VIEW_CONFIRM_MS)
  if (expired) return null
  let checked = state.checked
  if (now - checked >= VIEW_CHECK_MS) {
    checked = now
    if (!(await isPending(ctx, agent, session, id))) return null
  }
  let beat = state.beat
  if (now - beat >= HOOK_BEAT_MS) {
    beat = now
    if (!(await beatPending(ctx, agent, session, id))) return null
  }
  return { ...state, alive, checked, beat }
}

async function pollApprovalStep(
  ctx: Ctx,
  target: { agent: NativeAgent; session: string; id: string },
  state: WaitLoopState,
): Promise<WaitStep> {
  const decision = await takeDecision(ctx, target.agent, target.session, target.id)
  if (decision !== null) return { status: "done", decision }
  const now = ctx.clock.now()
  if (now - state.start >= state.maxMs) return { status: "done", decision: null }
  const next = await maintainApprovalLease(ctx, target, state, now)
  return next ? { status: "continue", state: next } : { status: "done", decision: null }
}

/**
 * Ask the Conversation view and wait. Null at once when the view is not open on this session.
 */
export async function awaitApproval(
  ctx: Ctx,
  request: ApprovalRequest,
  options: WaitOptions = {},
): Promise<ApprovalDecision | null> {
  const { agent, session, approval } = request
  if (!(await isOpen(ctx, agent, session))) return null
  const start = ctx.clock.now()
  const added = { ...approval, createdAt: new Date(start).toISOString(), session }
  const own = request.options.pid === process.pid ? procStartChecked(process.pid)[0] : null
  const filed = { ...request.options, ...(own !== null ? { start: own } : {}) }
  if (!(await addPending(ctx, added, filed))) return null
  const clear = () => clearPending(ctx, agent, session, approval.id)
  options.onPending?.(clear)
  try {
    let state: WaitLoopState = {
      start,
      alive: false,
      checked: start,
      beat: start,
      maxMs: options.maxMs ?? WAIT_MAX_MS,
    }
    const target = { agent, session, id: approval.id }
    for (;;) {
      const step = await pollApprovalStep(ctx, target, state)
      if (step.status === "done") return step.decision
      state = step.state
      await ctx.clock.sleep(options.pollMs ?? POLL_MS)
    }
  } finally {
    await clear()
  }
}
