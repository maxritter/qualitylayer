import type { Ctx } from "../../ctx.ts"
import { validModelId } from "../agents/ids.ts"
import type { ControlRequest, LaunchRecord, RunRecord } from "./contracts.ts"
import { stopRunAtBoundary } from "./control-guarded.ts"
import { runLifecycleControl } from "./control-lifecycle.ts"
import { assertNativeAvailable, nativeSessionFile } from "./control-native.ts"
import { AGENT_CAPABILITIES, withPermission } from "./launch-spec.ts"
import { releaseRunLeases } from "./lease.ts"
import { identityState, readHost, readRun, updateRun } from "./registry.ts"
import { CONTROL_SETTINGS, validateRunSettings } from "./settings-check.ts"
import { connectOrRevive, settleDeadHost } from "./settle.ts"

export { assertNativeAvailable, nativeSessionFile, stopRunAtBoundary }

export type ResumePreparation = { launch: LaunchRecord; binary: NonNullable<RunRecord["binary"]> }
export type ControlOptions = {
  settingsChange?: { id: string; authorized(): boolean }
  automaticRecovery?: boolean
  prepareResume?: (run: RunRecord, input: ControlRequest) => Promise<ResumePreparation>
  hostCommand?: (id: string) => string[]
}

const VALID_ACTIONS = new Set([
  "interrupt",
  "stop",
  "move",
  "take-control",
  "restart",
  "resume",
  "send-request",
  "configure",
])
const VALID_KEYS = new Set(["action", "generation", "settings", "mode", "confirmBypass"])
const CONFIGURE_KEYS = new Set(["model", "effort", "perm", "permMode"])

function assertValidConfigure(v: ControlRequest): void {
  if (v.action !== "configure") return
  const keys = v.settings ? Object.keys(v.settings) : []
  const valid =
    keys.length > 0 && v.mode === undefined && keys.every((key) => CONFIGURE_KEYS.has(key))
  if (!valid)
    throw new Error("Choose model, effort or permission settings to apply after this turn")
}

export function validateControl(input: unknown): ControlRequest {
  if (!input || typeof input !== "object") throw new Error("Expected a run control")
  const v = input as ControlRequest
  if (!VALID_ACTIONS.has(v.action) || !Number.isSafeInteger(v.generation) || v.generation < 1)
    throw new Error("Invalid run control or generation")
  if (Object.keys(v).some((key) => !VALID_KEYS.has(key)))
    throw new Error("Unknown run control choice")
  if (v.mode !== undefined && v.mode !== "open" && v.mode !== "continue")
    throw new Error("Invalid resume mode")
  if (v.confirmBypass !== undefined && typeof v.confirmBypass !== "boolean")
    throw new Error("Invalid Bypass confirmation")
  if (
    v.settings !== undefined &&
    (!v.settings || typeof v.settings !== "object" || Array.isArray(v.settings))
  )
    throw new Error("Invalid run settings")
  validateRunSettings(v.settings ?? {}, CONTROL_SETTINGS)
  assertValidConfigure(v)
  return v
}

async function trySettleDeadStop(ctx: Ctx, run: RunRecord): Promise<RunRecord | null> {
  // A host that died with its machine has no socket to answer Stop; finishing its cleanup is the stop.
  const settled = await settleDeadHost(ctx.home, run.id, run.generation, true)
  if (!settled || (settled.status !== "stopped" && settled.status !== "failed")) return null
  try {
    await releaseRunLeases(ctx, run.id, run.generation)
    return settled
  } catch (cause) {
    // A failed launch can still have a live host. Explicit Stop must reach that host.
    if (!settled.host || identityState(settled.host) !== "live") throw cause
    return null
  }
}

async function waitForStoppedRun(ctx: Ctx, run: RunRecord): Promise<RunRecord> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const current = readRun(ctx.home, run.id)
    const host = readHost(ctx.home, run.id)
    if (current?.status === "stopped" && host?.cleanup?.complete) {
      // The host writes the final record just before exiting; wait until its process is gone.
      try {
        await releaseRunLeases(ctx, run.id, run.generation)
        return current
      } catch {
        /* recheck */
      }
    }
    await Bun.sleep(25)
  }
  throw new Error("Stop is still cleaning up owned processes; its lease remains held")
}

async function stopOrInterruptRun(
  ctx: Ctx,
  run: RunRecord,
  action: "stop" | "interrupt",
): Promise<RunRecord> {
  if (action === "interrupt" && !AGENT_CAPABILITIES[run.agent].interruptKey)
    throw new Error("This agent has no known interrupt key")
  updateRun(ctx.home, run.id, run.generation, {
    pendingSettings: undefined,
    recovery: { generation: run.generation, state: "cancelled", at: new Date().toISOString() },
  })
  const alreadyEnded =
    run.status === "stopped" || (run.status === "failed" && !readHost(ctx.home, run.id)?.lead)
  if (action !== "stop" && alreadyEnded) return run
  if (run.intent && run.intent.state !== "complete")
    updateRun(ctx.home, run.id, run.generation, {
      intent: {
        ...run.intent,
        state: "paused",
        reason:
          action === "stop"
            ? "Stopped by you. Resume explicitly to continue."
            : "Interrupted by you. Resume explicitly to continue.",
      },
    })
  if (action === "stop") {
    const settled = await trySettleDeadStop(ctx, run)
    if (settled) return settled
  }
  const connection = await connectOrRevive(ctx.home, run.id)
  try {
    if (action === "stop") updateRun(ctx.home, run.id, run.generation, { status: "stopping" })
    connection.send({ type: "control", action, generation: run.generation })
    return action === "interrupt"
      ? (readRun(ctx.home, run.id) ?? run)
      : await waitForStoppedRun(ctx, run)
  } finally {
    connection.close()
  }
}

export async function controlRun(
  ctx: Ctx,
  run: RunRecord,
  input: ControlRequest,
  options: ControlOptions = {},
): Promise<RunRecord> {
  validateControl(input)
  if (input.action === "configure") throw new Error("Settings changes require server authority")
  if (
    input.settings?.model &&
    run.agent !== "other" &&
    !validModelId(run.agent, input.settings.model)
  )
    throw new Error(`Invalid model for ${run.agent}`)
  // A level and a mode named together must agree; naming either replaces the run's earlier pair.
  const requested = withPermission(run.agent, input.settings)
  if (input.generation !== run.generation) throw new Error("stale run generation")
  if (input.action === "move" || input.action === "resume" || input.action === "restart") {
    return runLifecycleControl({
      ctx,
      run,
      input,
      requested,
      options,
      stopRun: (target) =>
        controlRun(ctx, target, { action: "stop", generation: target.generation }),
    })
  }
  if (input.action !== "interrupt" && input.action !== "stop")
    throw new Error(
      input.action === "take-control"
        ? "Take control must address this mounted terminal's socket"
        : "This control is not available yet",
    )
  return stopOrInterruptRun(ctx, run, input.action)
}
