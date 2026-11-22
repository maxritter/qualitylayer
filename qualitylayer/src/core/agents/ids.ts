import agentsJson from "./agents.json" with { type: "json" }

export const NATIVE_AGENTS = [
  "claude-code",
  "codex",
  "pi",
  "opencode",
  "cursor",
  "grok",
  "antigravity",
  "copilot",
] as const
export type NativeAgent = (typeof NATIVE_AGENTS)[number]

/** Human-facing order. Agent discovery and automatic reviewer selection keep their own priorities. */
const firstInPickers: readonly NativeAgent[] = ["claude-code", "codex", "antigravity"]
export const AGENT_DISPLAY_ORDER: readonly NativeAgent[] = [
  ...firstInPickers,
  ...NATIVE_AGENTS.filter((agent) => !firstInPickers.includes(agent)),
]

/**
 * Whether the agent's review runs where it cannot edit: `review.readOnly` in `agents.json` is
 * `enforced` (the agent refuses the edit) or `detected` (QualityLayer only sees it afterwards, in the
 * stream). An agent whose review command is built in code has no entry and is enforced.
 */
export const readOnlyEnforced = (agent: NativeAgent): boolean =>
  (agentsJson as unknown as Record<string, { capabilities: { review?: { readOnly: string } } }>)[
    agent
  ]?.capabilities.review?.readOnly !== "detected"

export const BINARIES: Record<NativeAgent, string> = {
  "claude-code": "claude",
  codex: "codex",
  pi: "pi",
  opencode: "opencode",
  cursor: "cursor-agent",
  grok: "grok",
  antigravity: "agy",
  copilot: "copilot",
}
export const AGENT_NAMES: Record<NativeAgent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  pi: "Pi",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok",
  antigravity: "Antigravity",
  copilot: "GitHub Copilot",
}
export const isNativeAgent = (value: unknown): value is NativeAgent =>
  typeof value === "string" && (NATIVE_AGENTS as readonly string[]).includes(value)

const PLAIN_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PROVIDER_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,255}$/
/** A Cursor model, plain (`claude-opus-5-5-high`) or with parameters (`claude-opus-4-8[context=1m,effort=high]`). */
const CURSOR_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:\[[A-Za-z0-9._=,-]{1,128}\])?$/

/** An alias, a full name, or an id a gateway serves (`my-gateway/claude-opus-5-5`): one word, no shell characters. */
const CLAUDE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*(?:\[1m\])?$/
const providerModel = (value: string) => PROVIDER_MODEL.test(value) && !value.includes("..")
/** What a native model id may look like for each agent. */
const MODEL_ID: Record<NativeAgent, (value: string) => boolean> = {
  "claude-code": (value) => value.length <= 64 && CLAUDE_MODEL.test(value) && !value.includes(".."),
  codex: (value) => PLAIN_MODEL.test(value),
  pi: providerModel,
  opencode: providerModel,
  cursor: (value) => CURSOR_MODEL.test(value),
  grok: (value) => PLAIN_MODEL.test(value),
  antigravity: (value) => PLAIN_MODEL.test(value),
  copilot: (value) => {
    const parts = value.split("/")
    return parts.length <= 2 && parts.every((part) => PLAIN_MODEL.test(part))
  },
}

/**
 * Provider-qualified names are native model IDs in Pi and OpenCode; Cursor's carry its own
 * `[name=value,…]` parameters.
 */
export function validModelId(agent: NativeAgent, value: unknown): value is string {
  return typeof value === "string" && MODEL_ID[agent](value)
}
