// Split acceptance shares use the helpers' model. The whole-diff review uses the judge's model.
import type { Ctx } from "../ctx.ts"
import { detectAgent } from "./agents/detect.ts"
import { isNativeAgent } from "./agents/ids.ts"
import type { Helper } from "./briefs.ts"
import { readConfig, SESSION_MODEL } from "./config.ts"
import { agentEntry } from "./handoff/prompt.ts"
import { helperEffort } from "./handoff/start-values.ts"
import { type HelperRole, helperRoleName } from "./scaling.ts"

/**
 * The model a helper of this role runs on (`session` when the working session does the helper work); null
 * for an agent without a model table. Plan, security, and whole-change reviews use the judge.
 * Artifact checks use the design model. Research, building, and acceptance use the helpers' model.
 */
export async function subagentModel(
  ctx: Ctx,
  agent: string,
  role: HelperRole,
  share?: Helper["share"],
): Promise<string | null> {
  if (!isNativeAgent(agent)) return null
  if (Object.keys(agentEntry(agent).helperModels ?? {}).length === 0) return null
  const models = (await readConfig(ctx)).models[agent]
  if (models.helpers === SESSION_MODEL) return SESSION_MODEL
  if (
    role === "plan-review" ||
    role === "security" ||
    (role === "judge" && share?.kind !== "slices")
  )
    return models.judge
  return role === "artifact-check" ? models.design : models.helpers
}

/** How this agent starts a helper from its brief file, with the model and effort the reply names. */
function startLine(agent: string): string {
  if (agent === "pi" || agent === "opencode")
    return "Run each helper with ql_helper, passing only the path of its `brief_file` with its model, effort and minutes."
  if (agent === "unknown") return ""
  return `Start each helper with only the path of its \`brief_file\` and the words "Read it in full and follow it"${agent === "claude-code" ? ", passing its `model` and `effort` to the Agent tool" : ""}.`
}

/**
 * Each helper on its role's model and effort. With QualityLayer helpers set to This session,
 * none is handed out: its brief comes back in `off` for the session to follow. `start` is the one
 * sentence on how the agent starts the helpers handed out, for the reply to put beside them, and
 * `own` is `off` without it.
 */
export async function staff(
  ctx: Ctx,
  helpers: Helper[],
): Promise<{ on: Helper[]; off: string; start: string; own: string }> {
  const agent = detectAgent(ctx.env)
  const on: Helper[] = []
  const off: Helper[] = []
  for (const helper of helpers) {
    const model = await subagentModel(ctx, agent, helper.role, helper.share)
    // A recheck after a pass reviews a small diff: its brief names a lower effort of its own.
    const effort = helper.effort ?? helperEffort(helper.role, helper.share?.kind === "slices")
    if (model === SESSION_MODEL) off.push(helper)
    else on.push({ ...helper, ...(model !== null ? { model } : {}), effort })
  }
  const start = on.length > 0 ? startLine(agent) : ""
  const asked = off.filter((h) => h.role !== "slice")
  if (asked.length === 0) return { on, off: start, start, own: "" }
  const own = [
    `No ${helperRoleName(asked[0]?.role ?? "research")} subagent runs (helpers are set to This session): follow the brief yourself.`,
    ...asked.map((h) => h.brief.replace(/(?:^|\n)## Progress\n[\s\S]*?(?=\n## |$)/g, "")),
  ]
  return {
    on,
    off: [...own, start].filter((part) => part !== "").join("\n\n---\n\n"),
    start,
    own: own.join("\n\n---\n\n"),
  }
}
