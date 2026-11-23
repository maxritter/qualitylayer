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

type ReviewFixture = "panel-round" | "panel-findings" | "reviewing" | "findings" | "failed"

type ReviewFixtureSpec = {
  panel: boolean
  running: boolean
  state: "running" | "done" | "failed"
  locked: string
  line: string
  findings: number | null
}

const REVIEW_FIXTURES: Record<ReviewFixture, ReviewFixtureSpec> = {
  "panel-round": {
    panel: true,
    running: true,
    state: "running",
    locked: "Approve unlocks when the panel's review is in (round 2 of 2, running 4:12)",
    line: "Answering each other's findings",
    findings: null,
  },
  "panel-findings": {
    panel: true,
    running: false,
    state: "done",
    locked: "Approve unlocks when the agent has read the panel's review and opened the gate again",
    line: "Review result recorded",
    findings: 4,
  },
  reviewing: {
    panel: false,
    running: true,
    state: "running",
    locked: "The Codex Plan review is running.",
    line: "Reading the Plan",
    findings: null,
  },
  findings: {
    panel: false,
    running: false,
    state: "done",
    locked: "The planner must address the Codex review findings.",
    line: "Review result recorded",
    findings: 2,
  },
  failed: {
    panel: false,
    running: false,
    state: "failed",
    locked: "The Codex Plan review could not finish.",
    line: "Review result recorded",
    findings: null,
  },
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
  const spec = REVIEW_FIXTURES[fixture as ReviewFixture]
  if (spec === undefined) return task
  const shown = spec.panel
    ? withPlanMarker(task, "reviews", spec.running ? PLAN_PANEL_ROUND : PLAN_PANEL_FINDINGS)
    : task
  return {
    ...shown,
    action: null,
    gate: { ...task.gate, locked: spec.locked },
    helpers: [
      ...task.helpers.filter((helper) => helper.id !== "review-plan"),
      {
        id: "review-plan",
        kind: "review",
        label: spec.panel ? "Panel review · Codex, Grok, Pi" : "Codex review",
        state: spec.state,
        line: spec.line,
        at: Date.now(),
        started: Date.now() - (spec.panel ? 252_000 : 40_000),
        findings: spec.findings,
      },
    ],
  }
}
