// The author settles the review's open threads with their agent: each thread is shown with where
// it is and what was said, and decided as a fix, a different fix, an answer or a replan. The fixes
// are built and judged again; when that round passes, the review reopens by itself.

import type { Ctx } from "../../ctx.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { pullRequestThreads } from "../ship/pr-threads.ts"
import { type Task, taskDocPath } from "../task/store.ts"
import { doneMeansOf } from "./detail.ts"
import {
  type DecisionKind,
  type ReviewAnchor,
  type ReviewSource,
  type ReviewThread,
  readReview,
} from "./threads.ts"
import { decideThread, headOf, settleDecisions } from "./triage-decide.ts"
import { PR_PREFIX, prAnchor, takeInNewReplies } from "./triage-pr.ts"

export { decideThread, settleDecisions }

/** An open thread as the agent reads it: where it is, what it is on, and every word written. */
export type TriageThread = {
  id: string
  anchor: ReviewAnchor
  where: string
  context: string
  from: ReviewSource
  messages: { by: string; text: string }[]
  decision: { kind: DecisionKind; note: string } | null
  /** No decision yet, or the reviewer has answered since the author's. */
  needs_triage: boolean
}

/** A thread the author has not decided, or one the reviewer replied to after the decision. */
export function needsTriage(thread: ReviewThread): boolean {
  if (thread.state !== "open") return false
  if (thread.decision === undefined) return true
  const last = thread.messages.at(-1)
  return last !== undefined && last.at > thread.decision.at && last.src !== "me"
}

/** A decided fix, different fix or replan whose work has not been judged yet. */
export function awaitsFix(thread: ReviewThread): boolean {
  return (
    thread.state === "open" &&
    thread.decision !== undefined &&
    thread.decision.kind !== "answer" &&
    !needsTriage(thread)
  )
}

async function contextOf(ctx: Ctx, task: Task, anchor: ReviewAnchor): Promise<string> {
  if (anchor.kind === "doneMeans") {
    const path = taskDocPath(task, "plan")
    const frame = (await ctx.fs.exists(path)) ? parseDoc(await ctx.fs.readFile(path)).body : ""
    const item = doneMeansOf(frame).find((d) => String(d.n) === anchor.id)
    if (item !== undefined) return [item.head, item.text].filter(Boolean).join(" ")
  }
  if (anchor.kind === "diff" || anchor.kind === "pr") {
    const where = anchor.line !== undefined ? `${anchor.id}:${anchor.line}` : anchor.id
    return anchor.quote !== undefined ? `${where}  ${anchor.quote}` : where
  }
  return anchor.quote ?? anchor.id
}

/** How each kind of place reads in a thread's `where`. */
const WHERE: Record<ReviewAnchor["kind"], (anchor: ReviewAnchor) => string> = {
  doneMeans: (a) => `Done means ${a.id}`,
  picture: (a) => `the picture ${a.id}`,
  check: (a) => `the check ${a.id}`,
  plan: (a) => `the plan, ${a.id}`,
  diff: (a) => `${a.id}, line ${a.line ?? ""}`,
  pr: (a) => (a.line !== undefined ? `${a.id}, line ${a.line}` : a.id),
}

const whereOf = (anchor: ReviewAnchor): string => WHERE[anchor.kind](anchor)

/** The agreed fixes have been committed: the code is no longer where it was when the author decided. */
export async function fixesBuilt(ctx: Ctx, task: Task): Promise<boolean> {
  const fixes = (await readReview(ctx, task)).threads.filter(awaitsFix)
  if (fixes.length === 0) return false
  const head = await headOf(ctx, task)
  return fixes.some((t) => t.decision !== undefined && t.decision.head !== head)
}

/** The review's open threads, each with its context, for `review threads`; `url` when the pull request is known. */
export async function openThreads(ctx: Ctx, task: Task, url?: string): Promise<TriageThread[]> {
  const remote = await pullRequestThreads(ctx, task, url)
  await takeInNewReplies(ctx, task, remote)
  const state = await readReview(ctx, task)
  const out: TriageThread[] = []
  // Unresolved code comments on the pull request join the triage until the author has decided them.
  const known = new Set(state.threads.map((t) => t.id))
  for (const pr of remote) {
    if (known.has(`${PR_PREFIX}${pr.id}`)) continue
    const first = pr.comments[0]?.text ?? ""
    const anchor = prAnchor(pr)
    out.push({
      id: `${PR_PREFIX}${pr.id}`,
      anchor,
      where: whereOf(anchor),
      context: await contextOf(ctx, task, anchor),
      from: "pr",
      messages: pr.comments.map((c) => ({ by: c.by, text: c.text })),
      decision: null,
      needs_triage: first !== "" || pr.comments.length > 0,
    })
  }
  for (const thread of state.threads) {
    if (thread.state !== "open") continue
    out.push({
      id: thread.id,
      anchor: thread.anchor,
      where: whereOf(thread.anchor),
      context: await contextOf(ctx, task, thread.anchor),
      from: thread.src,
      messages: thread.messages.map((m) => ({ by: m.by, text: m.text })),
      decision:
        thread.decision === undefined
          ? null
          : { kind: thread.decision.kind, note: thread.decision.note },
      needs_triage: needsTriage(thread),
    })
  }
  return out
}
