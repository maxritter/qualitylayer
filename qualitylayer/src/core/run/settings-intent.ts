import { randomUUID } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { validModelId } from "../agents/ids.ts"
import type { ControlRequest, HostRecord, RunRecord } from "./contracts.ts"
import { validateControl } from "./control.ts"
import {
  assertNativePermissionChange,
  effectiveNativeSettings,
  observedNativeSettings,
} from "./effective-native-settings.ts"
import { withPermission } from "./launch-spec.ts"
import { readHost, readRun, runDir, updateRun } from "./registry.ts"

export { applyQueuedSettings } from "./settings-intent-apply.ts"

const NOT_READY = "This native session is not ready for a settings change"

/**
 * Why this session's model, effort and permissions cannot be changed from the App now; null when they
 * can. The App shows the chips as plain text with this as their tooltip, and a change is refused with it.
 */
export function settingsLock(
  run: RunRecord,
  host: Pick<HostRecord, "guardedRestart"> | null | undefined,
): string | null {
  if (run.agent === "other") return "This agent keeps its own settings; change them in its window"
  if (!run.nativeSession || !["running", "stopped", "failed"].includes(run.status)) return NOT_READY
  if (run.status === "running" && host?.guardedRestart !== true)
    return "This host cannot apply session settings safely; update its host before changing settings"
  return null
}

/** A person chooses once; later application retains the native restart and authority checks. */
export async function queueSettings(
  ctx: Ctx,
  run: RunRecord,
  input: ControlRequest,
  authorityProof: string,
): Promise<RunRecord> {
  validateControl(input)
  return ctx.fs.withLock(join(runDir(ctx.home, run.id), "control.lock"), async () => {
    const current = readRun(ctx.home, run.id)
    if (!current || current.generation !== input.generation) throw new Error("stale run generation")
    const locked = settingsLock(current, readHost(ctx.home, current.id))
    if (locked) throw new Error(locked)
    // The lock rules these out; the check narrows their types.
    if (current.agent === "other" || !current.nativeSession) throw new Error(NOT_READY)
    const settings = withPermission(current.agent, input.settings) ?? {}
    if (settings.model && !validModelId(current.agent, settings.model))
      throw new Error(`Invalid model for ${current.agent}`)
    assertNativePermissionChange(ctx, current, settings)
    effectiveNativeSettings(ctx, current, settings)
    if (
      settings.perm === "bypass" &&
      observedNativeSettings(ctx, current).perm !== "bypass" &&
      input.confirmBypass !== true
    )
      throw new Error("Confirm Bypass for this run before changing its permission level")
    return updateRun(ctx.home, current.id, current.generation, {
      pendingSettings: {
        id: randomUUID(),
        generation: current.generation,
        nativeSession: current.nativeSession,
        requestedAt: new Date(ctx.clock.now()).toISOString(),
        requestedStatus: current.status as "running" | "stopped" | "failed",
        authorityProof,
        settings,
        ...(input.confirmBypass ? { confirmBypass: true } : {}),
      },
    })
  })
}
