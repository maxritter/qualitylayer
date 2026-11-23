// The delivery queue. Whoever writes a task event (a short command or the server) queues it here for
// each automation that is on; the local server sends what is queued. Queueing never throws, never
// waits for the network and, with no automation, costs one read of one file.

import { randomBytes } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { automationsDir } from "../paths.ts"
import type { Task } from "../task/store.ts"
import { publicEventsOf } from "./events.ts"
import { noteProblem } from "./log.ts"
import { type EventPayload, eventPayload, projectIdOf } from "./payload.ts"
import { readAutomations, takesEvent } from "./store.ts"

/** One event waiting for one automation. */
export type Queued = {
  /** The delivery's id: sorts by the time it was queued. */
  id: string
  automation: string
  payload: EventPayload
  /** Tries made so far. */
  tries: number
  /** Not before this time (ms). */
  next: number
}

export const queueDir = (ctx: Ctx): string => join(automationsDir(ctx), "queue")

const queuedPath = (ctx: Ctx, id: string): string => join(queueDir(ctx), `${id}.json`)

const listeners = new Set<() => void>()
let sequence = 0

/** The sender asks to hear when something is queued in this process; returns the way to stop. */
export function onQueued(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tell the sender in this process that something may be due. (The server's flush route calls this too.) */
export function wakeSender(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // a listener's trouble is not the writer's
    }
  }
}

/** This process queued something that a server, not it, has to send. */
let queuedHere = false

/**
 * After a command that queued an event: start the local server if none runs (as `next` does) and
 * call its flush route, so the event goes out now. A server's own process has a sender and needs
 * none of this. Never throws; the command's own reply is never changed by it.
 */
export async function wakeServerToSend(ctx: Ctx): Promise<void> {
  try {
    if (!queuedHere || listeners.size > 0) return
    queuedHere = false
    const { ensureCockpit } = await import("../../server/lock.ts")
    const lock = await ensureCockpit(ctx, { explicit: false })
    if (lock === null) return
    const answered = await ctx.http.fetch(`http://127.0.0.1:${lock.port}/api/automations/flush`, {
      method: "POST",
      headers: { "x-qualitylayer-token": lock.token },
      signal: AbortSignal.timeout(3000),
    })
    await answered.body?.cancel().catch(() => {})
  } catch {
    // The events stay queued and go out when a server next runs.
  }
}

/**
 * Called by `appendEvent` after a record is written: queue its public event for every automation
 * that wants it. A failure is one line in the delivery log, never an error for the command.
 */
export async function queueTaskEvent(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  record: Record<string, unknown>,
): Promise<void> {
  try {
    // Bookkeeping is no event: it costs not even the read of the automations file.
    const events = publicEventsOf(record)
    if (events.length === 0) return
    const { automations, problem } = await readAutomations(ctx)
    if (problem !== null) {
      await noteProblem(ctx, problem)
      return
    }
    const project = projectIdOf(task)
    for (const mapped of events) {
      // Only an automation that is on, for this event and this project, is told; the payload is
      // built only when one is.
      const taking = automations.filter((automation) =>
        takesEvent(automation, mapped.event, project),
      )
      if (taking.length === 0) continue
      const payload = await eventPayload(ctx, task, record, mapped)
      // A Chat is no task for anyone else to follow.
      if (payload.task.type === "chat") return
      await ctx.fs.mkdir(automationsDir(ctx), { mode: 0o700 })
      await ctx.fs.mkdir(queueDir(ctx), { mode: 0o700 })
      const now = ctx.clock.now()
      for (const automation of taking) {
        // Time, then this process's count (events of the same millisecond keep their order), then luck.
        const id = `${String(now).padStart(14, "0")}-${String(sequence++ % 1000).padStart(3, "0")}-${randomBytes(3).toString("hex")}`
        const entry: Queued = { id, automation: automation.id, payload, tries: 0, next: now }
        await ctx.fs.atomicWrite(queuedPath(ctx, id), JSON.stringify(entry))
      }
      queuedHere = true
      wakeSender()
    }
  } catch (cause) {
    await noteProblem(ctx, cause)
  }
}

function isQueuedEntry(entry: Queued): boolean {
  if (typeof entry.id !== "string" || typeof entry.automation !== "string") return false
  if (typeof entry.payload?.id !== "string") return false
  return typeof entry.tries === "number" && typeof entry.next === "number"
}

/** Everything waiting, oldest first; a file that does not read stays where it is. */
export async function readQueue(ctx: Ctx): Promise<Queued[]> {
  let names: string[]
  try {
    names = (await ctx.fs.readdir(queueDir(ctx))).filter((name) => name.endsWith(".json")).sort()
  } catch {
    return []
  }
  const found: Queued[] = []
  for (const name of names) {
    try {
      const entry = JSON.parse(await ctx.fs.readFile(join(queueDir(ctx), name))) as Queued
      if (isQueuedEntry(entry)) found.push(entry)
    } catch {
      // half-written or foreign
    }
  }
  return found
}

/** Keep a delivery for its next try. */
export async function writeQueued(ctx: Ctx, entry: Queued): Promise<void> {
  await ctx.fs.atomicWrite(queuedPath(ctx, entry.id), JSON.stringify(entry))
}

/** Whether a delivery is still in the queue: removing an automation takes its deliveries out. */
export async function isQueued(ctx: Ctx, id: string): Promise<boolean> {
  return ctx.fs.exists(queuedPath(ctx, id))
}

/** Take a delivery out of the queue: sent, or given up. */
export async function dropQueued(ctx: Ctx, id: string): Promise<void> {
  await ctx.fs.remove(queuedPath(ctx, id))
}

/** Take every delivery waiting for one automation out of the queue: it was removed or turned off. */
export async function dropQueuedFor(ctx: Ctx, automation: string): Promise<number> {
  let dropped = 0
  for (const entry of await readQueue(ctx)) {
    if (entry.automation !== automation) continue
    await dropQueued(ctx, entry.id)
    dropped++
  }
  return dropped
}
