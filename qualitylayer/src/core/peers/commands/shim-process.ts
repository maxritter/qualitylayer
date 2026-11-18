import { spawn } from "node:child_process"
import { existsSync, openSync } from "node:fs"
import { trimLogSync } from "../../home-caps.ts"
import { windows } from "../../platform.ts"
import { pidAlive, selfCommand } from "../../self.ts"
import { codexHome, log, threadLogPath } from "../base.ts"
import { resolveThread, type Thread } from "../codex.ts"
import { shimPid, shimReady } from "../shim.ts"
import { out } from "./arguments.ts"

export async function spawnShim(thread: Thread): Promise<number | null> {
  const logPath = threadLogPath(thread.id)
  const [command, ...rest] = selfCommand(["peers", "shim", "--thread", thread.id])
  let daemon: number | undefined
  let childExited = false
  try {
    trimLogSync(logPath)
    const fd = openSync(logPath, "a", 0o600)
    const child = spawn(command as string, rest, {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      cwd: codexHome() && existsSync(codexHome()) ? codexHome() : "/",
      env: process.env,
    })
    daemon = child.pid
    child.once("exit", () => {
      childExited = true
    })
    child.unref()
  } catch (cause) {
    log(`could not start the stand-in for ${thread.id}: ${(cause as Error).message}`)
    return null
  }
  const readySeconds = windows ? 60 : 10
  const deadline = Date.now() + readySeconds * 1000
  while (Date.now() < deadline) {
    if (childExited) return null
    const pid = shimReady(thread.id, daemon)
    if (pid !== null) return pid
    if (daemon !== undefined && !pidAlive(daemon)) {
      log(`the stand-in for ${thread.id} exited; see ${logPath}`)
      return null
    }
    await Bun.sleep(50)
  }
  log(`the stand-in for ${thread.id} did not report ready in ${readySeconds}s; see ${logPath}`)
  return null
}

function attachmentThread(threadId: string, verbose: boolean): Thread | null {
  let thread: Thread
  try {
    thread = resolveThread(threadId)
  } catch (cause) {
    if (verbose) out(`  ${threadId}: not attachable (${(cause as Error).message})`)
    return null
  }
  if (thread.role === "guardian") {
    if (verbose) out(`  ${threadId}: approval guardian, no user-task stand-in started`)
    return null
  }
  if (thread.live !== true) {
    if (verbose) out(`  ${threadId}: ${thread.live === null ? "unverified" : "not live"}, skipped`)
    return null
  }
  return thread
}

/** Attach is transient: registrations and existing reply budgets are kept. */
export async function attachThread(threadId: string, verbose = true): Promise<number | null> {
  const thread = attachmentThread(threadId, verbose)
  if (thread === null) return null
  const running = shimPid(threadId)
  if (running !== null) {
    if (verbose) out(`  ${threadId}: stand-in already running (pid ${running})`)
    return running
  }
  const pid = await spawnShim(thread)
  if (verbose)
    out(
      pid === null
        ? `  ${threadId}: stand-in failed to start (see its log)`
        : `  ${threadId}: stand-in started (pid ${pid})`,
    )
  return pid
}
