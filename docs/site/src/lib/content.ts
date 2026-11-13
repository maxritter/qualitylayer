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

const LOCAL_WORK = faq(
  "Where do my code and plans live?",
  "QualityLayer keeps plans as Markdown files in your project and doesn’t host your code or project work. Your coding agent sends context to its provider under your own account and settings.",
);
const PLANS_DIFFER = faq(
  "What do Business and Enterprise add?",
  "Every plan includes the complete local product. Business adds centralized seats and billing, licence assignment and reassignment, priority support and earlier consideration of feature requests, with no delivery promise. Enterprise adds volume pricing, onboarding, invoicing and negotiated purchasing and support terms.",
);
const SOURCE = faq(
  "Can I read the source?",
  "Yes. The public code is available for inspection and contributions under the QualityLayer licence. Licensing and billing internals remain private.",
);
const LEGACY = faq(
  "I use Pilot Shell 11. What happens?",
  "Pilot Shell can stay installed. Existing paid plan terms and trial dates are preserved. In Settings › Memory, review and import saved lessons from your Pilot memory folder, SQLite database, backup or exported files.",
);

export const FAQS: Faq[] = [
  faq("Can I use my existing agents and subscriptions?", "Yes. Use your coding agent's existing login or API key. QualityLayer does not add an AI usage bill."),
  faq("How is this different from plan mode?", "QualityLayer adds visual planning, implementation checks and optional independent review. You approve the Plan before building and the finished change after checking."),
  LOCAL_WORK,
  faq("What about small changes and bugs?", "Use Chat for free-form work, and turn it into a task when it needs a plan. Feature and Bugfix tasks follow Plan, Implement and Verify, with your two approvals."),
  faq("Can I work in the App or my own agent?", "Both. Run your agent beside your task in the App or browser, or use QualityLayer from your own terminal, IDE or agent app."),
  faq("Can I use my own remote computer?", "Yes. Connect a computer you control through Settings › Machines, SSH or a paired browser. Your work stays on that machine."),
  SOURCE,
];

export const PRICING_FAQS: Faq[] = [
  faq("How long is the trial?", "Seven days from your first run, once per computer, with the complete local product. Choose a plan to continue afterwards. Existing trial dates do not restart."),
  faq("Monthly or yearly?", `Monthly is the default and you can cancel any time. Billed yearly, you save ${individual.saving} a month on Individual and ${business.saving} per seat a month on Business. Checkout shows the yearly total before you pay.`),
  faq("Do I pay for AI usage here?", "No. Your coding agents use your own subscriptions or API accounts. QualityLayer charges only for itself."),
  faq("Who needs a licence, and what are the limits?", "Each person using QualityLayer needs an assigned licence. Every plan includes unlimited tasks, repositories and supported agents; each licence key works on 5 computers."),
  PLANS_DIFFER,
  faq("Can I work offline?", "QualityLayer works for up to seven days offline after a successful licence check. Your coding agent may still need an internet connection. An expired trial or subscription does not grant a perpetual licence."),
  LOCAL_WORK,
  LEGACY,
];
