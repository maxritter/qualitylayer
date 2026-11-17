import { AGENT_SETUP, type AgentHealth, SIGNING_IN } from "./health-types.ts"
import { NATIVE_AGENTS, type NativeAgent } from "./ids.ts"

export type AgentSetupOperation = "install" | "sign-in"
export type AgentSetupMethod =
  | { kind: "installer"; script: string; needs: readonly string[] }
  | { kind: "login"; args: readonly string[]; env?: Readonly<Record<string, string>> }

export type AgentSetupCapability = {
  agent: NativeAgent
  enabled: boolean
  install: boolean
  signIn: boolean
  guide: string
}
export type AgentSetupState = {
  machine: string
  platform: string
  agents: AgentSetupCapability[]
}

// Vendor-documented native methods. An absent method keeps the existing setup guide rather than
// guessing an argument that a CLI could interpret as a model prompt.
const INSTALL: Partial<Record<NativeAgent, Record<"posix" | "win32", AgentSetupMethod>>> = {
  "claude-code": {
    posix: {
      kind: "installer",
      script: "curl -fsSL https://claude.ai/install.sh | bash",
      needs: ["curl", "bash"],
    },
    win32: { kind: "installer", script: "irm https://claude.ai/install.ps1 | iex", needs: [] },
  },
  codex: {
    posix: {
      kind: "installer",
      script: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      needs: ["curl", "sh"],
    },
    win32: { kind: "installer", script: "npm install -g @openai/codex", needs: ["npm"] },
  },
  cursor: {
    posix: {
      kind: "installer",
      script: "curl -fsS https://cursor.com/install | bash",
      needs: ["curl", "bash"],
    },
    win32: {
      kind: "installer",
      script: "irm 'https://cursor.com/install?win32=true' | iex",
      needs: [],
    },
  },
}
const LOGIN: Partial<Record<NativeAgent, AgentSetupMethod>> = {
  "claude-code": { kind: "login", args: ["auth", "login"] },
  codex: { kind: "login", args: ["login", "--device-auth"] },
  cursor: { kind: "login", args: ["login"], env: { NO_OPEN_BROWSER: "1" } },
  opencode: { kind: "login", args: ["auth", "login"] },
}

export function agentSetupMethod(
  agent: NativeAgent,
  operation: AgentSetupOperation,
  platform: string,
): AgentSetupMethod | null {
  if (!["darwin", "linux", "win32"].includes(platform)) return null
  return operation === "sign-in"
    ? (LOGIN[agent] ?? null)
    : (INSTALL[agent]?.[platform === "win32" ? "win32" : "posix"] ?? null)
}

export const agentSetupCapabilities = (
  platform: string,
  enabled: (agent: NativeAgent) => boolean,
): AgentSetupCapability[] =>
  NATIVE_AGENTS.map((agent) => ({
    agent,
    enabled: enabled(agent),
    install: agentSetupMethod(agent, "install", platform) !== null,
    signIn: agentSetupMethod(agent, "sign-in", platform) !== null,
    guide: AGENT_SETUP[agent],
  }))

/** Unknown authentication stays unknown; it does not remove an installed agent's launch capability. */
export const usableSetupAgent = (health: AgentHealth | undefined): boolean =>
  health?.status === "available" &&
  health.path !== null &&
  health.account !== SIGNING_IN &&
  health.accountCheck?.state !== "signed-out" &&
  health.accountCheck?.providers !== 0
