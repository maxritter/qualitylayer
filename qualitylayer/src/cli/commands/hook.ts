// hook prompt · hook activity · hook picker · hook ask · hook approve · hook live · hook stop ·
// hook own-command · hook memory-compact. Thin CLI dispatcher over sibling hook modules.

import { detectAgent } from "../../core/agents/detect.ts"
import { isNativeAgent, type NativeAgent } from "../../core/agents/ids.ts"
import { hasHookFile } from "../../core/install/agent-hooks.ts"
import type { Ctx } from "../../ctx.ts"
import { ASK_DENIED, approveHook, askHook, ownCommandHook } from "./hook-ask.ts"
import { liveCmd } from "./hook-live.ts"
import { asAdditionalContext, memoryCompact, promptHook } from "./hook-prompt.ts"
import { pickedAnswers, shellPatchWarning } from "./hook-shared.ts"
import { activityHook, pickerHook } from "./hook-work.ts"

export { ASK_DENIED, pickedAnswers, shellPatchWarning }

/**
 * `--agent <id>` ends the arguments of a hook an agent runs from its own hook file. The agent it
 * names answers for the hook from then on; a hook of Claude Code's settings that Cursor or Grok ran
 * comes without it, or with another agent's name, and is left to the hook file's call.
 */
export function ownHookCall(ctx: Ctx, args: string[]): { args: string[]; ctx: Ctx } | null {
  const at = args.indexOf("--agent")
  const named = at >= 0 ? args[at + 1] : undefined
  const running = detectAgent(ctx.env)
  if (hasHookFile(running) && named !== running) return null
  if (!isNativeAgent(named) || !hasHookFile(named)) return { args, ctx }
  const agent: NativeAgent = named
  return {
    args: args.filter((_, index) => index !== at && index !== at + 1),
    ctx: {
      ...ctx,
      env: {
        ...ctx.env,
        get: (name) => (name === "QUALITYLAYER_AGENT" ? agent : ctx.env.get(name)),
      },
    },
  }
}

const SUBCOMMANDS = new Map<string, (ctx: Ctx, args: string[]) => Promise<number>>([
  ["activity", (ctx, args) => activityHook(ctx, args[1])],
  [
    "picker",
    async (ctx, args) => {
      await pickerHook(ctx, args[1])
      return 0
    },
  ],
  ["ask", (ctx) => askHook(ctx)],
  ["approve", (ctx, args) => approveHook(ctx, args.slice(1))],
  ["live", (ctx, args) => liveCmd(ctx, false, args[1])],
  ["stop", (ctx) => liveCmd(ctx, true)],
  ["own-command", (ctx, args) => ownCommandHook(ctx, args[1])],
  [
    "memory-compact",
    async (ctx, args) => {
      await memoryCompact(ctx, args[1])
      return 0
    },
  ],
])

/** The agent a hook call comes from: the one `--agent` names, else the one the environment and parent processes show. */
function invokingAgent(ctx: Ctx, args: string[]): string {
  const at = args.indexOf("--agent")
  const named = at >= 0 ? args[at + 1] : undefined
  return isNativeAgent(named) ? named : detectAgent(ctx.env)
}

/**
 * An App launch carries its own copy of the hooks and sets `QUALITYLAYER_SESSION_HOOKS` to its agent's
 * id; its copy calls the hook with `--launch`. The installed copy of that same agent steps aside at
 * once, so no event is reported twice. Another agent started from inside the session (a helper, a
 * review) is not that agent and keeps its installed hooks.
 */
export async function hookCmd(given: Ctx, called: string[]): Promise<number> {
  const launch = called.includes("--launch")
  const hooked = given.env.get("QUALITYLAYER_SESSION_HOOKS")
  if (!launch && hooked && hooked === invokingAgent(given, called)) return 0
  const all = called.filter((word) => word !== "--launch")
  const own = ownHookCall(given, all)
  if (own === null) return 0
  const { ctx, args } = own
  const run = SUBCOMMANDS.get(args[0] ?? "")
  if (run !== undefined) return run(ctx, args)
  if (args[0] !== "prompt") {
    console.error(
      "usage: qualitylayer hook prompt | hook activity | hook picker | hook ask | hook approve | hook live | hook stop | hook memory-compact  (read the agent's hook JSON)",
    )
    return 1
  }
  if (detectAgent(ctx.env) === "copilot") await asAdditionalContext(() => promptHook(ctx, args))
  else await promptHook(ctx, args)
  return 0
}
