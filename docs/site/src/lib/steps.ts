/**
 * The workflow as the home page tells it: the three steps under the hero, and the same three plus
 * the pull request in the tour. Each `id` is also the step's anchor and screenshot name.
 */

/** Who acts in a step, in the App's colours: amber when you decide, blue when agents work, violet when agents check. */
export type Who = "you" | "agent" | "check";
export type Step = { id: string; name: string; who: Who; approve: boolean; line: string; text: string; does: string[]; alt: string };

export const WHO: Record<Who, string> = { you: "You decide", agent: "Agents work", check: "Agents check" };

export const STEPS: Step[] = [
  { id: "plan", name: "Plan", who: "you", approve: true, line: "Agree on it before any code", text: "Your agent reads the code, asks what only you can answer and writes one Plan. You approve it once.", does: ["Questions, each with a recommended answer", "Done means, with the steps that prove each point", "Diagrams and clickable screens"], alt: "The Plan's limit question: keep serving or block requests, with facts and a diagram for the recommended choice, beside Claude Code's conversation" },
  { id: "implement", name: "Implement", who: "agent", approve: false, line: "Build it test first", text: "Your agent cuts the Plan into slices and task cards and builds them without a stop.", does: ["A failing test before each change", "Independent slices handed to other agents", "A question only you can answer never stops the build"], alt: "The billing build: slice 6 of 11 in progress with its task cards, finished slices marked done, beside the session writing the next failing test" },
  { id: "verify", name: "Verify", who: "check", approve: true, line: "Check it, then review it", text: "Agents that did not write the code check every point and fix what fails. Then the page is your review.", does: ["Project checks, security scans and an independent review", "Up to two fix rounds without you", "The code, the screens and each point as it ran"], alt: "Verification for the billing change: project checks, independent reviews, security scans and fix rounds" },
  { id: "pull-request", name: "Pull request", who: "agent", approve: false, line: "Follow it until it is merged", text: "Your agent handles failing checks and review comments. You control the merge.", does: [], alt: "Pull request #412: two review threads and a failing check, above the pull request's checks and reviews" },
];

/** The three steps of every change; the pull request follows them. */
export const WORKFLOW_STEPS = STEPS.slice(0, 3);

/** The step the tour opens on. */
export const FIRST_STEP = "plan";

/** The hero showcase plays one chapter per step; its caption after Approve is the pull request. */
export const STEP_OF_CHAPTER: Record<string, string> = { plan: "plan", implement: "implement", verify: "verify", "pull-request": "pull-request" };
