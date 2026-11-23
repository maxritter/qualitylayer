// Sending what is queued. It runs in the local server, which sees every task: at its start, and
// whenever something is queued in its own process. Each automation's deliveries go one after the
// other, oldest first; different automations go side by side, so a slow receiver holds up only itself.

import type { Ctx } from "../../ctx.ts"
import { deliverEvent } from "./deliver.ts"
import { appendDelivery, noteProblem, trimDeliveries } from "./log.ts"
import { dropQueued, isQueued, onQueued, type Queued, readQueue, writeQueued } from "./queue.ts"
import { type Automation, readAutomations } from "./store.ts"

export { sendTest } from "./sender-test.ts"

export type SendReport = {
  sent: number
  failed: number
  left: number
  /** When the next retry is due (ms), or null when nothing waits for a time. */
  nextAt: number | null
}

/** Deliveries being tried right now: a second run leaves them alone. */
const inFlight = new Map<string, string>()

/** The wait after the first, second, ... fifth failed try of a URL: six tries over about nine hours. */
export const RETRY_DELAYS_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
]

/** When a failed delivery is tried next (ms), or null when the sixth try has failed and it is given up. */
export function nextTryAt(triesMade: number, now: number): number | null {
  const wait = RETRY_DELAYS_MS[triesMade - 1]
  return wait === undefined ? null : now + wait
}

type Outcome = { outcome: "sent" | "failed" | "left"; retryAt: number | null }

/** What a delivery stands on, as the files say it right now. */
type Standing =
  | { state: "wanted"; automation: Automation }
  | { state: "gone" }
  | { state: "unreadable"; problem: string }

/**
 * Read again whether a delivery still has an automation that is on and a place in the queue. The
 * person may remove or turn off the automation (the App or the command line) while a pass is out,
 * so this is asked right before each try and each write back, never answered from the pass's start.
 */
async function standing(ctx: Ctx, entry: Queued): Promise<Standing> {
  const { automations, problem } = await readAutomations(ctx)
  if (problem !== null) return { state: "unreadable", problem }
  const automation = automations.find((candidate) => candidate.id === entry.automation)
  if (automation === undefined || !automation.on || !(await isQueued(ctx, entry.id)))
    return { state: "gone" }
  return { state: "wanted", automation }
}

async function deliver(
  ctx: Ctx,
  automation: Automation,
  entry: Queued,
  options: { timeoutMs?: number },
): Promise<Outcome> {
  // A command may have done half its work when it fails, so it runs once: its delivery leaves the
  // queue before it starts, and a server that stops meanwhile does not run it a second time.
  if (automation.kind === "command") await dropQueued(ctx, entry.id)
  const tried = await deliverEvent(ctx, automation, entry.payload, options)
  const tries = entry.tries + 1
  const again = tried.ok || automation.kind === "command" ? null : nextTryAt(tries, ctx.clock.now())
  // A log that cannot be written must not make the sent event go out a second time.
  await appendDelivery(ctx, {
    at: ctx.clock.now(),
    automation: automation.id,
    event: entry.payload.id,
    name: entry.payload.event,
    result: tried.result,
    gaveUp: !tried.ok && again === null,
    ...(tried.output !== undefined ? { output: tried.output } : {}),
  }).catch(() => {})
  let retryAt = again
  if (again !== null && (await standing(ctx, entry)).state !== "gone") {
    await writeQueued(ctx, { ...entry, tries, next: again })
    // A removal between the look and the write must not leave the delivery behind.
    if ((await standing(ctx, entry)).state !== "gone") return { outcome: "failed", retryAt }
  }
  retryAt = null
  await dropQueued(ctx, entry.id)
  return { outcome: tried.ok ? "sent" : "failed", retryAt }
}

function recordSoonest(report: SendReport, at: number): void {
  report.nextAt = report.nextAt === null ? at : Math.min(report.nextAt, at)
}

function groupByAutomation(queued: readonly Queued[]): Map<string, Queued[]> {
  const grouped = new Map<string, Queued[]>()
  for (const entry of queued) {
    const group = grouped.get(entry.automation) ?? []
    group.push(entry)
    grouped.set(entry.automation, group)
  }
  return grouped
}

type SendPassContext = {
  now: number
  options: { timeoutMs?: number }
  waiting: Set<string>
  report: SendReport
}

async function processEntry(
  ctx: Ctx,
  automation: Automation | undefined,
  entry: Queued,
  pass: SendPassContext,
): Promise<void> {
  const { now, options, waiting, report } = pass
  const task = entry.payload.task.id
  try {
    // An automation that is gone or off has nothing to receive.
    if (automation === undefined || !automation.on) {
      await dropQueued(ctx, entry.id)
      return
    }
    if (inFlight.has(entry.id) || waiting.has(task)) {
      waiting.add(task)
      report.left++
      return
    }
    if (entry.next > now) {
      waiting.add(task)
      recordSoonest(report, entry.next)
      report.left++
      return
    }
    // The person may have removed or turned off the automation since this pass began.
    const current = await standing(ctx, entry)
    if (current.state === "gone") {
      await dropQueued(ctx, entry.id)
      return
    }
    if (current.state === "unreadable") {
      waiting.add(task)
      report.left++
      return
    }
    inFlight.set(entry.id, task)
    const { outcome, retryAt } = await deliver(ctx, current.automation, entry, options)
    if (outcome === "sent") report.sent++
    else if (outcome === "failed") report.failed++
    else report.left++
    if (retryAt !== null) {
      waiting.add(task)
      recordSoonest(report, retryAt)
    }
  } catch {
    waiting.add(task)
    report.left++
  } finally {
    inFlight.delete(entry.id)
  }
}

/**
 * Try every delivery that is due, once. Never throws. An automation's deliveries go oldest first,
 * and a task's later event waits while an earlier one of that task is still to be tried again:
 * other tasks go on.
 */
export async function sendDue(ctx: Ctx, options: { timeoutMs?: number } = {}): Promise<SendReport> {
  const report: SendReport = { sent: 0, failed: 0, left: 0, nextAt: null }
  try {
    const now = ctx.clock.now()
    const queued = await readQueue(ctx)
    if (queued.length === 0) return report
    const { automations, problem } = await readAutomations(ctx)
    // A file that cannot be read is no sign that every automation was deleted: the deliveries stay,
    // one line in the log names the problem, and the next wake tries again.
    if (problem !== null) {
      await noteProblem(ctx, problem)
      report.left = queued.length
      return report
    }
    const byAutomation = groupByAutomation(queued)
    await Promise.all(
      [...byAutomation].map(async ([id, entries]) => {
        const automation = automations.find((candidate) => candidate.id === id)
        // Tasks with an earlier event that has not come to an end.
        const waiting = new Set<string>()
        const pass: SendPassContext = { now, options, waiting, report }
        for (const entry of entries) {
          await processEntry(ctx, automation, entry, pass)
        }
      }),
    )
    if (report.sent + report.failed > 0) await trimDeliveries(ctx)
  } catch {
    // A queue that cannot be read waits for the next run.
  }
  return report
}

/** The timer the sender sets for the next retry; a test gives its own. */
export type Timers = {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const systemTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** The longest a timer can be set for (about 24 days); a retry is never that far off. */
const LONGEST_TIMER_MS = 2 ** 31 - 1

/**
 * Whether a queued delivery waits for a try: the local server does not stop for being idle while
 * one does (the schedule ends after about nine hours). Never throws.
 */
export async function automationsWaiting(ctx: Ctx): Promise<boolean> {
  try {
    const queued = await readQueue(ctx)
    if (queued.length === 0) return false
    const { automations, problem } = await readAutomations(ctx)
    // A file that cannot be read keeps the deliveries (the sender holds them until it can be), so they still wait.
    if (problem !== null) return true
    return queued.some((entry) =>
      automations.some((automation) => automation.id === entry.automation && automation.on),
    )
  } catch {
    return false
  }
}

/**
 * Start sending in this process: what is queued now goes out, and so does whatever is queued in
 * this process later or announced by the flush route. It is no poll: one timer is set for the next
 * retry that is due, and none while nothing waits. Returns the way to stop.
 */
export function startAutomationSender(ctx: Ctx, options: { timers?: Timers } = {}): () => void {
  const timers = options.timers ?? systemTimers
  let stopped = false
  let busy = false
  let again = false
  let timer: unknown
  const clearTimer = () => {
    if (timer === undefined) return
    timers.clear(timer)
    timer = undefined
  }
  const run = async () => {
    if (stopped) return
    if (busy) {
      again = true
      return
    }
    busy = true
    clearTimer()
    let next: number | null = null
    try {
      do {
        again = false
        next = (await sendDue(ctx)).nextAt
      } while (again && !stopped)
    } finally {
      busy = false
    }
    if (stopped || next === null) return
    timer = timers.set(
      () => {
        timer = undefined
        void run()
      },
      Math.min(Math.max(0, next - ctx.clock.now()), LONGEST_TIMER_MS),
    )
  }
  const stopListening = onQueued(() => void run())
  void run()
  return () => {
    stopped = true
    stopListening()
    clearTimer()
  }
}
