import { join } from "node:path"
import { asRecord, claudeSessionsDir, readJson } from "../base.ts"
import { readClaudeRecords, recordLiveness, socketPathOk } from "../claude.ts"
import { resolveThread, type Thread, threadIsPaused } from "../codex.ts"
import { isHookPeerKind, isNativeKind, resolveNative } from "../native.ts"
import { shimPid } from "../shim.ts"
import type { Buddy } from "./buddy-context.ts"
import { attachThread } from "./shim-process.ts"

function nativeStatus(
  buddy: Buddy,
  kind: Parameters<typeof resolveNative>[0],
): Record<string, unknown> {
  try {
    const row = resolveNative(kind, buddy.uuid)
    const route = isHookPeerKind(kind) ? "native_hook" : "native_extension"
    return { ...buddy, name: row.name, live: true, status: row.status, route }
  } catch (cause) {
    return { ...buddy, live: false, route: `unavailable: ${(cause as Error).message}` }
  }
}

function claudeStatus(buddy: Buddy, status: Record<string, unknown>): void {
  const states = readClaudeRecords()
    .filter((r) => r.sessionId === buddy.uuid)
    .map((r) => [r, recordLiveness(r)] as const)
  const live = states.find(([, s]) => s === "live")?.[0]
  if (live !== undefined) {
    Object.assign(status, { live: true, name: live.name ?? null, status: live.status ?? null })
    status.route = socketPathOk(live.messagingSocketPath)
      ? "available"
      : "unavailable: its socket is outside the allowlist"
  } else if (states.some(([, s]) => s === "unverified")) {
    status.name = states[0]?.[0].name ?? null
    status.route = "unavailable: liveness is unverified (process probe denied)"
  } else {
    status.live = false
    status.route = "unavailable: no live Claude session with that id"
  }
}

function codexRoute(thread: Thread, pid: number | null): string {
  return thread.live === null
    ? "unavailable: liveness is unverified"
    : !thread.live
      ? "unavailable: the thread is not live"
      : pid === null
        ? "unavailable: no stand-in attached (`qualitylayer peers buddy ping` attaches one)"
        : "available"
}

async function codexStatus(
  buddy: Buddy,
  attach: boolean,
  status: Record<string, unknown>,
): Promise<void> {
  let thread: Thread
  try {
    thread = resolveThread(buddy.uuid, false)
  } catch (cause) {
    status.route = `unavailable: ${(cause as Error).message}`
    return
  }
  Object.assign(status, { name: thread.name, live: thread.live, registered: thread.registered })
  let pid = shimPid(buddy.uuid)
  // A transient attach only: `up` would also reset the budget and register the thread.
  if (attach && pid === null && thread.live === true) pid = await attachThread(buddy.uuid, false)
  status.shim_pid = pid
  if (pid !== null) {
    const shimRec = asRecord(readJson(join(claudeSessionsDir(), `${pid}.json`), null))
    if (shimRec?.sessionId === buddy.uuid) status.status = shimRec.status ?? null
  }
  if (thread.rollout_path) status.paused = threadIsPaused(thread.rollout_path)
  status.route = codexRoute(thread, pid)
}

export async function buddyStatus(buddy: Buddy, attach: boolean): Promise<Record<string, unknown>> {
  if (isNativeKind(buddy.kind)) return nativeStatus(buddy, buddy.kind)
  const status: Record<string, unknown> = {
    name: null,
    live: null,
    registered: null,
    shim_pid: null,
    status: null,
    paused: null,
  }
  if (buddy.kind === "cc") claudeStatus(buddy, status)
  else await codexStatus(buddy, attach, status)
  return { ...status, kind: buddy.kind, uuid: buddy.uuid }
}
