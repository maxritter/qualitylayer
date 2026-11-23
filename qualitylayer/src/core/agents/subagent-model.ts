// The model each installed agent runs its subagents on, set where the agent
// itself reads it: Claude Code's CLAUDE_CODE_SUBAGENT_MODEL (settings.json
// env) and Codex's [agents] default_subagent_model (config.toml). A choice in
// the Cockpit writes that one key, so every subagent follows it, QualityLayer's
// helpers included; an agent that is not installed is never offered or touched.

import type { Ctx } from "../../ctx.ts"
import { err, ok, type Result } from "../../ctx.ts"
import { readConfig, writeConfig } from "../config.ts"
import { EFFORT_OPUS_PATH, jsonSet, tomlSet } from "../install/agent-settings.ts"
import { NATIVE_AGENTS, validModelId } from "./ids.ts"
import { nativeModelIds } from "./model-values.ts"
import {
  CLAUDE_KEY,
  inConfig,
  installedSubagentModels,
  type SubagentModels,
} from "./subagent-model-read.ts"

export type { SubagentModels }

/** One entry per installed agent that has subagents and that Settings leaves on. */
export async function subagentModels(ctx: Ctx): Promise<SubagentModels[]> {
  const { agents } = await readConfig(ctx)
  const enabled = NATIVE_AGENTS.filter((agent) => agents[agent].enabled)
  return enabled.length === 0 ? [] : installedSubagentModels(ctx, enabled)
}

async function updateClaudeSettings(
  ctx: Ctx,
  file: string,
  mutate: (doc: Record<string, unknown>) => void,
): Promise<Result<void>> {
  let doc: Record<string, unknown> = {}
  if (await ctx.fs.exists(file)) {
    try {
      doc = JSON.parse(await ctx.fs.readFile(file)) as Record<string, unknown>
    } catch {
      return err({ code: "bad_args", message: `${file} is not valid JSON; left as it is` })
    }
  }
  mutate(doc)
  await ctx.fs.writeFile(file, `${JSON.stringify(doc, null, 2)}\n`)
  return ok(undefined)
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
    const updated = await updateClaudeSettings(ctx, entry.file, (doc) => {
      jsonSet(doc, ["effortLevel"], effort)
      jsonSet(doc, EFFORT_OPUS_PATH, effort)
    })
    if (!updated.ok) return updated
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
    const updated = await updateClaudeSettings(ctx, entry.file, (doc) => {
      jsonSet(doc, CLAUDE_KEY, model)
    })
    if (!updated.ok) return updated
  } else {
    const text = (await ctx.fs.exists(entry.file)) ? await ctx.fs.readFile(entry.file) : ""
    const next = tomlSet(text, "agents", "default_subagent_model", JSON.stringify(model))
    await ctx.fs.writeFile(entry.file, next.text)
  }
  return ok({ ...entry, current: model })
}
