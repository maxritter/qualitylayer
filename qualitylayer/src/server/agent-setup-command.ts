import { hostname } from "node:os"
import { checkedAgentBinary } from "../core/agents/binary.ts"
import { AGENT_NAMES, type NativeAgent } from "../core/agents/ids.ts"
import {
  type AgentSetupOperation,
  type AgentSetupState,
  agentSetupCapabilities,
  agentSetupMethod,
} from "../core/agents/setup.ts"
import { readConfig } from "../core/config.ts"
import type { Ctx } from "../ctx.ts"

/** Only metadata; opening Setup never starts a native program or reads a credential. */
export async function readAgentSetup(ctx: Ctx): Promise<AgentSetupState> {
  const { agents } = await readConfig(ctx)
  return {
    machine: hostname(),
    platform: process.platform,
    agents: agentSetupCapabilities(process.platform, (agent) => agents[agent].enabled),
  }
}

export async function agentSetupProgram(
  ctx: Ctx,
  agent: NativeAgent,
  operation: AgentSetupOperation,
  env: Record<string, string>,
): Promise<{ program: string; args: string[] }> {
  const { agents } = await readConfig(ctx)
  if (!agents[agent].enabled)
    throw new Error(`Enable ${AGENT_NAMES[agent]} in Settings › Agents before setting it up.`)
  const method = agentSetupMethod(agent, operation, process.platform)
  if (method === null)
    throw new Error(`Use ${AGENT_NAMES[agent]}'s setup guide for this operation.`)
  if (method.kind === "login") {
    const binary = await checkedAgentBinary(ctx, agent, { env, timeoutMs: 3000 })
    Object.assign(env, method.env)
    return { program: binary.path, args: [...method.args] }
  }
  for (const tool of method.needs)
    if (!Bun.which(tool, { PATH: env.PATH }))
      throw new Error(`${tool} is needed on this machine. Install it, then try again.`)
  const windows = process.platform === "win32"
  const program = Bun.which(windows ? "powershell.exe" : "sh", { PATH: env.PATH })
  if (program === null) throw new Error("This machine has no supported setup terminal.")
  return {
    program,
    args: windows ? ["-NoLogo", "-NoProfile", "-Command", method.script] : ["-c", method.script],
  }
}
