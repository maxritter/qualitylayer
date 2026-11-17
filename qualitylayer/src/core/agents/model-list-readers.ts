// How each agent's list of its own models is read (`modelList` in `agents.json`): the formats its
// command or settings file prints them in, and the readers of the model the agent's own settings
// pick (`modelList.own`). Reading only reads text; nothing here starts a program.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { MODEL_LIST_IDS_MAX } from "../home-caps.ts"
import { roots } from "../install/agent-settings.ts"
import { plain, record } from "./account-reading.ts"
import { configDirVariable } from "./config-dir.ts"
import { type NativeAgent, validModelId } from "./ids.ts"

/** The most a settings file is read for. */
const SETTINGS_MAX_BYTES = 256 * 1024

const capped = (ids: Iterable<string>): string[] => [...ids].slice(0, MODEL_LIST_IDS_MAX)

/** `provider/model` per line, whatever else is printed around the ids dropped. */
function lines(agent: NativeAgent, text: string): string[] {
  const ids = new Set<string>()
  for (const line of plain(text).split(/\r?\n/)) {
    const id = line.trim()
    if (id.includes("/") && validModelId(agent, id)) ids.add(id)
    if (ids.size >= MODEL_LIST_IDS_MAX) break
  }
  return [...ids]
}

/** A table headed `provider  model …` (Pi): each row's first two words are `provider/model`. */
function table(agent: NativeAgent, text: string): string[] {
  const ids = new Set<string>()
  let headed = false
  for (const row of plain(text).split(/\r?\n/)) {
    const words = row.trim().split(/\s+/)
    if (!headed) headed = /^provider$/i.test(words[0] ?? "") && /^model$/i.test(words[1] ?? "")
    else if (words.length >= 2) {
      const id = `${words[0]}/${words[1]}`
      if (validModelId(agent, id)) ids.add(id)
    }
    if (ids.size >= MODEL_LIST_IDS_MAX) break
  }
  return [...ids]
}

const BLOCK = /^[ \t]*\[model\.(?:"([^"\n]+)"|'([^'\n]+)'|([A-Za-z0-9._-]+))\][ \t]*(?:#.*)?$/gm

/** The names of the `[model.<id>]` blocks of a TOML file (Grok). */
function blocks(agent: NativeAgent, text: string): string[] {
  const ids = new Set<string>()
  for (const match of text.matchAll(BLOCK)) {
    const id = match[1] ?? match[2] ?? match[3] ?? ""
    if (validModelId(agent, id)) ids.add(id)
  }
  return capped(ids)
}

const MODEL_KEY = /^[ \t]*`model`:/
const QUOTED_ID = /^[ \t]*-[ \t]+"([^"\n]+)"[ \t]*$/

/**
 * The quoted ids listed under the `model` key of `copilot help config` (`    - "claude-sonnet-5.5"`
 * per line); the list ends at the first line that is not one.
 */
function helpModels(agent: NativeAgent, text: string): string[] {
  const ids = new Set<string>()
  let listing = false
  for (const line of plain(text).split(/\r?\n/)) {
    if (!listing) listing = MODEL_KEY.test(line)
    else {
      const id = QUOTED_ID.exec(line)?.[1]
      if (id === undefined) break
      if (validModelId(agent, id)) ids.add(id)
    }
  }
  return capped(ids)
}

/**
 * The models Codex caches for the signed-in account (`models_cache.json`, the list its own `/model`
 * picker shows): each listed `slug` in Codex's `priority` order. Hidden models (its auto reviewer) are
 * left out.
 */
function codexCache(agent: NativeAgent, text: string): string[] {
  try {
    const models = record(JSON.parse(text))?.models
    if (!Array.isArray(models)) return []
    const listed = models
      .map((model) => record(model))
      .filter((model) => model?.visibility === "list" && validModelId(agent, model.slug))
      .map((model) => ({
        slug: model?.slug as string,
        rank: typeof model?.priority === "number" ? model.priority : Number.POSITIVE_INFINITY,
      }))
      // A stable sort: models without a priority keep their order, after those with one.
      .sort((a, b) => (a.rank === b.rank ? 0 : a.rank < b.rank ? -1 : 1))
    return capped(new Set(listed.map((model) => model.slug)))
  } catch {
    return []
  }
}

/**
 * An id then its name on each row: `id<TAB>name` (Antigravity's `agy models`) or `id - name`
 * (Cursor's `cursor-agent models`). Headings and notes around the rows are dropped.
 */
function idRows(agent: NativeAgent, text: string): string[] {
  const ids = new Set<string>()
  for (const line of plain(text).split(/\r?\n/)) {
    const id = /^(\S+)(?:\t+| - )\S/.exec(line.trim())?.[1]
    if (id !== undefined && validModelId(agent, id)) ids.add(id)
    if (ids.size >= MODEL_LIST_IDS_MAX) break
  }
  return [...ids]
}

const FORMATS: Record<string, (agent: NativeAgent, text: string) => string[]> = {
  "id-rows": idRows,
  lines,
  table,
  "toml-blocks": blocks,
  "copilot-help": helpModels,
  "codex-cache": codexCache,
}

/** The most a list file is read for: Codex's model cache carries each model's instructions. */
export const LIST_FILE_MAX_BYTES = 4 * 1024 * 1024

/** The ids in one text, read as `format` says; an unknown format reads none. */
export const readIds = (format: string, agent: NativeAgent, text: string): string[] =>
  FORMATS[format]?.(agent, text) ?? []

/** A small text file of the agent's own folder, or null when it is missing, too large or unreadable. */
export async function settingsText(
  ctx: Ctx,
  path: string,
  maxBytes = SETTINGS_MAX_BYTES,
): Promise<string | null> {
  try {
    if (!(await ctx.fs.exists(path))) return null
    const text = ctx.fs.readRange
      ? await ctx.fs.readRange(path, 0, maxBytes + 1)
      : await ctx.fs.readFile(path)
    return Buffer.byteLength(text) > maxBytes ? null : text
  } catch {
    return null
  }
}

const jsonModel = (agent: NativeAgent, text: string | null): string | null => {
  if (text === null) return null
  try {
    const model = record(Bun.JSONC.parse(text))?.model
    return typeof model === "string" && validModelId(agent, model) ? model : null
  } catch {
    return null
  }
}

/** The folder of the agent's own settings: its variable (in the process or the launch environment), else its default. */
function folderOf(ctx: Ctx, agent: NativeAgent, env: Record<string, string>): string | null {
  const variable = configDirVariable(agent)
  const moved = variable === null ? undefined : env[variable] || ctx.env.get(variable)
  const dirs = roots(ctx)
  return moved || (dirs === null ? null : dirs[agent === "claude-code" ? "claude" : agent])
}

type Reader = (ctx: Ctx, agent: NativeAgent, folder: string) => Promise<string | null>

/**
 * How each agent's own settings pick a model, as `agents.json` names it in `modelList.own`.
 * OpenCode: the `model` of `opencode.json` or `opencode.jsonc`, the later file winning.
 * Pi: `defaultProvider` and `defaultModel` of `settings.json`.
 * Grok: `default` of the `[models]` table of `config.toml`.
 */
const OWN: Record<string, Reader> = {
  "opencode-config": async (ctx, agent, folder) => {
    let own: string | null = null
    for (const name of ["opencode.json", "opencode.jsonc"])
      own = jsonModel(agent, await settingsText(ctx, join(folder, name))) ?? own
    return own
  },
  "pi-settings": async (ctx, agent, folder) => {
    const text = await settingsText(ctx, join(folder, "settings.json"))
    try {
      const settings = text === null ? null : record(JSON.parse(text))
      const id = `${settings?.defaultProvider}/${settings?.defaultModel}`
      return typeof settings?.defaultModel === "string" && validModelId(agent, id) ? id : null
    } catch {
      return null
    }
  },
  "grok-config": async (ctx, agent, folder) => {
    const text = await settingsText(ctx, join(folder, "config.toml"))
    const table = text?.match(/^[ \t]*\[models\][ \t]*$([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/m)?.[1]
    const id = table?.match(/^[ \t]*default[ \t]*=[ \t]*["']([^"'\n]+)["']/m)?.[1]
    return id !== undefined && validModelId(agent, id) ? id : null
  },
  // Codex: the top-level `model` of `config.toml`, before its first table.
  "codex-config": async (ctx, agent, folder) => {
    const text = await settingsText(ctx, join(folder, "config.toml"))
    const top = text?.split(/^[ \t]*\[/m)[0]
    const id = top?.match(/^[ \t]*model[ \t]*=[ \t]*["']([^"'\n]+)["']/m)?.[1]
    return id !== undefined && validModelId(agent, id) ? id : null
  },
}

/** The model the agent's own settings pick, or null. */
export async function ownModel(
  ctx: Ctx,
  agent: NativeAgent,
  reader: string,
  env: Record<string, string>,
): Promise<string | null> {
  const folder = folderOf(ctx, agent, env)
  return folder === null ? null : ((await OWN[reader]?.(ctx, agent, folder)) ?? null)
}

/** The text a command-less list is read from: the agent's settings file named by `file`. */
export async function listFile(
  ctx: Ctx,
  agent: NativeAgent,
  file: string,
  env: Record<string, string>,
): Promise<string | null> {
  const folder = folderOf(ctx, agent, env)
  return folder === null ? null : settingsText(ctx, join(folder, file), LIST_FILE_MAX_BYTES)
}

/** The Codex cache can change outside QualityLayer, without waiting for a picker to refresh. */
export async function codexCacheChanged(
  ctx: Ctx,
  checkedAt: number,
  env: Record<string, string>,
): Promise<boolean> {
  const folder = folderOf(ctx, "codex", env)
  if (folder === null) return false
  const stat = await ctx.fs.stat?.(join(folder, "models_cache.json"))
  return stat !== null && stat !== undefined && stat.mtimeMs > checkedAt
}
