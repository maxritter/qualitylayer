// The models an agent can use now, as the agent itself prints them (`modelList` in `agents.json`:
// OpenCode's `opencode models` lists a `provider/model` per line for every provider its own settings
// connect; Codex caches the account's models in `models_cache.json`). It runs only when a picker asks, never on a timer: one read-only command in its own
// process group with a time and size limit, one at a time per agent, and its answer is kept in the
// QualityLayer home (`model-list-store.ts`) for `MODEL_LIST_LIFETIME_MS`, so every picker, review and
// default in that time reads a file instead of starting the agent. A failed read keeps the older
// answer and is not repeated for `MODEL_LIST_RETRY_MS`.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { readConfig } from "../config.ts"
import { runBounded } from "../limits/bounded-run.ts"
import { agentEnvironment } from "../run/agent-env.ts"
import agentsJson from "./agents.json" with { type: "json" }
import { agentBinary } from "./binary.ts"
import { configDirEnvironment } from "./config-dir.ts"
import type { NativeAgent } from "./ids.ts"
import { codexCacheChanged, listFile, ownModel, readIds } from "./model-list-readers.ts"
import { type StoredModelList, storedModelLists, storeModelList } from "./model-list-store.ts"
import { listsModels } from "./model-values.ts"

/** How long one read of an agent's list is trusted. */
export const MODEL_LIST_LIFETIME_MS = 10 * 60_000
/** How long after a failed read the agent is left alone. */
export const MODEL_LIST_RETRY_MS = 2 * 60_000
/** The longest the command may take. */
export const MODEL_LIST_TIMEOUT_MS = 10_000
/** More output than this is not a model list. */
const MAX_OUTPUT = 512 * 1024
/** How long the output of a command that has exited may still drain. */
const DRAIN_MS = 250

/**
 * The ids in one output, read as the agent's `modelList.format` says: a `provider/model` per line
 * (OpenCode), the first two columns of a table (Pi), the `[model.<id>]` blocks of a file (Grok) or the
 * quoted ids under the `model` key of `copilot help config`.
 * Whatever else is printed is dropped, each id only in the characters a model id may hold, once, in
 * the order printed, at most `MODEL_LIST_IDS_MAX`.
 */
export function parseModelList(agent: NativeAgent, output: string, format?: string): string[] {
  return readIds(format ?? spec(agent)?.format ?? "lines", agent, output)
}

const reading = new WeakMap<Ctx["env"], Map<NativeAgent, Promise<StoredModelList | null>>>()
/** When a read failed for an agent that has no earlier answer, so nothing is stored for it. */
const failed = new WeakMap<Ctx["env"], Map<NativeAgent, number>>()

type ListSpec = { command: string[] | null; format: string; own: string | null; file?: string }
const spec = (agent: NativeAgent): ListSpec | null => {
  const list = (agentsJson as unknown as Record<string, { capabilities: { modelList?: unknown } }>)[
    agent
  ]?.capabilities.modelList
  return list === null || list === undefined ? null : (list as ListSpec)
}

/** The text one read parses: a command's output (null when it failed), or the settings file a command-less list names. */
async function sourceText(
  ctx: Ctx,
  read: {
    agent: NativeAgent
    list: ListSpec
    binary: string
    env: Record<string, string>
    timeoutMs: number
  },
): Promise<string | null> {
  const { agent, list, binary, env, timeoutMs } = read
  if (list.command === null) return listFile(ctx, agent, list.file ?? "config.toml", env)
  const cwd = join(ctx.home, "agents", "model-list")
  await ctx.fs.mkdir(cwd)
  const output = await runBounded(binary, list.command, {
    cwd,
    env,
    timeoutMs,
    maxBytes: MAX_OUTPUT,
    drainMs: DRAIN_MS,
  })
  return output !== null && output.code === 0 ? output.stdout : null
}

async function ask(
  ctx: Ctx,
  agent: NativeAgent,
  binary: string,
  held: StoredModelList | undefined,
  timeoutMs: number,
): Promise<StoredModelList | null> {
  const list = spec(agent)
  const now = ctx.clock.now()
  if (list === null) return null
  const env = await agentEnvironment(ctx, "model-list")
  const text = await sourceText(ctx, { agent, list, binary, env, timeoutMs })
  if (text === null) {
    const marks = failed.get(ctx.env) ?? new Map<NativeAgent, number>()
    failed.set(ctx.env, marks)
    if (held === undefined) {
      marks.set(agent, now)
      return null
    }
    const kept = { ...held, failedAt: now }
    await storeModelList(ctx, agent, kept)
    return kept
  }
  const models = readIds(list.format, agent, text)
  // An agent whose settings name no model of their own (`own` null: Copilot) has none to show.
  const own =
    list.own === null ? null : ((await ownModel(ctx, agent, list.own, env)) ?? models[0] ?? null)
  const entry: StoredModelList = { models, own, checkedAt: now, binary }
  failed.get(ctx.env)?.delete(agent)
  await storeModelList(ctx, agent, entry)
  return entry
}

/**
 * Whether asking now is pointless: the stored answer is recent and from this command, or an agent
 * with no answer at all failed a moment ago.
 */
function settled(
  ctx: Ctx,
  agent: NativeAgent,
  binary: string,
  held: StoredModelList | undefined,
): boolean {
  const now = ctx.clock.now()
  if (held === undefined) {
    const lastFailure = failed.get(ctx.env)?.get(agent)
    return lastFailure !== undefined && now - lastFailure < MODEL_LIST_RETRY_MS
  }
  return (
    held.binary === binary &&
    (now - held.checkedAt < MODEL_LIST_LIFETIME_MS ||
      (held.failedAt !== undefined && now - held.failedAt < MODEL_LIST_RETRY_MS))
  )
}

/** One read at a time per agent: callers that ask meanwhile share it. */
function shared(
  ctx: Ctx,
  agent: NativeAgent,
  start: () => Promise<StoredModelList | null>,
): Promise<StoredModelList | null> {
  const asking = reading.get(ctx.env) ?? new Map<NativeAgent, Promise<StoredModelList | null>>()
  reading.set(ctx.env, asking)
  const active = asking.get(agent)
  if (active !== undefined) return active
  const read = start().finally(() => asking.delete(agent))
  asking.set(agent, read)
  return read
}

/**
 * The agent's models: the stored answer while it is recent, else one command run shared by every
 * caller that asks meanwhile. Null when the agent lists no models, is not installed, or has never
 * answered. A person-chosen command or a new version of it is asked again.
 */
export async function readModelList(
  ctx: Ctx,
  agent: NativeAgent,
  timeoutMs: number = MODEL_LIST_TIMEOUT_MS,
): Promise<StoredModelList | null> {
  if (!listsModels(agent)) return null
  const held = (await storedModelLists(ctx))[agent]
  const binary = await agentBinary(ctx, agent)
  if (binary === null) return held ?? null
  if (settled(ctx, agent, binary, held)) {
    if (
      agent !== "codex" ||
      held === undefined ||
      !(await codexCacheChanged(
        ctx,
        Math.max(held.checkedAt, held.failedAt ?? 0),
        configDirEnvironment(ctx.env, (await readConfig(ctx)).agents),
      ))
    )
      return held ?? null
  }
  return shared(ctx, agent, () =>
    ask(ctx, agent, binary, held, timeoutMs).catch(() => held ?? null),
  )
}

/**
 * The same, but a read that takes longer than `ms` gives what is stored (or null) at once and ends
 * on its own: a hung command holds no picker up.
 */
export async function readModelListWithin(
  ctx: Ctx,
  agent: NativeAgent,
  ms: number,
): Promise<StoredModelList | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((done) => {
    timer = setTimeout(() => done("late"), ms)
  })
  try {
    const answer = await Promise.race([readModelList(ctx, agent), late])
    return answer === "late" ? ((await storedModelLists(ctx))[agent] ?? null) : answer
  } finally {
    clearTimeout(timer)
  }
}
