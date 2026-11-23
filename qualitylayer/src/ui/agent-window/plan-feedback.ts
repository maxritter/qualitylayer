import type { ConversationSnapshot } from "../../core/conversation/types.ts"
import type { ViewerState } from "../../core/run/protocol.ts"
import type { RunWindow } from "../run-context.tsx"

export type PlanUpdateOutcome = "requested" | "active"
export type PlanFeedbackActor = {
  run: RunWindow
  status: RunWindow["status"]
  attention: RunWindow["attention"]
  viewer: ViewerState | undefined
  readOnly: boolean
  busy: boolean
  hasDraft: boolean
  load(): Promise<ConversationSnapshot | undefined>
  send(text: string): boolean
  resume(): Promise<boolean | undefined>
}

export function planningRun(run: RunWindow): boolean {
  return (
    run.agent !== "other" &&
    !!run.nativeSession &&
    ((run.purpose.kind === "task" && run.purpose.phase === "planning") ||
      (run.purpose.kind === "new-task" && run.purpose.type !== "chat"))
  )
}

function sameActor(before: PlanFeedbackActor, now: PlanFeedbackActor) {
  return (
    before.run.id === now.run.id &&
    before.run.generation === now.run.generation &&
    before.run.nativeSession === now.run.nativeSession
  )
}

function requireInput(actor: PlanFeedbackActor) {
  if (actor.readOnly || actor.busy || actor.hasDraft || actor.status !== "running")
    throw new Error("Open the planner's Conversation to continue. Its current input is kept.")
  const viewer = actor.viewer
  if (
    !viewer ||
    viewer.generation !== actor.run.generation ||
    !viewer.controller ||
    !viewer.canType
  )
    throw new Error("This window no longer controls the planner. Open Conversation and try again.")
  if (actor.attention !== "clear")
    throw new Error(
      "Answer the planner's current question in Conversation before updating the Plan.",
    )
}

/** The person's explicit request, through the current native session's existing input or resume. */
export async function updatePlanFromFeedback(
  current: () => PlanFeedbackActor,
): Promise<PlanUpdateOutcome> {
  const actor = current()
  if (!planningRun(actor.run) || actor.readOnly || actor.busy)
    throw new Error("The current planner is unavailable. Your feedback is saved.")
  if (actor.status === "stopped" || actor.status === "failed") {
    if (!actor.run.canResume || !(await actor.resume()))
      throw new Error("Could not resume the planner. Your feedback is saved.")
    return "requested"
  }
  requireInput(actor)
  const snapshot = await actor.load()
  const now = current()
  if (!sameActor(actor, now))
    throw new Error("The planner changed. Try again with its current session.")
  requireInput(now)
  if (!snapshot || snapshot.source === "none" || snapshot.state === undefined)
    throw new Error("Could not read the planner's current state. Open Conversation and try again.")
  if (snapshot.question || (snapshot.approvals?.length ?? 0) > 0)
    throw new Error(
      "Answer the planner's current question in Conversation before updating the Plan.",
    )
  if (
    snapshot.state === "working" ||
    (snapshot.workers?.length ?? 0) > 0 ||
    snapshot.workersIncomplete
  )
    return "active"
  if (
    !now.send(
      "Run qualitylayer next to read my pending Plan feedback. Revise the Plan and answer the feedback before asking for approval.",
    )
  )
    throw new Error("Could not send the update request. Your feedback is saved.")
  return "requested"
}

export type PlannerRelease = "released" | "active"

function snapshotBlocksRelease(snapshot: ConversationSnapshot | undefined): boolean {
  if (!snapshot || snapshot.source === "none" || snapshot.state === undefined) return true
  if (snapshot.state === "working" || snapshot.question) return true
  const hasApprovals = (snapshot.approvals?.length ?? 0) > 0
  const hasWorkers = (snapshot.workers?.length ?? 0) > 0 || Boolean(snapshot.workersIncomplete)
  return hasApprovals || hasWorkers
}

/**
 * Approve and build here (12.9): the planning run ends at a turn boundary so its own native
 * conversation can continue as the build. A planner still in its turn, asking, or with helpers
 * running is left alone ("active"); nothing is typed into it and nothing is interrupted.
 */
export async function releasePlannerForBuild(
  current: () => PlanFeedbackActor,
  stop: () => Promise<boolean | undefined>,
): Promise<PlannerRelease> {
  const actor = current()
  if (!planningRun(actor.run) || actor.readOnly || actor.busy)
    throw new Error("The planning session is unavailable here. Choose where to build instead.")
  if (actor.status === "stopped" || actor.status === "failed") return "released"
  if (actor.hasDraft)
    throw new Error(
      "You have an unsent message in the planner's Conversation. Send or clear it, then build here.",
    )
  if (actor.attention !== "clear") return "active"
  const snapshot = await actor.load()
  const now = current()
  if (!sameActor(actor, now))
    throw new Error("The planner changed. Try again with its current session.")
  // What changed while the snapshot was read counts too: new words, a permission, a new turn.
  if (now.hasDraft || now.attention !== "clear" || now.status !== "running" || now.busy)
    return "active"
  if (snapshotBlocksRelease(snapshot)) return "active"
  if ((await stop()) !== true)
    throw new Error("The planning session did not stop. Your approval is kept; try again.")
  return "released"
}
