/**
 * Plans as sold today: the live Polar checkouts and their prices. These are the
 * values that charge customers, so a price change happens here and in Polar together.
 * Enterprise has no checkout: it is built with a company that asks for it.
 */
import { CONTACT_EMAIL } from "./product";

export const PRICE_CURRENCY = "EUR";

/** A table group's colour: the workflow part it belongs to (as the home page colours the steps), or plain for the rest. */
export type Hue = "plan" | "build" | "verify" | "review" | "plain";

export interface Plan {
  id: "solo" | "team" | "enterprise";
  name: string;
  audience: string;
  /** Full charge in euros for each billing period, per seat for Business. "Custom" for Enterprise. */
  price: { monthly: number; yearly: number } | "Custom";
  per: string;
  cta: string;
  /** The Polar checkout for each billing period; Enterprise has one mail link. */
  href: { monthly: string; yearly: string } | string;
  badge?: string;
  plus: string;
  /** Five short highlights per plan, most important first, each one line on the card; the table holds the detail. */
  highlights: [Hue, string][];
}

export const PLANS: Plan[] = [
  {
    id: "solo",
    name: "Individual",
    audience: "For one person.",
    price: { monthly: 19, yearly: 180 },
    per: "per month",
    cta: "Start Individual",
    href: {
      monthly: import.meta.env.VITE_POLAR_CHECKOUT_SOLO_MONTHLY || "https://buy.polar.sh/polar_cl_7qzxxKiqZXIFe3Uabodh7IauA937iVROT5qVW4VyuUf",
      yearly: import.meta.env.VITE_POLAR_CHECKOUT_SOLO_YEARLY || "https://buy.polar.sh/polar_cl_9krLYPvWYMBAXX4nL4LolXKgB5cAEA7J57H8Y3j0oQY",
    },
    plus: "The complete local product:",
    highlights: [
      ["plan", "Plan, build, verify and review"],
      ["verify", "Security scans and reviews"],
      ["build", "Bring your own coding agent"],
      ["review", "Stays on your computer"],
      ["plain", "Unlimited tasks and repos"],
    ],
  },
  {
    id: "team",
    name: "Business",
    audience: "For centralized purchasing.",
    price: { monthly: 29, yearly: 276 },
    per: "per seat / month",
    cta: "Start Business",
    href: {
      monthly: import.meta.env.VITE_POLAR_CHECKOUT_TEAM_MONTHLY || "https://buy.polar.sh/polar_cl_Qeegkxuq603Ai4UAWSTCT7rOqLmKACxgmKbw40AAj5b",
      yearly: import.meta.env.VITE_POLAR_CHECKOUT_TEAM_YEARLY || "https://buy.polar.sh/polar_cl_vDV57vWuG7nb2SCgK9RZUzunpOJo9pfjCELnc1PxhTh",
    },
    plus: "The same product, plus:",
    highlights: [
      ["plan", "Seats and billing in one place"],
      ["build", "Assign and reassign licences"],
      ["review", "Priority support"],
      ["verify", "Priority feature requests"],
      ["plain", "Complete local product per person"],
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    audience: "For negotiated purchasing and support.",
    price: "Custom",
    per: "volume pricing",
    cta: "Contact us",
    href: `mailto:${CONTACT_EMAIL}?subject=QualityLayer%20Enterprise`,
    plus: "Everything in Business, plus:",
    highlights: [
      ["plan", "Volume pricing for many seats"],
      ["build", "Onboarding for your developers"],
      ["verify", "Negotiated support terms"],
      ["review", "Invoicing and custom terms"],
      ["plain", "Business benefits included"],
    ],
  },
];

export const formatPrice = (amount: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: PRICE_CURRENCY, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);

/** A cell: included or not included. */
export type Cell = boolean;
export type CompareRow = { feature: string; solo: Cell; team: Cell; enterprise: Cell; note?: string };
export type CompareGroup = { name: string; hue: Hue; rows: CompareRow[] };

const row = (feature: string, solo: Cell, team: Cell, enterprise: Cell, note?: string): CompareRow => ({
  feature,
  solo,
  team,
  enterprise,
  note,
});

/**
 * The complete local product, Business purchasing and support, then Enterprise arrangements. Every feature in detail lives in the docs (Max, 2 November 2026).
 * Public copy never counts the supported agents; the number changes as agents are added.
 */

export const COMPARE: CompareGroup[] = [
  {
    name: "The complete local product",
    hue: "build",
    rows: [
      row("The whole workflow", true, true, true, "Seven steps, with your approval of the Plan and of the final Review"),
      row("Tasks, Chat and Artifacts", true, true, true, "Use your supported coding agents with your own subscriptions or API accounts"),
      row("Checks and independent review", true, true, true, "Tests, security scans and an agent that did not write the code"),
      row("Local work and personal remote access", true, true, true, "Keep work on your computers; reach your own machines through SSH or a paired browser"),
      row("Unlimited tasks and repositories", true, true, true),
    ],
  },
  {
    name: "Purchasing and support",
    hue: "verify",
    rows: [
      row("Centralized seats and billing", false, true, true),
      row("Licence assignment and reassignment", false, true, true),
      row("Priority support", false, true, true),
      row("Priority feature requests", false, true, true, "Earlier consideration during planning; delivery is agreed separately"),
    ],
  },
  {
    name: "Negotiated arrangements",
    hue: "plain",
    rows: [
      row("Volume pricing", false, false, true),
      row("Invoicing arrangements", false, false, true),
      row("Onboarding", false, false, true),
      row("Negotiated purchasing and support terms", false, false, true),
    ],
  },
];
