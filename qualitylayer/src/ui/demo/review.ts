import { DEMO_TASK_ID } from "./identity.ts"
// The final approval in the demo: what the server leaves of a task once the person approves its
// change, with a pull request only when they chose to open one.

import type { PullRequestView } from "../../core/review/summary.ts"
import type { ShipChoice } from "../../core/ship/choice.ts"
import type { LandingState } from "../../core/ship/landing.ts"
import type { TaskDetail } from "../api.ts"
import { demoCost } from "./cost.ts"

const MIN = 60_000

/** What the demo's approval leaves: the change is approved and not merged yet, with no commits after it. */
export const demoLanding = (
  task: Pick<TaskDetail, "slug"> & { branch?: string | null },
  /** `?landing=changes` in the address: a commit already came after the approval, to see Approve change. */
  changed = typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("landing") === "changes",
): LandingState => ({
  state: "landing",
  base: "main",
  branch: task.branch ?? `feat/${task.slug}`,
  approvedHead: "7d2c1e0b4a9f3c58e1d62a07b9c4f8e3d5a1b2c6",
  scope: "demo-approved-scope",
  since: changed
    ? [
        {
          sha: "3f2a1c0d8e7b6a5f4c3d2e1f0a9b8c7d6e5f4a3b",
          subject: "Empty state says “No usage yet”",
          files: 1,
          added: 2,
          removed: 2,
        },
      ]
    : [],
})

/** The pull request the demo opens for a task. */
const demoPullRequest = (task: TaskDetail): PullRequestView => ({
  number: 318,
  title: task.title,
  url: `https://github.com/${task.projectName}/pull/318`,
  state: "open",
  checks: "14 checks passing",
  branch: `feat/${task.slug}`,
})

/**
 * The final approval in the demo, as the server leaves the task: the facts of what was decided, and a pull request
 * only when the person chose "Approve and open a pull request". Returns the pull request it opened.
 */
export function shipDemoReview(
  task: TaskDetail,
  ship: ShipChoice | undefined,
  now = Date.now(),
): PullRequestView | null {
  const pr = ship === "pull-request" ? demoPullRequest(task) : null
  if (task.review !== null) task.review = { ...task.review, pr }
  task.shipped = {
    approvedAt: now,
    choice: ship ?? null,
    pr,
    prError: null,
    // What the person decided: the 8 Plan items of the billing task, the 5 items of your review, 2 of them fixes.
    decided: { planItems: task.id === DEMO_TASK_ID ? 8 : 4, answered: 5, fixes: 2 },
    // The same total the header and the cost panel show: the task's own, as the server reads it.
    cost: {
      usd: demoCost(task.id, task.stage).total.usd,
      minutes: Math.round(demoCost(task.id, task.stage).total.ms / MIN),
    },
  }
  // Without a pull request the change is approved and waits for its merge; with one, its card holds the story.
  task.landing = demoLanding(task)
  return pr
}
