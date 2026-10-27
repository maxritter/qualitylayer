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
  /** Four short highlights per plan, of about the same length; the table holds the detail. */
  highlights: [Hue, string][];
}

export const PLANS: Plan[] = [
  {
    id: "solo",
    name: "Solo",
    audience: "For one developer.",
    price: { monthly: 29, yearly: 288 },
    per: "per month",
    cta: "Start Solo",
    href: {
      monthly: import.meta.env.VITE_POLAR_CHECKOUT_SOLO_MONTHLY || "https://buy.polar.sh/polar_cl_7qzxxKiqZXIFe3Uabodh7IauA937iVROT5qVW4VyuUf",
      yearly: import.meta.env.VITE_POLAR_CHECKOUT_SOLO_YEARLY || "https://buy.polar.sh/polar_cl_9krLYPvWYMBAXX4nL4LolXKgB5cAEA7J57H8Y3j0oQY",
    },
    plus: "Everything one developer needs:",
    highlights: [
      ["plan", "Approve the plan before any code is written"],
      ["build", "Built test first, with its checks recorded"],
      ["verify", "Checked against your request before you see it"],
      ["review", "Works with any coding agent"],
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
      ["plan", "Share plans and collect your team’s feedback"],
      ["build", "Follow the progress of every shared task"],
      ["verify", "Invite people outside your team to comment"],
      ["review", "Review finished changes together"],
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    audience: "For 20 developers or more.",
    price: "Custom",
    per: "volume pricing",
    cta: "Contact us",
    href: `mailto:${CONTACT_EMAIL}?subject=QualityLayer%20Enterprise`,
    badge: "On request",
    plus: "Everything in Team, plus:",
    highlights: [
      ["plan", "Host in your own cloud or on-premise"],
      ["build", "Volume pricing for many seats"],
      ["verify", "Single sign-on"],
      ["review", "Invoicing and custom terms"],
    ],
  },
];

export const formatPrice = (amount: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: PRICE_CURRENCY, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);

/** A cell: included, not included, or available when a company asks for it. */
export type Cell = boolean | "request";
export type CompareRow = { feature: string; solo: Cell; team: Cell; enterprise: Cell; note?: string };
export type CompareGroup = { name: string; hue: Hue; rows: CompareRow[] };

/** Enterprise has everything Team has unless a row says otherwise. */
const row = (feature: string, solo: Cell, team: Cell, note?: string, enterprise: Cell = team): CompareRow => ({
  feature,
  solo,
  team,
  enterprise,
  note,
});
const onRequest = (feature: string) => row(feature, false, false, undefined, "request");

export const COMPARE: CompareGroup[] = [
  {
    name: "Plan",
    hue: "plan",
    rows: [
      row("Approve one plan before any code is written", true, true),
      row("Answer questions in batches, in any order", true, true, "Each answer reaches your agent immediately in Your turn"),
      row("Review the outcomes with the complete Plan", true, true, "Answer unresolved choices, then approve the Plan or give feedback"),
      row("Decisions shown as diagrams and a clickable mockup", true, true),
      row("Read the full-size Plan with line comments", true, true),
      row("Bugs start with finding their cause", true, true),
      row("A ready prompt for small requests", true, true, "Your plain agent runs it"),
      row("Copy the plan as a PRD", true, true, "For Confluence, Google Docs or Jira"),
    ],
  },
  {
    name: "Build",
    hue: "build",
    rows: [
      row("Choose the models that build and check", true, true),
      row("Every task test first, project checks recorded", true, true),
      row("One session builds every slice, with subagents when useful", true, true),
      row("The cost of every step", true, true, "Estimated at list price"),
    ],
  },
  {
    name: "Verify",
    hue: "verify",
    rows: [
      row("Security review when a change crosses a trust boundary", true, true, "Runs when the Plan names one, such as outside input, sign-in or secrets"),
      row("An agent that did not write the code adds tests and checks every point", true, true, "On by default; Settings can turn it off"),
      row("A separate coding agent reviews your plan and risky changes", true, true, "Choose any installed agent: Claude Code, Codex, Cursor, Grok, Antigravity, Pi or OpenCode"),
    ],
  },
  {
    name: "Review",
    hue: "review",
    rows: [
      row("Approve the finished change, with its evidence", true, true, "Unverified checks stay unverified when you approve"),
      row("Read the whole change like a pull request", true, true, "Split or unified, comments on any line, viewed marks per file"),
      row("Ask, Change or Replace with, on any line", true, true, "Ask gets an answer without changing code. Change goes to your agent with your decision. Replace with sends exact lines"),
      row("Agent findings appear on their lines", true, true, "Make one your change request, or say why it is not a problem and it becomes a project lesson"),
      row("Ask another agent to review a file or the change", true, true, "An installed agent that did not build it reads the change, read-only, for up to 8 minutes. Its cost is listed"),
      row("Run the review tools your team already uses", true, true, "Up to 8 commands, such as Semgrep, a linter, codex review or CodeRabbit’s CLI. Findings on changed lines arrive as threads"),
      row("Approve with comments still open", true, true, "They are posted to the pull request as one GitHub review"),
      row("Review the code as a team", false, true, "Ask for review pushes the branch to your own Git remote. Teammates with a checkout of the repository read the code there and comment on lines; others see the walkthrough"),
    ],
  },
  {
    name: "Everyday",
    hue: "plain",
    rows: [
      row("The App for macOS, Windows and Linux", true, true, "On a server or in WSL, it opens in your browser"),
      row("A notification when it is Your turn", true, true, "App bell, menu bar, and above the Claude Code prompt"),
      row("Your tasks and agent status on Home", true, true, "Tasks that need you and work in progress"),
      row("Seven coding agents in the App or browser", true, true, "Claude Code, Codex, Cursor, Grok, Antigravity, Pi and OpenCode, each in its own terminal with its own permission modes"),
      row("See how much of your plan is left", true, true, "Claude Code and Codex limits in the sidebar, the conversation footer and Settings › Usage"),
      row("Your AI agents can message each other", true, true, "Claude Code, Codex, Pi and OpenCode sessions on your computer"),
    ],
  },
  {
    name: "Team",
    hue: "plain",
    rows: [
      row("Share plans with your team", false, true),
      row("Team feedback goes straight to your agent", false, true),
      row("Ask a teammate about any part of a plan", false, true, "A Slack message opens it under Questions for you"),
      row("Teammates answer with their own agent", false, true, "Their agent drafts it; nothing is sent until they approve"),
      row("Follow the progress of every shared task", false, true),
      row("Invite people outside your team to comment", false, true),
      row(
        "Plans, comments and links are encrypted on your machine",
        false,
        true,
        "We can’t read them. We see who shared, who was asked, which task, when and its step. The guest page’s code comes from us. With Slack connected, task titles and questions pass through our server to Slack. Pending notifications expire after 72 hours. Review code travels between your computer and your own Git remote. We store your team’s encrypted comments, the short lines of code they quote and the commits they point to.",
      ),
      row("Manage seats and billing in one place", false, true),
    ],
  },
  {
    name: "Enterprise",
    hue: "plain",
    rows: [
      onRequest("Host in your own cloud, on-premise or a private VPC"),
      onRequest("Volume pricing"),
      onRequest("Single sign-on (SSO)"),
      onRequest("Custom terms and invoicing"),
    ],
  },
];
