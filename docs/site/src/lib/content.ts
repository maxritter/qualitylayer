/**
 * The website's questions and answers. Each answer must hold for the product as it
 * ships; when the product changes, change it here. Plain text only: the home page's
 * structured data reuses these answers. Words follow the App's glossary: Your turn, passed,
 * Checked by agents, Found while checking, Only you can confirm, Questions for you.
 */

import { PLANS, formatPrice } from "./pricing";

export type Faq = { question: string; answer: string };

const faq = (question: string, answer: string): Faq => ({ question, answer });

/** Monthly and yearly prices of a plan, read from the plans themselves so the answer below never drifts. */
const priced = (id: "solo" | "team") => {
  const price = PLANS.find((p) => p.id === id)?.price;
  if (price === undefined || price === "Custom") throw new Error(`${id} has no price`);
  return { monthly: formatPrice(price.monthly), yearly: formatPrice(price.yearly / 12), year: formatPrice(price.yearly) };
};
const solo = priced("solo");
const team = priced("team");

/** Asked on the home page and on pricing, answered the same way on both. */
const CODE_LEAVES = faq(
  "Does my code leave my computer?",
  "Your coding agent sends code to its provider under your existing data settings, as it does today. QualityLayer keeps your code, plans, artifacts and agent output on your computer. Sharing encrypts tasks, documents and comments on your computer first: we can't read them, and see only who shared which task, when and at which step. Artifacts go along only if you include them; terminal output and the repository's code never do. Code your team reviews travels through your own Git remote; we store only the team's encrypted comments, the short lines of code they quote and the commits they point to. With Slack connected, task titles and questions pass through our server to Slack. A screenshot you attach to a feedback report can show code, so check it first.",
);

/** Ordered by what a visitor asks first: cost, the difference, privacy, then how they would use it. */
export const FAQS: Faq[] = [
  faq(
    "Can I use the models and subscriptions I already have?",
    "Yes. Claude Code, Codex, Cursor, Grok, Antigravity, Pi and OpenCode run on the login or API key you already have, with the models your plan offers. QualityLayer charges only for itself, never for AI usage. The App shows each step's estimated cost, and Settings › Usage adds up the last 7 or 30 days, or this month.",
  ),
  faq(
    "How is this different from plan mode?",
    "Plan mode gives you a plan in the chat, then one long build that you check yourself. With QualityLayer, your agent asks only about unresolved choices; independent questions arrive together, and each answer reaches it immediately. Then it shows one plan with diagrams and clickable mockups, which you comment on and approve before any code is written. It builds the plan in tested slices and fixes what fails itself. An agent that did not write the code checks it against what you agreed, and you approve the finished change with its evidence.",
  ),
  CODE_LEAVES,
  faq(
    "What about small changes and bugs?",
    "Use Chat with Claude Code or Codex to explore a question or work freely. Choose Feature or Bugfix for a Plan and review. Small changes keep a short Plan and one build step. Larger work gets more design detail; bugs start with reproduction. You approve before code and before shipping.",
  ),
  faq(
    "Can I run my agent in the App or browser?",
    "Yes. Start Claude Code, Codex, Cursor, Grok, Antigravity, Pi or OpenCode when you create a task, or from the Agent tab at any step. Your task stays on the left and the agent works on the right, in the desktop App or in your browser. Your own terminal, VS Code and other IDEs still work.",
  ),
  faq(
    "Can I use it on my own, or only with a team?",
    "On your own: one developer runs all seven steps. The Team plan adds sharing plans for feedback, asking teammates through Slack and reviewing a change together.",
  ),
  faq(
    "Is it for product managers as well as engineers?",
    "Yes. Choose Product or Engineering at Setup or in Settings › Workflow. Product starts with a brief: the problem, how success is measured, the first release and what the user sees, which you can copy as a PRD; the engineering detail stays folded away. Engineering starts with the full technical plan. The task header switches the level for one task.",
  ),
  faq(
    "Can I see how much of my plan is left?",
    "For Claude Code and Codex, yes. The sidebar shows the window with the least left, the conversation footer marks one that runs low, and Settings › Usage lists every window with its reset time. The other agents report no limits, and the App says so. A build that stops on a limit continues by itself when the window resets, unless you turn that off.",
  ),
  faq(
    "I use Pilot Shell today. What happens?",
    "Keep using Pilot Shell 11 for as long as you want, including alongside QualityLayer. Setup leaves Pilot Shell and its tools in place. Your paid licence carries over; import memories per project in Settings → Memory.",
  ),
];

export const PRICING_FAQS: Faq[] = [
  faq(
    "How long is the trial?",
    "Seven days from your first run, with everything in Solo. Sharing with a team needs the Team plan. After the trial, choose a plan to continue.",
  ),
  faq(
    "Monthly or yearly?",
    `Solo costs ${solo.year} a year, equivalent to ${solo.yearly} a month, instead of ${solo.monthly} billed monthly. Team costs ${team.year} per seat a year, equivalent to ${team.yearly} per seat a month, instead of ${team.monthly} billed monthly.`,
  ),
  faq(
    "Do I pay for AI usage here?",
    "No. Your coding agents use your own subscriptions or API accounts. QualityLayer charges only for itself.",
  ),
  faq(
    "Is there a limit on tasks or repositories?",
    "No. Each plan is per developer, with unlimited tasks, repositories and agents.",
  ),
  faq(
    "Which agents does it work with?",
    "Claude Code, Codex, Cursor, Grok, Antigravity, Pi and OpenCode have native setup, model choices and interactive sessions in the App or browser. Choose any installed agent for a separate review. The CLI connects other agents that run shell commands, including in your own terminal, VS Code or another IDE.",
  ),
  faq(
    "Who needs a seat?",
    "Everyone on your team who uses QualityLayer. Outside people you invite to comment through a link do not.",
  ),
  CODE_LEAVES,
  faq(
    "What does Enterprise include?",
    "For companies with 20 developers or more. It can include hosting in your own cloud or on-premise, volume pricing, single sign-on, invoicing and custom terms. Write to us and we scope it together.",
  ),
  faq(
    "I use Pilot Shell 11. What happens?",
    "You can use Pilot Shell 11 and QualityLayer in parallel. QualityLayer leaves Pilot Shell, its tools and its configuration in place. Your paid subscription keeps its existing price while it stays active. If it ends, a new subscription uses current prices. Without an active licence, you get a fresh seven-day trial. Import memories per project in Settings → Memory.",
  ),
];
