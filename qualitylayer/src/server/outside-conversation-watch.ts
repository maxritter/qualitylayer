import { type FSWatcher, lstatSync, watch } from "node:fs"
import { basename, dirname } from "node:path"
import { locateRecord } from "../core/conversation/locate.ts"
import type { Ctx } from "../ctx.ts"
import { outsideConversationBinding } from "./conversation.ts"
import type { Pace } from "./resource-guard.ts"
import { LIVE_EVENT_MS } from "./watch.ts"

export type OutsideConversationWatch = {
  start(changed: () => void, unavailable: () => void): () => void
}

/** Only the two bounded identities may accompany an event upgrade, never a path or token. */
export function outsideStreamInterest(url: URL) {
  if (url.search === "") return null
  const keys = [...url.searchParams.keys()]
  const task = url.searchParams.get("outsideTask") ?? ""
  const session = url.searchParams.get("expectedSession") ?? ""
  return keys.length === 2 &&
    keys.includes("outsideTask") &&
    keys.includes("expectedSession") &&
    /^[A-Za-z0-9_-]{1,128}~[A-Za-z0-9_-]{1,200}$/.test(task) &&
    /^[A-Za-z0-9_-]{1,128}$/.test(session)
    ? { task, session }
    : false
}

/** Resolve the exact outside binding. Null means it changed. Undefined keeps task events without a file watch. */
export async function prepareOutsideConversationWatch(
  ctx: Ctx,
  interest: { task: string; session: string },
  pace: Pick<Pace, "factor">,
): Promise<OutsideConversationWatch | null | undefined> {
  const binding = await outsideConversationBinding(ctx, interest.task)
  if (binding instanceof Response || binding.run.nativeSession !== interest.session) return null
  const location = locateRecord(ctx, binding.run)
  if (location?.kind !== "jsonl") return undefined
  const stamp = () => {
    try {
      const entry = lstatSync(location.path)
      return `${entry.dev}:${entry.ino}:${entry.size}:${entry.mtimeMs}`
    } catch {
      return null
    }
  }
  return {
    start(changed, unavailable) {
      let stopped = false
      let pending = false
      let checking = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let watcher: FSWatcher | undefined
      let previous = stamp()
      const stop = () => {
        if (stopped) return
        stopped = true
        clearTimeout(timer)
        watcher?.close()
      }
      const failed = () => {
        if (stopped) return
        stop()
        unavailable()
      }
      const flush = async () => {
        timer = undefined
        if (stopped || checking) return
        pending = false
        checking = true
        try {
          const current = await outsideConversationBinding(ctx, interest.task)
          if (stopped) return
          if (
            current instanceof Response ||
            current.run.nativeSession !== interest.session ||
            current.run.cwd !== binding.run.cwd
          ) {
            stop()
          }
          // A changed binding refreshes the task too, but never keeps the old record watched.
          changed()
        } catch {
          failed()
        } finally {
          checking = false
          if (pending && !stopped) schedule()
        }
      }
      const schedule = () => {
        if (stopped) return
        pending = true
        timer ??= setTimeout(() => void flush(), LIVE_EVENT_MS * pace.factor)
        timer.unref?.()
      }
      try {
        watcher = watch(dirname(location.path), { persistent: false }, (_, name) => {
          if (name !== null && name.toString() !== basename(location.path)) return
          const current = stamp()
          if (current === previous) return
          previous = current
          schedule()
        })
        watcher.on("error", failed)
      } catch {
        failed()
      }
      return stop
    },
  }
}
