import { Database } from "bun:sqlite"
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import {
  claudeSettingsCommand,
  claudeSettingsCursor,
  readClaudeSettingsChange,
} from "../conversation/claude-settings.ts"
import { copilotSelectedModel } from "../conversation/copilot.ts"
import { locateRecord } from "../conversation/locate.ts"
import { nativeEffort } from "../conversation/types.ts"
import type { ControlRequest, RunRecord, RunSettings } from "./contracts.ts"
import { AGENT_CAPABILITIES, reportedPermission } from "./launch-spec.ts"

export type NativeSettingField = "model" | "effort"
export type NativeSettingsTimes = Partial<Record<NativeSettingField, string>>

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
type Selection = Partial<Pick<RunSettings, NativeSettingField | "perm" | "permMode">>
type Json = Record<string, unknown>
const MAX_BYTES = 4 * 1024 * 1024
const COPILOT_MAX_BYTES = 16 * 1024 * 1024
const MAX_LINES = 8192
const MAX_SUMMARY_BYTES = 64 * 1024
const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined
const modelId = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/+@[\]#-]{0,255}$/.test(value)
    ? value
    : undefined

export class NativeSettingsUnknownError extends Error {
  readonly code = "native_settings_unknown"
  constructor(readonly fields: NativeSettingField[]) {
    super(`Confirm the current ${fields.join(" and ")} before changing this session's settings.`)
    this.name = "NativeSettingsUnknownError"
  }
}

function qualifiedModel(provider: unknown, id: unknown): string | undefined {
  const name = modelId(id)
  const source = modelId(provider)
  return name && source ? `${source}/${name}` : undefined
}

/** Read only the selected main session, never its assistant history or related sessions. */
function sqliteSelection(path: string, session: string): Selection {
  let db: Database | undefined
  try {
    db = new Database(path, { readonly: true })
    const row = db
      .query("SELECT substr(model, 1, 4097) AS model FROM session_v2 WHERE id = ?")
      .get(session) as {
      model?: unknown
    } | null
    if (typeof row?.model !== "string" || row.model.length > 4096) return {}
    const selected = object(JSON.parse(row.model))
    return {
      model: qualifiedModel(selected?.providerID, selected?.id),
      effort: nativeEffort(selected?.variant),
    }
  } catch {
    return {}
  } finally {
    db?.close()
  }
}

/**
 * One row of Copilot's record into `selected`; true once native selection metadata chose the model.
 * Usage can report effort, but its routed model never chooses the next session's model.
 */
function copilotSelection(
  row: Json,
  selected: Selection,
  chosen: boolean,
  run: RunRecord,
): boolean {
  const boundary = Date.parse(run.generationStartedAt ?? run.startedAt)
  const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN
  if (row.type === "session.permissions_changed" && Number.isFinite(boundary) && at >= boundary) {
    const change = object(row.data)
    const mode = change?.allowAllPermissionMode
    const choices = {
      off: { perm: "own", permMode: "ask" },
      on: { perm: "bypass", permMode: "bypass" },
      auto: { perm: "fewer", permMode: "allow-tools" },
    } as const
    if (
      typeof mode === "string" &&
      Object.hasOwn(choices, mode) &&
      change?.allowAllPermissions === (mode === "on")
    )
      Object.assign(selected, choices[mode as keyof typeof choices])
  }
  if (row.type === "session.start" || row.type === "session.model_change") {
    const change = object(row.data)
    selected.model = modelId(copilotSelectedModel(row.type, row.data))
    selected.effort = nativeEffort(change?.reasoningEffort)
    return selected.model !== undefined
  }
  if (row.type === "session.usage_record") {
    const usage = object(object(row.data)?.usage)
    selected.effort = nativeEffort(usage?.reasoningEffort) ?? selected.effort
  }
  return chosen
}

function jsonlSelection(path: string, run: RunRecord): Selection {
  let fd: number | undefined
  try {
    if (!lstatSync(path).isFile()) return {}
    fd = openSync(path, "r")
    const before = fstatSync(fd)
    if (!before.isFile() || before.size === 0) return {}
    const limit = run.agent === "copilot" ? COPILOT_MAX_BYTES : MAX_BYTES
    const start = Math.max(0, before.size - limit)
    const buffer = Buffer.alloc(Math.min(before.size, limit))
    const count = readSync(fd, buffer, 0, buffer.length, start)
    const after = fstatSync(fd)
    const current = lstatSync(path)
    if (
      count !== buffer.length ||
      !current.isFile() ||
      before.dev !== current.dev ||
      before.ino !== current.ino ||
      before.size !== current.size ||
      before.mtimeMs !== current.mtimeMs ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      return {}
    let text = buffer.toString("utf8")
    if (!text.endsWith("\n")) return {}
    if (start > 0) text = text.slice(text.indexOf("\n") + 1)
    const lines = text.trimEnd().split("\n")
    if (lines.length > MAX_LINES) return {}
    const selected: Selection = {}
    const seen: NativeSettingsTimes = {}
    let chosen = false
    const localSettings = claudeSettingsCursor(
      run.agent === "claude-code" && run.nativeSession
        ? { session: run.nativeSession, cwd: run.cwd }
        : undefined,
    )
    for (const line of lines) {
      const row = object(JSON.parse(line))
      const change =
        row && run.agent === "claude-code"
          ? readClaudeSettingsChange(row, localSettings)
          : undefined
      if (!row || row.isSidechain === true) continue
      if (typeof row.sessionId === "string" && row.sessionId !== run.nativeSession) continue
      if (run.agent === "claude-code") {
        if (change) {
          for (const field of change.withdrawn) delete selected[field]
          Object.assign(selected, change.values)
          for (const field of ["model", "effort"] as const)
            if (change.values?.[field] !== undefined && typeof row.timestamp === "string")
              seen[field] = row.timestamp
          continue
        }
        for (const field of claudeSettingsCommand(row)) delete selected[field]
        const message = object(row.message)
        if (row.type === "assistant" && message?.role === "assistant") {
          const model = modelId(message.model)
          if (!model) continue
          if (model !== selected.model) selected.effort = undefined
          selected.model = model
          if (typeof row.timestamp === "string") seen.model = row.timestamp
          selected.effort = nativeEffort(row.effort) ?? selected.effort
          if (nativeEffort(row.effort) && typeof row.timestamp === "string")
            seen.effort = row.timestamp
        }
      } else if (run.agent === "codex" && row.type === "turn_context") {
        const context = object(row.payload)
        selected.model = modelId(context?.model)
        selected.effort = nativeEffort(context?.effort ?? context?.reasoning_effort)
      } else if (run.agent === "copilot") {
        chosen = copilotSelection(row, selected, chosen, run)
      } else if (run.agent === "pi") {
        if (row.type === "model_change") {
          selected.model = qualifiedModel(row.provider, row.modelId)
        } else if (row.type === "thinking_level_change") {
          selected.effort = nativeEffort(row.thinkingLevel)
        }
      }
    }
    for (const field of unverifiedNativeFields(run, seen)) delete selected[field]
    return selected
  } catch {
    return {}
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Grok keeps the model and effort of a session in the summary beside its update log. */
function summarySelection(recordPath: string): Selection {
  try {
    const path = join(dirname(recordPath), "summary.json")
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > MAX_SUMMARY_BYTES) return {}
    const summary = object(JSON.parse(readFileSync(path, "utf8")))
    return {
      model: modelId(summary?.current_model_id),
      effort: nativeEffort(summary?.reasoning_effort),
    }
  } catch {
    return {}
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
      : jsonlSelection(location.path, run)),
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
  if (
    action === "resume" &&
    explicit === undefined &&
    selected.model === undefined &&
    model !== undefined &&
    !unverifiedNativeFields(run).includes("model")
  ) {
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
