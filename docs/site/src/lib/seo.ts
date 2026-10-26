import { SHARE_DESCRIPTION, SITE_URL, SLOGAN } from "./product.ts";

export const PUBLIC_PAGES = {
  "/": { title: `QualityLayer: ${SLOGAN}`, description: SHARE_DESCRIPTION },
  "/pricing": {
    title: "Pricing | QualityLayer",
    description: "QualityLayer plans for solo developers, teams and companies, with unlimited tasks, repositories and agents.",
  },
  "/download": {
    title: "Download QualityLayer for macOS, Windows and Linux",
    description: "Download QualityLayer for macOS, Windows and Linux. Plan and review changes with Claude Code, Codex and your team.",
  },
  "/compare": {
    title: "Compare QualityLayer with spec tools and coding agents",
    description: "Compare QualityLayer with Spec Kit, OpenSpec, Task Master, the plan modes of Claude Code, Cursor and Codex, and agents like Cline, Devin and Conductor.",
  },
  "/compare/superpowers": {
    title: "QualityLayer vs Superpowers: skills, approvals and evidence",
    description: "Compare Superpowers' test-driven skills for Claude Code and Codex with QualityLayer's visual Plan, recorded verification and human review.",
  },
  "/compare/bmad-method": {
    title: "QualityLayer vs BMAD Method: planning artifacts and review",
    description: "Looking for a BMAD Method alternative? Compare BMAD's agile planning paths and parallel review with QualityLayer's approved Plan and recorded evidence.",
  },
  "/compare/gsd": {
    title: "QualityLayer vs GSD (Get Shit Done): spec loop and proof",
    description: "Compare GSD's discuss, plan, execute, verify and ship loop with QualityLayer's approvals, verification evidence and pull request follow-up.",
  },
  "/compare/traycer": {
    title: "QualityLayer vs Traycer: desktop apps for coding agents",
    description: "Compare Traycer's parallel agents, artifacts and tickets with QualityLayer's approved Plan, recorded verification and human Review.",
  },
  "/compare/compound-engineering": {
    title: "QualityLayer vs Compound Engineering: plans and reviews",
    description: "Compare Every's Compound Engineering plugin with QualityLayer: planning, review against the plan, saved lessons and recorded evidence.",
  },
  "/compare/claude-code-plan-mode": {
    title: "QualityLayer vs Claude Code plan mode: plan, build, verify",
    description: "Compare Claude Code's built-in plan mode with QualityLayer's full plan, build, verify and review flow inside Claude Code.",
  },
  "/compare/cursor-plan-mode": {
    title: "QualityLayer vs Cursor plan mode: planning and verification",
    description: "Compare Cursor's plan mode and Projects with QualityLayer's visual Plan, recorded verification and review across coding agents.",
  },
  "/compare/codex-plan-mode": {
    title: "QualityLayer vs Codex plan mode: approve the plan and result",
    description: "Compare Codex's built-in plan mode with QualityLayer inside Codex. You approve a visual Plan, and an agent that did not write the code checks the result.",
  },
  "/compare/humanlayer": {
    title: "QualityLayer vs HumanLayer: planning, proof and review",
    description: "Considering a HumanLayer alternative? Compare agent support, collaborative planning, recorded verification and human review in QualityLayer and HumanLayer.",
  },
  "/compare/spec-kit": {
    title: "QualityLayer vs GitHub Spec Kit: specs, proof and review",
    description: "Looking for a Spec Kit alternative? Compare GitHub Spec Kit's customizable spec workflows with QualityLayer's visual planning, verification and human approval.",
  },
  "/compare/openspec": {
    title: "QualityLayer vs OpenSpec: change proposals and verification",
    description: "Compare OpenSpec's flexible change proposals, spec updates and verification with QualityLayer's visual planning, recorded evidence and human review process.",
  },
  "/compare/kiro": {
    title: "QualityLayer vs Kiro: spec workflows and code verification",
    description: "Compare Kiro's integrated specs and property-based testing with QualityLayer's Claude Code and Codex workflow, recorded verification and human review.",
  },
  "/compare/task-master": {
    title: "QualityLayer vs Task Master: PRD tasks and verification",
    description: "Compare Task Master's PRD-to-task workflow for Cursor and Claude Code with QualityLayer's visual Plan, recorded verification and human review.",
  },
  "/compare/cline": {
    title: "QualityLayer vs Cline: Plan and Act mode or an approved Plan",
    description: "Compare Cline's Plan and Act modes and step-by-step approvals with QualityLayer's approved Plan, recorded verification and review before the pull request.",
  },
  "/compare/aider": {
    title: "QualityLayer vs Aider: terminal pair programming and review",
    description: "Compare Aider's ask and architect modes, auto commits and test runs with QualityLayer's approved Plan, test-first build and recorded verification.",
  },
  "/compare/github-copilot-coding-agent": {
    title: "QualityLayer vs GitHub Copilot coding agent: plan and proof",
    description: "Compare GitHub Copilot's cloud coding agent with QualityLayer: who approves the plan, how the result is checked and how the pull request is opened.",
  },
  "/compare/devin": {
    title: "QualityLayer vs Devin: autonomous agent or approved Plan",
    description: "Compare Devin's autonomous cloud sessions, test recordings and Devin Review with QualityLayer's approved Plan and evidence for each agreed outcome.",
  },
  "/compare/claude-squad": {
    title: "QualityLayer vs Claude Squad: parallel sessions and review",
    description: "Compare Claude Squad's parallel terminal sessions for Claude Code, Codex and Aider with QualityLayer's plan, verify and review flow for each change.",
  },
  "/compare/conductor": {
    title: "QualityLayer vs Conductor: parallel workspaces and proof",
    description: "Compare Conductor's parallel workspaces for Claude Code, Codex, Cursor and OpenCode with QualityLayer's approved Plan and recorded verification.",
  },
  "/best-spec-driven-development-tools": {
    title: "Best spec-driven development tools compared | QualityLayer",
    description: "Compare spec-driven development tools, from GitHub Spec Kit, OpenSpec and Superpowers to Kiro and QualityLayer, by workflow, review and verification.",
  },
  "/imprint": {
    title: "Imprint | QualityLayer",
    description: "Who sells QualityLayer and how to reach us: address, e-mail and VAT ID.",
  },
  "/privacy": {
    title: "Privacy policy | QualityLayer",
    description: "What QualityLayer sends, to whom, why and for how long, and your rights under the GDPR.",
  },
  "/terms": {
    title: "Terms of service | QualityLayer",
    description: "The terms for qualitylayer.dev, the QualityLayer App and the team service.",
  },
} as const;

export const INDEXABLE_ROBOTS = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

const PRIVATE_PAGES = {
  "/billing": {
    title: "Subscription & billing | QualityLayer",
    description: "Manage invoices, seats and payment in your billing account.",
    robots: "noindex,nofollow",
  },
  "/checkout/success": {
    title: "Purchase confirmation | QualityLayer",
    description: "Check your subscription and activate QualityLayer with your licence key.",
    robots: "noindex,nofollow",
  },
  "/open": {
    title: "Open in the QualityLayer App",
    description: "Open the question or the task from the message in the QualityLayer App.",
    robots: "noindex",
  },
} as const;

export function pageMetadata(pathname: string) {
  const page = PUBLIC_PAGES[pathname as keyof typeof PUBLIC_PAGES];
  const privatePath = pathname.startsWith("/open/") ? "/open" : pathname;
  const privatePage = PRIVATE_PAGES[privatePath as keyof typeof PRIVATE_PAGES];
  return {
    title: page?.title ?? privatePage?.title ?? "QualityLayer",
    description: page?.description ?? privatePage?.description ?? "Open your QualityLayer task in the App.",
    canonicalUrl: `${SITE_URL}${pathname}`,
    robots: page ? INDEXABLE_ROBOTS : privatePage?.robots ?? "noindex, follow",
  };
}

/** Keep JSON text inside its inert script element, even if content contains HTML. */
export function serializeStructuredData(data: object | object[]) {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
