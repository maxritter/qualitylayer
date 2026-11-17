// What Settings › Agents shows in the demo: each agent's sign-in and plan, and where QualityLayer's
// own part of each agent stands. One agent is out of date until Repair puts it back, in memory only.

import {
  type AgentAccount,
  type AgentHealth,
  accountShown,
} from "../../core/agents/health-types.ts"
import { NATIVE_AGENTS, type NativeAgent } from "../../core/agents/ids.ts"
import { type AgentSetupState, agentSetupCapabilities } from "../../core/agents/setup.ts"
import type { RepairReport } from "../../core/install/install.ts"
import type { IntegrationHealth, IntegrationItem } from "../../core/install/integration.ts"
import type { Api } from "../api.ts"

export const demoAgentSetup = (): AgentSetupState => ({
  machine: "Example Mac",
  platform: "darwin",
  agents: agentSetupCapabilities("darwin", () => true),
})

/** What each agent's own status command reports, in the shapes the real check stores: Antigravity names no plan. */
const DEMO_ACCOUNTS: Record<NativeAgent, Pick<AgentAccount, "state" | "plan" | "providers">> = {
  "claude-code": { state: "signed-in", plan: "Claude Max" },
  codex: { state: "signed-in", plan: "ChatGPT Pro" },
  pi: { state: "signed-in", providers: 3 },
  opencode: { state: "signed-in", providers: 2 },
  cursor: { state: "signed-in", plan: "Cursor Pro" },
  grok: { state: "signed-in", plan: "grok.com" },
  antigravity: { state: "signed-in" },
  copilot: { state: "signed-in" },
}

/** The demo's account check for one agent, with the line Settings and Setup show for it. */
export function demoAccount(
  agent: NativeAgent,
  checkedAt: number,
): Pick<AgentHealth, "accountCheck" | "account" | "accountTitle"> {
  const accountCheck: AgentAccount = {
    ...DEMO_ACCOUNTS[agent],
    checkedAt,
    source: "Illustrative sign-in",
  }
  return accountShown(accountCheck)
}

/** The agent whose turn-end hooks are missing until Repair. */
const OUT_OF_DATE: NativeAgent = "grok"

const ITEMS: Pick<IntegrationItem, "id" | "label">[] = [
  { id: "skills", label: "Skills" },
  { id: "files", label: "Command" },
  { id: "hooks", label: "Turn-end hooks" },
]

function healthOf(agent: NativeAgent, repaired: ReadonlySet<NativeAgent>): IntegrationHealth {
  const stale = agent === OUT_OF_DATE && !repaired.has(agent)
  const items = ITEMS.map(
    (item): IntegrationItem =>
      stale && item.id === "hooks"
        ? { ...item, state: "missing", detail: "Missing: turn-end hooks" }
        : { ...item, state: "ready", detail: null },
  )
  return { agent, status: stale ? "repair" : "ready", items }
}

export function createDemoIntegration(
  onChange: () => void,
): Pick<Api, "agentIntegration" | "repairAgent"> {
  const repaired = new Set<NativeAgent>()
  return {
    agentIntegration: async () => NATIVE_AGENTS.map((agent) => healthOf(agent, repaired)),
    repairAgent: async (agent): Promise<RepairReport> => {
      repaired.add(agent)
      onChange()
      return {
        agent,
        health: healthOf(agent, repaired),
        changed: ["Skills and hooks set again"],
        kept: [],
      }
    },
  }
}
