import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { isRolloutOf } from "../agents/codex-rollout.ts"
import { validModelId } from "../agents/ids.ts"
import { locateRecord } from "../conversation/locate.ts"
import { hasHookFile } from "../install/agent-hooks.ts"
import { recordLiveness } from "../peers/claude.ts"
import { lsofHoldersChecked } from "../peers/codex.ts"
import { homeVariable } from "../platform.ts"
import { acceptedStopSequence, acceptedTurnBoundary, permissionChangeBoundary } from "./bind.ts"
import {
  type ControlRequest,
  canRecoverRun,
  type LaunchRecord,
  type RunRecord,
} from "./contracts.ts"
import {
  assertNativePermissionChange,
  effectiveNativeSettings,
  observedNativeSettings,
} from "./effective-native-settings.ts"
import { assertPreviousMayResume } from "./fresh-state.ts"
import { AGENT_CAPABILITIES, withPermission } from "./launch-spec.ts"
import { acquireRunLeases, releaseRunLeases, runTaskLeaseKey } from "./lease.ts"
import { assertNativeSessionFree, extraNativeSessionFile } from "./native-sessions.ts"
import { procFileHolders } from "./processes.ts"
import {
  connectHost,
  identityState,
  listRuns,
  nextGeneration,
  processIdentity,
  readHost,
  readRun,
  runDir,
  startHost,
  updateRun,
  writeLaunch,
} from "./registry.ts"
import { CONTROL_SETTINGS, validateRunSettings } from "./settings-check.ts"
import { connectOrRevive, settleDeadHost } from "./settle.ts"

export type ResumePreparation = { launch: LaunchRecord; binary: NonNullable<RunRecord["binary"]> }
export type ControlOptions = {
  settingsChange?: { id: string; authorized(): boolean }
  automaticRecovery?: boolean
  prepareResume?: (run: RunRecord, input: ControlRequest) => Promise<ResumePreparation>
  hostCommand?: (id: string) => string[]
}

function names(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}
/** The saved native transcript is a prerequisite; a recorded UUID alone cannot resume a session. */
export function nativeSessionFile(ctx: Ctx, run: RunRecord): string | null {
  const id = run.nativeSession
  if (run.agent === "other" || !id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null
  const home = homeVariable(ctx.env)
  if (!home) return null
  if (run.agent === "pi" || run.agent === "opencode") return extraNativeSessionFile(ctx, run)
  if (run.agent === "claude-code") {
    const root = join(ctx.env.get("CLAUDE_CONFIG_DIR") || join(home, ".claude"), "projects")
    const own = join(root, run.cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`)
    if (existsSync(own)) return own
    for (const name of names(root).slice(0, 4096)) {
      const path = join(root, name, `${id}.jsonl`)
      if (existsSync(path)) return path
    }
    return null
  }
  if (run.agent !== "codex") return locateRecord(ctx, run)?.path ?? null
  return codexSessionFile(join(ctx.env.get("CODEX_HOME") || join(home, ".codex"), "sessions"), id)
}

const datedFolders = (path: string, pattern: RegExp) =>
  names(path).filter((name) => pattern.test(name))

/** Codex's rollout for a session: `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl[.zst]`, searching at most 4096 days. */
function codexSessionFile(root: string, id: string): string | null {
  let inspected = 0
  for (const year of datedFolders(root, /^\d{4}$/))
    for (const month of datedFolders(join(root, year), /^\d{2}$/))
      for (const day of datedFolders(join(root, year, month), /^\d{2}$/)) {
        if (++inspected > 4096) return null
        const dir = join(root, year, month, day)
        // The plain file sorts before its compressed one: Codex resumes from it when both are there.
        const match = names(dir)
          .filter((name) => isRolloutOf(name, id))
          .sort()[0]
        if (match) return join(dir, match)
      }
  return null
}
export function assertNativeAvailable(ctx: Ctx, run: RunRecord): void {
  const file = nativeSessionFile(ctx, run)
  if (!file) throw new Error("The native session is gone. Start a fresh run instead.")
  for (const other of listRuns(ctx.home)) {
    if (
      other.id !== run.id &&
      other.agent === run.agent &&
      other.nativeSession === run.nativeSession &&
      !["stopped", "failed"].includes(other.status)
    )
      throw new Error("This native session is running in another managed window.")
  }
  if (run.agent === "claude-code") {
    const root = join(
      ctx.env.get("CLAUDE_CONFIG_DIR") || join(homeVariable(ctx.env) as string, ".claude"),
      "sessions",
    )
    for (const name of names(root).slice(0, 4096)) {
      if (!name.endsWith(".json")) continue
      let row: Record<string, unknown>
      try {
        row = JSON.parse(readFileSync(join(root, name), "utf8"))
      } catch {
        continue
      }
      if (row.sessionId !== run.nativeSession) continue
      const state = recordLiveness({ ...row, _path: join(root, name) })
      if (state !== "dead")
        throw new Error(
          state === "live"
            ? "This native session is alive in another terminal."
            : "This native session's process identity cannot be verified; resume was refused.",
        )
    }
  } else if (run.agent === "pi" || run.agent === "opencode" || hasHookFile(run.agent)) {
    assertNativeSessionFree(ctx, run)
  } else if (run.agent === "codex") {
    const root = ctx.env.get("CODEX_HOME") || join(homeVariable(ctx.env) as string, ".codex")
    const held = [file, join(root, "thread-writer-locks", `${run.nativeSession}.lock`)]
    // Linux says in /proc who holds a file; a plain server often has no lsof to ask.
    const [holders, verified] =
      process.platform === "linux" ? procFileHolders(held, /codex/i) : lsofHoldersChecked(held)
    if (!verified)
      throw new Error(
        "This native session's process identity cannot be verified; resume was refused.",
      )
    for (const rows of holders.values())
      for (const [pid] of rows) {
        const witness = processIdentity(pid, "descendant")
        if (!witness)
          throw new Error(
            "This native session's holder identity cannot be verified; resume was refused.",
          )
        if (identityState(witness) === "dead") continue
        throw new Error(`This native session is alive in another terminal (pid ${pid}).`)
      }
  }
}

export function validateControl(input: unknown): ControlRequest {
  if (!input || typeof input !== "object") throw new Error("Expected a run control")
  const v = input as ControlRequest
  if (
    ![
      "interrupt",
      "stop",
      "move",
      "take-control",
      "restart",
      "resume",
      "send-request",
      "configure",
    ].includes(v.action) ||
    !Number.isSafeInteger(v.generation) ||
    v.generation < 1
  )
    throw new Error("Invalid run control or generation")
  if (
    Object.keys(v).some(
      (key) => !["action", "generation", "settings", "mode", "confirmBypass"].includes(key),
    )
  )
    throw new Error("Unknown run control choice")
  if (v.mode !== undefined && !["open", "continue"].includes(v.mode))
    throw new Error("Invalid resume mode")
  if (v.confirmBypass !== undefined && typeof v.confirmBypass !== "boolean")
    throw new Error("Invalid Bypass confirmation")
  if (
    v.settings !== undefined &&
    (!v.settings || typeof v.settings !== "object" || Array.isArray(v.settings))
  )
    throw new Error("Invalid run settings")
  validateRunSettings(v.settings ?? {}, CONTROL_SETTINGS)
  if (
    v.action === "configure" &&
    (!v.settings ||
      Object.keys(v.settings).length === 0 ||
      v.mode !== undefined ||
      Object.keys(v.settings).some((key) => !["model", "effort", "perm", "permMode"].includes(key)))
  )
    throw new Error("Choose model, effort or permission settings to apply after this turn")
  return v
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
  if (["move", "resume", "restart"].includes(input.action)) {
    if (run.agent === "other")
      throw new Error("This agent has no qualified Move, Resume or Restart control")
    return ctx.fs.withLock(join(runDir(ctx.home, run.id), ".bind.lock"), () =>
      ctx.fs.withLock(join(runDir(ctx.home, run.id), "control.lock"), async () => {
        let current = readRun(ctx.home, run.id)
        if (!current || current.generation !== input.generation)
          throw new Error("stale run generation")
        if (options.settingsChange) {
          if (current.pendingSettings?.id !== options.settingsChange.id) return current
          if (!options.settingsChange.authorized())
            throw new Error("Settings-change authority was revoked")
        }
        const assertRecoveryClaim = (saved: Readonly<RunRecord>) => {
          if (
            saved.recovery?.generation !== input.generation ||
            saved.recovery.state !== "attempted" ||
            !canRecoverRun(saved)
          )
            throw new Error("Automatic recovery was cancelled; Resume explicitly when ready")
        }
        const assertSettingsClaim = (saved: Readonly<RunRecord>) => {
          if (
            options.settingsChange &&
            (saved.pendingSettings?.id !== options.settingsChange.id ||
              !options.settingsChange.authorized())
          )
            throw new Error("The queued settings change was cancelled before application")
        }
        if (options.automaticRecovery) assertRecoveryClaim(current)
        if (input.action === "move") {
          current = await controlRun(ctx, current, {
            action: "stop",
            generation: current.generation,
          })
          await releaseRunLeases(ctx, current.id, current.generation)
          return current
        }
        // A run whose host died with its machine still reads running; settle it so Resume can proceed.
        if (input.action === "resume")
          current =
            (await settleDeadHost(ctx.home, current.id, current.generation, true)) ?? current
        await assertPreviousMayResume(ctx, current)
        let permissionInputAt: number | undefined
        if (input.action === "restart") {
          const permissionOnly =
            Object.keys(requested ?? {}).length > 0 &&
            Object.keys(requested ?? {}).every((key) => key === "perm" || key === "permMode")
          const permissionPause =
            permissionOnly &&
            permissionChangeBoundary(current) &&
            readHost(ctx.home, current.id)?.permissionRestart === true
          if (permissionPause && !acceptedTurnBoundary(current))
            permissionInputAt = readHost(ctx.home, current.id)?.lastInputAt ?? 0
          if (current.status !== "running" || (!acceptedTurnBoundary(current) && !permissionPause))
            throw new Error(
              "Restart needs an accepted turn boundary. Stop and Resume here instead.",
            )
          if (readHost(ctx.home, current.id)?.guardedRestart !== true)
            throw new Error("This host cannot guard Restart. Stop and Resume here instead.")
          if (!nativeSessionFile(ctx, current))
            throw new Error("The native session is gone. Start a fresh run instead.")
        } else if (!["stopped", "failed"].includes(current.status))
          throw new Error("Stop this run before resuming it")
        // Resolve the native session and launch choices before ending a healthy session.
        if (input.action !== "restart") assertNativeAvailable(ctx, current)
        if (!options.prepareResume) throw new Error("Resume launch preparation is unavailable")
        assertNativePermissionChange(ctx, current, requested)
        const settings = effectiveNativeSettings(ctx, current, requested)
        const acceptedPermission =
          observedNativeSettings(ctx, current).perm ?? current.settings?.perm
        if (
          settings.perm === "bypass" &&
          acceptedPermission !== "bypass" &&
          input.confirmBypass !== true
        )
          throw new Error("Confirm Bypass for this run before changing its permission level")
        const prepared = await options.prepareResume(
          { ...current, settings: settings as RunRecord["settings"] },
          {
            ...input,
            settings,
            ...(permissionInputAt !== undefined ? { mode: "continue" as const } : {}),
          },
        )
        if (options.settingsChange && !options.settingsChange.authorized())
          throw new Error("Settings-change authority was revoked before application")
        if (input.action === "restart") {
          current = await guardedRestartStop(ctx, current, permissionInputAt)
          assertNativeAvailable(ctx, current)
        }
        if (current.cleanup && !current.cleanup.complete)
          throw new Error("Owned-process cleanup must finish before Resume")
        if (
          [current.lead, current.host].some(
            (identity) => identity && identityState(identity) !== "dead",
          )
        )
          throw new Error("Owned processes are still alive or unverified; Resume was refused")
        await releaseRunLeases(ctx, current.id, current.generation)
        const next = nextGeneration(
          ctx.home,
          current.id,
          current.generation,
          {
            status: "validated",
            settings: settings as RunRecord["settings"],
            pendingSettings: undefined,
            binary: prepared.binary,
            lead: undefined,
            host: undefined,
            cleanup: undefined,
            stoppedAt: undefined,
            error: undefined,
            firstPromptAt: undefined,
            startupPrompt: undefined,
            terminalPrompt: undefined,
            waitSince: undefined,
            attention: "clear",
            lastPrompt: undefined,
            runEvents: [],
            permissionMode: undefined,
            startPhase: "validated",
            guardedRestart: undefined,
            ...(current.intent &&
            input.action === "resume" &&
            input.mode !== "open" &&
            current.intent.state !== "complete"
              ? {
                  intent: {
                    ...current.intent,
                    state: "active",
                    reason: undefined,
                    attemptedProgress: undefined,
                  },
                }
              : {}),
          },
          (saved) => {
            if (options.automaticRecovery) assertRecoveryClaim(saved)
            assertSettingsClaim(saved)
          },
        )
        const assertStartup = (saved: Readonly<RunRecord>) => {
          if (
            saved.generation !== next.generation ||
            (saved.recovery?.generation === next.generation &&
              saved.recovery.state === "cancelled") ||
            (options.settingsChange && !options.settingsChange.authorized())
          )
            throw new Error("Session startup was cancelled")
        }
        let hostSpawnBegan = false
        let hostStarted = false
        try {
          await acquireRunLeases(ctx, next, {
            checkout: next.cwd,
            branch: false,
            ...(runTaskLeaseKey(next) ? { task: runTaskLeaseKey(next) } : {}),
            session: next.nativeSession,
          })
          updateRun(ctx.home, next.id, next.generation, (saved) => {
            assertStartup(saved)
            writeLaunch(ctx.home, next.id, prepared.launch)
            return {
              status: "starting",
              startPhase: "launch-written",
            }
          })
          await startHost(ctx.home, next.id, options.hostCommand?.(next.id), (saved) => {
            assertStartup(saved)
            hostSpawnBegan = true
          })
          hostStarted = true
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline) {
            try {
              const connection = await connectHost(ctx.home, next.id, 250)
              connection.close()
              return updateRun(ctx.home, next.id, next.generation, (saved) => {
                assertStartup(saved)
                return {
                  status: "running",
                  startPhase: "ready",
                }
              })
            } catch {
              const state = readRun(ctx.home, next.id)
              if (state) assertStartup(state)
              if (state?.status === "failed") throw new Error(state.error || "Resume host failed")
              await Bun.sleep(25)
            }
          }
          throw new Error("Resumed agent host did not become ready within 10 seconds")
        } catch (cause) {
          const latest = readRun(ctx.home, next.id)
          if (
            latest?.generation === next.generation &&
            ((latest.recovery?.generation === next.generation &&
              latest.recovery.state === "cancelled") ||
              (options.settingsChange && !options.settingsChange.authorized()))
          ) {
            if (hostStarted || latest.host)
              await controlRun(ctx, latest, { action: "stop", generation: next.generation })
            else if (!hostSpawnBegan) {
              updateRun(ctx.home, next.id, next.generation, {
                status: "stopped",
                launchOwner: undefined,
                recovery: {
                  generation: next.generation,
                  state: "cancelled",
                  at: new Date().toISOString(),
                },
              })
              await releaseRunLeases(ctx, next.id, next.generation)
            }
            throw cause
          }
          updateRun(ctx.home, next.id, next.generation, {
            status: "failed",
            error: cause instanceof Error ? cause.message : String(cause),
          })
          throw cause
        }
      }),
    )
  }
  if (input.action !== "interrupt" && input.action !== "stop")
    throw new Error(
      input.action === "take-control"
        ? "Take control must address this mounted terminal's socket"
        : "This control is not available yet",
    )
  if (input.action === "interrupt" && !AGENT_CAPABILITIES[run.agent].interruptKey)
    throw new Error("This agent has no known interrupt key")
  if (["stop", "interrupt"].includes(input.action))
    updateRun(ctx.home, run.id, run.generation, {
      pendingSettings: undefined,
      recovery: { generation: run.generation, state: "cancelled", at: new Date().toISOString() },
    })
  if (
    input.action !== "stop" &&
    (run.status === "stopped" || (run.status === "failed" && !readHost(ctx.home, run.id)?.lead))
  )
    return run
  if (run.intent && run.intent.state !== "complete")
    updateRun(ctx.home, run.id, run.generation, {
      intent: {
        ...run.intent,
        state: "paused",
        reason:
          input.action === "stop"
            ? "Stopped by you. Resume explicitly to continue."
            : "Interrupted by you. Resume explicitly to continue.",
      },
    })
  if (input.action === "stop") {
    // A host that died with its machine has no socket to answer Stop; finishing its cleanup is the stop.
    const settled = await settleDeadHost(ctx.home, run.id, run.generation, true)
    if (settled && ["stopped", "failed"].includes(settled.status)) {
      try {
        await releaseRunLeases(ctx, run.id, run.generation)
        return settled
      } catch (cause) {
        // A failed launch can still have a live host. Explicit Stop must reach that host.
        if (!settled.host || identityState(settled.host) !== "live") throw cause
      }
    }
  }
  const connection = await connectOrRevive(ctx.home, run.id)
  try {
    if (input.action === "stop") updateRun(ctx.home, run.id, run.generation, { status: "stopping" })
    connection.send({ type: "control", action: input.action, generation: run.generation })
    if (input.action === "interrupt") return readRun(ctx.home, run.id) ?? run
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
  } finally {
    connection.close()
  }
}

async function guardedRestartStop(
  ctx: Ctx,
  run: RunRecord,
  permissionInputAt?: number,
): Promise<RunRecord> {
  const permissionPause = permissionInputAt !== undefined
  // The host, rather than an earlier HTTP projection, reserves the accepted boundary.
  const current = readRun(ctx.home, run.id)
  const sequence = permissionPause ? run.runEvents?.at(-1)?.sequence : acceptedStopSequence(run)
  if (
    !current ||
    current.generation !== run.generation ||
    current.status !== "running" ||
    !(permissionPause ? permissionChangeBoundary(current) : acceptedTurnBoundary(current)) ||
    current.nativeSession !== run.nativeSession ||
    (permissionPause ? current.runEvents?.at(-1)?.sequence : acceptedStopSequence(current)) !==
      sequence
  )
    throw new Error("The turn changed before Restart. Stop and Resume here instead.")
  const connection = await connectOrRevive(ctx.home, run.id)
  try {
    if (connection.ready.guardedRestart !== true || !sequence)
      throw new Error("This host cannot guard Restart. Stop and Resume here instead.")
    let refused: string | undefined
    connection.onFrame((frame) => {
      if (frame.type === "error") refused = frame.message
    })
    if (permissionPause && connection.ready.permissionRestart !== true)
      throw new Error(
        "This host cannot apply permission changes at a native prompt. Stop and Resume here instead.",
      )
    connection.send({
      type: "restart",
      generation: run.generation,
      sequence,
      ...(permissionPause
        ? {
            permission: {
              nativeSession: run.nativeSession ?? "",
              inputAt: permissionInputAt ?? 0,
            },
          }
        : {}),
    })
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const current = readRun(ctx.home, run.id)
      const host = readHost(ctx.home, run.id)
      if (refused) throw new Error(refused)
      if (current?.status === "stopped" && host?.cleanup?.complete) {
        if (current.guardedRestart?.sequence !== sequence || current.guardedRestart.valid !== true)
          throw new Error(
            "Activity changed after Restart was reserved. The run is stopped; Resume here instead.",
          )
        try {
          await releaseRunLeases(ctx, run.id, run.generation)
          return current
        } catch {
          /* final host exit */
        }
      }
      if (
        current?.status === "running" &&
        !(permissionPause ? permissionChangeBoundary(current) : acceptedTurnBoundary(current))
      )
        throw new Error("The turn changed before Restart. Stop and Resume here instead.")
      await Bun.sleep(25)
    }
    throw new Error("Restart did not finish owned-process cleanup; its lease remains held")
  } finally {
    connection.close()
  }
}

/** Reuse the host-side idle reservation for a fresh run, without resuming the old identity. */
export const stopRunAtBoundary = (ctx: Ctx, run: RunRecord): Promise<RunRecord> =>
  guardedRestartStop(ctx, run)
