// The routes behind the agent cards: the last executable and version results, an explicit check (it
// answers with the versions; `/sign-in` waits for the sign-ins it started and answers with all), and
// whether QualityLayer's own part of each agent is in place, with its repair. Only the App and the
// browsers it opened start a check or a repair; reading the results is open to every paired page.

import { checkAgentHealth, readAgentHealth, settledSignIns } from "../core/agents/health.ts"
import { isNativeAgent, NATIVE_AGENTS } from "../core/agents/ids.ts"
import { repairAgent } from "../core/install/install.ts"
import { integrationHealth } from "../core/install/integration.ts"
import { readTools } from "../core/tools-status.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { readAgentSetup } from "./agent-setup-command.ts"

/** The longest the sign-in route waits; each command has 10 s, so this is a net, not the usual wait. */
export const SIGN_IN_WAIT_MS = 45_000

const refusal = (what: string) =>
  new Response(`Only the App and browsers it opened may ${what}.`, { status: 403 })

async function readRoute(ctx: Ctx, path: string): Promise<Result<unknown> | null> {
  if (path === "/api/agents/setup") return ok(await readAgentSetup(ctx))
  if (path === "/api/agents") return ok({ agents: await readAgentHealth(ctx) })
  if (path === "/api/tools") return ok({ tools: await readTools(ctx) })
  if (path === "/api/agents/sign-in") {
    await settledSignIns(ctx, SIGN_IN_WAIT_MS)
    return ok({ agents: await readAgentHealth(ctx) })
  }
  return path === "/api/agents/integration"
    ? ok({ integration: await integrationHealth(ctx) })
    : null
}

const repairOf = (ctx: Ctx, agent: unknown): Promise<Result<unknown>> | Result<unknown> =>
  isNativeAgent(agent)
    ? repairAgent(ctx, agent)
    : err({ code: "bad_args", message: `agent: expected ${NATIVE_AGENTS.join(", ")}` })

async function handleAgentCheck(
  ctx: Ctx,
  paired: () => boolean,
  readBody: () => Promise<Record<string, unknown>>,
): Promise<Result<unknown> | Response> {
  if (!paired()) return refusal("check installed agents")
  const agent = (await readBody()).agent
  if (agent !== undefined && !isNativeAgent(agent))
    return err({ code: "bad_args", message: "Unknown native agent" })
  return ok({ agents: await checkAgentHealth(ctx, agent === undefined ? undefined : [agent]) })
}

/**
 * The answer to `/api/agents`, `/check`, `/integration`, `/repair`, `/api/tools` or `/api/tools/check`: a result for the caller to send,
 * a response when the caller may not do it, or null for any other path.
 */
export async function agentSetupRoute(
  ctx: Ctx,
  request: Request,
  path: string,
  paired: () => boolean,
  readBody: () => Promise<Record<string, unknown>>,
): Promise<Result<unknown> | Response | null> {
  if (request.method !== "POST") return request.method === "GET" ? readRoute(ctx, path) : null
  if (path === "/api/agents/check") return handleAgentCheck(ctx, paired, readBody)
  if (path === "/api/tools/check")
    return paired() ? ok({ tools: await readTools(ctx, true) }) : refusal("check git and gh")
  if (path === "/api/agents/repair")
    return paired() ? repairOf(ctx, (await readBody()).agent) : refusal("repair an agent's setup")
  return null
}
