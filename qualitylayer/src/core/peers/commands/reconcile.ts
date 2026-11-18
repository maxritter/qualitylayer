import type { Thread } from "../codex.ts"
import { codexThreads, readRegistered } from "../codex.ts"
import { shimPid } from "../shim.ts"
import { out } from "./arguments.ts"
import { spawnShim } from "./shim-process.ts"

function attachable(id: string, thread: Thread | undefined, verbose: boolean): thread is Thread {
  if (thread?.role === "guardian") {
    if (verbose) out(`  ${id}: approval guardian, registration retained but no stand-in started`)
    return false
  }
  if (thread?.live === null) {
    if (verbose) out(`  ${id}: liveness unverified, skipped`)
    return false
  }
  if (thread === undefined || thread.live !== true) {
    if (verbose) out(`  ${id}: not live, skipped`)
    return false
  }
  return true
}

function pendingThread(id: string, thread: Thread | undefined, verbose: boolean): Thread | null {
  if (!attachable(id, thread, verbose)) return null
  const running = shimPid(id)
  if (running !== null) {
    if (verbose) out(`  ${id}: stand-in already running (pid ${running})`)
    return null
  }
  return thread
}

function reportStart(id: string, pid: number | null, verbose: boolean): boolean {
  if (pid === null) {
    if (verbose) out(`  ${id}: stand-in failed to start (see its log)`)
    return false
  }
  if (verbose) out(`  ${id}: stand-in started (pid ${pid})`)
  return true
}

export async function reconcile(verbose = true): Promise<number> {
  const registered = readRegistered()
  if (Object.keys(registered).length === 0) {
    if (verbose) out("no registered threads; run `qualitylayer peers up <name|uuid>` first")
    return 0
  }
  const [threads, ok] = codexThreads()
  if (!ok) {
    if (verbose) out("thread discovery is unavailable; no stand-in can be started")
    return 0
  }
  let started = 0
  for (const id of Object.keys(registered).sort()) {
    const thread = pendingThread(
      id,
      threads.find((t) => t.id === id),
      verbose,
    )
    if (thread === null) continue
    const pid = await spawnShim(thread)
    if (reportStart(id, pid, verbose)) started++
  }
  return started
}
