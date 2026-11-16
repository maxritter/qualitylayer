// The model each installed agent runs its subagents on, set where the agent
// itself reads it: Claude Code's CLAUDE_CODE_SUBAGENT_MODEL (settings.json
// env) and Codex's [agents] default_subagent_model (config.toml). A choice in
// the Cockpit writes that one key, so every subagent follows it, QualityLayer's
// helpers included; an agent that is not installed is never offered or touched.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { err, ok, type Result } from "../../ctx.ts"
import { configPath, readConfig, writeConfig } from "../config.ts"
import {
  EFFORT_OPUS_PATH,
  jsonGet,
  jsonSet,
  roots,
  tomlGet,
  tomlSet,
} from "../install/agent-settings.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"
import { installedBinary } from "./binary.ts"
import { fastModeModels } from "./fast-mode.ts"
import { AGENT_NAMES, NATIVE_AGENTS, type NativeAgent, validModelId } from "./ids.ts"
import { readModelListWithin } from "./model-list.ts"
import { knownFrom } from "./model-list-store.ts"
import { nativeModelIds, stepModels, usableDefault } from "./model-values.ts"

/** The longest a picker waits for an agent to print its own models; a slower read ends on its own. */
export const MODEL_LIST_WAIT_MS = 3000

export type SubagentAgent = NativeAgent

/**
 * The agents whose helper model and effort live in QualityLayer's own settings: every agent but
 * Claude Code and Codex, which read theirs from the agent's own settings file.
 */
const CONFIG_AGENTS = ["pi", "opencode", "cursor", "grok", "antigravity", "copilot"] as const
const inConfig = (agent: SubagentAgent): boolean =>
  (CONFIG_AGENTS as readonly string[]).includes(agent)

export type SubagentModels = {
  agent: SubagentAgent
  label: string
  /** Where the choice is written, for the settings page to name. */
  file: string
  models: { id: string; name: string }[]
  /** What the agent's own configuration says now; null when it sets nothing. */
  current: string | null
  /** QualityLayer's recommendation, the first of `models` unless the agent's own list says it cannot run. */
  recommended: string
  /** What an agent that lists its own models printed, and the model it would start with itself. */
  listed?: { models: string[]; own: string | null }
  /** The effort the session and its subagents run at; null when the agent's default applies. */
  effort: string | null
  efforts: string[]
  /** Its command is on PATH, so QualityLayer can start it for a review. */
  runnable: boolean
  /** Models with native Fast support; this does not report the inherited setting. */
  fastModeModels?: string[]
}

const CLAUDE_KEY = ["env", "CLAUDE_CODE_SUBAGENT_MODEL"]

const unquote = (value: string | null) =>
  value === null ? null : value.replace(/^["']|["']$/g, "")

/** The catalog's models, then the ids the person added. */
const withAdded = (catalog: { id: string; name: string }[], ids: readonly string[]) => [
  ...catalog,
  ...ids.filter((id) => !catalog.some((m) => m.id === id)).map((id) => ({ id, name: id })),
]

/** One entry per installed agent that has subagents and that Settings leaves on. */
export async function subagentModels(ctx: Ctx): Promise<SubagentModels[]> {
  const { agents } = await readConfig(ctx)
  const enabled = NATIVE_AGENTS.filter((agent) => agents[agent].enabled)
  return enabled.length === 0 ? [] : installedSubagentModels(ctx, enabled)
}

/**
 * One agent whose choices live in QualityLayer's settings: the catalog's models, then those the agent
 * lists itself (the read waits `MODEL_LIST_WAIT_MS` at most), and the model that can run.
 */
async function configAgentModels(
  ctx: Ctx,
  agent: (typeof CONFIG_AGENTS)[number],
): Promise<SubagentModels> {
  const own = await readModelListWithin(ctx, agent, MODEL_LIST_WAIT_MS)
  // After the list: a choice that cannot run is read as the agent's own model.
  const config = await readConfig(ctx)
  const catalog = stepModels(agent)
  const named = new Set(catalog.map((model) => model.id))
  return {
    agent,
    label: AGENT_NAMES[agent],
    file: configPath(ctx),
    models: withAdded(
      [
        ...catalog,
        ...(own?.models ?? []).filter((id) => !named.has(id)).map((id) => ({ id, name: id })),
      ],
      config.addedModels[agent],
    ),
    current: config.models[agent].helpers,
    recommended: usableDefault(agent, catalog[0]?.id ?? "", knownFrom(own ?? undefined)),
    ...(own === null ? {} : { listed: { models: own.models, own: own.own } }),
    effort: config.implement.defaults[agent].effort,
    efforts: [...AGENT_CAPABILITIES[agent].efforts],
    runnable: (await installedBinary(ctx, agent)) !== null,
  }
}

async function installedSubagentModels(
  ctx: Ctx,
  enabled: readonly NativeAgent[],
): Promise<SubagentModels[]> {
  const { addedModels: added } = await readConfig(ctx)
  const dirs = roots(ctx)
  if (dirs === null) return []
  const out: SubagentModels[] = []
  // An agent that was installed but never started has no configuration folder yet: it is listed too.
  const searches = new Map(enabled.map((agent) => [agent, installedBinary(ctx, agent)] as const))
  const here = async (agent: SubagentAgent, folder: string) =>
    enabled.includes(agent) &&
    ((await ctx.fs.exists(folder)) || (await searches.get(agent)) !== null)
  if (await here("claude-code", dirs.claude)) {
    const file = join(dirs.claude, "settings.json")
    let current: string | null = null
    let effort: string | null = null
    if (await ctx.fs.exists(file)) {
      try {
        const doc = JSON.parse(await ctx.fs.readFile(file))
        const value = jsonGet(doc, CLAUDE_KEY)
        current = typeof value === "string" && value !== "" ? value : null
        const level = jsonGet(doc, EFFORT_OPUS_PATH) ?? jsonGet(doc, ["effortLevel"])
        effort = typeof level === "string" && level !== "" ? level : null
      } catch {
        current = null
      }
    }
    const models = withAdded(stepModels("claude-code"), added["claude-code"])
    out.push({
      agent: "claude-code",
      fastModeModels: await fastModeModels(ctx, "claude-code"),
      label: "Claude Code",
      file,
      models,
      current,
      recommended: models[0]?.id ?? "sonnet",
      effort,
      efforts: [...AGENT_CAPABILITIES["claude-code"].efforts],
      runnable: (await installedBinary(ctx, "claude-code")) !== null,
    })
  }
  if (await here("codex", dirs.codex)) {
    const file = join(dirs.codex, "config.toml")
    const text = (await ctx.fs.exists(file)) ? await ctx.fs.readFile(file) : ""
    // The models Codex caches for the account reach every picker through `listed`.
    const own = await readModelListWithin(ctx, "codex", MODEL_LIST_WAIT_MS)
    const models = withAdded(stepModels("codex"), added.codex)
    out.push({
      agent: "codex",
      fastModeModels: await fastModeModels(ctx, "codex"),
      label: "Codex",
      file,
      models,
      ...(own === null ? {} : { listed: { models: own.models, own: own.own } }),
      current: unquote(tomlGet(text, "agents", "default_subagent_model")),
      recommended: models[0]?.id ?? "gpt-6.1-sol",
      effort:
        unquote(tomlGet(text, "agents", "default_subagent_reasoning_effort")) ??
        unquote(tomlGet(text, null, "model_reasoning_effort")),
      efforts: [...AGENT_CAPABILITIES.codex.efforts],
      runnable: (await installedBinary(ctx, "codex")) !== null,
    })
  }
  for (const agent of CONFIG_AGENTS)
    if (await here(agent, dirs[agent])) out.push(await configAgentModels(ctx, agent))
  return out
}

/**
 * Write one agent's effort for the session and its subagents: Claude Code's
 * top-level effortLevel and Opus 5.5's own (subagents inherit the session);
 * Codex's model_reasoning_effort and [agents] default_subagent_reasoning_effort.
 */
export async function setAgentEffort(
  ctx: Ctx,
  agent: string,
  effort: string,
): Promise<Result<SubagentModels>> {
  const entry = (await subagentModels(ctx)).find((a) => a.agent === agent)
  if (entry === undefined) {
    return err({ code: "bad_args", message: `${agent} is not installed on this machine` })
  }
  if (!entry.efforts.includes(effort)) {
    return err({ code: "bad_args", message: `${effort} is not an effort level` })
  }
  if (inConfig(entry.agent)) {
    await writeConfig(ctx, {
      planning: { defaults: { [entry.agent]: { effort } } },
      implement: { defaults: { [entry.agent]: { effort } } },
    })
    return ok({ ...entry, effort })
  }
  if (entry.agent === "claude-code") {
    let doc: Record<string, unknown> = {}
    if (await ctx.fs.exists(entry.file)) {
      try {
        doc = JSON.parse(await ctx.fs.readFile(entry.file)) as Record<string, unknown>
      } catch {
        return err({ code: "bad_args", message: `${entry.file} is not valid JSON; left as it is` })
      }
    }
    jsonSet(doc, ["effortLevel"], effort)
    jsonSet(doc, EFFORT_OPUS_PATH, effort)
    await ctx.fs.writeFile(entry.file, `${JSON.stringify(doc, null, 2)}\n`)
  } else {
    const text = (await ctx.fs.exists(entry.file)) ? await ctx.fs.readFile(entry.file) : ""
    const main = tomlSet(text, null, "model_reasoning_effort", JSON.stringify(effort)).text
    const both = tomlSet(
      main,
      "agents",
      "default_subagent_reasoning_effort",
      JSON.stringify(effort),
    )
    await ctx.fs.writeFile(entry.file, both.text)
  }
  return ok({ ...entry, effort })
}

/** Write one agent's subagent model where the agent reads it. */
export async function setSubagentModel(
  ctx: Ctx,
  agent: string,
  model: string,
): Promise<Result<SubagentModels>> {
  const entry = (await subagentModels(ctx)).find((a) => a.agent === agent)
  if (entry === undefined) {
    return err({ code: "bad_args", message: `${agent} is not installed on this machine` })
  }
  if (
    !(nativeModelIds(entry.agent)
      ? validModelId(entry.agent, model)
      : entry.models.some((m) => m.id === model))
  ) {
    return err({ code: "bad_args", message: `${model} is not a model ${entry.label} offers` })
  }
  if (inConfig(entry.agent)) {
    await writeConfig(ctx, { models: { [entry.agent]: { helpers: model } } })
    return ok({ ...entry, current: model })
  }
  if (entry.agent === "claude-code") {
    let doc: Record<string, unknown> = {}
    if (await ctx.fs.exists(entry.file)) {
      try {
        doc = JSON.parse(await ctx.fs.readFile(entry.file)) as Record<string, unknown>
      } catch {
        return err({ code: "bad_args", message: `${entry.file} is not valid JSON; left as it is` })
      }
    }
    jsonSet(doc, CLAUDE_KEY, model)
    await ctx.fs.writeFile(entry.file, `${JSON.stringify(doc, null, 2)}\n`)
  } else {
    const text = (await ctx.fs.exists(entry.file)) ? await ctx.fs.readFile(entry.file) : ""
    const next = tomlSet(text, "agents", "default_subagent_model", JSON.stringify(model))
    await ctx.fs.writeFile(entry.file, next.text)
  }
  return ok({ ...entry, current: model })
}
