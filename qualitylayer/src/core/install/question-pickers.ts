// Whether each installed agent's question picker is ready, for `qualitylayer doctor`.
//
// Setup writes a setting only where an agent has one (`agent-settings.ts`); this reads, and
// writes nothing. A picker is `off` only when the person's own settings say so, and the reason
// names that setting. An agent whose `picker` in `agents.json` is false asks numbered choices in
// the chat.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { NATIVE_AGENTS, type NativeAgent } from "../agents/ids.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"
import { roots } from "./agent-settings.ts"
import { findAgentBinary } from "./agents-found.ts"

export type QuestionPicker = {
  agent: NativeAgent
  state: "ready" | "off" | "numbered"
  /** What turned the picker off, or why the chat asks numbered choices. */
  reason?: string
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

async function read(ctx: Ctx, path: string): Promise<string | null> {
  try {
    return (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : null
  } catch {
    return null
  }
}

/** The file's TOML table, or null when it is missing or not TOML. */
async function toml(ctx: Ctx, path: string): Promise<Record<string, unknown> | null> {
  const text = await read(ctx, path)
  try {
    return text === null ? null : record(Bun.TOML.parse(text))
  } catch {
    return null
  }
}

async function claudePickerOff(ctx: Ctx, dir: string): Promise<string | null> {
  const file = join(dir, "settings.json")
  const text = await read(ctx, file)
  try {
    const deny = record(record(text === null ? null : JSON.parse(text))?.permissions)?.deny
    const names =
      Array.isArray(deny) && deny.some((rule) => /^AskUserQuestion(\(|$)/.test(`${rule}`))
    return names ? `permissions.deny names AskUserQuestion in ${file}` : null
  } catch {
    return null
  }
}

async function tomlFeatureOff(
  ctx: Ctx,
  dir: string,
  key: string,
  label: string,
): Promise<string | null> {
  const file = join(dir, "config.toml")
  const off = record((await toml(ctx, file))?.features)?.[key] === false
  return off ? `${label} = false in ${file}` : null
}

async function opencodePickerOff(ctx: Ctx, dir: string): Promise<string | null> {
  // OpenCode's permission config takes `question` as a key; `"deny"` removes the tool.
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const file = join(dir, name)
    const text = await read(ctx, file)
    try {
      const question = record(
        record(text === null ? null : Bun.JSONC.parse(text))?.permission,
      )?.question
      if (question === "deny" || record(question)?.["*"] === "deny")
        return `permission.question is "deny" in ${file}`
    } catch {}
  }
  return null
}

/** The reason this agent's picker is off in the person's own settings, or null. */
async function turnedOff(
  ctx: Ctx,
  agent: NativeAgent,
  dirs: NonNullable<ReturnType<typeof roots>>,
): Promise<string | null> {
  switch (agent) {
    case "claude-code":
      return claudePickerOff(ctx, dirs.claude)
    case "codex":
      return tomlFeatureOff(
        ctx,
        dirs.codex,
        "default_mode_request_user_input",
        "default_mode_request_user_input",
      )
    case "grok":
      return tomlFeatureOff(ctx, dirs.grok, "ask_user_question", "features.ask_user_question")
    case "opencode":
      return opencodePickerOff(ctx, dirs.opencode)
    default:
      return null
  }
}

/**
 * One entry per installed agent, in the agents' order. `installed` says whether an agent is on this
 * machine; by default it is found as the rest of the installer finds it.
 */
export async function questionPickers(
  ctx: Ctx,
  installed: (agent: NativeAgent) => Promise<boolean> = async (agent) =>
    (await findAgentBinary(ctx, agent)) !== null,
): Promise<QuestionPicker[]> {
  const dirs = roots(ctx)
  const found = await Promise.all(NATIVE_AGENTS.map(installed))
  const out: QuestionPicker[] = []
  for (const agent of NATIVE_AGENTS.filter((_, i) => found[i])) {
    const reason = dirs === null ? null : await turnedOff(ctx, agent, dirs)
    out.push(
      reason !== null
        ? { agent, state: "off", reason }
        : AGENT_CAPABILITIES[agent].picker
          ? { agent, state: "ready" }
          : { agent, state: "numbered", reason: "questions are numbered choices in the chat" },
    )
  }
  return out
}
