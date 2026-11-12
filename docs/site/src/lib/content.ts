import { PLANS, formatPrice } from "./pricing";

export type Faq = { question: string; answer: string };
const faq = (question: string, answer: string): Faq => ({ question, answer });
const priced = (id: "solo" | "team") => {
  const price = PLANS.find((plan) => plan.id === id)?.price;
  if (price === undefined || price === "Custom") throw new Error(`${id} has no price`);
  return { saving: formatPrice(price.monthly - price.yearly / 12) };
};
const individual = priced("solo");
const business = priced("team");

const CODE_LEAVES = faq(
  "Does my code leave my computer?",
  "Your chosen coding agent sends context to its provider under your account and data settings. QualityLayer keeps tasks, Chats, artifacts, memories and terminal history on machines you control. Licence checks, trials, billing, updates and reports you choose to send use their separate services. Check support attachments before sending them. Project files and optional memory exports become readable to people with repository access when you commit and push them.",
);
const PLANS_DIFFER = faq(
  "What do Business and Enterprise add?",
  "Every plan includes the same complete local Tasks, Chat and Artifacts product. Business adds centralized seats and billing, licence assignment and reassignment, priority support and priority feature requests. Enterprise includes Business plus volume pricing, onboarding, invoicing arrangements and negotiated purchasing and support terms. Priority feature requests receive earlier consideration, without a promised delivery date. These plans do not add hosted collaboration, a team backend or SSO.",
);
const SOURCE = faq(
  "Is QualityLayer open source?",
  "QualityLayer is paid commercial software. The source-available offering permits inspection and contributions to QualityLayer itself, including contribution forks and focused public-component checks. It does not grant reuse in another product or distribution of a standalone app. The public checkout intentionally excludes private licensing, backend and complete-build tooling. Only Max Ritter produces complete official builds. Source publication is prepared separately from this release; the published licence and contribution guide define the permissions when available.",
);
const MEMORY = faq(
  "Can I keep project memories in Git?",
  "Yes, with explicit opt-in for each project. The local store stays authoritative; export writes eligible project lessons for you to review and commit. Anyone with repository access can read them. Personal lessons, credentials and private session data stay outside the export. Repository import is explicit; search and startup do not import, and QualityLayer never pushes or pulls for memory. Retirement and replacement records travel with exports. Conflicting edits keep both versions until you reconcile them. Restoring a retired local lesson is a separate action from importing repository records.",
);
const LEGACY = faq(
  "I use Pilot Shell 11. What happens?",
  "You can use Pilot Shell 11 and QualityLayer in parallel. QualityLayer leaves Pilot Shell, its tools and its configuration in place. Your paid subscription keeps its existing price while it stays active. Existing currencies, seats, benefits, keys, activations and already granted contractual rights are preserved. If it ends, a new subscription uses current prices. A computer eligible for its first QualityLayer trial can try it for seven days; an upgrade does not reset earlier trial dates. Import your Pilot memories per project in Settings › Memory; they stay private unless a later explicit action makes them eligible for export.",
);

export const FAQS: Faq[] = [
  faq("Can I use the models and subscriptions I already have?", "Yes. Use your supported agent's existing login or API key. QualityLayer does not add an AI usage bill."),
  faq("How is this different from plan mode?", "QualityLayer adds visual planning, tested implementation and optional independent review. You approve the Plan before building and the finished change after checking."),
  CODE_LEAVES,
  faq("What about small changes and bugs?", "Use Chat with a supported agent for free-form work, and convert it to a task when it needs a plan. Feature and Bugfix tasks follow Plan, Implement and Verify, with your two approvals."),
  faq("Can I run my agent in the App or browser?", "Yes. Your task and agent run side by side. Conversation, Terminal and Files keep the session and its work together. Mark text, code or an artifact spot, write quick feedback and send it to your current agent. Agents without Conversation input keep an explicit terminal handoff."),
  PLANS_DIFFER,
  faq("Can I use my own remote computer?", "Yes. Connect a machine you control through Settings › Machines, SSH or a paired browser. Its local server authenticates access to your own work; this does not create a hosted workspace or teammate account."),
  MEMORY,
  SOURCE,
  faq("Is it for product managers as well as engineers?", "Yes. Each Plan opens with what users get, and a request for a PRD gets one with a success measure and a first release."),
  faq("Can I see how much of my plan is left?", "Claude Code, Codex and GitHub Copilot show the limits they report, with reset times when available. Stopped builds can resume when their limit resets."),
  LEGACY,
];

export const PRICING_FAQS: Faq[] = [
  faq("How long is the trial?", "Seven days from your first run, once per computer, with the complete local product. After the trial, choose a plan to continue. The migration preserves original trial dates; it does not restart existing trials."),
  faq("Monthly or yearly?", `Monthly is the default and you can cancel any time. Billed yearly, you save ${individual.saving} a month on Individual and ${business.saving} per seat a month on Business. Checkout shows the yearly total before you pay.`),
  faq("Do I pay for AI usage here?", "No. Your coding agents use your own subscriptions or API accounts. QualityLayer charges only for itself."),
  faq("Is there a limit on tasks or repositories?", "No. Each plan licenses its assigned person, with unlimited tasks, repositories and supported agents. Each licence key works on 5 computers."),
  faq("Which agents does it work with?", "Use your own subscriptions or API keys. Claude Code, Codex, Cursor, Grok, Antigravity, Pi, OpenCode and GitHub Copilot have setup, model choices and interactive sessions in the App or browser. Conversation features follow each agent's native integration; an explicit terminal handoff remains available. The CLI connects other agents that run shell commands in your terminal or IDE."),
  faq("Who needs a seat?", "Each person using QualityLayer needs an assigned licence. Business centralizes purchasing and seat assignment; it does not give people access to each other's tasks or artifacts."),
  PLANS_DIFFER,
  faq("Can I work offline?", "After a successful licence check, QualityLayer keeps its existing allowance of up to seven days offline. Your agent may still need its provider's connection. An expired trial or subscription does not create a perpetual licence."),
  CODE_LEAVES,
  SOURCE,
  LEGACY,
];
