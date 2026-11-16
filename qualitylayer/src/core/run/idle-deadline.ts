// The deadline of `sessions.idleStop`: an idle session, whatever windows it has open, is stopped once
// it has had no event for the period the person chose. The checks and the stop are the ones of
// Settings › Sessions (sessions-view.ts), so a session with an open turn, question, approval or
// helper is never stopped, and its transcript is kept. Separate from the 15-minute rule of a
// detached host (idle.ts) and from crash recovery.
//
// There is no poll. One timer per idle session is set when its record changes and cleared when the
// session moves on; a working agent writes its record often, so a change is looked at only once the
// record has been quiet for a moment.

import type { IdleStop } from "../config-values.ts"
import { acceptedStopEvent } from "./bind.ts"
import type { RunRecord } from "./contracts.ts"
import { idleRunBoundary } from "./idle.ts"
import { listedRun } from "./listed-run.ts"
import type { StopOutcome } from "./sessions-view.ts"

export const IDLE_STOP_MS: Record<Exclude<IdleStop, "never">, number> = {
  "2h": 2 * 3_600_000,
  "8h": 8 * 3_600_000,
  "24h": 24 * 3_600_000,
}

/** A record's changes are looked at once it has been quiet this long: a working agent writes many. */
export const SETTLE_MS = 2000
/** The longest a single timer waits. */
const MAX_TIMER_MS = 2 ** 31 - 1

export type IdleTimers = {
  set(ms: number, action: () => void): unknown
  clear(handle: unknown): void
}

export const realIdleTimers: IdleTimers = {
  set: (ms, action) => {
    const handle = setTimeout(action, Math.min(ms, MAX_TIMER_MS))
    handle.unref()
    return handle
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export type IdleDeadlineDeps = {
  readRun(id: string): RunRecord | null
  listRuns(): RunRecord[]
  /** The period `sessions.idleStop` names, in milliseconds; undefined for Never. Read when it matters. */
  period(): Promise<number | undefined>
  stop(run: RunRecord): Promise<StopOutcome | null>
  now(): number
  timers?: IdleTimers
  /** Tell whoever shows sessions that one was stopped. */
  changed?(): void
}

export class IdleDeadline {
  private timers: IdleTimers
  private waiting = new Map<string, unknown>()
  private disposed = false

  constructor(private deps: IdleDeadlineDeps) {
    this.timers = deps.timers ?? realIdleTimers
  }

  /** A run's record changed: look at it again once it is quiet. */
  observe(id: string): void {
    if (this.disposed) return
    this.cancel(id)
    this.waiting.set(
      id,
      this.timers.set(SETTLE_MS, () => {
        this.waiting.delete(id)
        void this.arm(id).catch(() => {})
      }),
    )
  }

  /** Look at every running session: at the start, and when the person changes the period. */
  start(): void {
    for (const run of this.deps.listRuns().filter(listedRun)) this.observe(run.id)
  }

  dispose(): void {
    this.disposed = true
    for (const id of [...this.waiting.keys()]) this.cancel(id)
  }

  private cancel(id: string): void {
    const handle = this.waiting.get(id)
    if (handle !== undefined) this.timers.clear(handle)
    this.waiting.delete(id)
  }

  private async due(id: string): Promise<{ run: RunRecord; at: number } | null> {
    const run = this.deps.readRun(id)
    if (!run || !listedRun(run) || idleRunBoundary(run) === undefined) return null
    const period = await this.deps.period()
    const last = Date.parse(acceptedStopEvent(run)?.at ?? "")
    return period === undefined || !Number.isFinite(last) ? null : { run, at: last + period }
  }

  private async arm(id: string): Promise<void> {
    const due = await this.due(id)
    // A change that came while the setting was read has its own look coming.
    if (this.disposed || this.waiting.has(id) || due === null) return
    this.waiting.set(
      id,
      this.timers.set(Math.max(0, due.at - this.deps.now()), () => {
        this.waiting.delete(id)
        void this.fire(id).catch(() => {})
      }),
    )
  }

  private async fire(id: string): Promise<void> {
    const due = await this.due(id)
    if (this.disposed || due === null) return
    // The person may have made the period longer since this timer was set.
    if (this.deps.now() < due.at) return this.arm(id)
    if ((await this.deps.stop(due.run))?.stopped) this.deps.changed?.()
  }
}
