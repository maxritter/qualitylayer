// The words Home and the sidebar say under a task's name: the step, then what is asked of the person
// in the step's own terms. A task that waits in the Plan counts its questions; while the build goes on and a need waits, it names the one thing only the person can
// set. A shipped task whose pull request is open says what the pull request holds ("Pull request ·
// 2 threads, 1 check failing"), and one that was merged says so. Everything else is the shared
// status's own words (`shellStatus`).

import { openNeeds } from "../../core/interaction-shell/status.ts"
import type { LandingState } from "../../core/ship/landing.ts"
import { isWaiting, lifeWords, waitingWords } from "../../core/ship/pr-words.ts"
import type { AgentStatus } from "../../interaction/contracts.ts"
import type { TaskSummary } from "../api.ts"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function historyAt(
  task: Pick<TaskSummary, "archived" | "archivedAt" | "closing" | "created">,
): number {
  if (task.archived && task.archivedAt !== undefined) return task.archivedAt
  const shipped = Date.parse(task.closing?.shipped ?? "")
  return Number.isNaN(shipped) ? task.created : shipped
}

function hasUnsettledFinalApproval(task: Pick<TaskSummary, "stage" | "gate">): boolean {
  if (task.stage === "abandoned") return false
  return task.gate?.target === "final" && task.gate.decision === "approved" && !task.gate.settled
}

/**
 * The person's final approval is saved: the task shipped, or its final approval waits to be
 * applied (in Verify, also while it rechecks). From that moment nothing of the task
 * waits on them for the approval, and no page offers Approve again. A settled approval on a task
 * that is not shipped belongs to an earlier round of a reopened task.
 */
export const finalApproved = (task: Pick<TaskSummary, "stage" | "gate">): boolean =>
  task.stage === "shipped" || hasUnsettledFinalApproval(task)

/**
 * The chip of the pull request an approval chose: "Opening pull request" from the click until
 * GitHub has given it a number, then "Pull request #248"; null for a task with no pull request.
 */
export function pullRequestChip(task: Pick<TaskSummary, "stage" | "pullRequest">): string | null {
  if (task.stage !== "shipped" || task.pullRequest === undefined) return null
  const { number, url } = task.pullRequest
  if (number !== null) return `Pull request #${number}`
  return url === "" ? "Opening pull request" : "Pull request"
}

/** A shipped task whose pull request is open: it stays under Open now, not under Shipped. */
export const prOpen = (task: Pick<TaskSummary, "stage" | "pullRequest">): boolean =>
  task.stage === "shipped" && task.pullRequest?.state === "open"

/** Something of the open pull request waits on the person: the one fact Home and the sidebar share. */
export const prWaits = (task: Pick<TaskSummary, "stage" | "pullRequest">): boolean =>
  prOpen(task) && task.pullRequest !== undefined && isWaiting(task.pullRequest.waiting)

/** A shipped task whose change has not reached its base branch yet: the chat stays open for merge, deploy and tweaks. */
export const landingOf = (
  task: Pick<TaskSummary, "stage"> & { landing?: LandingState | null },
): LandingState | null =>
  task.stage === "shipped" && task.landing?.state === "landing" ? task.landing : null

/** Two ids of one commit, one of them possibly shortened. */
const sameCommit = (a: string, b: string | null): boolean =>
  b !== null && a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a))

/**
 * The commits made after the approval that still wait for the person. Without a pull request, all
 * of them (Approve change). With one open, those it does not carry: the pull request is opened
 * with the approved commit alone, so a later commit is in it only once it was pushed (Push the
 * fix), and then the merge accepts it. A pull request whose head is not among them and is not the
 * approved commit (pushed from elsewhere, rewritten) is taken to carry them, as before.
 */
export function sinceOutsidePullRequest(
  task: Pick<TaskSummary, "stage" | "pullRequest"> & { landing?: LandingState | null },
): LandingState["since"] {
  const landing = landingOf(task)
  if (landing === null) return []
  if (!prOpen(task)) return landing.since
  const head = task.pullRequest?.head ?? ""
  // Not read yet, or still at the approved commit: nothing after the approval is in it.
  if (head === "" || sameCommit(head, landing.approvedHead)) return landing.since
  const pushed = landing.since.findIndex((commit) => sameCommit(commit.sha, head))
  return pushed < 0 ? [] : landing.since.slice(0, pushed)
}

/**
 * Commits were made after the approval and wait for the person's Approve change. With the pull
 * request open that move is not theirs: what it carries the merge accepts, and what it does not
 * carry waits for Push the fix (`pushWaits`).
 */
export const landingWaits = (
  task: Pick<TaskSummary, "stage" | "pullRequest"> & { landing?: LandingState | null },
): boolean => !prOpen(task) && pendingHead(landingOf(task)) !== null

/**
 * The open pull request does not carry every commit made since the approval: the ones it lacks
 * wait for the person's Push the fix, whether or not anything else of the pull request waits.
 */
export const pushWaits = (task: Parameters<typeof landingWaits>[0]): boolean =>
  prOpen(task) && sinceOutsidePullRequest(task).length > 0

/**
 * The head the person has not approved yet: the newest commit after the approval, or the head of a
 * branch rewritten since (amend, rebase, force-push), which lists no commits but is never hidden.
 */
export function pendingHead(landing: LandingState | null): string | null {
  if (landing === null) return null
  if (landing.rewritten === true) return landing.tip ?? null
  return landing.since[0]?.sha ?? null
}

/** Something waits on the person in an open shipped task: a pull request thread, or changes after the approval. */
export const openWaits = (task: Parameters<typeof landingWaits>[0]): boolean =>
  prWaits(task) || landingWaits(task) || pushWaits(task)

/** A shipped task whose change is not in its base branch yet: its pull request is open, or it has not landed. */
export const unlanded = (task: Pick<TaskSummary, "stage" | "pullRequest" | "landing">): boolean =>
  prOpen(task) || landingOf(task) !== null

/**
 * A shipped task that stays in the open list: only one that still needs the person (a thread or a
 * failing check on its pull request, changes after the approval). An approved task nobody has to
 * act on stands with the finished ones from the click on, its pull request open or not: nothing
 * runs (Max, 10 November 2026).
 */
export const staysOpen = (task: Pick<TaskSummary, "stage" | "pullRequest" | "landing">): boolean =>
  openWaits(task)

/** "Approved · not merged yet", or what waits: "2 changes since your approval"; null once landed. */
export function landingLine(task: Parameters<typeof landingWaits>[0]): string | null {
  const landing = landingOf(task)
  if (landing === null) return null
  if (!prOpen(task) && landing.rewritten === true) return "Rewritten since your approval"
  const n = sinceOutsidePullRequest(task).length
  return n > 0
    ? `${plural(n, "change", "changes")} since your approval`
    : "Approved · not merged yet"
}

/**
 * A shipped task that went out as a pull request reads Shipped. One approved without a pull request
 * reads Approved: QualityLayer's part ended at the approval, and the person's own route takes it on.
 */
export function shippedWord(
  task: Pick<TaskSummary, "pullRequest" | "closing"> & {
    shipped?: { pr: unknown; choice: string | null } | null
    review?: { pr?: unknown } | null
  },
): "Shipped" | "Approved" {
  // The closing record's words: "approved" (or "approved, pushed by you") when no pull request was opened.
  const how = task.closing?.how
  const signs = [
    task.pullRequest !== undefined,
    task.shipped?.pr != null,
    task.review?.pr != null,
    task.shipped?.choice === "pull-request",
    how !== undefined && !how.startsWith("approved"),
  ]
  return signs.some(Boolean) ? "Shipped" : "Approved"
}

/**
 * What a shipped task says of its pull request: what waits on the person, else its state and its
 * checks, else that it was merged or closed; null for a task with no pull request.
 */
export function pullRequestLine(task: Pick<TaskSummary, "stage" | "pullRequest">): string | null {
  if (task.stage !== "shipped" || task.pullRequest === undefined) return null
  return waitingWords(task.pullRequest) ?? lifeWords(task.pullRequest)
}

/**
 * The line of an open shipped task: what waits on the person first (a thread, or changes after the
 * approval), then its pull request, then that it is approved and not merged yet.
 */
export function openLine(
  task: Pick<TaskSummary, "stage" | "pullRequest" | "landing">,
): string | null {
  if (landingWaits(task)) return landingLine(task)
  return pullRequestLine(task) ?? landingLine(task)
}

/** What Home asks of the person for an open shipped task. */
export function openMove(task: Parameters<typeof landingWaits>[0]): string {
  if (landingWaits(task)) return "Approve change"
  return task.pullRequest !== undefined ? "Open the pull request" : "Open the task"
}

function activeStatusWords(task: TaskSummary, status: AgentStatus): string {
  const waitingPlanQuestions =
    status.state !== "stopped" &&
    status.openItems > 0 &&
    task.stage === "plan" &&
    (task.gate === null || task.gate.settled || task.gate.decision !== "pending")
  if (waitingPlanQuestions) return plural(status.openItems, "question", "questions")
  if (status.state === "working" && task.action === "implement") return "start the build"
  const needs = openNeeds(task)
  if (status.state === "working" && task.stage === "implement" && needs > 0) {
    return `${plural(needs, "thing", "things")} only you can set`
  }
  return status.doing
}

export function statusWords(task: TaskSummary, status: AgentStatus): string {
  const pr = openLine(task)
  if (pr !== null) return pr
  // Held by its plan limit: the agent asks and does nothing until it resets.
  if (status.signals?.limit != null) return status.doing
  return activeStatusWords(task, status)
}
