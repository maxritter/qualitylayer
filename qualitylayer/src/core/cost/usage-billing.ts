// How each agent is billed, as far as this computer can tell, so dollars are shown only for use that
// is billed by use. A plan is limits, not a bill; an API key or a gateway is a bill.
//
// - Claude Code: a base URL in its environment is a gateway (`ANTHROPIC_BASE_URL`); an API key
//   variable is a key (the same variables its limits reader treats as a sign-in without a plan); else
//   its last limits reading: windows are a plan, "signed in with an API key" is a key.
// - Codex: only the `auth_mode` of `auth.json` in its home (CODEX_HOME). The rest of that file holds
//   tokens: it is never parsed, kept, logged or returned, and the answer is one word.
// - Pi and OpenCode: a guess from the provider in front of the model ids they used. A provider that
//   sells a subscription (see SUBSCRIPTION_PROVIDERS) is a plan; any other provider is a key. Both
//   agents can be signed in either way for the same provider, so this is a guess and says so here only.
// - Copilot: always a plan; its use is credits or premium requests of the plan, not dollars.
// - Any other agent keeps no token counts and is not known.
//
// "unknown" is not a bill: the App shows no dollars for it.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { NativeAgent } from "../agents/ids.ts"
import { roots } from "../install/agent-settings.ts"
import { CLAUDE_NO_PLAN, CLAUDE_UNREPORTED, type ClaudeReport } from "../limits/claude-usage.ts"

export type UsageBilling = "plan" | "key" | "gateway" | "unknown"

/** What decides an agent's billing beyond its own folder: Claude Code's last limits reading. */
export type BillingHints = { claude?: () => Promise<ClaudeReport | null> }

/** The variables Claude Code signs in with instead of a plan when one is set. */
const CLAUDE_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]

const set = (ctx: Ctx, name: string): boolean => (ctx.env.get(name) ?? "") !== ""

function claudeReportBilling(report: ClaudeReport | null): UsageBilling {
  if (report === null) return "unknown"
  if ("windows" in report) return "plan"
  if (report.cause !== "no-plan") return "unknown"
  if (report.reason === CLAUDE_NO_PLAN) return "key"
  return report.reason === CLAUDE_UNREPORTED ? "plan" : "unknown"
}

async function claudeBilling(ctx: Ctx, hints: BillingHints): Promise<UsageBilling> {
  if (set(ctx, "ANTHROPIC_BASE_URL")) return "gateway"
  if (CLAUDE_KEY_VARIABLES.some((name) => set(ctx, name))) return "key"
  const report = (await hints.claude?.().catch(() => null)) ?? null
  return claudeReportBilling(report)
}

async function codexBilling(ctx: Ctx): Promise<UsageBilling> {
  const home = roots(ctx)?.codex
  if (home === undefined) return "unknown"
  let text: string
  try {
    text = await ctx.fs.readFile(join(home, "auth.json"))
  } catch {
    return "unknown"
  }
  const mode = topLevelAuthMode(text)
  if (mode === "chatgpt") return "plan"
  return mode === "apikey" ? "key" : "unknown"
}

/**
 * The top-level `auth_mode` string of a JSON object, found without building the object: strings are
 * walked past one at a time and objects below the top level (the file's tokens) are skipped over by
 * depth, so nothing of them is kept.
 */
export function topLevelAuthMode(text: string): string | null {
  let depth = 0
  let at = 0
  while (at < text.length) {
    const char = text[at]
    if (char === "{") depth++
    else if (char === "}") depth--
    if (char !== '"') {
      at++
      continue
    }
    const end = stringEnd(text, at)
    if (end < 0) return null
    const next = text.slice(end + 1).trimStart()
    const isKey = next.startsWith(":")
    if (depth === 1 && isKey && text.slice(at + 1, end) === "auth_mode") {
      const value = /^:\s*"([A-Za-z_]+)"/.exec(next)
      return value?.[1] ?? null
    }
    at = end + 1
  }
  return null
}

/** Where the string that starts at `from` ends; -1 when it never does. */
function stringEnd(text: string, from: number): number {
  for (let at = from + 1; at < text.length; at++) {
    if (text[at] === "\\") at++
    else if (text[at] === '"') return at
  }
  return -1
}

/** Providers that sell a subscription the agent can sign in with, so their use is a plan. */
const SUBSCRIPTION_PROVIDERS = new Set([
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
  "google-antigravity",
])

export function providerBillingKind(provider: unknown, model: string): UsageBilling {
  const named = typeof provider === "string" && provider !== "" ? provider : providerOf(model)
  return named === null ? "unknown" : SUBSCRIPTION_PROVIDERS.has(named) ? "plan" : "key"
}

/** The provider in front of a `provider/model` id; null for an id without one. */
const providerOf = (model: string): string | null => {
  const slash = model.indexOf("/")
  return slash > 0 ? model.slice(0, slash) : null
}

function providerBilling(models: readonly { model: string; tokens: number }[]): UsageBilling {
  const byProvider = new Map<string, number>()
  for (const { model, tokens } of models) {
    const provider = providerOf(model)
    if (provider !== null) byProvider.set(provider, (byProvider.get(provider) ?? 0) + tokens)
  }
  let main: string | null = null
  let most = -1
  for (const [provider, tokens] of byProvider)
    if (tokens > most) {
      main = provider
      most = tokens
    }
  if (main === null) return "unknown"
  return SUBSCRIPTION_PROVIDERS.has(main) ? "plan" : "key"
}

/** How an agent is billed; `models` are the ones it used in the period, with their tokens. */
export async function billingOf(
  ctx: Ctx,
  agent: NativeAgent,
  models: readonly { model: string; tokens: number }[],
  hints: BillingHints,
): Promise<UsageBilling> {
  if (agent === "claude-code") return claudeBilling(ctx, hints)
  if (agent === "codex") return codexBilling(ctx)
  if (agent === "pi" || agent === "opencode") return providerBilling(models)
  // Copilot is a plan (AI credits, or premium requests on a legacy plan), never a per-token bill.
  if (agent === "copilot") return "plan"
  return "unknown"
}
