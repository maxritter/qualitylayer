import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    { type: "category", label: "Get started", collapsed: false, items: [
      "intro", "install", "first-task", "agents/native", "agents/other", "moving-from-pilot-shell",
    ] },
    { type: "category", label: "Workflow", collapsed: false, items: [
      "steps/discuss", "steps/research", "steps/plan", "steps/outline", "steps/implement", "steps/verify", "steps/review", "steps/pull-request",
    ] },
    { type: "category", label: "App and team", collapsed: false, items: [
      "app", "chat", "artifacts", "reference/code-health", "memory", "required-lines", "team/plans", "team/agents", "team/changes",
    ] },
    { type: "category", label: "Reference", collapsed: false, items: [
      "reference/commands", "reference/settings", "reference/files", "reference/changelog",
    ] },
  ],
};

export default sidebars;
