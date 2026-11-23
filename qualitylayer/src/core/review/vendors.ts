// Which agents can run on this machine, and whether the working agent's other vendor is one of
// them. Kept apart from `cross.ts` so the flow (`task-flow.ts`) can ask without importing the
// review runner, which itself reads the flow.

import type { Ctx } from "../../ctx.ts"
import { installedBinary, type Reviewer } from "../agents/binary.ts"
import { readAgentHealth } from "../agents/health.ts"
import { isNativeAgent, NATIVE_AGENTS, type NativeAgent } from "../agents/ids.ts"
import { buildingOn } from "../agents/model-values.ts"
import { pickReviewer, type ReviewerContext, type ReviewerPick } from "../agents/reviewer-pick.ts"
import { readConfig } from "../config.ts"
import { DEFAULT_CONFIG, SESSION_MODEL } from "../config-values.ts"
import { withAgentFolders } from "../install/agent-folders.ts"
import { roots } from "../install/agent-settings.ts"
import { listRuns } from "../run/registry.ts"
import { readSession, type Task } from "../task/store.ts"

/**
 * Agents that are set up (their config folder exists, where Settings says it is) and can be
 * started (on PATH, or where the login shell and the usual install folders find it): every one of the seven can run a review.
 */
export async function installedAgents(ctx: Ctx): Promise<Reviewer[]> {
  const dirs = roots(await withAgentFolders(ctx))
  if (dirs === null) return []
  const { agents } = await readConfig(ctx)
  const folders = {
    "claude-code": dirs.claude,
    codex: dirs.codex,
    pi: dirs.pi,
    opencode: dirs.opencode,
    cursor: dirs.cursor,
    grok: dirs.grok,
    copilot: dirs.copilot,
    antigravity: dirs.antigravity,
  } as const
  const out: Reviewer[] = []
  for (const agent of Object.keys(folders) as (keyof typeof folders)[])
    if (
      agents[agent].enabled &&
      (await ctx.fs.exists(folders[agent])) &&
      (await installedBinary(ctx, agent)) !== null
    )
      out.push(agent)
  return out
}

/** The agents whose own status command last said they are signed out; an unknown sign-in is not listed. */
export async function signedOutAgents(ctx: Ctx): Promise<NativeAgent[]> {
  return (await readAgentHealth(ctx))
    .filter((row) => row.accountCheck?.state === "signed-out")
    .map((row) => row.agent)
}

/**
 * The model the building session runs: the one its newest run of this task was started with, else
 * the model the Implement start opens with for that agent. Null when neither is known.
 */
export async function buildingModel(
  ctx: Ctx,
  working: string,
  task?: Pick<Task, "runtimeDir">,
): Promise<string | null> {
  if (!isNativeAgent(working)) return null
  if (task !== undefined) {
    const run = listRuns(ctx.home)
      .filter(
        (r) =>
          r.taskRuntimeDir === task.runtimeDir &&
          r.agent === working &&
          typeof r.settings?.model === "string" &&
          r.settings.model !== "",
      )
      .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0))[0]
    if (run?.settings?.model !== undefined) return run.settings.model
  }
  return buildingOn(working, (await readConfig(ctx)).implement.defaults[working].orchestrator)
}

/**
 * What the pick of a second opinion reads: the building session's model, the model each agent would
 * review with (Settings › Reviewer models) and who is signed out. `building` is left out when only
 * whether some agent can review matters.
 */
export async function reviewerContext(
  ctx: Ctx,
  working: string,
  building?: Pick<Task, "runtimeDir"> | "none",
  /** `helpers`: the agent answers as a helper, on its helpers' model, rather than reviewing on its second-opinion model. */
  reviewsOn: "second-opinion" | "helpers" = "second-opinion",
): Promise<ReviewerContext> {
  const config = await readConfig(ctx)
  const helpers = Object.fromEntries(
    NATIVE_AGENTS.map((agent) => {
      const configured = config.models[agent].helpers
      return [
        agent,
        configured === SESSION_MODEL ? DEFAULT_CONFIG.models[agent].helpers : configured,
      ]
    }),
  ) as Record<NativeAgent, string>
  return {
    model: building === "none" ? null : await buildingModel(ctx, working, building),
    models: reviewsOn === "helpers" ? helpers : config.secondOpinion.models,
    signedOut: await signedOutAgents(ctx),
  }
}

/** A second opinion's reviewer with the model it reads on. */
export type SelectedReviewer = ReviewerPick & { model: string }

/**
 * The second opinion's reviewer of the working agent's work: the agent and model Settings › Models
 * names for it, when that agent is on this computer and not signed out; else picked automatically
 * from another model family among the agents here, on that agent's second-opinion model.
 */
export async function selectedReviewer(
  ctx: Ctx,
  working: string,
  task?: Pick<Task, "runtimeDir">,
): Promise<SelectedReviewer | null> {
  const installed = await installedAgents(ctx)
  const context = await reviewerContext(ctx, working, task)
  const { secondOpinion } = await readConfig(ctx)
  const chosen = isNativeAgent(working) ? secondOpinion.reviewers[working] : undefined
  const chosenAgent =
    chosen !== undefined && chosen.agent !== "auto" && chosen.agent !== working
      ? chosen.agent
      : null
  const canUseChosen =
    chosenAgent !== null &&
    installed.includes(chosenAgent) &&
    !(context.signedOut ?? []).includes(chosenAgent)
  if (canUseChosen && chosen !== undefined) {
    const model = chosen.model || secondOpinion.models[chosenAgent]
    const models = { ...context.models, [chosenAgent]: model }
    const pick = pickReviewer(working, chosenAgent, installed, { ...context, models })
    if (pick !== null) return { ...pick, model }
  }
  const pick = pickReviewer(working, "auto", installed, context)
  return pick === null ? null : { ...pick, model: secondOpinion.models[pick.agent] }
}

/**
 * Whether the other vendor's agent is installed for the agent working on this task: true or false
 * for Claude Code and Codex, null when the task has no session yet (or an agent without an
 * opposite), where nothing can be said about it.
 */
export async function otherVendorInstalled(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<boolean | null> {
  const working = (await readSession(ctx, task))?.agent ?? "unknown"
  const installed = await installedAgents(ctx)
  const other = pickReviewer(
    working,
    "auto",
    installed,
    await reviewerContext(ctx, working, "none"),
  )
  if (other === null) return isNativeAgent(working) ? false : null
  return installed.includes(other.agent)
}
