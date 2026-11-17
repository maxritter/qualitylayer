import { expect, test } from "bun:test"
import type { AgentHealth } from "../../src/core/agents/health-types.ts"
import { NATIVE_AGENTS } from "../../src/core/agents/ids.ts"
import {
  agentSetupCapabilities,
  agentSetupMethod,
  usableSetupAgent,
} from "../../src/core/agents/setup.ts"
import { isTerminalContext } from "../../src/core/run/contracts.ts"

test("setup offers every supported agent in catalog order, with only documented native operations", () => {
  const capabilities = agentSetupCapabilities("linux", (agent) => agent === "codex")
  expect(capabilities.map(({ agent }) => agent)).toEqual([...NATIVE_AGENTS])
  expect(capabilities.filter(({ enabled }) => enabled).map(({ agent }) => agent)).toEqual(["codex"])
  expect(capabilities.find(({ agent }) => agent === "opencode")).toMatchObject({
    install: false,
    signIn: true,
    guide: "https://opencode.ai/docs/",
  })
  for (const agent of NATIVE_AGENTS) {
    expect(agentSetupMethod(agent, "install", "unsupported")).toBeNull()
    expect(agentSetupMethod(agent, "sign-in", "unsupported")).toBeNull()
  }
})

test("setup uses each platform's vendor method and never turns an unknown login into a prompt", () => {
  expect(agentSetupMethod("claude-code", "install", "darwin")).toMatchObject({
    kind: "installer",
    script: "curl -fsSL https://claude.ai/install.sh | bash",
  })
  expect(agentSetupMethod("codex", "install", "win32")).toMatchObject({
    kind: "installer",
    script: "npm install -g @openai/codex",
  })
  expect(agentSetupMethod("codex", "sign-in", "linux")).toEqual({
    kind: "login",
    args: ["login", "--device-auth"],
  })
  expect(agentSetupMethod("cursor", "sign-in", "linux")).toEqual({
    kind: "login",
    args: ["login"],
    env: { NO_OPEN_BROWSER: "1" },
  })
  for (const agent of ["pi", "grok", "antigravity", "copilot"] as const)
    expect(agentSetupMethod(agent, "sign-in", "darwin")).toBeNull()
})

test("one installed agent remains usable when authentication is unknown, without treating signed-out as ready", () => {
  const available: AgentHealth = {
    agent: "codex",
    status: "available",
    path: "/tools/codex",
    checkedAt: 1,
    version: "codex-cli 0.169.0",
    detail: null,
  }
  expect(usableSetupAgent(available)).toBe(true)
  expect(usableSetupAgent({ ...available, account: "Checking sign-in…" })).toBe(false)
  expect(
    usableSetupAgent({
      ...available,
      accountCheck: { state: "unknown", checkedAt: 1, source: "status" },
    }),
  ).toBe(true)
  for (const accountCheck of [
    { state: "signed-out", checkedAt: 1, source: "status" },
    { state: "signed-in", providers: 0, checkedAt: 1, source: "status" },
  ] as const)
    expect(usableSetupAgent({ ...available, accountCheck })).toBe(false)
  expect(usableSetupAgent({ ...available, status: "not-found", path: null })).toBe(false)
  expect(usableSetupAgent(undefined)).toBe(false)
})

test("the setup terminal accepts only a native agent and operation, with no browser command or home", () => {
  const context = { kind: "agent-setup", agent: "codex", operation: "install" }
  expect(isTerminalContext(context)).toBe(true)
  expect(isTerminalContext({ ...context, operation: "sign-in" })).toBe(true)
  for (const wrong of [
    { ...context, agent: "other" },
    { ...context, operation: "exec" },
    { ...context, command: "echo unsafe" },
    { ...context, home: "/another/user" },
    { ...context, platform: "win32" },
    { ...context, agent: "codex\n" },
  ])
    expect(isTerminalContext(wrong)).toBe(false)
})
