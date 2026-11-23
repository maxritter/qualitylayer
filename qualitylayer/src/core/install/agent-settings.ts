// The agent settings QualityLayer's workflow relies on, set by the installer.
// Like Pilot Shell's installer, it only adds what is missing and says so: a key
// the user already has keeps its value, and a key the user removes after an
// install is not added again. Everything set is recorded, so uninstall puts
// back exactly those keys, and only while they still hold the installer's value.
//
// Every change is one key: a JSON path in Claude Code's settings.json, or a key
// in Codex's config.toml (top level or in one table).
//
// Nothing here ever asks a question.

import type { Ctx } from "../../ctx.ts"
import type { NativeAgent } from "../agents/ids.ts"
import { applySetting } from "./agent-settings-apply.ts"
import { applyCodexPermissions, trustCodexHooks } from "./agent-settings-codex.ts"
import { migrateCodexCompactReturn } from "./agent-settings-codex-migrate.ts"
import {
  MOD_SETTING,
  type Plan,
  type Records,
  readRecords,
  readText,
  type SettingItem,
  type SettingResult,
  writeRecords,
} from "./agent-settings-core.ts"
import { plans } from "./agent-settings-plans.ts"
import { CODEX_PERMISSION_IDS } from "./native-defaults.ts"

export {
  EFFORT_OPUS_PATH,
  modFolder,
  type Plan,
  roots,
  type SettingItem,
  type SettingResult,
} from "./agent-settings-core.ts"
export { launchHookGroups } from "./agent-settings-hooks.ts"
export { revertAgentSettings } from "./agent-settings-revert.ts"
export { jsonGet, jsonSet, tomlGet, tomlSet } from "./settings-document.ts"

export async function listAgentSettings(ctx: Ctx): Promise<SettingItem[]> {
  return (await plans(ctx)).map(({ key: _key, keptMessage: _k, ...item }) => item)
}

async function pruneDeletedSettingFiles(ctx: Ctx, records: Records): Promise<boolean> {
  // A settings file that is gone (a rebuilt dev container that kept only ~/.qualitylayer, an agent
  // installed afresh) took the installer's settings with it. The person removed none of them, so
  // their records go and they are set again.
  const gone = new Set<string>()
  for (const record of records.applied) {
    if (!gone.has(record.file) && (await readText(ctx, record.file)) === null) gone.add(record.file)
  }
  if (gone.size === 0) return false
  const lost = new Set(records.applied.filter((r) => gone.has(r.file)).map((r) => r.id))
  records.applied = records.applied.filter((r) => !gone.has(r.file))
  records.seen = records.seen.filter((id) => !lost.has(id))
  return true
}

function shouldApplyItem(item: Plan, records: Records, options: { repair?: NativeAgent }): boolean {
  if (item.state !== "available") return false
  // The mod's setting follows the files the installer just placed, even after an uninstall. A
  // hook the person took out is put back only when they ask for the repair.
  const repairs = options.repair !== undefined && item.integration === true
  if (item.id === MOD_SETTING || repairs || item.reshape === true) return true
  return !records.seen.includes(item.id)
}

/**
 * On install and update: set every setting that is missing and was never set
 * before (a key the user removed stays removed). A value of the user's own stays
 * and is said in the result. Nothing is asked. One result per item set or
 * kept with something to say. The mod's setting names a folder, so it is set only when `mod` says
 * the installer placed one.
 */
export async function configureAgents(
  ctx: Ctx,
  options: { mod?: boolean; repair?: NativeAgent } = {},
): Promise<SettingResult[]> {
  const results: SettingResult[] = []
  const records = await readRecords(ctx)
  const kept = new Map<string, string | null>()
  let changed = await pruneDeletedSettingFiles(ctx, records)
  changed = (await migrateCodexCompactReturn(ctx, records, kept)) || changed
  const items = (await plans(ctx)).filter(
    (item) => options.repair === undefined || item.agent === options.repair,
  )
  const permissions = await applyCodexPermissions(ctx, items, records, kept)
  changed ||= permissions.some((result) => result.done)
  results.push(...permissions)
  for (const item of items) {
    if (CODEX_PERMISSION_IDS.has(item.id) && item.state === "available") continue
    if (item.id === MOD_SETTING && options.mod !== true) continue
    if (shouldApplyItem(item, records, options)) {
      changed = true
      results.push(await applySetting(ctx, item, records, kept))
    } else if (item.state === "kept" && item.keptMessage !== undefined) {
      results.push({ id: item.id, done: false, message: item.keptMessage })
    }
  }
  const trust = await trustCodexHooks(ctx, items, records, kept)
  changed ||= trust.changed
  if (trust.result !== undefined) results.push(trust.result)
  if (changed) await writeRecords(ctx, records)
  return results
}
