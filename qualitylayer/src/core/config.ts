// ~/.qualitylayer/config.json: the few switches a user has. Missing or broken
// files fall back to the defaults; the final approval is never configurable.
// The shape and the defaults live in config-values.ts, which the page imports.

import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { configDirEnvironment } from "./agents/config-dir.ts"
import { isNativeAgent } from "./agents/ids.ts"
import { codexCacheChanged, listFile, ownModel, readIds } from "./agents/model-list-readers.ts"
import { knownFrom, storedModelLists } from "./agents/model-list-store.ts"
import {
  type KnownModels,
  type StepAgent,
  usableDefault,
  usableLaunchModel,
} from "./agents/model-values.ts"
import { planningAfterSettings } from "./config-planning.ts"
import { refuseSettingsPatch } from "./config-refuse.ts"
import { AGENTS, isRecord } from "./config-rules.ts"
import { settleConfig } from "./config-settle.ts"
import { type Config, DEFAULT_CONFIG } from "./config-values.ts"

export {
  type Config,
  type CrossReviewPoint,
  SESSION_MODEL,
  type Theme,
} from "./config-values.ts"
export { refuseSettingsPatch }

export function configPath(ctx: Ctx): string {
  return join(ctx.home, "config.json")
}

function hasLegacySecondOpinionOptIn(second: Record<string, unknown>): boolean {
  if ("enabled" in second) return false
  const hasAgent = second.agent === "auto" || isNativeAgent(second.agent)
  const hasPlan = second.plan === "risky" || second.plan === "always"
  const hasChange = second.change === "risky" || second.change === "always"
  return hasAgent || hasPlan || hasChange
}

function migrateStoredPatch(parsed: unknown): unknown {
  // A file from before the place question: someone who set answers to terminal chose it.
  const saved =
    isRecord(parsed) && !("answerPlaceChosen" in parsed)
      ? { ...parsed, answerPlaceChosen: parsed.answers === "terminal" }
      : parsed
  // Before None was the default, partial reviewer/scope choices inherited enabled: true.
  // Keep that explicit opt-in, without enabling a new, empty or models-only preference.
  if (!isRecord(saved) || !isRecord(saved.secondOpinion)) return saved
  const second = saved.secondOpinion
  const legacy = Object.fromEntries(
    AGENTS.flatMap((agent) => (typeof second[agent] === "string" ? [[agent, second[agent]]] : [])),
  )
  return {
    ...saved,
    secondOpinion: {
      ...second,
      ...(hasLegacySecondOpinionOptIn(second) ? { enabled: true } : {}),
      models: { ...legacy, ...(isRecord(second.models) ? second.models : {}) },
    },
  }
}

/** The settings as the file holds them, with the defaults under what it does not name. */
async function readStoredConfig(ctx: Ctx): Promise<Config> {
  const path = configPath(ctx)
  const base: Config = { ...DEFAULT_CONFIG }
  if (!(await ctx.fs.exists(path))) return base
  try {
    const parsed: unknown = JSON.parse(await ctx.fs.readFile(path))
    return settleConfig(base, migrateStoredPatch(parsed))
  } catch {
    return base
  }
}

/** One agent's model choices, each catalog model its own list says cannot run swapped for its own model. */
function usableModels(config: Config, agent: StepAgent, from: KnownModels | null): Config {
  const use = (model: string) => usableDefault(agent, model, from)
  const launch = (model: string) => usableLaunchModel(agent, model, from)
  const { helpers, judge, design } = config.models[agent]
  const planning = config.planning.defaults[agent]
  const lastStart = config.planning.lastStart
  const build = config.implement.defaults[agent]
  return {
    ...config,
    models: {
      ...config.models,
      [agent]: { helpers: use(helpers), judge: use(judge), design: use(design) },
    },
    secondOpinion: {
      ...config.secondOpinion,
      models: {
        ...config.secondOpinion.models,
        [agent]: use(config.secondOpinion.models[agent]),
      },
    },
    planning: {
      ...config.planning,
      ...(agent === "pi" && lastStart?.agent === agent
        ? { lastStart: { ...lastStart, model: launch(lastStart.model) } }
        : {}),
      defaults: {
        ...config.planning.defaults,
        [agent]: { ...planning, model: launch(planning.model) },
      },
    },
    implement: {
      ...config.implement,
      defaults: {
        ...config.implement.defaults,
        [agent]: {
          ...build,
          orchestrator: launch(build.orchestrator),
          builder: launch(build.builder),
          subagents: launch(build.subagents),
        },
      },
    },
  }
}

async function freshCodexModels(
  ctx: Ctx,
  config: Config,
  checkedAt: number,
): Promise<KnownModels | null> {
  const env = configDirEnvironment(ctx.env, config.agents)
  if (!(await codexCacheChanged(ctx, checkedAt, env))) return null
  const text = await listFile(ctx, "codex", "models_cache.json", env)
  const listed = text === null ? [] : readIds("codex-cache", "codex", text)
  if (listed.length === 0) return null
  const own = await ownModel(ctx, "codex", "codex-config", env)
  return { listed, own: own ?? listed[0] ?? null }
}

/**
 * The settings in force. An agent that lists its own models (`modelList` in `agents.json`) may not
 * have a login for the catalog's: where its stored list is known, a choice that is a catalog model
 * missing from it becomes the model the agent itself would start with. A custom or listed model is
 * never touched. Codex can update its native catalog between reads of our list. This never starts
 * the agent.
 */
export async function readConfig(ctx: Ctx): Promise<Config> {
  const config = await readStoredConfig(ctx)
  const lists = await storedModelLists(ctx)
  const nativeCodex = lists.codex
    ? await freshCodexModels(ctx, config, lists.codex.checkedAt)
    : null
  return AGENTS.reduce((held, agent) => {
    const from = (agent === "codex" ? nativeCodex : null) ?? knownFrom(lists[agent])
    return from === null && agent !== "pi" ? held : usableModels(held, agent, from)
  }, config)
}

export async function writeConfig(ctx: Ctx, patch: unknown): Promise<Config> {
  // Choosing either place, anywhere, answers the place question for good.
  const chosen =
    isRecord(patch) &&
    ("answers" in patch || "approvals" in patch) &&
    !("answerPlaceChosen" in patch)
      ? { ...patch, answerPlaceChosen: true }
      : patch
  const next = settleConfig(await readStoredConfig(ctx), chosen)
  next.planning.lastStart = planningAfterSettings(next, patch, ctx.clock.now())
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.writeFile(configPath(ctx), `${JSON.stringify(next, null, 2)}\n`)
  return readConfig(ctx)
}
