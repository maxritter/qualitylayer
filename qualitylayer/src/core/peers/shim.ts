// The stand-in: one process per Codex thread that appears to Claude Code as a
// peer session. It writes a registry record naming its own socket, queues
// what Claude sends into the thread with `codex queue`, and tails the thread's
// rollout to post each finished turn back to whoever asked, under a loop guard
// (at most three consecutive replies to one requester unless allowed more).

import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, chmodSync as setMode } from "node:fs"
import type { Server } from "node:net"
import { join } from "node:path"
import { windows } from "../platform.ts"
import {
  asRecord,
  CODEX_TESTED,
  claudeSessionsDir,
  envNumber,
  log,
  nowIso,
  nowSeconds,
  PEER_FEATURES,
  PEER_PROTOCOL,
  PROCESSED_TURN_HISTORY,
  parseTime,
  parseVersion,
  REPLY_BUDGET,
  REPLY_BUDGET_WINDOW_DEFAULT,
  readJson,
  SHIM_FEATURES,
  stableDir,
  threadPidPath,
  threadStatePath,
  toolVersion,
  unlinkQuiet,
  writeJsonAtomic,
} from "./base.ts"
import { defaultSocketDir, peerKeyName, pidDomain, procStart } from "./claude.ts"
import {
  codexThreads,
  codexTitleOwner,
  lastBoundary,
  peerNameForThread,
  RolloutTail,
  type Tag,
  type Thread,
  type Turn,
  threadIsHeld,
  writerLockPath,
} from "./codex.ts"
import { releaseLock, tryLock } from "./lock.ts"
import {
  advanceBudgetSequence,
  allowanceWaiting,
  consumeBudgetReset,
  releaseHeldReplies,
  resetBudgetSequence,
  sequenceExpired,
} from "./shim-budget.ts"
import { dispatchInboundLine } from "./shim-inbound.ts"
import {
  type Allowance,
  boundMap,
  type Contact,
  type Held,
  type ShimRuntime,
  type UnansweredEntry,
  validAllowance,
} from "./shim-lifecycle.ts"
import { flushUnansweredNotices } from "./shim-notices.ts"
import { processTurnEnd } from "./shim-outbound.ts"
import { bindShimServer, runShimPollLoop } from "./shim-poll.ts"

export { shimPid, shimReady, shimSupports, stopShim } from "./shim-lifecycle.ts"

export class Shim implements ShimRuntime {
  readonly threadId: string
  readonly rolloutPath: string | null
  readonly lockPath: string
  holderPid: number | null
  threadName: string | null
  name: string
  readonly cwd: string
  readonly sockDir: string
  readonly sockPath: string
  readonly recordPath: string
  tail: RolloutTail
  processedTurns: string[]
  budgets: Record<string, number>
  budgetSenderSid: string | null
  budgetLastAt: number | null
  budgetNotified: Set<string>
  held: Record<string, Held>
  allowance: Allowance | null
  releaseAfterStart = false
  contacts: Record<string, Contact>
  readonly fresh: boolean
  readonly startedAt: number
  nameSince: number
  status: "busy" | "idle"
  readonly pollMs: number
  readonly livenessMs: number
  readonly aliasMs: number
  readonly replyWindow: number
  readonly noticeFoldMs: number
  unanswered = new Map<string, UnansweredEntry>()
  private procStartValue: string | null = null
  readonly authToken = windows ? randomBytes(32).toString("hex") : null
  readonly authKeyPath: string
  idleSubs: [string | null, string][] = []
  recordRewrites = 0
  stopped = false
  private server: Server | null = null
  private cleaned = false
  private owns = false
  clients = 0
  codexVersion: string | null = null
  livenessUnverified = false

  constructor(readonly thread: Thread) {
    this.threadId = thread.id
    this.rolloutPath = thread.rollout_path
    this.lockPath = writerLockPath(this.threadId)
    this.holderPid = thread.holder_pid
    this.threadName = thread.name
    this.name = peerNameForThread(
      this.threadName,
      this.threadId,
      undefined,
      codexTitleOwner(this.threadName),
      codexThreads(false)[0],
    )
    this.cwd = thread.cwd ?? stableDir()
    this.sockDir = defaultSocketDir()
    this.sockPath = join(
      this.sockDir,
      windows ? `cc-msg-${randomBytes(16).toString("hex")}` : `${process.pid}.sock`,
    )
    this.recordPath = join(claudeSessionsDir(), `${process.pid}.json`)
    this.authKeyPath = join(claudeSessionsDir(), peerKeyName(process.pid, this.sockPath))

    const state = asRecord(readJson(threadStatePath(this.threadId), {})) ?? {}
    this.tail = new RolloutTail(this.rolloutPath, asRecord(state.tail) ?? {})
    const processed = (state.processed_turns ?? state.delivered) as unknown
    this.processedTurns = Array.isArray(processed) ? processed.map(String) : []
    this.budgets = { ...((asRecord(state.budgets) ?? {}) as Record<string, number>) }
    this.budgetSenderSid =
      typeof state.budget_sender_sid === "string" ? state.budget_sender_sid : null
    this.budgetLastAt = parseTime(state.budget_last_at)
    this.budgetNotified = new Set(
      Array.isArray(state.budget_notified) ? state.budget_notified.map(String) : [],
    )
    this.held = { ...((asRecord(state.held) ?? {}) as Record<string, Held>) }
    this.allowance = validAllowance(state.allowance) ? state.allowance : null
    this.contacts = { ...((asRecord(state.contacts) ?? {}) as Record<string, Contact>) }
    this.fresh = Object.keys(state).length === 0
    if (this.fresh) this.tail.poll(false)
    else if (this.tail.lastBoundary === null && this.rolloutPath)
      this.tail.lastBoundary = lastBoundary(this.rolloutPath)
    this.startedAt = nowSeconds()
    this.nameSince = this.startedAt
    this.status = this.tail.lastBoundary === "started" ? "busy" : "idle"
    this.pollMs = envNumber("QUALITYLAYER_PEERS_POLL_INTERVAL", 1) * 1000
    this.livenessMs = envNumber("QUALITYLAYER_PEERS_LIVENESS_INTERVAL", 5) * 1000
    const alias = envNumber("QUALITYLAYER_PEERS_ALIAS_REFRESH_INTERVAL", 30)
    this.aliasMs = (alias > 0 ? alias : 30) * 1000
    const fold = envNumber("QUALITYLAYER_PEERS_NOTICE_FOLD", 2)
    this.noticeFoldMs = (fold >= 0 ? fold : 2) * 1000
    const window = envNumber("QUALITYLAYER_PEERS_REPLY_BUDGET_WINDOW", REPLY_BUDGET_WINDOW_DEFAULT)
    this.replyWindow = window > 0 ? window : REPLY_BUDGET_WINDOW_DEFAULT
    const now = nowSeconds()
    if (sequenceExpired(this, now))
      resetBudgetSequence(this, `the ${this.replyWindow}s idle window elapsed`, now)
    if (this.allowance !== null && !this.allowance.bound && !allowanceWaiting(this, now)) {
      log(`reply allowance for ${this.allowance.sid} dropped: its window elapsed before this start`)
      this.allowance = null
    }
  }

  async run(): Promise<number> {
    if (!this.rolloutPath) {
      log(`thread ${this.threadId} has no rollout path; nothing to tail`)
      return 2
    }
    const [held, pid] = threadIsHeld(this.rolloutPath, this.holderPid, this.lockPath)
    if (!held) {
      log(
        held === null
          ? `thread ${this.threadId} liveness is unverified; not starting a stand-in`
          : `thread ${this.threadId} is not held by a live codex process; not starting`,
      )
      return 3
    }
    this.holderPid = pid ?? this.holderPid
    const parsed = parseVersion(toolVersion("codex"))
    this.codexVersion = parsed !== null ? parsed.join(".") : CODEX_TESTED
    if (!tryLock(threadPidPath(this.threadId))) {
      log(
        `another stand-in already owns thread ${this.threadId}; exiting without touching its files`,
      )
      return 4
    }
    this.owns = true
    const stop = () => {
      log("signal; shutting down")
      this.stopped = true
    }
    process.on("SIGTERM", stop)
    process.on("SIGINT", stop)
    try {
      this.consumeBudgetMarker(true)
      this.saveState()
      this.server = await bindShimServer(this)
      this.writeRecord()
      log(
        `stand-in up: thread=${this.threadId} name=${this.name} socket=${this.sockPath} holder=${this.holderPid}`,
      )
      if (this.releaseAfterStart) {
        this.releaseAfterStart = false
        await releaseHeldReplies(this)
        this.saveState()
      }
      await runShimPollLoop(this)
      await flushUnansweredNotices(this, true)
    } finally {
      this.cleanup()
    }
    return 0
  }

  private cleanup(): void {
    if (this.cleaned) return
    this.cleaned = true
    if (this.owns) this.saveState()
    unlinkQuiet(this.recordPath)
    if (windows) unlinkQuiet(this.authKeyPath)
    unlinkQuiet(this.sockPath)
    this.server?.close()
    if (this.owns) releaseLock(threadPidPath(this.threadId))
  }

  record(): Record<string, unknown> {
    const stamp = Date.now()
    this.procStartValue ??= procStart(process.pid)
    return {
      pid: process.pid,
      sessionId: this.threadId,
      cwd: this.cwd,
      startedAt: Math.floor(this.startedAt * 1000),
      procStart: this.procStartValue,
      version: `codex-${this.codexVersion ?? CODEX_TESTED}`,
      peerProtocol: PEER_PROTOCOL,
      peerFeatures: [...PEER_FEATURES],
      kind: "interactive",
      entrypoint: "codex",
      pidDomain: pidDomain(),
      messagingSocketPath: this.sockPath,
      name: this.name,
      nameSource: "user",
      nameSince: Math.floor(this.nameSince * 1000),
      status: this.status,
      updatedAt: stamp,
      statusUpdatedAt: stamp,
    }
  }

  writeRecord(): void {
    const dir = claudeSessionsDir()
    mkdirSync(dir, { recursive: true })
    try {
      setMode(dir, 0o700)
    } catch {
      // best effort
    }
    writeJsonAtomic(this.recordPath, this.record(), 0o644)
  }

  setStatus(status: "busy" | "idle"): void {
    if (status === this.status) return
    this.status = status
    if (existsSync(this.recordPath)) this.writeRecord()
  }

  saveState(): void {
    writeJsonAtomic(
      threadStatePath(this.threadId),
      {
        thread_id: this.threadId,
        name: this.name,
        thread_name: this.threadName,
        name_since: Math.floor(this.nameSince * 1000),
        shim_pid: process.pid,
        shim_features: [...SHIM_FEATURES],
        tail: this.tail.state(),
        processed_turns: this.processedTurns.slice(-PROCESSED_TURN_HISTORY),
        budgets: boundMap(this.budgets),
        budget_sender_sid: this.budgetSenderSid,
        budget_last_at: this.budgetLastAt,
        budget_notified: [...this.budgetNotified].sort(),
        held: boundMap(this.held),
        allowance: this.allowance,
        contacts: boundMap(this.contacts),
        updated_at: nowIso(),
      },
      0o600,
    )
  }

  async handleLine(raw: string): Promise<void> {
    return dispatchInboundLine(this, raw)
  }

  consumeBudgetMarker(initial: boolean): void {
    consumeBudgetReset(this, initial)
  }

  capFor(sid: string): number {
    return this.allowance !== null && this.allowance.sid === sid
      ? Math.max(REPLY_BUDGET, this.allowance.total)
      : REPLY_BUDGET
  }

  advanceBudgetSequence(tag: Tag | null): void {
    advanceBudgetSequence(this, tag)
  }

  async handleTurnEnd(turn: Turn): Promise<void> {
    return processTurnEnd(this, turn)
  }
}
