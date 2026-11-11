import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    { type: "category", label: "Get started", collapsed: false, items: [
      "intro", "install", "machines", "first-task", "work-in-your-agent", "agents/native", "agents/other", "moving-from-pilot-shell",
    ] },
    { type: "category", label: "Workflow", collapsed: false, items: [
      "steps/plan", "steps/implement", "steps/verify", "steps/pull-request",
    ] },
    { type: "category", label: "App and projects", collapsed: false, items: [
      "app", "chat", "artifacts", "reference/code-health", "memory", "automations",
    ] },
    { type: "category", label: "Reference", collapsed: false, items: [
      "reference/commands", "reference/settings", "reference/files", "reference/antivirus", "reference/changelog",
    ] },
  ],
};

export default sidebars;
