import { DEMO_TASK_ID } from "./identity.ts"
// The demo story's world (`?story`, docs/artifacts/demo-story.md): the same demo, with only what one
// person's QualityLayer holds on an ordinary day. Home shows what waits for them (the billing task
// and one change to review) and two agents at work, so both fit on one screen. The full demo keeps every task, as
// its checks and the App Model's pages need each of their states.

import type { ProjectLooks } from "../../core/project-look.ts"
import type { TaskDetail, TaskSummary } from "../api.ts"
import type { WalkthroughApi } from "../timeline/walkthrough-api.ts"
import { DEMO_LOOKS } from "./api.ts"
import { helperOf, liveReportOf, permissionSignals, signalsOf, todoOf } from "./live-rows.ts"

/** The tasks the story keeps: the billing task, one change to review, two running, one shipped. */
const STORY_TASKS = new Set([DEMO_TASK_ID, "export", "webhook", "tokens", "audit"])

export const storyWorldFrom = (search: string) => new URLSearchParams(search).has("story")

/** The story's project, acme/platform, comes first in the sidebar. */
export const STORY_LOOKS: ProjectLooks = {
  ...DEMO_LOOKS,
  order: ["platform", ...DEMO_LOOKS.order.filter((id) => id !== "platform")],
}

/**
 * QualityLayer answers fast: on the story's day nothing has waited for a day. The billing task started
 * about an hour ago (the full demo keeps its older ages for other states).
 */
const STARTED_AGO = 70 * 60_000
const fresh = <T extends { id: string; created?: number }>(task: T): T =>
  task.id === DEMO_TASK_ID ? { ...task, created: Date.now() - STARTED_AGO } : task

/**
 * The agents report as their hooks do, so their sidebar rows show what each does now, its own task list
 * and its helpers: Claude Code on the webhook retries with a helper, OpenCode on the tokens; and the
 * review's agent asks to open the pull request, which is an amber Needs you row.
 */
const AT_WORK: Record<string, (now: number) => NonNullable<TaskDetail["live"]>> = {
  webhook: (now) =>
    liveReportOf(
      signalsOf("claude-code", now, {
        tool: { at: now - 2_000, words: "Editing src/delivery/retry.ts" },
        agents: [helperOf("Explore", now)],
        todo: todoOf(
          [
            "Write the failing retry test",
            "Add the backoff schedule",
            "Sign each delivery attempt",
            "Record failed attempts in the audit trail",
            "Keep the provider's rate limit",
            "Run the full suite",
          ],
          3,
          now,
        ),
      }),
    ),
  export: (now) =>
    liveReportOf(permissionSignals("claude-code", now, "Running gh pr create --fill")),
  tokens: (now) =>
    liveReportOf(
      signalsOf("opencode", now, {
        tool: { at: now - 2_000, words: "Reading tokens/colors.json" },
        todo: todoOf(
          [
            "Export the colour tokens",
            "Check the swatch contrast",
            "Publish the package",
            "Update the usage notes",
          ],
          1,
          now,
        ),
      }),
    ),
}

/** A story task as it is read now: the agents report what their hooks would. */
const read = <T extends TaskSummary>(task: T, now = Date.now()): T => {
  const report = AT_WORK[task.id]?.(now)
  return fresh(report === undefined ? task : { ...task, live: report })
}

export function storyWorldApi(api: WalkthroughApi): WalkthroughApi {
  // `?before`: the day before the billing task was created, as New task starts it.
  const before =
    typeof location !== "undefined" && new URLSearchParams(location.search).has("before")
  // The demo's own tasks at load: the story keeps its five of them, and every task made since (New task).
  let seeded: Set<string> | undefined
  const kept = (id: string) =>
    seeded?.has(id) === true ? STORY_TASKS.has(id) && !(before && id === DEMO_TASK_ID) : true
  return {
    ...api,
    tasks: async () => {
      const all = await api.tasks()
      seeded ??= new Set(all.map((task) => task.id))
      const now = Date.now()
      return all.filter((task) => kept(task.id)).map((task) => read(task, now))
    },
    task: async (id) => read(await api.task(id)),
  }
}
