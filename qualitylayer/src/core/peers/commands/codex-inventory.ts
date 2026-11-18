import { asRecord, parseTime, readJson, threadStatePath } from "../base.ts"
import type { Said } from "../claims.ts"
import type { ClaudeRecord } from "../claude.ts"
import {
  codexTitleOwner,
  liveCoordinator,
  peerNameForThread,
  type readRegistered,
  type Thread,
} from "../codex.ts"
import { codexFacts } from "../doing.ts"
import { shimPid } from "../shim.ts"
import { sessionFacts } from "./session-facts.ts"

type InventoryContext = {
  threads: Thread[]
  records: ClaudeRecord[]
  registered: ReturnType<typeof readRegistered>
  said: Map<string, Said>
}
function threadAlias(
  t: Thread,
  pid: number | null,
  { threads, records }: InventoryContext,
): string | null {
  const state = pid !== null ? (asRecord(readJson(threadStatePath(t.id), {})) ?? {}) : {}
  let alias = typeof state.name === "string" ? state.name : null
  if (
    alias === `codex-${t.id.slice(0, 8)}` &&
    threads.some((other) => other.id !== t.id && other.id.slice(0, 8) === t.id.slice(0, 8))
  )
    alias = null
  if (alias === null) {
    try {
      alias = peerNameForThread(t.name, t.id, records, codexTitleOwner(t.name, threads), threads)
    } catch {
      alias = null
    }
  }
  return alias
}

export const codexView = async (t: Thread, context: InventoryContext) => {
  const { threads, registered, said } = context
  const pid = shimPid(t.id)
  const alias = threadAlias(t, pid, context)
  const coordinator = t.role === "guardian" ? null : liveCoordinator(t, threads, true)
  const via =
    coordinator !== null &&
    (t.live === false || (t.holder_pid !== null && t.holder_pid === coordinator.holder_pid))
  return {
    id: t.id,
    name: t.name,
    peer_name: alias,
    role: t.role ?? "unknown",
    parent_id: t.parent_id,
    addressability:
      t.role === "guardian" ? "system_thread" : via ? "coordinator" : "native_queue_unverified",
    coordinator: coordinator?.id ?? null,
    updated_at: t.updated_at,
    registered: t.id in registered,
    holder_pid: t.holder_pid,
    shim_pid: pid,
    live: t.live,
    liveness_error: t.liveness_error,
    ...(await sessionFacts(
      `codex:${t.id}`,
      said,
      { cwd: t.cwd, transcript: t.role === "guardian" ? null : t.rollout_path, name: t.name },
      codexFacts,
      parseTime(t.updated_at),
    )),
  }
}
