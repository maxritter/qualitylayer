import { docBlocks, markerKey } from "../../../core/docs/markers.ts"
import type { TaskDetail } from "../../api.ts"
import { DEMO_TASK_ID } from "../identity.ts"

export const PLAN_LONG_ANSWER = `${"Keep the original qualification and every selected option. ".repeat(120).trim()}

  - Preserve the first authored list item.
  - Preserve the second authored list item and its qualification.

Original ending retained exactly.`

/** A review panel in its second round, as QualityLayer writes the Plan's Reviews text. */
export const PLAN_PANEL_ROUND =
  "**Review panel · Codex, Grok, Pi** · round 2 of 2, answering each other's findings."

/** A review panel's folded-in result: who backs each finding, then the planner's answer. */
export const PLAN_PANEL_FINDINGS = [
  "**Review panel · Codex, Grok, Pi** · asked for 4 changes · 4 findings: 2 taken, 1 kept, 1 asked of you.",
  "- The acceptance test passes when the second reviewer never starts. · Panel: all · Codex, Grok, Pi · Taken: step 2 now counts the reviewers that started",
  "- The cost row drops a reviewer when two start in the same millisecond. · Panel: all · Codex, Grok, Pi · Asked of you: keep one cost row per reviewer, or one for the panel?",
  "- The second round should have a shorter time limit than the first. · Panel: split · Codex · Grok disagrees: a large Plan needs the time · Kept: one limit for both rounds is simpler to explain",
  "- Settings never says what a panel costs. · Panel: one · Pi, second round · Taken: the hint names two runs per reviewer",
].join("\n")

/** The task with the text between one of the Plan's `ql:` markers replaced, parsed again as the server would. */
function withPlanMarker(task: TaskDetail, name: string, text: string): TaskDetail {
  return {
    ...task,
    pages: task.pages?.map((page) => {
      if (page.step !== "plan") return page
      const body = page.body.replace(
        new RegExp(`<!-- ql:${name} -->[\\s\\S]*?<!-- /ql:${name} -->`),
        () => `<!-- ql:${name} -->\n${text}\n<!-- /ql:${name} -->`,
      )
      const parsed = docBlocks(body)
      return {
        ...page,
        body,
        blocks: parsed.blocks,
        markers: parsed.markers.map((marker) => ({
          ...marker,
          key: markerKey(marker),
          edited: false,
        })),
        problems: parsed.problems,
      }
    }),
  }
}

/** Explicit source-preview fixtures; ordinary moments and the person's tasks are untouched. */
export function demoPlanEntry(task: TaskDetail): TaskDetail {
  const fixture = new URLSearchParams(globalThis.location?.search ?? "").get("plan-entry")
  if (task.id !== DEMO_TASK_ID || task.stage !== "plan" || !task.gate || !fixture) return task
  if (fixture === "long-answer")
    return withPlanMarker(
      task,
      "decided-by-you",
      `- Plan · Which behavior must stay? — ${PLAN_LONG_ANSWER}`,
    )
  // A review panel: its second round running, or its findings folded in. The demo itself keeps
  // one reviewer; these two previews exist for the model and the tests.
  const panel = fixture === "panel-round" || fixture === "panel-findings"
  if (!panel && !["reviewing", "findings", "failed"].includes(fixture)) return task
  const running = fixture === "reviewing" || fixture === "panel-round"
  const state = running ? "running" : fixture === "failed" ? "failed" : "done"
  const shown = panel
    ? withPlanMarker(task, "reviews", running ? PLAN_PANEL_ROUND : PLAN_PANEL_FINDINGS)
    : task
  return {
    ...shown,
    action: null,
    gate: {
      ...task.gate,
      locked: panel
        ? running
          ? "Approve unlocks when the panel's review is in (round 2 of 2, running 4:12)"
          : "Approve unlocks when the agent has read the panel's review and opened the gate again"
        : fixture === "reviewing"
          ? "The Codex Plan review is running."
          : fixture === "findings"
            ? "The planner must address the Codex review findings."
            : "The Codex Plan review could not finish.",
    },
    helpers: [
      ...task.helpers.filter((helper) => helper.id !== "review-plan"),
      {
        id: "review-plan",
        kind: "review",
        label: panel ? "Panel review · Codex, Grok, Pi" : "Codex review",
        state,
        line: running
          ? panel
            ? "Answering each other's findings"
            : "Reading the Plan"
          : "Review result recorded",
        at: Date.now(),
        started: Date.now() - (panel ? 252_000 : 40_000),
        findings: fixture === "findings" ? 2 : fixture === "panel-findings" ? 4 : null,
      },
    ],
  }
}
