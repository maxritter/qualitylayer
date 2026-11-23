import type { Ctx } from "../../ctx.ts"
import { locateRecord } from "../conversation/locate.ts"
import type { ControlRequest, RunRecord, RunSettings } from "./contracts.ts"
import {
  jsonlSelection,
  type NativeSettingField,
  type NativeSettingsTimes,
  type Selection,
  sqliteSelection,
  summarySelection,
} from "./effective-native-records.ts"
import { AGENT_CAPABILITIES, reportedPermission } from "./launch-spec.ts"

export type { NativeSettingField, NativeSettingsTimes }

/** Terminal edits may change a native choice without writing a new selection row yet. */
export function unverifiedNativeFields(
  run: RunRecord,
  seen: NativeSettingsTimes = {},
): NativeSettingField[] {
  if (run.agent !== "claude-code") return []
  const input = run.runEvents?.findLast(
    (row) => row.generation === run.generation && row.event === "TerminalInput",
  )
  const changedAt = Math.max(
    Date.parse(input?.at ?? "") || 0,
    Date.parse(run.generationStartedAt ?? "") || 0,
  )
  if (!changedAt) return []
  return (["model", "effort"] as const).filter(
    (field) => (Date.parse(seen[field] ?? "") || 0) < changedAt,
  )
}

export class NativeSettingsUnknownError extends Error {
  readonly code = "native_settings_unknown"
  constructor(readonly fields: NativeSettingField[]) {
    super(`Confirm the current ${fields.join(" and ")} before changing this session's settings.`)
    this.name = "NativeSettingsUnknownError"
  }
}

/** Fresh, bounded metadata from this run's main native session; no Conversation cache or global defaults. */
export function observedNativeSettings(ctx: Ctx, run: RunRecord): Selection {
  const permission = reportedNativePermission(run)
  const location = locateRecord(ctx, run)
  if (!location) return permission
  if (location.kind === "sqlite")
    return { ...permission, ...sqliteSelection(location.path, location.session) }
  return {
    ...permission,
    ...(run.agent === "grok"
      ? summarySelection(location.path)
      : jsonlSelection(location.path, run, unverifiedNativeFields)),
  }
}

export function reportedNativePermission(
  run: RunRecord,
): Partial<Pick<RunSettings, "perm" | "permMode">> {
  const row = run.runEvents?.findLast(
    (event) =>
      event.lead &&
      event.generation === run.generation &&
      event.nativeSession === run.nativeSession &&
      event.permissionMode === run.permissionMode,
  )
  if (!row?.permissionMode) return {}
  const mode = reportedPermission(run.agent, row.permissionMode)
  return mode ? { perm: mode.level, permMode: mode.id } : {}
}

/** Copilot restores these saved modes on resume; its flags cannot apply a requested downshift. */
export function assertNativePermissionChange(
  ctx: Ctx,
  run: RunRecord,
  requested?: ControlRequest["settings"],
): void {
  if (run.agent !== "copilot" || !["ask", "allow-tools"].includes(requested?.permMode ?? "")) return
  if (observedNativeSettings(ctx, run).permMode === requested?.permMode) return
  throw new Error(
    "Change Copilot's permission mode in its Terminal with /permissions, then apply other settings here. This conversation stays running; Copilot cannot change this saved mode through its resume flags.",
  )
}

/** A plain Resume can keep its last model choice when the native record has no newer verified selection. */
export function effectiveNativeSettings(
  ctx: Ctx,
  run: RunRecord,
  explicit?: ControlRequest["settings"],
  action?: "resume",
): Partial<RunSettings> {
  const { model, effort: _effort, ...remaining } = run.settings ?? {}
  const observed = observedNativeSettings(ctx, run)
  const selected = { ...remaining, ...observed, ...explicit }
  const canReuseModel =
    action === "resume" && explicit === undefined && selected.model === undefined
  if (canReuseModel && model !== undefined && !unverifiedNativeFields(run).includes("model")) {
    selected.model = model
  }
  if (explicit !== undefined) {
    // An agent with no separate effort control (Cursor keeps it in the model id) has none to confirm.
    const asked = (["model", "effort"] as const).filter(
      (field) => field === "model" || AGENT_CAPABILITIES[run.agent].effort === "separate",
    )
    const missing = asked.filter((field) => selected[field] === undefined)
    if (missing.length) throw new NativeSettingsUnknownError(missing)
  }
  return selected
}
