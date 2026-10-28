import { VERIFY_CHECKS } from "@/lib/tour";

/**
 * What each chapter's text says, as the words its close-up must show. The close-up opens on a
 * moment that already shows the claim, so a reader who stops on the text sees it at once, and no
 * later moment takes it away.
 * - always: shown at every moment, first to last.
 * - first: shown when the chapter opens.
 * - last: shown once the close-up has finished playing.
 */
export type Claim = { always: (string | RegExp)[]; first?: (string | RegExp)[]; last?: (string | RegExp)[] };

export const CLAIMS: Record<string, Claim> = {
  // "Your agent asks one batch until the goal is clear": the batch's strip, one question in focus, its choices
  discuss: {
    always: [/a batch of 4 from Claude Code/, /Scope and what Done means 1 2 3 4/, /question \d of 4/, "recommended", "Or write your own answer"],
    first: ["question 1 of 4", "Your turn · 4 questions"],
    last: ["Sent to Claude Code", "Your turn · 2 questions"],
  },
  // "Agents read the code before anything is designed", then one more batch when real choices are left
  research: {
    always: ["The questions", "never see your request", "Reading the code, without your request"],
    first: ["3 agents reading the code", "reading the code"],
    last: ["A choice the code leaves open", "From Research"],
  },
  // "You approve one plan before any code": the complete Plan, with its diagram, contracts and outcomes, approved from its header
  plan: {
    always: ["Count each request once and bill it", "Done means", "How a request is counted", "Contracts", "Reviewed by", "Ready to approve", "Give feedback", "Approve Plan"],
    last: ["1 comment"],
  },
  // "The build session cuts the Plan into slices": the slices in build order, the scenario for each point, nothing to approve
  outline: {
    always: ["in build order", "Slices", "How each point is proved", "scenario 3"],
    last: ["Every Done means point has a scenario"],
  },
  // "One command starts the build": lead and subagent defaults beside the command.
  start: {
    always: ["Lead", "Subagent default", "Effort", "Using QualityLayer, implement the approved plan for task usage-billing"],
    first: ["Copy"],
    last: ["Copied"],
  },
  // "It is built in slices, on its own": one session, in order, test first
  implement: {
    always: ["The slices are built in the Outline’s order", "Every task starts with a failing test", "tasks committed"],
    first: ["building slice 2", "2 of 5 tasks committed", "the test fails first"],
    last: ["5 of 5 tasks committed", "Checked by agents", "Ask why"],
  },
  // "An agent that did not write the code checks every point": the checks in order, each point with its evidence, the chip names what runs
  verify: {
    always: [...VERIFY_CHECKS, "each point against the running program"],
    first: ["running Independent review", "window.test.ts"],
    last: ["9 of 9 passed", "Your turn · 2 in Review"],
  },
  // Review opens the code, with complete supporting records in three folds and one final approval.
  review: {
    always: ["The change, top to bottom"],
    first: ["Review the code", "Approve and create PR", "Checks", "Screens", "Change details", "not verified", "services/gateway/src/meter.ts", "Does a retry with a new request id count twice?", "Built, slice by slice", "Decided while building", "Ask why"],
    last: ["Approved · pull request #412 opened", "The task stays open until the pull request is merged", "Pull request #412", "no review yet"],
  },
  // "Ask, and your agent draws the page": the request, and the page inside the Plan's question
  draw: {
    always: ["Mock up the billing mode page", "the artifact for this question", "Full size", "Looks right", "Change it"],
  },
  // "Open it full size and point at what to change"
  comment: {
    always: ["billing-mode · full size", "Comment", "Switch to usage"],
    first: ["Click a spot on the artifact"],
    last: ["Changed the page: the last switch shows beside the button"],
  },
  // "Ask a teammate about any part of the plan": the passage, who to ask, the Slack message
  ask: {
    always: ["03-plan.md", "the overage is billed"],
    first: ["Ask the team about this passage", "Anna", "Ask Anna"],
    last: ["Slack message sent", "via Claude Code"],
  },
  // "Teammates see the questions for them first": the passage in view, a draft that is not sent
  answer: {
    always: ["Question from Ben Ortiz", "once per minute", "Looks right", "Suggest a change", "Reply", "Or hand it to someone else"],
    last: ["Draft by your Claude Code · not sent yet"],
  },
  // "See your team's work in one place": remind or hand on
  space: {
    always: ["Your questions to others", "Working now", "Team activity", "Remind", "Hand to…"],
    last: ["reminded just now"],
  },
  // "Review the finished change together": the proof, a teammate's comment, then approval
  together: {
    always: ["Done means 3", "Can Finance see the entry without opening the logs?", "screenshot 2"],
    first: ["Comment from Anna"],
    last: ["Ready to approve", "Ben approved"],
  },
  // "See how much of your plan is left, and what each step costs"
  settings: {
    always: ["Plan limits", "5 hours", "This week", "Resume when a limit resets", "$20.95", "estimated at list price"],
    last: ["the build continues when the window resets"],
  },
  // "It works where your agents already work": one command, the systems it runs on
  agents: {
    always: ["New task", "Claude Code", "Codex", "Cursor", "Grok", "Antigravity", "Pi", "OpenCode", "Another agent", "Using QualityLayer, plan", "macOS", "Windows", "Linux", "WSL"],
    last: ["Copied", "needs your review"],
  },
};

/** The claims in `wanted` that `text` does not show. */
export const missing = (text: string, wanted: (string | RegExp)[] = []) => wanted.filter((w) => (typeof w === "string" ? !text.includes(w) : !w.test(text)));
