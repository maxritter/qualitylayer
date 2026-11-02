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
  /** Full charge in euros for each billing period, per seat for Team. "Custom" for Enterprise. */
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
    name: "Solo",
    audience: "For working on your own.",
    price: { monthly: 29, yearly: 288 },
    per: "per month",
    cta: "Start Solo",
    href: {
      monthly: import.meta.env.VITE_POLAR_CHECKOUT_SOLO_MONTHLY || "https://buy.polar.sh/polar_cl_7qzxxKiqZXIFe3Uabodh7IauA937iVROT5qVW4VyuUf",
      yearly: import.meta.env.VITE_POLAR_CHECKOUT_SOLO_YEARLY || "https://buy.polar.sh/polar_cl_9krLYPvWYMBAXX4nL4LolXKgB5cAEA7J57H8Y3j0oQY",
    },
    plus: "Everything for working alone:",
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
    name: "Team",
    audience: "For teams, per seat.",
    price: { monthly: 49, yearly: 468 },
    per: "per seat / month",
    cta: "Start Team",
    href: {
      monthly: import.meta.env.VITE_POLAR_CHECKOUT_TEAM_MONTHLY || "https://buy.polar.sh/polar_cl_Qeegkxuq603Ai4UAWSTCT7rOqLmKACxgmKbw40AAj5b",
      yearly: import.meta.env.VITE_POLAR_CHECKOUT_TEAM_YEARLY || "https://buy.polar.sh/polar_cl_vDV57vWuG7nb2SCgK9RZUzunpOJo9pfjCELnc1PxhTh",
    },
    plus: "Everything in Solo, plus:",
    highlights: [
      ["plan", "Share plans with your team"],
      ["build", "Team instructions and checks"],
      ["review", "Review the code as a team"],
      ["verify", "Slack and email questions"],
      ["plain", "Seats and billing in one place"],
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    audience: "For custom hosting and terms.",
    price: "Custom",
    per: "volume pricing",
    cta: "Contact us",
    href: `mailto:${CONTACT_EMAIL}?subject=QualityLayer%20Enterprise`,
    plus: "Everything in Team, plus:",
    highlights: [
      ["plan", "Self-host in your own cloud"],
      ["build", "Single sign-on for your team"],
      ["verify", "Volume pricing for many seats"],
      ["review", "Invoicing and custom terms"],
      ["plain", "Onboarding for your team"],
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
 * Three groups of five rows, most important first: what one developer gets, what Team adds,
 * what Enterprise adds. Every feature in detail lives in the docs (Max, 2 November 2026).
 * Public copy never counts the supported agents; the number changes as agents are added.
 */
/** What Team sharing reveals to us, shown under the comparison so the privacy terms stay on the page. */
export const TEAM_PRIVACY =
  "Team plans, comments and links are encrypted on your machine. We can’t read them. We see who shared, who was asked, which task, when and its step. The guest page’s code comes from us. With Slack or email on, task titles and questions pass through our server to Slack or our email provider. Pending notifications expire after 72 hours. Review code travels between your computer and your own Git remote. We store your team’s encrypted comments, the short lines of code they quote and the commits they point to.";

export const COMPARE: CompareGroup[] = [
  {
    name: "Working alone, on your computer",
    hue: "build",
    rows: [
      row("The whole workflow", true, true, true, "Seven steps, with your approval of the Plan and of the final Review"),
      row("Checked before you see it", true, true, true, "Tests first, security scans and a review by an agent that did not write the code"),
      row("Your agents, your subscriptions", true, true, true, "Claude Code, Codex and more, with no extra AI bill from us"),
      row("Your work stays on your computer", true, true, true, "Plans, artifacts and agent output stay local unless you share them"),
      row("Unlimited tasks and repositories", true, true, true),
    ],
  },
  {
    name: "Working as a team",
    hue: "verify",
    rows: [
      row("Share plans and collect feedback", false, true, true, "Your team's feedback goes straight to your agent"),
      row("Shared team instructions and checks", false, true, true, "Your standards, tools and checks for every teammate's tasks"),
      row("Review the code as a team", false, true, true, "Comments on any line, through your own Git remote"),
      row("Questions over Slack and email", false, true, true, "Ask a teammate about any part of a plan; morning digests"),
      row("Guests comment through a link", false, true, true, "Share a plan or an artifact with people outside your team"),
    ],
  },
  {
    name: "For large companies",
    hue: "plain",
    rows: [
      row("Host the backend yourself", false, false, true, "In your own cloud, on-premise or a private VPC"),
      row("Single sign-on", false, false, true, "SAML or OIDC through your identity provider"),
      row("Volume pricing for many seats", false, false, true),
      row("Invoicing and custom terms", false, false, true),
      row("Onboarding for your team", false, false, true, "A working session to set up the workflow with your developers"),
    ],
  },
];
