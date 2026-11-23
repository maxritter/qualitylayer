// Where a person's comment on a planning document stands, in the order they see it: sent, read by
// the session or queued behind its work, taken by a helper, then answered, changed or noted. Pure:
// the server reads the signals (the session, the helper worker), the App applies the clock, so the
// elapsed time keeps moving between polls. The deadlines are the helper backstop's: a comment the
// session did not pick up by then goes to a fresh read-only helper (review/answers.ts).

import { isArtifactDoc } from "./artifact/format.ts"
import type { Comment } from "./gate/comments.ts"

/** A planning document of a task: `01-plan.md`. */
export const PLANNING_DOC = /^\d{2}-(?:discuss|research|plan|outline)\.md$/

/** A document a person comments on for an agent: a planning document or an artifact page. */
export const helperDoc = (doc: string): boolean => PLANNING_DOC.test(doc) || isArtifactDoc(doc)

/** The agent is at work: a comment it has not read after this long goes to a helper. */
export const DOC_PICK_MS = 90_000
/** Its turn ended, it stopped or nothing ever spoke: nobody reads soon, so the helper starts sooner. */
export const DOC_IDLE_PICK_MS = 20_000
/** It waits in `gate wait`, which takes a comment within a second: this long is slack, not delay. */
export const DOC_WAITING_PICK_MS = 15_000

/** Whether the agent can read a comment soon: waiting in `gate wait`, at work, ended its turn, or unknown. */
export type AgentReach = "waiting" | "busy" | "idle" | "unknown"

export const pickDeadline = (reach: AgentReach): number =>
  reach === "waiting" ? DOC_WAITING_PICK_MS : reach === "idle" ? DOC_IDLE_PICK_MS : DOC_PICK_MS

export type CommentPhase =
  | "sent"
  | "queued"
  | "reading"
  | "helper"
  | "noted"
  | "answered"
  | "changed"
  | "no-answer"

export type CommentHandling = {
  phase: CommentPhase
  /** When this phase began (ms epoch): the App counts the elapsed time from it. */
  since: number
  /** The working agent's name, in the words the card uses. */
  agent: string
  /** What the agent is at, while it is busy ("Research"). */
  busyWith?: string
  /** When a helper steps in if the session has not read the comment (ms epoch); only while unread. */
  helperDueAt?: number
  /** The agent runs outside the App and was told of the comment in its own window. */
  told?: true
  /** A helper gave the answer, not the working agent. */
  by?: "helper"
  /** The helper answering now: who, and its latest step. */
  helper?: { name: string; line?: string }
  /** A helper's note on a change it left for the agent, or why nobody answered. */
  reason?: string
}

export type HandlingContext = {
  now: number
  agent: string
  reach: AgentReach
  busyWith?: string
  /** The helper running now, if one does. */
  helper: { name: string; line?: string } | null
  /** Tests and the demo shorten the wait before a helper steps in. */
  deadline?: number
}

function activeCommentHandling(
  c: Comment,
  ctx: HandlingContext,
  base: { agent: string },
): CommentHandling | null {
  const pickedOrDelivered = c.pickedAt !== undefined || c.delivered === true
  if (c.answeredBy === "session" && pickedOrDelivered)
    return { ...base, phase: "reading", since: c.pickedAt ?? c.created }
  if (c.noAnswer !== undefined)
    return { ...base, phase: "no-answer", since: c.created, reason: c.noAnswer }
  if (c.helperNote !== undefined)
    return { ...base, phase: "noted", since: c.pickedAt ?? c.created, reason: c.helperNote }
  if (c.answeredBy === "helper" || c.helperNow !== undefined)
    return {
      ...base,
      phase: "helper",
      since: c.pickedAt ?? c.helperNow ?? c.created,
      ...(ctx.helper !== null ? { helper: ctx.helper } : {}),
    }
  return pickedOrDelivered ? { ...base, phase: "reading", since: c.pickedAt ?? c.created } : null
}

function pendingCommentHandling(
  c: Comment,
  ctx: HandlingContext,
  base: { agent: string },
): CommentHandling {
  return {
    ...base,
    phase: ctx.reach === "waiting" ? "sent" : "queued",
    since: c.created,
    ...(ctx.busyWith !== undefined && ctx.reach === "busy" ? { busyWith: ctx.busyWith } : {}),
    helperDueAt: c.created + (ctx.deadline ?? pickDeadline(ctx.reach)),
    ...(c.told !== undefined ? { told: true as const } : {}),
  }
}

/** The status of one comment on a planning document; null for a note, a team thread or another document. */
export function commentHandling(c: Comment, ctx: HandlingContext): CommentHandling | null {
  if (c.for === "person" || c.source !== undefined || !helperDoc(c.doc)) return null
  const base = { agent: ctx.agent }
  if (c.answer !== undefined)
    return {
      ...base,
      phase: c.changed === true ? "changed" : "answered",
      since: c.answered ?? c.created,
      ...(c.answeredBy === "helper" ? { by: "helper" as const } : {}),
    }
  if (c.resolved !== undefined) return null
  return activeCommentHandling(c, ctx, base) ?? pendingCommentHandling(c, ctx, base)
}

/** A thread stands where its newest comment with a status does. */
export function threadHandling(
  comments: readonly Comment[],
  ctx: HandlingContext,
): CommentHandling | null {
  for (const c of [...comments].reverse()) {
    const handling = commentHandling(c, ctx)
    if (handling !== null) return handling
  }
  return null
}
