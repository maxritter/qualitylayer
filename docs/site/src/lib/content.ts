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
  return { monthly: formatPrice(price.monthly), yearly: formatPrice(price.yearly / 12), saving: formatPrice(price.monthly - price.yearly / 12) };
};
const solo = priced("solo");
const team = priced("team");

/** Asked on the home page and on pricing, answered the same way on both. */
const CODE_LEAVES = faq(
  "Does my code leave my computer?",
  "Your agent sends code to its provider under your existing data settings. QualityLayer keeps code, plans, artifacts and agent output on your computer. Shared tasks, documents and comments are encrypted there: we can't read them, but see who shared which task, when and at which step. The selected Plan preview can accompany a share; Include artifacts adds other previews. Terminal output and repository code stay out. Your team reviews code through its own Git remote. We store encrypted review comments, short quoted code lines and their commit references. Slack and email notifications send task titles and questions through our server to Slack or our email provider. Check feedback screenshots before attaching them: they can contain code.",
);

/** Ordered by what a visitor asks first: cost, the difference, privacy, then how they would use it. */
export const FAQS: Faq[] = [
  faq(
    "Can I use the models and subscriptions I already have?",
    "Yes. Use your existing agent login or API key.",
  ),
  faq(
    "How is this different from plan mode?",
    "QualityLayer adds visual planning, tested implementation and optional independent review. You approve the plan before building and the finished change after checking.",
  ),
  CODE_LEAVES,
  faq(
    "What about small changes and bugs?",
    "Use Chat with Claude Code or Codex for free-form work, and convert it to a task when it needs a plan. Choose Feature or Bugfix to start with a plan, checks and final review.",
  ),
  faq(
    "Can I run my agent in the App or browser?",
    "Yes. Your task and agent run side by side in the App or browser, and the sidebar shows when an agent needs you. You can also use your own terminal or IDE.",
  ),
  faq(
    "Can I use it on my own, or only with a team?",
    "Both. The Team plan adds shared plans, questions over Slack or email and code review with teammates.",
  ),
  faq(
    "Is it for product managers as well as engineers?",
    "Yes. Choose Engineering for technical plans or Product for a product brief in Settings › Workflow.",
  ),
  faq(
    "Can I see how much of my plan is left?",
    "Claude Code, Codex and GitHub Copilot show the limits they report, with reset times when available. Stopped builds can resume when their limit resets.",
  ),
  faq(
    "I use Pilot Shell today. What happens?",
    "An active Pilot Shell licence works with both products. Import your Pilot memories in Settings › Memory. Older purchases may need help moving over.",
  ),
];

export const PRICING_FAQS: Faq[] = [
  faq(
    "How long is the trial?",
    "Seven days from your first run, with everything in Solo. Sharing with a team needs the Team plan. After the trial, choose a plan to continue.",
  ),
  faq(
    "Monthly or yearly?",
    `Monthly is the default and you can cancel any time. Billed yearly, you save ${solo.saving} a month on Solo and ${team.saving} per seat a month on Team. Checkout shows the yearly total before you pay.`,
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
    "Use your own subscriptions or API keys. Claude Code, Codex and other supported agents have setup, model choices and interactive sessions in the App or browser. Choose an installed agent for independent review. The CLI connects other agents that run shell commands in your terminal or IDE.",
  ),
  faq(
    "Who needs a seat?",
    "Everyone on your team who uses QualityLayer. Outside people you invite to comment through a link do not.",
  ),
  CODE_LEAVES,
  faq(
    "What does Enterprise include?",
    "Custom hosting in your cloud or on-premise, single sign-on, volume pricing, invoicing, custom terms and team onboarding. It's available to companies of any size; contact us to arrange it.",
  ),
  faq(
    "I use Pilot Shell 11. What happens?",
    "You can use Pilot Shell 11 and QualityLayer in parallel. QualityLayer leaves Pilot Shell, its tools and its configuration in place. Your paid subscription keeps its existing price while it stays active. If it ends, a new subscription uses current prices. Without an active licence, you get a fresh seven-day trial. Import your Pilot memories per project in Settings › Memory.",
  ),
];
