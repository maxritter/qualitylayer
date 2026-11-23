// Server → browser is one SSE stream fed by a file watcher on the runtime
// folders and on every registered project's docs/plans. No polling timers
// reach the browser; the page refetches when an event arrives.

import type { FSWatcher } from "node:fs"
import { join } from "node:path"
import { logFile } from "../core/automations/log.ts"
import { automationsDir, automationsFile } from "../core/paths.ts"
import type { Ctx } from "../ctx.ts"
import { Pace } from "./resource-guard.ts"
import { emitWatchEvent, type WatchState } from "./watch-emit.ts"
import type { Hub, StreamEvent } from "./watch-hub.ts"
import { PUBLICATION_CHECK_MS, PublicationRecovery, recoveryStride } from "./watch-publications.ts"
import { refreshWatchRoots, stopWatchState } from "./watch-refresh.ts"

export {
  classify,
  Hub,
  LIVE_EVENT_MS,
  type StreamEvent,
} from "./watch-hub.ts"

/**
 * Watch the runtime root and each project's plans; returns a stop function once every folder is
 * watched. The page's pacing stretches with `pace` while the server is over its resource budget
 * (see resource-guard.ts).
 */
export async function startWatching(
  ctx: Ctx,
  hub: Hub,
  pace: Pace = new Pace(),
): Promise<() => void> {
  // One look at every folder and one baseline of it: nothing is announced meanwhile, so nothing is deferred.
  const watching = await watchRuntime(ctx, hub, pace, { deferred: false })
  return watching.stop
}

export type Watching = {
  stop: () => void
  /** Watches the folders that are not the runtime root: the memory catalog and each project's. */
  settle: () => Promise<void>
}

/**
 * `startWatching` in two parts. This returns once the runtime root is watched: the folders every
 * task, run and ask is written to, which is what a server announcing itself must already hear.
 * `settle` then watches the rest. On macOS each native watcher after a process's first goes through
 * the system's file-event daemon one at a time, and a busy machine makes every one of them cost
 * hundreds of milliseconds to seconds (a project's folders add one each), so a server that waits for
 * all of them before it announces itself is not there for the person or the CLI meanwhile. A folder
 * watched late has its changes since the server started published by the first look of `recovery`.
 * `deferred: false` watches everything before it returns, with one baseline, as `startWatching` does.
 * `settle` is cooperative: it hands the event loop back before each folder it watches, because creating
 * a native watcher blocks the process for as long as the file-event daemon takes, and the server's
 * own timers (its checks that it is still wanted) and requests must run between those waits.
 */
export async function watchRuntime(
  ctx: Ctx,
  hub: Hub,
  pace: Pace = new Pace(),
  options: { deferred?: boolean } = {},
): Promise<Watching> {
  const refresh = async (runtimeOnly = false, cooperative = false) => {
    if (state.stopped) return
    if (state.refreshing) return state.refreshing
    const pending = refreshWatchRoots(state, runtimeOnly, cooperative)
    state.refreshing = pending
    try {
      await pending
    } finally {
      if (state.refreshing === pending) state.refreshing = undefined
    }
  }

  const state: WatchState = {
    ctx,
    hub,
    pace,
    watchers: new Map<string, FSWatcher>(),
    memoryChecks: new Map<string, ReturnType<typeof setInterval>>(),
    changed: new Map<StreamEvent["type"], string>(),
    live: undefined,
    livePath: undefined,
    flush: undefined,
    lastFlush: Number.NEGATIVE_INFINITY,
    lastHeard: Date.now(),
    sourceFolders: new Set<string>(),
    projectFolders: undefined,
    wanted: undefined,
    recoveryRoots: undefined,
    runtimeRoots: ["projects", "runs"].map((name) => join(ctx.home, name)),
    approvals: join(ctx.home, "approvals"),
    pickers: join(ctx.home, "pickers"),
    automations: automationsDir(ctx),
    automationFiles: new Set([automationsFile(ctx), logFile(ctx)]),
    stopped: false,
    refreshing: undefined,
    recovery: undefined as unknown as PublicationRecovery,
    triggerRefresh: () => void refresh().catch(() => {}),
  }
  state.recovery = new PublicationRecovery(join(ctx.home, "runs"), (path, aggregate) =>
    emitWatchEvent(state, path, aggregate),
  )

  // A folder that cannot be made or listed costs live updates for it, never the server.
  const deferred = options.deferred !== false
  await refresh(deferred).catch(() => {})
  await state.recovery.seed()
  let recoveryBeat = 0
  const recover = setInterval(() => {
    if (++recoveryBeat < recoveryStride(Date.now() - state.lastHeard, pace.factor)) return
    recoveryBeat = 0
    state.recovery.tick()
  }, PUBLICATION_CHECK_MS)
  recover.unref?.()
  // New plans folders appear after a project's first task; re-scan at a slow, server-side pace.
  const rescan = setInterval(() => void refresh(false, true).catch(() => {}), 15_000)

  return {
    stop: () => {
      clearInterval(rescan)
      clearInterval(recover)
      stopWatchState(state)
    },
    settle: async () => {
      await refresh(false, true).catch(() => {})
      if (state.stopped) return
      await state.recovery.seed()
    },
  }
}
