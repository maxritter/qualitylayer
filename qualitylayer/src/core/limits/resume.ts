// Resume after reset. A build that stopped on a plan limit has nothing to do until the window
// resets. When the person allows it (`limits.resumeAfterReset`), one resume is set for a minute
// after the reset: it sends the agent one message telling it to go on. It is sent only if the
// session still stands where the stop left it (no event since, nothing typed, the record still
// ends in the refusal), and the person can cancel it on the task. The plan is kept with the run,
// so a restart of the server arms it again. There is no polling: a quiet run is looked at once, and
// one timer waits for the reset. A stop that cannot be resumed (the setting is off, or the agent
// named no reset time) is still kept, as `held`, so the App can say the build waits on the agent's
// limit rather than show it running; it ends when the session moves on.

import type { Ctx } from "../../ctx.ts"
import type { NativeAgent } from "../agents/ids.ts"
import type { RunRecord } from "../run/contracts.ts"
import {
  CONTINUE_MESSAGE,
  LATE_MS,
  parseResumeEntry,
  QUIET_MS,
  RESUME_AFTER_RESET_MS,
  type ResumeDeps,
  type ResumeEntry,
  realTimers,
  resumeEntryPath,
  settledSequence,
  type Timers,
} from "./resume-record.ts"
import { detectLimitStop, type LimitStop } from "./stop.ts"
import { tailLines } from "./tail.ts"

export {
  CONTINUE_MESSAGE,
  LATE_MS,
  QUIET_MS,
  RESUME_AFTER_RESET_MS,
  type ResumeDeps,
  type ResumeEntry,
  realTimers,
  settledSequence,
  type Timers,
}

/** How much of the end of the session record is read to see the stop. */
const TAIL_BYTES = 128 * 1024

/** The one place resumes are planned, armed, guarded and sent. */
export class LimitResume {
  private entries = new Map<string, ResumeEntry>()
  private waiting = new Map<string, unknown>()
  private watching = new Map<string, unknown>()
  private timers: Timers

  constructor(
    private ctx: Ctx,
    private deps: ResumeDeps,
  ) {
    this.timers = deps.timers ?? realTimers
  }

  /** Arm the resumes the last server left planned, and look at the runs it may have missed. */
  async start(): Promise<void> {
    for (const run of this.deps.listRuns()) {
      const entry = await this.load(run.id)
      if (entry?.state === "scheduled") this.arm(entry)
      // A held stop is looked at again too: the session may have moved on while no server ran.
      else if (run.status === "running") this.observe(run.id)
    }
  }

  /** A run's events changed: look at its record once they have been quiet for a while. */
  observe(runId: string): void {
    const held = this.watching.get(runId)
    if (held !== undefined) this.timers.clear(held)
    this.watching.set(
      runId,
      this.timers.set(QUIET_MS, () => {
        this.watching.delete(runId)
        void this.check(runId).catch(() => {})
      }),
    )
  }

  /** The resumes still waiting for their reset. */
  scheduled(): ResumeEntry[] {
    return [...this.entries.values()].filter((entry) => entry.state === "scheduled")
  }

  /**
   * The runs that stand stopped on a plan limit now, resume planned or not: what the App shows in
   * place of a running build. A run that ended or restarted since is left out.
   */
  stopped(): ResumeEntry[] {
    return [...this.entries.values()].filter((entry) => {
      if (entry.state !== "scheduled" && entry.state !== "held") return false
      const run = this.deps.readRun(entry.run)
      return run !== null && run.status === "running" && run.generation === entry.generation
    })
  }

  /** Cancel the run's planned resume; whether there was one. */
  async cancel(runId: string): Promise<boolean> {
    const entry = this.entries.get(runId) ?? (await this.load(runId))
    if (entry?.state !== "scheduled") return false
    await this.settle(entry, "cancelled", "Cancelled by you")
    return true
  }

  dispose(): void {
    for (const handle of [...this.waiting.values(), ...this.watching.values()])
      this.timers.clear(handle)
    this.waiting.clear()
    this.watching.clear()
  }

  private async load(runId: string): Promise<ResumeEntry | null> {
    try {
      const entry = parseResumeEntry(await this.ctx.fs.readFile(resumeEntryPath(this.ctx, runId)))
      if (entry !== null) this.entries.set(runId, entry)
      return entry
    } catch {
      return null
    }
  }

  private async save(entry: ResumeEntry): Promise<void> {
    this.entries.set(entry.run, entry)
    await this.ctx.fs.atomicWrite(
      resumeEntryPath(this.ctx, entry.run),
      `${JSON.stringify(entry)}\n`,
    )
    this.deps.changed?.()
  }

  private async settle(
    entry: ResumeEntry,
    state: ResumeEntry["state"],
    reason?: string,
  ): Promise<void> {
    const handle = this.waiting.get(entry.run)
    if (handle !== undefined) this.timers.clear(handle)
    this.waiting.delete(entry.run)
    await this.save({
      ...entry,
      state,
      ...(reason === undefined ? {} : { reason }),
      settledAt: this.ctx.clock.now(),
    })
  }

  private arm(entry: ResumeEntry): void {
    const held = this.waiting.get(entry.run)
    if (held !== undefined) this.timers.clear(held)
    this.entries.set(entry.run, entry)
    this.waiting.set(
      entry.run,
      this.timers.set(Math.max(0, (entry.resumeAt ?? 0) - this.ctx.clock.now()), () => {
        this.waiting.delete(entry.run)
        void this.fire(entry.run).catch(() => {})
      }),
    )
  }

  private async tail(run: RunRecord): Promise<string[]> {
    const path = this.deps.transcript(run)
    return path === null ? [] : tailLines(this.ctx, path, TAIL_BYTES)
  }

  /**
   * Look at a quiet run's record. A plan-limit refusal at its end is kept: with a resume planned for
   * after the reset when Settings allows it and the agent named the time, held otherwise. A held
   * stop the session has moved on from is ended.
   */
  async check(runId: string): Promise<ResumeEntry | null> {
    const run = this.deps.readRun(runId)
    if (run === null || run.status !== "running" || run.purpose.kind !== "task") return null
    if (run.agent === "other") return null
    const stop = detectLimitStop(run.agent, await this.tail(run))
    const known = this.entries.get(runId) ?? (await this.load(runId))
    if (stop === null) {
      if (known?.state === "held" || known?.state === "scheduled")
        await this.settle(known, "skipped", "Someone wrote in the session after the stop")
      return null
    }
    if (known?.stopKey === stop.key) return null
    return this.plan(run, run.agent, stop, await this.deps.enabled())
  }

  private async plan(
    run: RunRecord,
    agent: NativeAgent,
    stop: LimitStop,
    enabled: boolean,
  ): Promise<ResumeEntry> {
    const resumable = enabled && stop.resetsAt !== null
    const entry: ResumeEntry = {
      version: 1,
      run: run.id,
      generation: run.generation,
      task: run.task ?? null,
      agent,
      window: stop.window,
      stopKey: stop.key,
      resetsAt: stop.resetsAt,
      resumeAt: resumable ? (stop.resetsAt as number) + RESUME_AFTER_RESET_MS : null,
      stoppedAt: stop.at,
      sequence: settledSequence(run),
      state: resumable ? "scheduled" : "held",
      ...(resumable
        ? {}
        : { reason: enabled ? "The agent did not say when it resets" : "Turned off in Settings" }),
    }
    await this.save(entry)
    if (resumable) this.arm(entry)
    return entry
  }

  /** The reset has come: send the message, unless anything changed since the stop. */
  async fire(runId: string): Promise<ResumeEntry | null> {
    const entry = this.entries.get(runId)
    if (entry?.state !== "scheduled") return null
    // A timer waits at most ~24.8 days; a longer window (a monthly plan) fires early and waits again.
    if (entry.resumeAt !== null && this.ctx.clock.now() < entry.resumeAt) {
      this.arm(entry)
      return null
    }
    const verdict = await this.verdict(entry)
    let skipped = "reason" in verdict ? verdict.reason : null
    if ("run" in verdict) {
      try {
        await this.deps.send(verdict.run, CONTINUE_MESSAGE)
      } catch {
        skipped = "The session could not be reached"
      }
    }
    await this.settle(entry, skipped === null ? "sent" : "skipped", skipped ?? undefined)
    return skipped === null ? (this.entries.get(runId) ?? null) : null
  }

  /** The run to tell, or why it must not be told: anything that changed since the stop. */
  private async verdict(entry: ResumeEntry): Promise<{ run: RunRecord } | { reason: string }> {
    const run = this.deps.readRun(entry.run)
    const stale = this.whyStale(entry, run)
    if (stale !== null || run === null || run.agent === "other")
      return { reason: stale ?? "The session is no longer running" }
    if (!(await this.deps.enabled())) return { reason: "Turned off in Settings" }
    const stop = detectLimitStop(run.agent, await this.tail(run))
    return stop?.key === entry.stopKey
      ? { run }
      : { reason: "Someone wrote in the session after the stop" }
  }

  /** What the run's own state says against going on: too late, gone, restarted, or moved on since the stop. */
  private whyStale(entry: ResumeEntry, run: RunRecord | null): string | null {
    if (this.ctx.clock.now() - (entry.resumeAt ?? 0) > LATE_MS) return "The reset passed long ago"
    if (run === null || run.generation !== entry.generation || run.status !== "running")
      return "The session is no longer running"
    if (settledSequence(run) !== entry.sequence) return "The session moved on after the stop"
    return null
  }
}
