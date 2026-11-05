import type { NativeAgent } from "@ql/core/agents/ids";

/** The eight agents the site names, most used first: the agents grid and the hero's rotating name. Two grid columns, so an even count. */
export const SHOWN_AGENTS: [label: string, agent: NativeAgent][] = [
  ["Claude Code", "claude-code"],
  ["Codex", "codex"],
  ["Cursor", "cursor"],
  ["Antigravity", "antigravity"],
  ["Pi", "pi"],
  ["OpenCode", "opencode"],
  ["Grok", "grok"],
  ["GitHub Copilot", "copilot"],
];
