// The team's review of a change, as the log of what was said: a thread on a Done means or a
// picture, a reply, a resolve, a reviewer's verdict, a request to review again, and how the
// author decided a thread. Every state the Cockpit shows (open threads, who approved) is
// folded from the log, so the author's machine and a teammate's read the same review.

import { type Ctx, ok, type Result } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { REVIEW_DOC, readTeamComments } from "../team/comments.ts"
import { appendOwnWith, isMirrored, readOwn } from "../team/own-log.ts"
import type { Person } from "../team/people.ts"
import { eventFrom, newThreadId } from "./threads-actions.ts"
import { foldReview } from "./threads-fold.ts"
import { fromWire, toWire } from "./threads-wire.ts"

export { eventFrom, foldReview, fromWire, newThreadId, toWire }

/** The kinds of item in a review a thread can be about. `pr` is a comment made on the pull request. */
export const REVIEW_KINDS = ["doneMeans", "picture", "check", "plan", "diff", "pr"] as const
export type ReviewKind = (typeof REVIEW_KINDS)[number]

/**
 * What a thread is about: a Done means (its number), a picture (its file), a check
 * (`dod:T5`, `scenario:2`, `acceptance:A1`), a decision of the plan (a task id), a line of the
 * author's own diff (file, side, line and the line's text) or a pull request comment.
 */
export type ReviewAnchor = {
  kind: ReviewKind
  id: string
  quote?: string
  line?: number
  side?: "old" | "new"
  stamp?: string
}

/** How the author settled a thread with the agent: fix it as asked, fix it differently, answer, or replan. */
export const DECISIONS = ["fix", "other", "answer", "replan"] as const
export type DecisionKind = (typeof DECISIONS)[number]

/** A reviewer's own state: what their last verdict said, or that they were asked again. */
export type ReviewerState = "approved" | "changes" | "commented" | "requested"

/** `ref` is the id a word has where it was written (a pull request comment): the same on every read. */
export type ReviewBody =
  | { t: "thread"; thread: string; anchor: ReviewAnchor; text: string; ref?: string }
  | { t: "reply"; thread: string; text: string; ref?: string }
  | { t: "resolve"; thread: string }
  | { t: "reopen"; thread: string }
  | { t: "verdict"; state: Exclude<ReviewerState, "requested">; text?: string }
  | { t: "rereview"; to: string }
  | { t: "decision"; thread: string; kind: DecisionKind; note: string; round: number; head: string }

/** Where a word came from: this machine's author, a teammate, a guest with the link, or the pull request. */
export type ReviewSource = "me" | "team" | "link" | "pr"

export type ReviewEvent = ReviewBody & {
  id: string
  by: string
  at: number
  src: ReviewSource
  /** Member identity authenticated by the backend, separate from the displayed name. */
  actor?: Person
  /** Task-owner capability attested by the backend, not by the event's quote. */
  owner?: true
}

export type ThreadMessage = {
  id: string
  by: string
  at: number
  text: string
  src: ReviewSource
  ref?: string
}

export type ReviewThread = {
  id: string
  anchor: ReviewAnchor
  messages: ThreadMessage[]
  state: "open" | "resolved"
  created: number
  /** Who opened it. */
  by: string
  src: ReviewSource
  /** How the author settled it with the agent; the thread stays open or resolves as that says. */
  decision?: { kind: DecisionKind; note: string; at: number; round: number; head: string }
}

export type Reviewer = {
  name: string
  email?: string
  role: "author" | "team" | "link"
  state: "author" | ReviewerState
  at: number
}

export type ReviewState = { threads: ReviewThread[]; reviewers: Reviewer[] }

/**
 * What the Cockpit sends for the author or a teammate; the server adds who, when and the ids.
 * `verdict` is a reviewer's own state; `decision` is the author settling a thread with the agent.
 */
export type ReviewAction =
  | { t: "thread"; anchor: ReviewAnchor; text: string; thread?: string; ref?: string }
  | { t: "reply"; thread: string; text: string; ref?: string }
  | { t: "resolve"; thread: string }
  | { t: "reopen"; thread: string }
  | { t: "verdict"; state: Exclude<ReviewerState, "requested">; text?: string }
  | { t: "rereview"; to: string }
  | {
      t: "decision"
      thread: string
      kind: DecisionKind
      note: string
      round?: number
      head?: string
    }

/** What the author's own words are signed with in the log. */
export const AUTHOR = "You"

/** Everything said in the review: the author's own words and what the team said. */
export async function reviewEvents(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<ReviewEvent[]> {
  const heard = (await readTeamComments(ctx, task))
    .filter((c) => !isMirrored(c, REVIEW_DOC, { requireOwner: true }))
    .map((c) => fromWire(c))
    .filter((e): e is ReviewEvent => e !== null)
  return [...(await readOwn<ReviewEvent>(ctx, task, "review")), ...heard]
}

/** What the review holds so far: the threads and who has said what. */
export async function readReview(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<ReviewState> {
  return foldReview(await reviewEvents(ctx, task))
}

/** Add the author's word to the review log. */
export async function sayInReview(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  action: ReviewAction,
  /** Whose word it is when it is not the author's own: a comment read from the pull request. */
  as: { by: string; src: ReviewSource } = { by: AUTHOR, src: "me" },
): Promise<Result<ReviewEvent>> {
  const made = await appendOwnWith<ReviewEvent>(ctx, task, "review", async (own) => {
    const state = foldReview(await reviewEvents(ctx, task))
    const known = (id: string) => state.threads.some((t) => t.id === id)
    const event = eventFrom(
      action,
      {
        id: `m${own.length + 1}-${ctx.clock.now().toString(36)}`,
        now: ctx.clock.now(),
        by: as.by,
        src: as.src,
      },
      known,
      newThreadId,
    )
    return event.ok ? ok([event.data]) : event
  })
  return made.ok ? ok(made.data[0] as ReviewEvent) : made
}
