// The Pull request button in the App (App Model: get-approval, get-approval-final): what was pushed and
// how its pull request stands, and the push itself. The person's click in the App is their act, the same
// as `qualitylayer gate open plan|final --via github` at their own terminal. GitHub only (Max, 11 Nov).
//   GET  /api/tasks/<id>/outside-approval[?target=final]      → { sent, state, approvedBy }
//   POST /api/tasks/<id>/outside-approval {target?}            → the same after pushing, with the link to open

import { type Ctx, ok, type Result } from "../../ctx.ts"
import { NAMES } from "../docs/names.ts"
import * as gate from "../gate/gate.ts"
import { gateRevision } from "../gate/revision.ts"
import { headSha } from "../git/repo.ts"
import { refused } from "../next/refusal.ts"
import type { Task } from "../task/store.ts"
import {
  linkOf,
  originUrl,
  outsidePoller,
  readSent,
  requestFor,
  type Sent,
  sendFinal,
  sendPlan,
  type Target,
} from "./approval.ts"

import { type ReviewDestination, reviewDestination } from "./review-destination.ts"

export type OutsideState = {
  destination?: ReviewDestination
  /** What was pushed: its compare page, and the pull request once the person created it there. */
  sent: { url?: string; number?: number; compare?: string; at: number } | null
  /**
   * none: nothing pushed · pushed: pushed, no pull request yet · waiting: the pull request is open ·
   * approved: settled on GitHub · stale: the Plan or the change moved since it was pushed.
   */
  state: "none" | "pushed" | "waiting" | "approved" | "stale"
  approvedBy?: { login: string; url: string; via: "github" }
  /** After a push: the page the person opens next (the compare page, or the open request). */
  open?: string
}

/** The step a target's gate belongs to, and that gate's name. */
const STEP: Record<Target, { stage: string; gate: string }> = {
  plan: { stage: "plan", gate: NAMES.plan },
  final: { stage: "verify", gate: gate.FINAL },
}

export const targetOf = (word: unknown): Target => (word === "final" ? "final" : "plan")

// The App looks at most every 20 seconds per task and target, whatever the number of pages open; a
// page asks every 30, so each of its asks finds the next look due, a push's own look included.
const lastLook = new Map<string, number>()
const LOOK_MS = 20_000

/** What the pushed branch shows now against what is here: the Plan's revision, or the change's commit. */
async function current(ctx: Ctx, task: Task, target: Target): Promise<string | null> {
  return target === "final" ? headSha(ctx, task.repoRoot) : gateRevision(ctx, task, NAMES.plan)
}

const shown = (s: Sent | null): OutsideState["sent"] =>
  s === null || s.closed === true
    ? null
    : {
        ...(s.url !== undefined ? { url: s.url } : {}),
        ...(s.number !== undefined ? { number: s.number } : {}),
        ...(s.compare !== undefined ? { compare: s.compare } : {}),
        at: s.at,
      }

/** Where the Plan or the change stands on GitHub. Looking may record an approval; comments stay for the agents. */
export async function outsideState(
  ctx: Ctx,
  task: Task,
  target: Target = "plan",
): Promise<OutsideState> {
  let sent = await readSent(ctx, task, target)
  const step = STEP[target]
  const read = async () => {
    const g = await gate.readGate(ctx, task)
    return g?.target === step.gate ? g : null
  }
  let open = await read()
  const decided = (g: typeof open) =>
    g?.decision === "approved" && g.outside !== undefined
      ? {
          state: "approved" as const,
          approvedBy: { login: g.outside.login, url: g.outside.url, via: "github" as const },
        }
      : null
  const settledFirst = decided(open)
  if (settledFirst) return { sent: shown(sent), ...settledFirst }
  if (sent === null || sent.closed === true || task.stage !== step.stage)
    return {
      sent: shown(sent),
      state: "none",
      destination: reviewDestination(await originUrl(ctx, task.repoRoot)),
    }
  const key = `${task.runtimeDir}:${target}`
  const now = ctx.clock.now()
  if (now - (lastLook.get(key) ?? 0) >= LOOK_MS) {
    lastLook.set(key, now)
    // The pull request the person created on GitHub's page, found by its branch.
    sent = (await requestFor(ctx, task, sent).catch(() => null)) ?? sent
    if (open?.decision === "pending" && sent.number !== undefined) {
      await outsidePoller(ctx, task, { feedback: false, target })().catch(() => null)
      open = await read()
      const settled = decided(open)
      if (settled) return { sent: shown(sent), ...settled }
      sent = (await readSent(ctx, task, target)) ?? sent
      if (sent.closed === true) return { sent: null, state: "none" }
    }
  }
  const here = await current(ctx, task, target)
  return {
    sent: shown(sent),
    state: here !== sent.revision ? "stale" : sent.number !== undefined ? "waiting" : "pushed",
  }
}

/** The person's click: push the Plan (opening its gate when needed) or the change in its final review. */
export async function sendFromApp(
  ctx: Ctx,
  task: Task,
  target: Target = "plan",
): Promise<Result<OutsideState>> {
  let pushed: Sent
  if (target === "final") {
    if (task.stage !== "verify")
      return refused("Only a change in its final review gets a pull request here.", [])
    // The review opens when the page turned to the person; a click before the page read it opens it.
    await gate.ensureFinalReview(ctx, task)
    const review = await gate.readGate(ctx, task)
    if (review?.target !== gate.FINAL || review.decision !== "pending" || review.settled === true)
      return refused("The final review is not open, so nothing is pushed yet.", [])
    const sent = await sendFinal(ctx, task)
    if (!sent.ok) return sent
    pushed = sent.data
  } else {
    if (task.stage !== "plan") return refused("Only an open Plan gets a pull request here.", [])
    // A Plan whose gate is open stays as it is (its session and its id); only a closed one opens.
    const open = await gate.readGate(ctx, task)
    if (open?.target !== NAMES.plan || open.decision !== "pending" || open.settled === true) {
      const opened = await gate.open(ctx, task, NAMES.plan)
      if (!opened.ok) return opened
    }
    const sent = await sendPlan(ctx, task)
    if (!sent.ok) return sent
    pushed = sent.data
  }
  lastLook.delete(`${task.runtimeDir}:${target}`)
  const now = await outsideState(ctx, task, target)
  return ok({ ...now, open: now.sent?.url ?? linkOf(pushed) })
}
