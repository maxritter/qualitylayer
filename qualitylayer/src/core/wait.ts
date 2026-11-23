// One bounded file watcher for every agent. Cursors are per session and committed under a lock.

import { randomUUID } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { detectAgent } from "./agents/detect.ts"
import { readGate } from "./gate/gate.ts"
import { procStartChecked } from "./peers/claude.ts"
import { managedPlanningContext } from "./run/bind.ts"
import { sessionKey } from "./task/binding.ts"
import { pickerPending, reconcilePickerCompletions } from "./task/picker-completion.ts"
import { type Task, touchSession } from "./task/store.ts"
import { takeEvent } from "./wait-deliver.ts"
import {
  currentStage,
  type GateRecord,
  stoppedTask,
  type WaitEvent,
  type WaitHost,
  type WaitOptions,
  whileTaskWaits,
} from "./wait-types.ts"

export { takeEvent } from "./wait-deliver.ts"
export { hasActiveWait, hasPending, pollWaitAnswers, rememberWaitReply } from "./wait-reply.ts"
export {
  BATCH_QUIET_MS,
  type WaitEvent,
  type WaitHost,
  type WaitKind,
  type WaitReply,
  waitReplyPath,
} from "./wait-types.ts"

/** How often an event wait checks whether its stage or open gate was handled meanwhile. */
const GATE_LOOK_MS = 5_000
/** How often a running wait refreshes its lease. */
const LEASE_BEAT_MS = 3_000

type Tick = () => Promise<void>

async function checkStageOrGateChange(
  ctx: Ctx,
  task: WaitHost,
  initialStage: string,
  watched: GateRecord | null,
): Promise<WaitEvent | null> {
  const stage = await currentStage(ctx, task)
  if (stage !== initialStage) return { event: "stage", stage, then: "qualitylayer next" }
  const gate = watched !== null ? await readGate(ctx, task as Task) : null
  const sameDecided =
    watched !== null &&
    gate !== null &&
    (gate.id ?? gate.opened) === (watched.id ?? watched.opened) &&
    gate.decision !== "pending"
  if (!sameDecided) return null
  return {
    event: "stage",
    stage: await currentStage(ctx, task),
    then: `The ${gate.target} decision (${gate.decision}) was already handled in this session: run qualitylayer next${task.slug ? ` --task ${task.slug}` : ""}.`,
  }
}

function pendingTimeoutEvent<T>(opts: WaitOptions & { pending?: () => T }): T | WaitEvent {
  return opts.pending
    ? opts.pending()
    : {
        event: "pending",
        again: true,
        status: "Still waiting for an App event. Run the returned wait command again.",
        then: `qualitylayer wait${opts.coalesce?.batch ? ` --batch ${opts.coalesce.batch}` : ""} --json`,
      }
}

async function waitStep<T>(
  ctx: Ctx,
  task: WaitHost,
  opts: WaitOptions & { poll?: () => Promise<T | null>; pending?: () => T },
  state: { initialStage: string; watched: GateRecord | null; looked: number },
): Promise<T | WaitEvent | null> {
  const stopped = await stoppedTask(ctx, task)
  if (stopped) return stopped
  const event = opts.poll
    ? await opts.poll()
    : await whileTaskWaits(ctx, task, () => takeEvent(ctx, task, opts.kinds, opts.coalesce))
  if (event !== null) return event
  if (
    opts.poll === undefined &&
    task.slug !== undefined &&
    ctx.clock.now() - state.looked >= GATE_LOOK_MS
  ) {
    state.looked = ctx.clock.now()
    return checkStageOrGateChange(ctx, task, state.initialStage, state.watched)
  }
  return null
}

async function waitBody<T>(
  ctx: Ctx,
  task: WaitHost,
  opts: WaitOptions & { poll?: () => Promise<T | null>; pending?: () => T },
  tick: Tick = async () => {},
): Promise<T | WaitEvent> {
  const start = ctx.clock.now()
  const openGate =
    opts.poll === undefined && task.slug !== undefined && (opts.kinds?.includes("gate") ?? true)
      ? await readGate(ctx, task as Task)
      : null
  const state = {
    initialStage: task.stage,
    watched: openGate !== null && openGate.decision === "pending" ? openGate : null,
    looked: start,
  }
  let beat: number | null = null
  for (;;) {
    const ready = await waitStep(ctx, task, opts, state)
    if (ready !== null) return ready
    const now = ctx.clock.now()
    await tick()
    if (now - start >= opts.seconds * 1000) return pendingTimeoutEvent(opts)
    if (opts.beat !== false && task.slug && (beat === null || now - beat >= 15_000)) {
      beat = now
      const halted = await whileTaskWaits(ctx, task, () =>
        touchSession(ctx, task as Task, detectAgent(ctx.env), "waiting"),
      )
      if (halted) return halted
    }
    await ctx.clock.sleep(Math.min(1000, Math.max(1, opts.seconds * 1000 - (now - start))))
  }
}

async function attachPendingPickerStatus<T>(
  ctx: Ctx,
  task: WaitHost,
  result: T | WaitEvent,
): Promise<T | WaitEvent> {
  if (!result || typeof result !== "object" || !("event" in result) || result.event !== "pending")
    return result
  return whileTaskWaits(ctx, task, async () => {
    const completion = pickerPending(await reconcilePickerCompletions(ctx, task))
    if ("native_picker_pending" in completion)
      return { ...result, ...completion, status: completion.native_picker_pending.status }
    if ("native_picker_unanswered" in completion)
      return { ...result, ...completion, status: completion.native_picker_unanswered.status }
    return result
  })
}

/** The compatibility waits keep their own replies, while using this same watch loop. */
export function waitFor<T>(
  ctx: Ctx,
  task: WaitHost,
  opts: WaitOptions & { poll: () => Promise<T | null>; pending: () => T },
): Promise<T>
export function waitFor(ctx: Ctx, task: WaitHost, opts: WaitOptions): Promise<WaitEvent>
export async function waitFor<T>(
  ctx: Ctx,
  task: WaitHost,
  opts: WaitOptions & { poll?: () => Promise<T | null>; pending?: () => T },
): Promise<T | WaitEvent> {
  const stopped = await stoppedTask(ctx, task)
  if (stopped) return stopped
  if (task.slug && task.dir && task.repoRoot) ctx = await managedPlanningContext(ctx, task as Task)
  const key = sessionKey(ctx.env)
  const lease = key
    ? join(task.runtimeDir, "wait", `${key}.active.${process.pid}.${randomUUID()}.json`)
    : null
  const start = lease ? procStartChecked(process.pid)[0] : null
  const writeLease = () =>
    lease
      ? ctx.fs.atomicWrite(lease, JSON.stringify({ pid: process.pid, start, at: ctx.clock.now() }))
      : Promise.resolve()
  const setup = await whileTaskWaits(ctx, task, async () => {
    if (!lease) return
    await ctx.fs.mkdir(join(task.runtimeDir, "wait"))
    await writeLease()
  })
  if (setup) return setup
  let leased = ctx.clock.now()
  const tick: Tick = async () => {
    if (!lease || ctx.clock.now() - leased < LEASE_BEAT_MS) return
    leased = ctx.clock.now()
    await whileTaskWaits(ctx, task, () => writeLease().catch(() => {}))
  }
  try {
    return await attachPendingPickerStatus(ctx, task, await waitBody(ctx, task, opts, tick))
  } finally {
    if (lease) await ctx.fs.remove(lease).catch(() => {})
  }
}
