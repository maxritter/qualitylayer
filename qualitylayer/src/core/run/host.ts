import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  type FSWatcher,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs"
import { createServer, type Socket } from "node:net"
import { join } from "node:path"
import { createHeadlessTerminal } from "restty/headless"
import { realCtx } from "../../ctx.ts"
import { readGate } from "../gate/gate.ts"
import { lockPath as gateLockPath } from "../gate/lock.ts"
import { plannerFinishMessage } from "../handoff/finish-message.ts"
import { keyOf } from "../task/binding.ts"
import {
  pendingApproval,
  terminalPermissionScreen,
  watchApprovalScreen,
  watchTerminalPermission,
} from "./approval-screen.ts"
import {
  AttentionSignals,
  invalidateRunBoundary,
  reserveGuardedStop,
  reserveRunRestart,
} from "./bind.ts"
import {
  type CleanupResult,
  type HostRecord,
  PROTOCOL_VERSION,
  type ProcessIdentity,
} from "./contracts.ts"
import { idleRunBlocked, reserveIdleStop, watchIdleRun } from "./idle.ts"
import {
  launchHooksFolder,
  removeLaunchOverlays,
  removeStaleLaunchOverlays,
} from "./launch-hooks.ts"
import { AGENT_CAPABILITIES } from "./launch-spec.ts"
import { OWNER_ENV, ownerHash, PROCESS_LIMITS } from "./processes.ts"
import { encodeFrame, FrameDecoder, type HostFrame, LIMITS, type ServerFrame } from "./protocol.ts"
import {
  cleanupOwned,
  identityState,
  ownedProcesses,
  processIdentity,
  readHost,
  readLaunch,
  readRun,
  runDir,
  socketPath,
  updateRun,
  withRunRecord,
  writeHost,
  writeToken,
} from "./registry.ts"
import { BoundaryTracker, CursorStateTracker, rebuild, screenText } from "./restore.ts"
import { inputBoundaryMatches, inputSteps, typedMessage } from "./send-message.ts"
import { spawnError } from "./spawn-error.ts"
import { watchStartupPrompt } from "./startup-prompt.ts"
import { watchTurnSnapshots } from "./turn-snapshots.ts"
import { watchTurnRecord } from "./turn-watch.ts"
import {
  cleanupWindowsJob,
  ownWindowsJob,
  protectWindowsObject,
  releaseOwnWindowsJob,
} from "./windows.ts"

type Attachment = {
  socket: Socket
  decoder: FrameDecoder
  authenticated: boolean
  attached: boolean
  pendingAttach: boolean
  replaying: boolean
  replayEpoch: number
  queued: HostFrame[]
  queuedBytes: number
  /** Bytes of frames written to this viewer, and how many of them it says it has taken in (`ack`). */
  sent: number
  acked: number
  /** The viewer has sent an `ack`: the host counts what it owes it by them (see `waiting`). */
  acknowledging: boolean
  /** Wakes the replay that waits for the viewer to take in what it was sent. */
  resume?: () => void
  helloTimer: ReturnType<typeof setTimeout>
}

/** Complete identity metadata, independent of process enumeration and object-key order. */
const rosterStamp = (rows: readonly ProcessIdentity[]) =>
  rows
    .map((row) =>
      JSON.stringify(
        Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))),
      ),
    )
    .sort()
    .join("\n")

/** The frames that name the generation they are for; a host of another generation answers them as stale. */
const forGeneration = (
  frame: ServerFrame,
): frame is Extract<ServerFrame, { type: "attach" | "control" | "restart" | "guarded-stop" }> =>
  ["attach", "control", "restart", "guarded-stop"].includes(frame.type)

const BOUNDARY_REFUSED = { restart: "restart_boundary", "guarded-stop": "stop_refused" } as const

/** A replay is sent to a viewer that acknowledges no further than this ahead of what it has taken in. */
const REPLAY_AHEAD = 256 * 1024

/**
 * Stop the run at the boundary a restart or guarded-stop frame names; the reason when the run moved
 * past it, else null. Input is handled in the same turn of the host's loop, so what was typed before
 * a guarded stop arrives is already known here (in memory and in the record): nobody slips in
 * between the check and the stop.
 */
function stopAtBoundary(
  run: { home: string; id: string; record: HostRecord },
  generation: number,
  frame: Extract<ServerFrame, { type: "restart" | "guarded-stop" }>,
  stop: () => Promise<void>,
  screen: () => string,
): string | null {
  const { home, id, record } = run
  try {
    if (frame.type === "restart") {
      if (
        frame.permission &&
        (record.permissionRestart !== true ||
          (record.lastInputAt ?? 0) !== frame.permission.inputAt ||
          !terminalPermissionScreen(screen()))
      )
        throw new Error("The native permission prompt changed before Apply. Nothing was restarted.")
      reserveRunRestart({ home }, id, generation, frame.sequence, frame.permission?.nativeSession)
    } else if (record.lastInputAt !== undefined) throw new Error("Someone typed into the session")
    else reserveGuardedStop({ home }, id, generation, frame.sequence)
    void stop()
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : "The stop was refused"
  }
}

export async function runAgentHost(
  home: string,
  id: string,
  options: {
    idleTimeoutMs?: number
    /** How long after the last typing a handed-off planner is told (tests shorten it). */
    plannerQuietMs?: number
    turnRecord?: { quietMs?: number; searchMs?: number }
  } = {},
): Promise<number> {
  const run = readRun(home, id)
  if (!run) throw new Error("missing run record")
  const launch = readLaunch(home, id)
  const identity = processIdentity(process.pid, "host")
  if (!identity) throw new Error("host process identity unavailable")
  const lockPath = join(runDir(home, id), "host.lock")
  if (existsSync(lockPath)) {
    const prior = JSON.parse(readFileSync(lockPath, "utf8")) as ProcessIdentity
    if (identityState(prior) !== "dead") throw new Error("This run already has a host")
    rmSync(lockPath)
  }
  const lock = openSync(lockPath, "wx", 0o600)
  // No earlier host of this run lives now: what a killed one left of its launch goes before ours.
  writeFileSync(lock, JSON.stringify(identity))
  try {
    removeStaleLaunchOverlays(home, id, run.generation)
  } catch {
    // A leftover folder that cannot be removed now is removed with the run; the launch goes on.
  }
  let stopApproval = () => {}
  let stopTerminalPermissions = () => {}
  try {
    const token = writeToken(home, id)
    const path = socketPath(home, id)
    if (process.platform !== "win32" && existsSync(path)) {
      const prior = readHost(home, id)
      if (
        !prior ||
        prior.protocol !== PROTOCOL_VERSION ||
        identityState({
          pid: prior.pid,
          processStart: prior.processStart,
          pidDomain: prior.pidDomain,
          knownBy: "host",
        }) !== "dead"
      )
        throw new Error("Previous host socket ownership cannot be confirmed")
      rmSync(path)
    }
    const ownerSecret = randomBytes(32).toString("hex")
    const windowsJob = process.platform === "win32" ? ownWindowsJob(id, run.generation) : undefined
    const record: HostRecord = {
      ...(windowsJob ? { windowsJob } : {}),
      guardedRestart: true,
      permissionRestart: true,
      protocol: PROTOCOL_VERSION,
      run: id,
      generation: run.generation,
      pid: identity.pid,
      processStart: identity.processStart,
      pidDomain: identity.pidDomain,
      socket: path,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      ownerHash: ownerHash(ownerSecret),
      agent: run.agent,
      cwd: launch.cwd,
      startedAt: new Date().toISOString(),
      status: "starting",
    }
    writeHost(home, id, record)
    // When anyone last typed into the session, for whoever must not speak over them (the pull request
    // wake-up). Written at most once a second: a keystroke is not a file write.
    let inputWrittenAt = 0
    let inputRecordTimer: ReturnType<typeof setTimeout> | undefined
    const writeInput = () => {
      if (inputRecordTimer) clearTimeout(inputRecordTimer)
      inputRecordTimer = undefined
      inputWrittenAt = Date.now()
      writeHost(home, id, record)
      invalidateRunBoundary({ home }, id, run.generation, false, record.lastInputAt)
    }
    const noteInput = () => {
      const now = Date.now()
      record.lastInputAt = now
      if (now - inputWrittenAt >= 1000 || readRun(home, id)?.terminalPrompt === "permission")
        writeInput()
      else if (!inputRecordTimer) {
        inputRecordTimer = setTimeout(writeInput, inputWrittenAt + 1000 - now)
        inputRecordTimer.unref()
      }
    }
    const terminal = await createHeadlessTerminal({
      cols: launch.cols,
      rows: launch.rows,
      maxScrollbackBytes: LIMITS.scrollbackBytes,
      replay: { maxBytes: LIMITS.replayBytes },
    })
    terminal.wasm.setDefaultColors(
      terminal.handle,
      launch.colors.fg,
      launch.colors.bg,
      launch.colors.cursor,
    )
    const decoder = new TextDecoder()
    const boundary = new BoundaryTracker()
    const cursorState = new CursorStateTracker()
    const attentionSignals = new AttentionSignals()
    let wantsAttention = false
    // The agent's own start-up question (trust this folder, …) shows only on this screen: while the run
    // has not taken its first prompt, a pause in the output reads the screen once for it.
    const startupPrompts =
      run.agent !== "other" && run.purpose.kind !== "terminal"
        ? watchStartupPrompt({
            screen: () => screenText(terminal),
            done: () => finished || Boolean(readRun(home, id)?.firstPromptAt),
            set: (kind) => {
              try {
                updateRun(home, id, run.generation, { startupPrompt: kind ?? undefined })
              } catch {
                /* The run moved on (a restart or a stop); the next generation starts without one. */
              }
            },
          })
        : undefined
    const terminalPermissions =
      run.agent !== "other"
        ? watchTerminalPermission({
            screen: () => screenText(terminal),
            set: (asking) => {
              try {
                if (asking) writeHost(home, id, record)
                updateRun(home, id, run.generation, {
                  terminalPrompt: asking ? "permission" : undefined,
                })
              } catch {
                /* A stopped or replaced generation cannot inherit this screen's prompt. */
              }
            },
          })
        : undefined
    stopTerminalPermissions = () => terminalPermissions?.stop()
    // Codex's PermissionRequest hook also runs for what its Auto review approves; while that request is
    // the run's latest event, its screen says whether it still asks (approval-screen.ts).
    const pendingNow = () => {
      const current = readRun(home, id)
      return current?.generation === run.generation ? pendingApproval(current) : undefined
    }
    const approvalScreen =
      run.agent === "codex"
        ? watchApprovalScreen({
            pending: pendingNow,
            screen: () => screenText(terminal),
            set: (sequence, waitSince) => {
              try {
                updateRun(home, id, run.generation, (latest) =>
                  pendingApproval(latest)?.sequence === sequence ? { waitSince } : null,
                )
              } catch {
                /* The run moved on (a restart or a stop); the next generation records its own wait. */
              }
            },
          })
        : undefined
    let approvalRecord: FSWatcher | undefined
    let approvalStopped = false
    stopApproval = () => {
      if (approvalStopped) return
      approvalStopped = true
      approvalScreen?.stop()
      approvalRecord?.close()
    }
    if (approvalScreen)
      try {
        approvalRecord = watch(runDir(home, id), { persistent: false }, (_, name) => {
          if (name === null || name.toString() === "run.json") approvalScreen.runChanged()
        })
        approvalRecord.on("error", () => approvalRecord?.close())
        approvalScreen.runChanged()
      } catch {
        /* Without the watch the hook's wait stands, as before. */
      }
    const attachments = new Set<Attachment>()
    let sequence = 0
    let epoch = 0
    let inputAllowed = true
    let stopping: Promise<void> | undefined
    let finished = false
    let idle: ReturnType<typeof watchIdleRun> | undefined
    let turns: ReturnType<typeof watchTurnRecord> | undefined
    let snapshots: ReturnType<typeof watchTurnSnapshots> | undefined
    let descendants: ProcessIdentity[] = []
    const retainUnresolved = (cleanup: CleanupResult) => {
      descendants = [
        ...new Map(
          [...descendants, ...cleanup.remaining, ...cleanup.unverified]
            .filter((p) => identityState(p) !== "dead")
            .map((p) => [`${p.pid}:${p.nativeStart ?? p.processStart}`, p]),
        ).values(),
      ]
      record.descendants = descendants
    }
    let lastTreeAt = 0
    let treeTimer: ReturnType<typeof setTimeout> | undefined
    let lead: ProcessIdentity | null = null
    // Bytes to write, and pauses (milliseconds) between them.
    let inputQueue: (Uint8Array | number)[] = []
    let inputBytes = 0
    let inputTimer: ReturnType<typeof setTimeout> | undefined
    let guardedInput:
      | {
          boundary: NonNullable<Extract<ServerFrame, { type: "input" }>["boundary"]>
          inputSequence: number
          reply: (accepted: boolean) => void
        }
      | undefined
    const finishGuardedInput = (accepted: boolean) => {
      const pending = guardedInput
      guardedInput = undefined
      pending?.reply(accepted)
      if (!accepted && pending) {
        inputQueue = []
        inputBytes = 0
        if (inputTimer) clearTimeout(inputTimer)
        inputTimer = undefined
      }
    }
    let pumping = false
    let pty: Bun.Terminal | undefined
    const inputCtx = realCtx({
      env: { ...launch.env, QUALITYLAYER_HOME: home },
      cwd: launch.cwd,
    })
    const writeQueuedInput = (bytes: Uint8Array) => {
      const written = pty?.write(bytes) ?? 0
      if (written > 0) {
        inputBytes -= written
        if (written >= bytes.length) inputQueue.shift()
        else inputQueue[0] = bytes.subarray(written)
      }
      return written
    }
    const pumpInput = async () => {
      if (pumping || !pty || !inputAllowed) return
      pumping = true
      try {
        while (inputQueue.length) {
          const pending = guardedInput
          const currentInput = () => {
            const current = readRun(home, id)
            return (
              pending !== undefined &&
              guardedInput === pending &&
              inputAllowed &&
              current?.status === "running" &&
              current.generation === pending.boundary.generation &&
              current.nativeSession === pending.boundary.nativeSession &&
              current.task === pending.boundary.task &&
              current.eventSequence === pending.inputSequence &&
              current.intent?.state !== "paused" &&
              !(
                current.recovery?.generation === current.generation &&
                current.recovery.state === "cancelled"
              )
            )
          }
          const bytes = inputQueue[0]
          if (typeof bytes === "number") {
            if (!inputTimer)
              inputTimer = setTimeout(() => {
                inputTimer = undefined
                inputQueue.shift()
                void pumpInput()
              }, bytes)
            break
          }
          if (!bytes) break
          const queue = inputQueue
          let written: number
          if (pending) {
            const current = readRun(home, id)
            const runtimeDir = current?.taskRuntimeDir
            if (!runtimeDir || !currentInput()) {
              finishGuardedInput(false)
              continue
            }
            const task = { runtimeDir }
            const submitted = await inputCtx.fs
              .withLock(gateLockPath(task), async () => {
                const gate = await readGate(inputCtx, task)
                if (!currentInput()) return undefined
                if (gate?.decision === "approved") {
                  finishGuardedInput(false)
                  return undefined
                }
                // Approval and the actual PTY write share one boundary; connection and paste delay do not.
                return writeQueuedInput(bytes)
              })
              .catch(() => {
                if (guardedInput === pending) finishGuardedInput(false)
                return undefined
              })
            if (submitted === undefined || inputQueue !== queue || guardedInput !== pending)
              continue
            written = submitted
          } else written = writeQueuedInput(bytes)
          if (written < bytes.length) {
            if (!inputTimer)
              inputTimer = setTimeout(() => {
                inputTimer = undefined
                void pumpInput()
              }, 10)
            break
          }
        }
        if (!inputQueue.length) finishGuardedInput(true)
      } finally {
        pumping = false
      }
    }
    const queueInput = (bytes: Uint8Array): boolean => {
      if (bytes.length === 0) return true
      if (!inputAllowed || inputBytes + bytes.length > LIMITS.inboundBytes) return false
      inputQueue.push(...inputSteps(bytes.slice()))
      inputBytes += bytes.length
      void pumpInput()
      return true
    }
    const drop = (attachment: Attachment) => {
      attachment.socket.end(
        encodeFrame({ type: "resync", reason: "The window fell behind; attach again" }),
      )
      setTimeout(() => attachment.socket.destroy(), 500).unref()
      attachments.delete(attachment)
      attachment.resume?.()
      idle?.changed()
    }
    // What a viewer has not taken yet. The socket's own `writableLength` answers on macOS and Linux. A
    // Windows named pipe's socket answers 0 however much a viewer leaves unread (3 MB went to one that
    // read nothing, and no signal Node has said so), so a viewer that sends `ack` frames is also judged
    // by the bytes it was sent beyond the last it acknowledged. One that never acks is judged as before.
    const waiting = (attachment: Attachment) =>
      Math.max(
        attachment.socket.writableLength,
        attachment.acknowledging ? attachment.sent - attachment.acked : 0,
      )
    const send = (
      attachment: Attachment,
      frame: HostFrame,
      flushed?: () => void,
      counted = false,
    ): boolean => {
      if (attachment.socket.destroyed) return false
      const encoded = encodeFrame(frame)
      if (
        !counted &&
        waiting(attachment) + attachment.queuedBytes + encoded.length > LIMITS.attachmentBytes
      ) {
        drop(attachment)
        return false
      }
      attachment.sent += encoded.length
      attachment.socket.write(encoded, flushed)
      return true
    }
    const broadcast = (frame: HostFrame) => {
      for (const attachment of attachments) {
        if (!attachment.authenticated || !attachment.attached) continue
        if (attachment.replaying) {
          const size = encodeFrame(frame).length
          if (waiting(attachment) + attachment.queuedBytes + size > LIMITS.attachmentBytes)
            drop(attachment)
          else {
            attachment.queued.push(frame)
            attachment.queuedBytes += size
          }
        } else send(attachment, frame)
      }
    }
    const status = () =>
      ({ type: "status", status: record.status, cols: terminal.cols, rows: terminal.rows }) as const
    const attach = (attachment: Attachment) => {
      idle?.changed()
      if (!boundary.safe) {
        attachment.pendingAttach = true
        return
      }
      attachment.pendingAttach = false
      const replay = terminal.createReplay()
      // The journal caps raw bytes, but JSON spells each control byte as six: an agent that
      // redraws its whole screen (Claude Code, Codex) turned a full 2 MB journal into a 16 MB
      // replay the window rejected. Windows read only the events, so `data` (the same output
      // again) stays home, and past the budget the window gets the rebuilt screen.
      const journal = replay.truncated
        ? undefined
        : new TextEncoder().encode(JSON.stringify({ ...replay, data: undefined }))
      const trimmed = !journal || journal.length > LIMITS.replayBytes * 2
      const payload = trimmed
        ? new TextEncoder().encode(rebuild(terminal, cursorState.pendingWrap))
        : journal
      const currentEpoch = ++epoch
      attachment.replayEpoch = currentEpoch
      attachment.replaying = true
      attachment.attached = true
      attachment.queued = []
      attachment.queuedBytes = 0
      if (
        !send(attachment, {
          type: "replay-begin",
          epoch: currentEpoch,
          cols: trimmed ? terminal.cols : replay.initialCols,
          rows: trimmed ? terminal.rows : replay.initialRows,
          kind: trimmed ? "rebuild" : "replay",
          truncated: trimmed,
          upTo: sequence,
        })
      )
        return
      void (async () => {
        for (let offset = 0; offset < payload.length; offset += 32 * 1024) {
          // A viewer that acknowledges is sent the replay as it takes it in, so a big replay is not
          // counted against it as a backlog.
          while (
            attachment.acknowledging &&
            attachment.sent - attachment.acked > REPLAY_AHEAD &&
            !attachment.socket.destroyed &&
            attachments.has(attachment)
          )
            await new Promise<void>((resolve) => {
              attachment.resume = resolve
            })
          if (
            attachment.socket.destroyed ||
            attachment.replayEpoch !== currentEpoch ||
            !attachments.has(attachment)
          )
            return
          const written = await new Promise<boolean>((resolve) => {
            const closed = () => resolve(false)
            attachment.socket.once("close", closed)
            if (
              !send(
                attachment,
                {
                  type: "replay-chunk",
                  epoch: currentEpoch,
                  data: payload.subarray(offset, offset + 32 * 1024),
                },
                () => {
                  attachment.socket.off("close", closed)
                  resolve(true)
                },
              )
            ) {
              attachment.socket.off("close", closed)
              resolve(false)
            }
          })
          if (!written) return
        }
        if (
          attachment.replayEpoch !== currentEpoch ||
          !send(attachment, { type: "replay-end", epoch: currentEpoch })
        )
          return
        attachment.replaying = false
        const queued = attachment.queued
        attachment.queued = []
        attachment.queuedBytes = 0
        // What was queued was counted against the viewer's limit when it was queued.
        for (const frame of queued)
          if (!send(attachment, frame, undefined, attachment.acknowledging)) return
        send(attachment, status())
      })().catch(() => drop(attachment))
    }
    const pendingAttachments = () => {
      for (const attachment of attachments) if (attachment.pendingAttach) attach(attachment)
    }
    const output = (bytes: Uint8Array) => {
      if (!bytes.length) return
      if (run.agent === "other" && attentionSignals.push(bytes) && !wantsAttention) {
        wantsAttention = true
        updateRun(home, id, run.generation, { attention: "attention" })
        broadcast({ type: "attention", kind: "attention" })
      }
      const text = decoder.decode(bytes, { stream: true })
      cursorState.apply(terminal, text)
      startupPrompts?.changed()
      terminalPermissions?.changed()
      approvalScreen?.changed()
      const reply = terminal.drainOutput()
      if (reply) queueInput(new TextEncoder().encode(reply))
      for (let offset = 0; offset < bytes.length; offset += 32 * 1024)
        broadcast({
          type: "output",
          seq: ++sequence,
          data: bytes.slice(offset, offset + 32 * 1024),
        })
      if (lead && !treeTimer && !finished)
        treeTimer = setTimeout(
          () => {
            treeTimer = undefined
            lastTreeAt = Date.now()
            if (!lead || finished) return
            try {
              descendants = [
                ...new Map(
                  [...descendants, ...ownedProcesses(lead)].map((p) => [
                    `${p.pid}:${p.processStart}`,
                    p,
                  ]),
                ).values(),
              ]
              descendants = descendants.filter((p) => identityState(p) !== "dead")
              if (descendants.length > PROCESS_LIMITS.owned)
                throw new Error("run process roster exceeds its bound")
              const changed = rosterStamp(record.descendants ?? []) !== rosterStamp(descendants)
              record.descendants = descendants
              if (changed) writeHost(home, id, record)
            } catch {
              /* Stop records a failed ownership snapshot if process inspection stays unavailable. */
            }
          },
          Math.max(50, lastTreeAt + 1000 - Date.now()),
        )
    }
    const argv = [...launch.argv]
    if (run.agent === "codex" && !argv.includes("--no-daemon")) argv.splice(1, 0, "--no-daemon")
    const child = withRunRecord(home, id, run.generation, (current) => {
      if (current.recovery?.generation === run.generation && current.recovery.state === "cancelled")
        throw new Error("Session startup was cancelled")
      const childEnv = { ...launch.env, PWD: launch.cwd, [OWNER_ENV]: ownerSecret }
      try {
        return Bun.spawn(argv, {
          cwd: launch.cwd,
          env: childEnv,
          terminal: {
            cols: launch.cols,
            rows: launch.rows,
            data(_pty, bytes) {
              if ([...attachments].some((a) => a.pendingAttach)) {
                const split = boundary.nextBoundary(bytes)
                if (split === null) {
                  output(bytes)
                  return
                }
                output(bytes.subarray(0, split))
                pendingAttachments()
                const rest = bytes.subarray(split)
                boundary.push(rest)
                output(rest)
              } else {
                boundary.push(bytes)
                output(bytes)
              }
            },
          },
        })
      } catch (cause) {
        throw spawnError(cause, argv, childEnv, launch.cwd)
      }
    })
    pty = child.terminal ?? undefined
    void pumpInput()
    lead = processIdentity(child.pid, "lead")
    if (!lead) {
      child.kill()
      stopApproval()
      terminal.dispose()
      throw new Error("agent process identity unavailable")
    }
    lead.ownerHash = record.ownerHash
    if (windowsJob) lead.windowsJob = windowsJob
    record.lead = lead
    record.descendants = [lead]
    writeHost(home, id, record)
    updateRun(home, id, run.generation, {
      host: identity,
      lead,
      status: "starting",
      startPhase: "host-started",
    })
    const stop = (): Promise<void> => {
      if (stopping) return stopping
      inputAllowed = false
      finishGuardedInput(false)
      inputQueue = []
      inputBytes = 0
      if (inputTimer) clearTimeout(inputTimer)
      record.status = "stopping"
      writeHost(home, id, record)
      updateRun(home, id, run.generation, { status: "stopping" })
      broadcast(status())
      stopping = (async () => {
        if (!lead) return
        record.cleanup = await cleanupOwned(lead, descendants, () => {
          const interrupt = AGENT_CAPABILITIES[run.agent].interruptKey
          if (interrupt) child.terminal?.write(interrupt)
        })
        retainUnresolved(record.cleanup)
        writeHost(home, id, record)
      })()
      idle?.dispose()
      turns?.dispose()
      snapshots?.dispose()
      return stopping
    }
    const handle = (attachment: Attachment, frame: ServerFrame) => {
      if (!attachment.authenticated) {
        const offered = frame.type === "hello" ? Buffer.from(frame.token) : Buffer.alloc(0)
        const expected = Buffer.from(token)
        if (
          frame.type !== "hello" ||
          frame.protocol !== PROTOCOL_VERSION ||
          offered.length !== expected.length ||
          !timingSafeEqual(offered, expected)
        ) {
          attachment.socket.destroy()
          return
        }
        attachment.authenticated = true
        clearTimeout(attachment.helloTimer)
        send(attachment, {
          type: "ready",
          guardedRestart: true,
          permissionRestart: true,
          acknowledges: true,
          guardedInput: true,
          protocol: PROTOCOL_VERSION,
          run: id,
          generation: run.generation,
          pid: identity.pid,
          processStart: identity.processStart,
        })
        return
      }
      if (frame.type === "hello") {
        attachment.socket.destroy()
        return
      }
      if (forGeneration(frame) && frame.generation !== run.generation) {
        send(attachment, {
          type: "error",
          code: "stale_generation",
          message: "This run changed; attach again",
        })
        return
      }
      if (frame.type === "ack") {
        attachment.acknowledging = true
        attachment.acked = Math.max(attachment.acked, Math.min(frame.bytes, attachment.sent))
        attachment.resume?.()
      } else if (frame.type === "attach") attach(attachment)
      else if (frame.type === "restart" || frame.type === "guarded-stop") {
        const refused = stopAtBoundary({ home, id, record }, run.generation, frame, stop, () =>
          screenText(terminal),
        )
        if (refused !== null)
          send(attachment, { type: "error", code: BOUNDARY_REFUSED[frame.type], message: refused })
      } else if (frame.type === "input" && inputAllowed) {
        finishGuardedInput(false)
        if (frame.boundary) {
          const current = readRun(home, id)
          if (
            !current ||
            inputBytes !== 0 ||
            !inputBoundaryMatches(current, frame.boundary) ||
            terminalPermissionScreen(screenText(terminal))
          ) {
            send(attachment, { type: "input-result", ...frame.boundary, accepted: false })
            return
          }
        }
        if (frame.data.length) {
          noteInput()
          idle?.changed()
          turns?.changed()
          invalidateRunBoundary(
            { home },
            id,
            run.generation,
            frame.data.length === 1 && (frame.data[0] === 0x1b || frame.data[0] === 0x03),
          )
          if (wantsAttention) {
            wantsAttention = false
            updateRun(home, id, run.generation, { attention: "clear" })
            broadcast({ type: "attention", kind: "clear" })
          }
        }
        const inputBoundary = frame.boundary
        if (inputBoundary)
          guardedInput = {
            boundary: inputBoundary,
            inputSequence: readRun(home, id)?.eventSequence ?? -1,
            reply: (accepted) =>
              send(attachment, {
                type: "input-result",
                generation: inputBoundary.generation,
                sequence: inputBoundary.sequence,
                accepted,
              }),
          }
        if (!queueInput(frame.data)) attachment.socket.destroy()
      } else if (frame.type === "resize" && inputAllowed) {
        terminal.resize(frame.cols, frame.rows)
        cursorState.resize()
        child.terminal?.resize(frame.cols, frame.rows)
        broadcast(status())
      } else if (frame.type === "control") {
        if (frame.action === "stop" || frame.action === "move") void stop()
        else if (frame.action === "interrupt" && inputAllowed) {
          finishGuardedInput(false)
          const interrupt = AGENT_CAPABILITIES[run.agent].interruptKey
          if (interrupt) {
            invalidateRunBoundary({ home }, id, run.generation, true)
            child.terminal?.write(interrupt)
          }
        }
      }
    }
    const accept = (socket: Socket) => {
      if (attachments.size >= LIMITS.attachments) {
        socket.destroy()
        return
      }
      const attachment: Attachment = {
        socket,
        decoder: new FrameDecoder("server"),
        authenticated: false,
        attached: false,
        pendingAttach: false,
        replaying: false,
        replayEpoch: 0,
        queued: [],
        queuedBytes: 0,
        sent: 0,
        acked: 0,
        acknowledging: false,
        helloTimer: setTimeout(() => socket.destroy(), LIMITS.helloMs),
      }
      attachments.add(attachment)
      socket.on("close", () => {
        clearTimeout(attachment.helloTimer)
        attachments.delete(attachment)
        attachment.resume?.()
        idle?.changed()
      })
      socket.on("error", () => socket.destroy())
      socket.on("data", (bytes) => {
        if (bytes.length > LIMITS.inboundBytes) {
          socket.destroy()
          return
        }
        try {
          for (const frame of attachment.decoder.push(
            typeof bytes === "string" ? Buffer.from(bytes) : bytes,
          ))
            handle(attachment, frame as ServerFrame)
        } catch {
          socket.destroy()
        }
      })
    }
    let server = createServer(accept)
    // A cleanup of /tmp can remove the socket file while this host lives, leaving every window,
    // Stop and Resume unable to reach it. On SIGUSR2 it listens again at the same path; attached
    // windows keep their connections.
    const relisten = () => {
      if (finished || existsSync(path)) return
      try {
        socketPath(home, id) // recreates the private directory if it went too
      } catch {
        return
      }
      // Close the orphaned listener first: closing it later would unlink the new socket's path.
      server.close()
      server = createServer(accept)
      server.once("error", () => {})
      server.listen(path, () => {
        try {
          chmodSync(path, 0o600)
        } catch {}
      })
    }
    let listening = false
    try {
      // A live socket is never replaced, even when a stale run record suggests it is ours.
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(path, () => {
          listening = true
          try {
            if (process.platform === "win32") protectWindowsObject(path)
            else chmodSync(path, 0o600)
            resolve()
          } catch (cause) {
            reject(cause)
          }
        })
      })
      if (process.platform !== "win32") {
        process.on("SIGUSR2", relisten)
        record.socketRevive = true
      }
      record.status = "running"
      writeHost(home, id, record)
      updateRun(home, id, run.generation, { status: "running" })
      const idleCtx = realCtx({ env: launch.env, cwd: launch.cwd })
      idle = watchIdleRun({
        home,
        id,
        generation: run.generation,
        timeoutMs: options.idleTimeoutMs,
        attached: () =>
          [...attachments].some((a) => a.authenticated && (a.attached || a.pendingAttach)),
        blocked: (current) =>
          idleCtx.home === home ? idleRunBlocked(idleCtx, current) : Promise.resolve(true),
        stop: (sequence, stamp) => {
          reserveIdleStop(home, id, run.generation, sequence, stamp)
          void stop()
        },
        // The build went outside the App and the planner was not told: this host tells it.
        tell: (current) => {
          const handedOff = current.handedOff
          if (!handedOff || handedOff.told) return
          queueInput(Buffer.from(typedMessage(plannerFinishMessage(handedOff.agent))))
          try {
            updateRun(home, id, run.generation, (latest) =>
              latest.handedOff && !latest.handedOff.told
                ? { handedOff: { ...latest.handedOff, told: true } }
                : null,
            )
          } catch {
            // A newer generation owns the record now; it was told what this one typed.
          }
        },
        quietAt: () => (record.lastInputAt ?? 0) + (options.plannerQuietMs ?? 31_000),
      })
      turns = watchTurnRecord({
        ctx: idleCtx,
        home,
        id,
        generation: run.generation,
        ...options.turnRecord,
      })
      snapshots = watchTurnSnapshots({ home, id, generation: run.generation })
      const onSignal = () => {
        if (!finished) void stop()
      }
      process.on("SIGTERM", onSignal)
      process.on("SIGINT", onSignal)
      const code = await child.exited
      await Bun.sleep(500)
      if (stopping) await stopping
      else record.cleanup = await cleanupOwned(lead, descendants)
      if (record.cleanup) retainUnresolved(record.cleanup)
      // Older ConPTY versions can block closing while any attached descendant is still alive.
      if (process.platform === "win32" && record.cleanup?.complete) child.terminal?.close()
      const tail = decoder.decode()
      if (tail) terminal.write(tail)
      record.exitCode = code
      startupPrompts?.stop()
      terminalPermissions?.stop()
      stopApproval()
      record.lastScreen = screenText(terminal)
      record.stoppedAt = new Date().toISOString()
      record.status = record.cleanup?.complete ? "stopped" : "stopping"
      writeHost(home, id, record)
      updateRun(home, id, run.generation, {
        status: record.status,
        stoppedAt: record.stoppedAt,
        cleanup: record.cleanup,
      })
      const bound = readRun(home, id)
      if (bound?.taskRuntimeDir && bound.nativeSession && record.cleanup?.complete) {
        const live = join(bound.taskRuntimeDir, "live", keyOf(bound.nativeSession))
        mkdirSync(live, { recursive: true, mode: 0o700 })
        writeFileSync(
          join(live, "process-gone.json"),
          JSON.stringify({ pid: lead.pid, at: Date.now() }),
          { mode: 0o600 },
        )
      }
      broadcast({ type: "exit", code, cleanupComplete: record.cleanup?.complete ?? false })
      finished = true
      if (treeTimer) clearTimeout(treeTimer)
      process.off("SIGTERM", onSignal)
      process.off("SIGINT", onSignal)
      for (const attachment of attachments) {
        attachment.socket.end()
        setTimeout(() => attachment.socket.destroy(), 500).unref()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      return record.cleanup?.complete ? 0 : 1
    } finally {
      process.off("SIGUSR2", relisten)
      stopApproval()
      if (!finished) {
        await stop()
        await child.exited
        if (process.platform === "win32" && record.cleanup?.complete) child.terminal?.close()
        for (const attachment of attachments) attachment.socket.destroy()
        if (listening) await new Promise<void>((resolve) => server.close(() => resolve()))
      }
      if (inputTimer) clearTimeout(inputTimer)
      if (treeTimer) clearTimeout(treeTimer)
      if (inputRecordTimer) clearTimeout(inputRecordTimer)
      idle?.dispose()
      turns?.dispose()
      snapshots?.dispose()
      terminal.dispose()
      if (listening && process.platform !== "win32") rmSync(path, { force: true })
      rmSync(join(runDir(home, id), "token"), { force: true })
    }
  } catch (cause) {
    stopApproval()
    const current = readHost(home, id)
    if (current?.pid === identity.pid) {
      current.error = cause instanceof Error ? cause.message : String(cause)
      if (current.ownerHash && !current.cleanup?.complete)
        current.cleanup = current.windowsJob
          ? await cleanupWindowsJob(current.windowsJob, current.descendants)
          : await cleanupOwned(current.lead, current.descendants, undefined, current.ownerHash)
      if (current.cleanup)
        current.descendants = [
          ...new Map(
            [
              ...(current.descendants ?? []),
              ...current.cleanup.remaining,
              ...current.cleanup.unverified,
            ]
              .filter((p) => identityState(p) !== "dead")
              .map((p) => [`${p.pid}:${p.nativeStart ?? p.processStart}`, p]),
          ).values(),
        ]
      current.status =
        (current.lead || current.ownerHash) && !current.cleanup?.complete ? "stopping" : "failed"
      writeHost(home, id, current)
      updateRun(home, id, run.generation, {
        status: current.status,
        cleanup: current.cleanup,
        error: current.error,
      })
    }
    throw cause
  } finally {
    stopApproval()
    stopTerminalPermissions()
    rmSync(join(runDir(home, id), "token"), { force: true })
    // The launch's hook overlays (`launch-hooks.ts`) live only as long as the agent: on a clean exit,
    // a non-zero one or a crash of the host alike. This host removes its own generation's only; a
    // restart has already prepared the next one's.
    removeLaunchOverlays(launchHooksFolder(home, id, run.generation))
    closeSync(lock)
    rmSync(lockPath, { force: true })
    if (process.platform === "win32") releaseOwnWindowsJob()
  }
}
