import { asRecord, envNumber, GC_DAYS_DEFAULT } from "../base.ts"
import { codexThreads, findStateDb, independentPeerThread, readRegistered } from "../codex.ts"
import { shimPid } from "../shim.ts"
import { gcBridgeState } from "./bridge-retention.ts"
import type { AddCheck } from "./doctor.ts"
export async function reportThreads(add: AddCheck): Promise<void> {
  const db = findStateDb()
  add(
    db ? "ok" : "warn",
    `Codex state database: ${db ?? "none with a recognised `threads` schema (send by UUID only)"}`,
  )
  const [threads] = codexThreads()
  const unverified = threads.filter((t) => t.live === null)
  if (unverified.length > 0) {
    add(
      "fail",
      `Codex liveness probe unavailable: ${unverified[0]?.liveness_error ?? "lsof failed"}`,
    )
  } else if (db) {
    const stale = await gcBridgeState(
      envNumber("QUALITYLAYER_PEERS_GC_DAYS", GC_DAYS_DEFAULT),
      true,
      false,
    )
    add(
      stale.length > 0 ? "warn" : "ok",
      `bridge GC: ${stale.length} stale thread${stale.length === 1 ? "" : "s"}`,
    )
  }
  const registered = readRegistered()
  const live = new Set(threads.filter((t) => t.live === true).map((t) => t.id))
  for (const id of Object.keys(registered).sort()) {
    const name = String(asRecord(registered[id])?.name ?? id)
    const native = threads.find((thread) => thread.id === id)
    const pid = shimPid(id)
    if (pid !== null) add("ok", `${name}: stand-in running (pid ${pid})`)
    else if (native && !independentPeerThread(native))
      add("info", `${name}: managed native helper; its coordinator owns peer delivery`)
    else if (live.has(id))
      add("warn", `${name}: thread is live but has no stand-in (run \`qualitylayer peers up\`)`)
    else add("ok", `${name}: registered, thread not running`)
  }
  if (Object.keys(registered).length === 0)
    add("warn", "no registered threads (run `qualitylayer peers up <name|uuid>`)")
  for (const t of threads.filter(
    (t) =>
      t.live === true &&
      independentPeerThread(t) &&
      !(t.id in registered) &&
      shimPid(t.id) === null,
  )) {
    add(
      "warn",
      `${t.name ?? t.id}: live Codex thread, not attached (run \`qualitylayer peers up ${t.id}\`)`,
    )
  }
}
