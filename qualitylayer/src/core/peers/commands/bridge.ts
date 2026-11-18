import { writeFileSync } from "node:fs"
import { budgetResetPath, isUuid, nowIso, PeerError, warnVersions } from "../base.ts"
import {
  readRegistered,
  registerThread,
  resolveThread,
  resolveThreadPreferLive,
  routeSubAgent,
  threadLabel,
  unregisterThreadUnlocked,
} from "../codex.ts"
import { Shim, stopShim } from "../shim.ts"
import { type Args, fail, opt, out } from "./arguments.ts"
import { underReconcileLock } from "./bridge-lock.ts"
import { reconcile } from "./reconcile.ts"
import { attachThread } from "./shim-process.ts"

export async function cmdShim(args: Args): Promise<number> {
  const id = opt(args, "thread")
  if (id === undefined) return fail("--thread <uuid> is required", 2)
  const thread = resolveThread(id, false)
  if (thread.role === "guardian")
    throw new PeerError(
      "Approval guardian threads are not user-task peers and do not receive a stand-in.",
    )
  return new Shim(thread).run()
}

export async function cmdUp(args: Args): Promise<number> {
  warnVersions()
  const target = args.positional[0]
  if (target !== undefined) {
    const thread = resolveThread(target)
    if (thread.role === "guardian")
      throw new PeerError(
        "Approval guardian threads cannot be attached as user-task peers; choose the requesting task's full UUID.",
      )
    // A spawned sub-agent is not loaded on its own: it gets no stand-in, its live coordinator
    // receives for it and its claims hold while that thread lives.
    const routed = thread.parent_id !== null ? routeSubAgent(thread.id) : null
    if (routed !== null) {
      out(
        `${threadLabel(thread)} is a sub-agent of ${threadLabel(routed.coordinator)}, which is live: it needs no stand-in; messages for it go to its coordinator, and its claims hold while that thread is live`,
      )
      return 0
    }
    registerThread(thread)
    // An explicit `up` clears the reply budget.
    writeFileSync(budgetResetPath(thread.id), `${nowIso()}\n`)
    out(`registered ${thread.name ?? thread.id} (${thread.id})`)
  }
  await underReconcileLock(() => reconcile())
  return 0
}

async function stopRegisteredThread(target: string): Promise<number> {
  let id: string
  try {
    id = resolveThreadPreferLive(target).id
  } catch (cause) {
    if (!isUuid(target)) throw cause
    id = target
  }
  // Stop and unregister under one hold of the lock, so a bare `up` cannot restart it in between.
  const [stopped, removed] = await underReconcileLock(async () => [
    await stopShim(id),
    unregisterThreadUnlocked(id),
  ])
  out(
    removed
      ? `unregistered ${id}${stopped ? " and stopped its stand-in" : ""}`
      : `${id} was not registered${stopped ? "; stand-in stopped" : ""}`,
  )
  return 0
}

export async function cmdDown(args: Args): Promise<number> {
  const target = args.positional[0]
  if (target !== undefined) {
    return stopRegisteredThread(target)
  }
  const stopped = await underReconcileLock(async () => {
    const list: string[] = []
    for (const id of Object.keys(readRegistered()).sort()) if (await stopShim(id)) list.push(id)
    return list
  })
  for (const id of stopped) out(`stopped the stand-in for ${id}`)
  out("registrations kept; `qualitylayer peers up` brings them back")
  return 0
}

// Restart keeps registration, spent replies and valid grants; `down` then `up` resets them.
export async function cmdRestart(args: Args): Promise<number> {
  const target = args.positional[0]
  if (target === undefined) return fail("restart <thread>", 2)
  const thread = resolveThreadPreferLive(target)
  if (thread.role === "guardian")
    throw new PeerError(
      "Approval guardian threads cannot be restarted as user-task peers; choose the requesting task's full UUID.",
    )
  const pid = await underReconcileLock(async () => {
    await stopShim(thread.id)
    return attachThread(thread.id, false)
  })
  if (pid === null) return fail(`${thread.id}: the stand-in did not start again (see its log)`, 1)
  out(
    `restarted the stand-in for ${thread.name ?? thread.id} (pid ${pid}); its reply budget is kept`,
  )
  return 0
}
