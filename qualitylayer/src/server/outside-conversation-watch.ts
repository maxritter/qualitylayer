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

const OUTSIDE_TASK_PATTERN = /^[A-Za-z0-9_-]{1,128}~[A-Za-z0-9_-]{1,200}$/
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function hasValidOutsideInterest(keys: string[], task: string, session: string): boolean {
  const hasKeys =
    keys.length === 2 && keys.includes("outsideTask") && keys.includes("expectedSession")
  return hasKeys && OUTSIDE_TASK_PATTERN.test(task) && SESSION_ID_PATTERN.test(session)
}

/** Only the two bounded identities may accompany an event upgrade, never a path or token. */
export function outsideStreamInterest(url: URL) {
  if (url.search === "") return null
  const keys = [...url.searchParams.keys()]
  const task = url.searchParams.get("outsideTask") ?? ""
  const session = url.searchParams.get("expectedSession") ?? ""
  return hasValidOutsideInterest(keys, task, session) ? { task, session } : false
}

function fileStamp(path: string): string | null {
  try {
    const entry = lstatSync(path)
    return `${entry.dev}:${entry.ino}:${entry.size}:${entry.mtimeMs}`
  } catch {
    return null
  }
}

type WatchTarget = {
  ctx: Ctx
  task: string
  session: string
  cwd: string
  path: string
  pace: Pick<Pace, "factor">
}

function bindingMatches(
  current: Awaited<ReturnType<typeof outsideConversationBinding>>,
  target: Pick<WatchTarget, "session" | "cwd">,
): boolean {
  return (
    !(current instanceof Response) &&
    current.run.nativeSession === target.session &&
    current.run.cwd === target.cwd
  )
}

type WatcherState = {
  target: WatchTarget
  changed: () => void
  unavailable: () => void
  stopped: boolean
  pending: boolean
  checking: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  watcher: FSWatcher | undefined
  previous: string | null
}

function stopWatcherState(state: WatcherState) {
  if (state.stopped) return
  state.stopped = true
  clearTimeout(state.timer)
  state.watcher?.close()
}

function failWatcherState(state: WatcherState) {
  if (state.stopped) return
  stopWatcherState(state)
  state.unavailable()
}

function scheduleWatcherFlush(state: WatcherState) {
  if (state.stopped) return
  state.pending = true
  state.timer ??= setTimeout(
    () => void flushWatcherState(state),
    LIVE_EVENT_MS * state.target.pace.factor,
  )
  state.timer.unref?.()
}

async function flushWatcherState(state: WatcherState) {
  state.timer = undefined
  if (state.stopped || state.checking) return
  state.pending = false
  state.checking = true
  try {
    const current = await outsideConversationBinding(state.target.ctx, state.target.task)
    if (state.stopped) return
    // A changed binding refreshes the task too, but never keeps the old record watched.
    if (!bindingMatches(current, state.target)) stopWatcherState(state)
    state.changed()
  } catch {
    failWatcherState(state)
  } finally {
    state.checking = false
    if (state.pending && !state.stopped) scheduleWatcherFlush(state)
  }
}

function onWatchedFileEvent(state: WatcherState, name: string | Buffer | null) {
  if (name !== null && name.toString() !== basename(state.target.path)) return
  const current = fileStamp(state.target.path)
  if (current === state.previous) return
  state.previous = current
  scheduleWatcherFlush(state)
}

function startOutsideWatcher(
  target: WatchTarget,
  changed: () => void,
  unavailable: () => void,
): () => void {
  const state: WatcherState = {
    target,
    changed,
    unavailable,
    stopped: false,
    pending: false,
    checking: false,
    timer: undefined,
    watcher: undefined,
    previous: fileStamp(target.path),
  }
  try {
    state.watcher = watch(dirname(target.path), { persistent: false }, (_, name) => {
      onWatchedFileEvent(state, name)
    })
    state.watcher.on("error", () => failWatcherState(state))
  } catch {
    failWatcherState(state)
  }
  return () => stopWatcherState(state)
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
  const target: WatchTarget = {
    ctx,
    task: interest.task,
    session: interest.session,
    cwd: binding.run.cwd,
    path: location.path,
    pace,
  }
  return {
    start: (changed, unavailable) => startOutsideWatcher(target, changed, unavailable),
  }
}
