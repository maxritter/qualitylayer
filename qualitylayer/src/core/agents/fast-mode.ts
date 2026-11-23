import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { roots, tomlGet } from "../install/agent-settings.ts"
import type { AgentKind } from "../run/contracts.ts"

const CLAUDE_MODELS = ["opus", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]
const CLAUDE_BLOCKING_ENV = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_DISABLE_FAST_MODE",
]
const CATALOG_MAX_AGE = 24 * 60 * 60 * 1000

const readIfPresent = async (ctx: Ctx, file: string): Promise<string> =>
  (await ctx.fs.exists(file)) ? ctx.fs.readFile(file) : ""

async function claudeFastModeModels(ctx: Ctx, claudeDir: string): Promise<string[]> {
  const settings = JSON.parse((await readIfPresent(ctx, join(claudeDir, "settings.json"))) || "{}")
  const env = (key: string) => ctx.env.get(key) ?? settings.env?.[key]
  const enabled = (key: string) => ![undefined, "", "0", "false"].includes(env(key))
  if (CLAUDE_BLOCKING_ENV.some(enabled)) return []
  const base = env("ANTHROPIC_BASE_URL")
  if (base && base.replace(/\/$/, "") !== "https://api.anthropic.com") return []
  const override = env("ANTHROPIC_DEFAULT_OPUS_MODEL")
  return override && !CLAUDE_MODELS.includes(override) ? CLAUDE_MODELS.slice(1) : [...CLAUDE_MODELS]
}

function supportsCodexFastMode(model: Record<string, unknown>): boolean {
  const tiers = model.service_tiers
  const speeds = model.additional_speed_tiers
  const hasTier =
    Array.isArray(tiers) && tiers.some((tier) => tier && ["priority", "fast"].includes(tier.id))
  const hasSpeed = Array.isArray(speeds) && speeds.includes("fast")
  return hasTier || hasSpeed
}

async function codexFastModeModels(ctx: Ctx, codexDir: string): Promise<string[]> {
  const config = await readIfPresent(ctx, join(codexDir, "config.toml"))
  const provider = tomlGet(config, null, "model_provider")?.replace(/^["']|["']$/g, "")
  if ((provider && provider !== "openai") || ctx.env.get("OPENAI_BASE_URL")) return []
  const catalog = JSON.parse(
    (await readIfPresent(ctx, join(codexDir, "models_cache.json"))) || "{}",
  )
  const age = ctx.clock.now() - Date.parse(catalog.fetched_at)
  if (!Number.isFinite(age) || age < 0 || age > CATALOG_MAX_AGE || !Array.isArray(catalog.models)) {
    return []
  }
  return catalog.models.flatMap((model: Record<string, unknown>) =>
    supportsCodexFastMode(model) && typeof model.slug === "string" ? [model.slug] : [],
  )
}

/** Capability only: native account eligibility and the inherited speed remain the client's decision. */
export async function fastModeModels(ctx: Ctx, agent: AgentKind): Promise<string[]> {
  const dirs = roots(ctx)
  if (!dirs || (agent !== "codex" && agent !== "claude-code")) return []
  try {
    return agent === "claude-code"
      ? await claudeFastModeModels(ctx, dirs.claude)
      : await codexFastModeModels(ctx, dirs.codex)
  } catch {
    return []
  }
}

export async function validateFastMode(
  ctx: Ctx,
  agent: AgentKind,
  model: string | undefined,
  value: unknown,
): Promise<void> {
  if (value === undefined) return
  if (typeof value !== "boolean") throw new Error("Invalid fastMode")
  if (!model || !(await fastModeModels(ctx, agent)).includes(model))
    throw new Error(
      "Fast mode is unavailable for this agent and model. Use the agent's settings or choose a supported model.",
    )
}
