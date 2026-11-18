import { spawn } from "node:child_process"
import { openSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { realCtx } from "../../../ctx.ts"
import { trimLogSync } from "../../home-caps.ts"
import { recordRunHook } from "../../run/bind.ts"
import { selfCommand } from "../../self.ts"
import { asRecord, envNumber, GC_DAYS_DEFAULT, isUuid, log, stateDir } from "../base.ts"
import { type Args, flag, opt, out } from "./arguments.ts"
import { underReconcileLock } from "./bridge-lock.ts"
import { gcBridgeState } from "./bridge-retention.ts"
import { reconcile } from "./reconcile.ts"
import { capPeerState, cleanupExpiredRequests } from "./request-retention.ts"
import { attachThread } from "./shim-process.ts"

export async function cmdSessionHook(args: Args): Promise<number> {
  let payload: Record<string, unknown> = {}
  try {
    const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8").trim()
    if (raw.trim() !== "") payload = asRecord(JSON.parse(raw)) ?? {}
  } catch {
    payload = {}
  }
  await recordRunHook(realCtx(), payload, "SessionStart").catch(() => {})
  const source = String(payload.source ?? "unknown")
  const sessionId = payload.session_id
  const logPath = join(stateDir(), "session-hook.log")
  try {
    const command = selfCommand(["peers", "hook-reconcile"])
    if (
      flag(args, "auto-attach") &&
      (source === "startup" || source === "resume") &&
      isUuid(sessionId)
    ) {
      command.push("--thread", String(sessionId))
    }
    trimLogSync(logPath)
    const fd = openSync(logPath, "a", 0o600)
    const [bin, ...rest] = command
    // Codex's hook runner waits for inherited pipes: detach completely.
    const child = spawn(bin as string, rest, {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    })
    child.unref()
    writeFileSync(
      logPath,
      `session-hook: source=${source} session=${sessionId ?? "-"} auto_attach=${flag(args, "auto-attach")}\n`,
      { flag: "a" },
    )
  } catch (cause) {
    log(`could not start the reconcile: ${(cause as Error).message}`)
  }
  out("{}")
  return 0
}

export async function cmdHookReconcile(args: Args): Promise<number> {
  try {
    await gcBridgeState(envNumber("QUALITYLAYER_PEERS_GC_DAYS", GC_DAYS_DEFAULT), false, false)
  } catch (cause) {
    log(`GC skipped: ${(cause as Error).message}`)
  }
  cleanupExpiredRequests()
  capPeerState()
  await underReconcileLock(() => reconcile(false))
  const thread = opt(args, "thread")
  if (thread !== undefined) {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if ((await underReconcileLock(() => attachThread(thread, false))) !== null) break
      await Bun.sleep(250)
    }
  }
  return 0
}
