/**
 * The workflow as the home page tells it: the seven steps under the hero, and the same seven
 * plus the pull request in the tour. Each `id` is also the step's anchor and screenshot name.
 */

/** Who acts in a step, in the App's colours: amber when you decide, blue when agents work, violet when agents check. */
export type Who = "you" | "agent" | "check";
export type Step = { id: string; name: string; who: Who; line: string; text: string; alt: string };

export const WHO: Record<Who, string> = { you: "You decide", agent: "Agents work", check: "Agents check" };

export const STEPS: Step[] = [
  { id: "discuss", name: "Discuss", who: "you", line: "Settle what you want", text: "Settle the open questions with your agent.", alt: "Discuss for usage-based billing: whether the 400 seat customers move to usage or stay on seats, with three choices and a recommendation, beside Claude Code's session" },
  { id: "research", name: "Research", who: "agent", line: "Read the code first", text: "Agents trace how the code works today and what can be reused.", alt: "Research for usage-based billing: how a request is counted, invoiced and retried today, what the goal puts at risk and the findings, beside the Claude Code session" },
  { id: "plan", name: "Plan", who: "you", line: "Approve it before any code", text: "Review diagrams and clickable designs, then approve the plan.", alt: "The Plan's one open decision as a visual billing architecture: keep serving and bill the overage, or block requests at the limit, beside Claude Code's messages in QualityLayer's Conversation view" },
  { id: "outline", name: "Outline", who: "agent", line: "Split it into tasks", text: "Your agent breaks the plan into small, testable tasks.", alt: "Usage-based billing split into eleven slices in waves, two marked risky, as the build session writes the Outline" },
  { id: "implement", name: "Implement", who: "agent", line: "Build it test first", text: "Your lead builds test first and delegates independent work when useful.", alt: "The billing build: slice 6 of 11 in progress with its task cards, finished slices marked done, beside the session writing the next failing test" },
  { id: "verify", name: "Verify", who: "check", line: "Check the running change", text: "Run project checks and independent review. Your agent fixes the findings.", alt: "Verification for the billing change: security review, project checks, an independent review, a second opinion and fix rounds, with the one point only you can confirm" },
  { id: "review", name: "Review", who: "you", line: "Read the change and its proof", text: "Review the code and checks, request changes or approve.", alt: "Review of the billing change: code, screens and checks, with one final approval in the page header" },
  { id: "pull-request", name: "Pull request", who: "agent", line: "Follow it until it is merged", text: "Your agent handles failing checks and review comments. You control the merge.", alt: "Pull request #412: two review threads and a failing check wait on you, above the pull request's checks and reviews" },
];

/** The seven steps of every change; the pull request follows them. */
export const WORKFLOW_STEPS = STEPS.slice(0, 7);

/** The step the tour opens on. */
export const FIRST_STEP = "discuss";
