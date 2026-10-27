/**
 * The workflow as the home page tells it: the seven steps under the hero, and the same seven
 * plus the pull request in the tour. Each `id` is also the step's anchor and screenshot name.
 */

/** Who acts in a step, in the App's colours: amber when you decide, blue when agents work, violet when agents check. */
export type Who = "you" | "agent" | "check";
export type Step = { id: string; name: string; who: Who; line: string; text: string; alt: string };

export const WHO: Record<Who, string> = { you: "You decide", agent: "Agents work", check: "Agents check" };

export const STEPS: Step[] = [
  { id: "discuss", name: "Discuss", who: "you", line: "Settle what you want", text: "Your agent asks only questions that change the result, each with a recommendation. Answer in any order.", alt: "Discuss for usage-based billing: whether the 400 seat customers move to usage or stay on seats, with three choices and a recommendation, beside Claude Code's session" },
  { id: "research", name: "Research", who: "agent", line: "Read the code first", text: "Agents trace how the code works today and what can be reused.", alt: "Research for usage-based billing: how a request is counted, invoiced and retried today, what the goal puts at risk and the findings, beside the Claude Code session" },
  { id: "plan", name: "Plan", who: "you", line: "Approve it before any code", text: "Read the plan with its diagrams and artifacts. Comment on any part, then approve it.", alt: "The Plan's one open decision as a visual billing architecture: keep serving and bill the overage, or block requests at the limit, beside Claude Code's messages in QualityLayer's Conversation view" },
  { id: "outline", name: "Outline", who: "agent", line: "Split it into tasks", text: "Your agent splits the plan into tasks, each with a scenario that proves it works.", alt: "Usage-based billing split into eleven slices in waves, two marked risky, as the build session writes the Outline" },
  { id: "implement", name: "Implement", who: "agent", line: "Build it test first", text: "One agent session builds the slices in order, each task test first, and fixes what fails. Each finished turn of the conversation folds into one line with the files it changed.", alt: "The billing build: slice 6 of 11 in progress with its task cards, finished slices marked done, beside the session writing the next failing test" },
  { id: "verify", name: "Verify", who: "check", line: "Check every point on the running program", text: "An agent that did not write the code adds missing tests and checks every point of the plan. A change that crosses a trust boundary gets a security review, and a risky one a second opinion.", alt: "Verification for the billing change: security review, project checks, an independent review, a second opinion and fix rounds, with the one point only you can confirm" },
  { id: "review", name: "Review", who: "you", line: "Read the change and its proof", text: "Read the change and its checks in the Review workspace, and open any file in your editor. Approve, or ask for changes.", alt: "Review of the billing change: the first of seven decisions, a screenshot of the built billing-mode screen with Looks right and Change" },
  { id: "pull-request", name: "Pull request", who: "agent", line: "Follow it until it is merged", text: "QualityLayer watches the pull request until it merges. A failing check, a review asking for changes or a conflict appears in Needs you and wakes your agent. It fixes routine requests itself and asks you about changes of scope or design.", alt: "Pull request #412: two review threads and a failing check wait on you, above the pull request's checks and reviews" },
];

/** The seven steps of every change; the pull request follows them. */
export const WORKFLOW_STEPS = STEPS.slice(0, 7);

/** The step the tour opens on. */
export const FIRST_STEP = "plan";
