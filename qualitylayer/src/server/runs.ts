import { join, relative } from "node:path"
import type { ServerWebSocket } from "bun"
import { readConfig } from "../core/config.ts"
import { stopViewing, VIEW_LEASE_MS, VIEW_MAX_MS } from "../core/conversation/approvals.ts"
import { CodexPickerAdapter } from "../core/conversation/codex-picker.ts"
import { nativeRun } from "../core/conversation/service.ts"
import type { Incoming } from "../core/interaction-docs/attachments.ts"
import type { ControlRequest, RunRecord, StartRequest } from "../core/run/contracts.ts"
import { controlRun, type ResumePreparation } from "../core/run/control.ts"
import { encodeFrame, FrameDecoder, type HostFrame, LIMITS } from "../core/run/protocol.ts"
import { recoverInterruptedRuns } from "../core/run/recovery.ts"
import { readHost, readRun } from "../core/run/registry.ts"
import { applyQueuedSettings } from "../core/run/settings-intent.ts"
import type { Ctx } from "../ctx.ts"
import type { GuardConfig } from "./guard.ts"
import { settingsOf } from "./run-launch-settings.ts"
import { parseRunStart } from "./run-start-request.ts"
import { runFreshConversation } from "./runs-fresh.ts"
import { handlePickerResponse } from "./runs-picker.ts"
import { prepareRunResume, sendOtherAgentRequest } from "./runs-resume.ts"
import { handleRunHttpRoute, handleStartChatWorkflow, type RouteDeps } from "./runs-routes.ts"
import {
  armSessionExpiryTimer,
  attachHostConnection,
  receiveBrowserMessage,
  refreshAllCapabilities,
  type SocketDeps,
} from "./runs-socket.ts"
import { startAgentRun } from "./runs-start.ts"
import {
  type AgentSocketData,
  type Attachment,
  attachRunId,
  type ClaudePickerEntry,
  refusal,
  validatePrepareHeaders,
} from "./runs-types.ts"

export { refreshRunIntentWait, summarizeRun } from "./runs-summary.ts"
export { type AgentSocketData, attachRunId } from "./runs-types.ts"
export { parseRunStart, settingsOf }

export class RunAttachments {
  private settingsApplying = new Map<string, Promise<RunRecord>>()
  private pickerAdapter = new CodexPickerAdapter()
  private claudePickers = new Map<string, ClaudePickerEntry>()
  private attachments = new Map<ServerWebSocket<AgentSocketData>, Attachment>()
  private controllers = new Map<string, ServerWebSocket<AgentSocketData>>()
  // Per run, the browsers that may answer and read its Conversation view, and when each last did.
  private leases = new Map<string, Map<string, number>>()
  private startupRecovery?: Promise<void>

  constructor(
    private ctx: Ctx,
    private guard: GuardConfig,
  ) {}

  get size() {
    return this.attachments.size
  }

  private applySettings(run: RunRecord): Promise<RunRecord> {
    if (!run.pendingSettings || run.pendingSettings.error) return Promise.resolve(run)
    const held = this.settingsApplying.get(run.id)
    if (held) return held
    const result = applyQueuedSettings(this.ctx, run, {
      authorized: (proof) => this.guard.sessions?.proofAuthority(proof)?.keyPaired === true,
      prepareResume: (current, input) => this.prepareResume(current, input),
    }).finally(() => {
      this.settingsApplying.delete(run.id)
      const current = readRun(this.ctx.home, run.id)
      if (current?.pendingSettings && current.pendingSettings.id !== run.pendingSettings?.id)
        void this.applySettings(current).catch(() => {})
    })
    this.settingsApplying.set(run.id, result)
    return result
  }

  async processSettingsChange(path: string): Promise<void> {
    const id = relative(join(this.ctx.home, "runs"), path).split(/[\\/]/)[0]
    if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return
    const run = readRun(this.ctx.home, id)
    if (run?.pendingSettings) await this.applySettings(run)
  }

  prepare(request: Request): AgentSocketData | Response {
    const url = new URL(request.url)
    const session = validatePrepareHeaders(request, url, this.guard)
    if (session instanceof Response) return session
    const id = attachRunId(url.pathname)
    const run = id === undefined ? null : readRun(this.ctx.home, id)
    if (!run) return refusal(404, "agent run not found")
    if (!readHost(this.ctx.home, run.id)) return refusal(409, "agent host unavailable")
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((part) => part.trim())
    return {
      run: run.id,
      session: session.id,
      generation: run.generation,
      watching: protocols.includes("qualitylayer-watch-v1"),
      phone: protocols.includes("qualitylayer-phone-v1"),
    }
  }

  private routeDeps(): RouteDeps {
    return {
      ctx: this.ctx,
      guard: this.guard,
      pickerAdapter: this.pickerAdapter,
      controllers: this.controllers,
      attachments: this.attachments,
      prepare: (request) => this.prepare(request),
      ensureStartupRecovery: () => {
        this.startupRecovery ??= recoverInterruptedRuns(this.ctx, {
          prepareResume: (run, input) => this.prepareResume(run, input),
        }).catch(() => {
          // Per-run failures stay on their records; an unavailable startup lock is retried next startup.
        })
      },
      applySettings: (run) => this.applySettings(run),
      prepareResume: (run, input) => this.prepareResume(run, input),
      startRun: (input, session, recorded, files) => this.start(input, session, recorded, files),
      sendRequest: (run) => sendOtherAgentRequest(this.ctx, run),
      pickerResponse: (request, picker, authority, canStart) =>
        handlePickerResponse(
          {
            ctx: this.ctx,
            guard: this.guard,
            pickerAdapter: this.pickerAdapter,
            claudePickers: this.claudePickers,
            controllers: this.controllers,
            attachments: this.attachments,
            capable: (attachment) => this.capable(attachment),
          },
          request,
          picker,
          authority,
          canStart,
        ),
      lease: (run, reader) => this.lease(run, reader),
      release: (run, reader) => this.release(run, reader),
      currentAttachment: (attachment) => this.current(attachment),
      capable: (attachment) => this.capable(attachment),
    }
  }

  private socketDeps(): SocketDeps {
    return {
      ctx: this.ctx,
      controllers: this.controllers,
      attachments: this.attachments,
      pickerAdapter: this.pickerAdapter,
      currentAuthority: (attachment) => this.current(attachment),
      capable: (attachment) => this.capable(attachment),
      refreshCapabilities: () => this.refreshCapabilities(),
      end: (attachment, code, reason) => this.end(attachment, code, reason),
      send: (attachment, frame) => this.send(attachment, frame),
      startFresh: (attachment, frame) =>
        runFreshConversation(
          {
            ctx: this.ctx,
            controllers: this.controllers,
            currentAuthority: (att) => this.current(att),
            prepareResume: (run, input) => this.prepareResume(run, input),
            startRun: (input, session, recorded, files) =>
              this.start(input, session, recorded, files),
            refreshCapabilities: () => this.refreshCapabilities(),
          },
          attachment,
          frame,
        ),
    }
  }

  route(request: Request) {
    return handleRunHttpRoute(this.routeDeps(), request)
  }

  /**
   * Resume a stopped run's own native session in a detached host, as Resume does but without the
   * prompt that continues its stage: the same session id, nobody attached, ready for a message.
   */
  resumeDetached(run: RunRecord): Promise<RunRecord> {
    return controlRun(
      this.ctx,
      run,
      { action: "resume", generation: run.generation, mode: "open" },
      { prepareResume: (current, choice) => this.prepareResume(current, choice, true) },
    )
  }

  private prepareResume(
    run: RunRecord,
    input: ControlRequest,
    forWake = false,
  ): Promise<ResumePreparation> {
    return prepareRunResume(this.ctx, run, input, forWake)
  }

  startChatWorkflow(request: Request, id: string, value: unknown) {
    return handleStartChatWorkflow(this.routeDeps(), request, id, value)
  }

  /** Start a build whose schedule fired (no browser socket attached yet). */
  startScheduled(input: StartRequest): Promise<RunRecord> {
    return this.start(input, null)
  }

  private start(
    input: StartRequest,
    session: string | null,
    recorded?: (run: RunRecord) => void,
    files: Incoming[] = [],
  ): Promise<RunRecord> {
    return startAgentRun(this.ctx, this.guard, input, { session, recorded, files })
  }

  private current(attachment: Attachment) {
    const authority = this.guard.sessions?.authority(attachment.ws.data.session)
    if (!authority) {
      this.end(attachment, 1008, "session expired or revoked")
      return null
    }
    return authority
  }

  private async capable(attachment: Attachment) {
    const authority = this.current(attachment)
    if (!authority) return false
    const config = await readConfig(this.ctx)
    return authority.keyPaired || config.typeFrom === "anyPaired"
  }

  async open(ws: ServerWebSocket<AgentSocketData>) {
    const attachment: Attachment = {
      ws,
      decoder: new FrameDecoder("server"),
      unsubscribe: () => {},
      replaying: true,
      upTo: 0,
      epoch: 0,
      closed: false,
      retrying: false,
      recovered: false,
      ended: false,
      messages: Promise.resolve(),
      inboundBytes: 0,
    }
    this.attachments.set(ws, attachment)
    const authority = this.current(attachment)
    if (!authority) return
    const deps = this.socketDeps()
    armSessionExpiryTimer(deps, attachment, authority.expiresAt)
    attachment.unsubscribe =
      this.guard.sessions?.subscribe(() => {
        if (this.current(attachment)) void this.refreshCapabilities()
      }) ?? (() => {})
    if (!ws.data.watching && !this.controllers.has(ws.data.run) && (await this.capable(attachment)))
      this.controllers.set(ws.data.run, ws)
    await this.refreshCapabilities()
    attachment.controllerAtAttach = this.controllers.get(ws.data.run)
    await attachHostConnection(deps, attachment)
  }

  refreshCapabilities() {
    return refreshAllCapabilities(this.socketDeps())
  }

  private send(attachment: Attachment, frame: HostFrame) {
    if (attachment.closed || !this.current(attachment)) return false
    const bytes = encodeFrame(frame)
    if (attachment.ws.getBufferedAmount() + bytes.length > LIMITS.attachmentBytes) {
      this.end(attachment, 1013, "slow terminal; reconnect for replay")
      return false
    }
    const sent = attachment.ws.send(bytes)
    if (sent === 0) {
      this.end(attachment, 1013, "terminal backlog full")
      return false
    }
    if (sent === -1) attachment.host?.socket.pause()
    return true
  }

  message(ws: ServerWebSocket<AgentSocketData>, message: string | Buffer) {
    const attachment = this.attachments.get(ws)
    if (!attachment) return
    const size = typeof message === "string" ? Buffer.byteLength(message) : message.length
    if (attachment.inboundBytes + size > LIMITS.inboundBytes) {
      this.end(attachment, 1009, "input backlog full")
      return
    }
    attachment.inboundBytes += size
    attachment.messages = attachment.messages
      .then(() => receiveBrowserMessage(this.socketDeps(), ws, message))
      .finally(() => {
        attachment.inboundBytes -= size
      })
  }

  drain(ws: ServerWebSocket<AgentSocketData>) {
    const host = this.attachments.get(ws)?.host
    host?.socket.resume()
    host?.ack()
  }

  private end(attachment: Attachment, code: number, reason: string) {
    if (attachment.closed) return
    attachment.closed = true
    attachment.pickerProof = undefined
    attachment.ws.close(code, reason)
    this.close(attachment.ws)
  }

  close(ws: ServerWebSocket<AgentSocketData>) {
    const attachment = this.attachments.get(ws)
    if (!attachment) return
    attachment.closed = true
    clearTimeout(attachment.timer)
    attachment.unsubscribe()
    attachment.host?.close()
    this.attachments.delete(ws)
    if (this.controllers.get(ws.data.run) === ws) this.controllers.delete(ws.data.run)
    // The last window of the browser that holds the view's lease going away (the App closed or crashed)
    // ends the lease; a waiting permission prompt is then left to the agent's own dialog.
    const { run, session } = ws.data
    if (
      this.leases.get(run)?.has(session) &&
      !this.attached(run, session) &&
      this.release(run, session)
    )
      void this.endViewing(run)
  }

  private attached(run: string, reader: string) {
    return [...this.attachments.keys()].some(
      (ws) => ws.data.run === run && ws.data.session === reader,
    )
  }

  /**
   * A browser that may answer read the view. Its reads are the only renewal of the lease (see approvals.ts);
   * this only remembers who read, so that the last of them closing can end it. No timer renews anything.
   */
  private lease(run: string, reader: string) {
    const readers = this.leases.get(run) ?? new Map<string, number>()
    const now = this.ctx.clock.now()
    // A reader that never closed is forgotten with the marker it left.
    for (const [other, at] of readers) if (now - at > VIEW_MAX_MS) readers.delete(other)
    readers.set(reader, now)
    this.leases.set(run, readers)
  }

  /** One holder lets go; true when no other holder read the view lately. */
  private release(run: string, reader: string) {
    const readers = this.leases.get(run)
    readers?.delete(reader)
    if (readers?.size === 0) this.leases.delete(run)
    const now = this.ctx.clock.now()
    return ![...(readers ?? [])].some(([, at]) => now - at <= VIEW_LEASE_MS)
  }

  private async endViewing(id: string) {
    try {
      const run = readRun(this.ctx.home, id)
      if (run && nativeRun(run) && run.nativeSession)
        await stopViewing(this.ctx, run.agent, run.nativeSession)
    } catch {
      // The view is not seen as open once its marker is old anyway.
    }
  }

  dispose() {
    this.claudePickers.clear()
    for (const run of this.controllers.keys()) this.pickerAdapter.forget(run)
    for (const id of this.leases.keys()) void this.endViewing(id)
    this.leases.clear()
    for (const attachment of this.attachments.values()) this.end(attachment, 1001, "server closing")
  }
}
