import { join } from "node:path"
import { readConfig } from "../../core/config.ts"
import { identityState, listRuns, readHost, signalOwned } from "../../core/run/registry.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"

const USAGE = "usage: qualitylayer agent-runs stop --all --reason app-quit [--json]"

const ALLOWED_STOP_ARGS = new Set(["--all", "--reason", "app-quit", "--json"])

function isValidStopArgs(args: string[]): boolean {
  if (args[0] !== "stop" || !args.includes("--all")) return false
  if (args[args.indexOf("--reason") + 1] !== "app-quit") return false
  return args.every((arg, i) => i === 0 || ALLOWED_STOP_ARGS.has(arg))
}

function isConfirmedLiveHost(
  host: ReturnType<typeof listRuns>[number]["host"],
  hostRecord: ReturnType<typeof readHost>,
): host is NonNullable<ReturnType<typeof listRuns>[number]["host"]> {
  if (host?.knownBy !== "host") return false
  if (hostRecord && (hostRecord.pid !== host.pid || hostRecord.processStart !== host.processStart))
    return false
  // Windows has no native process table: a host there is witnessed by its creation time.
  const witness = process.platform === "win32" ? host.processStart : host.nativeStart
  return Boolean(witness) && identityState(host) === "live"
}

function trySignalRun(home: string, run: ReturnType<typeof listRuns>[number]): boolean {
  const hostRecord = readHost(home, run.id)
  const host = run.host
  if (["stopped", "failed"].includes(run.status) && (!host || identityState(host) === "dead"))
    return false
  if (!isConfirmedLiveHost(host, hostRecord))
    throw new Error("The host's process identity could not be confirmed")
  if (!signalOwned(host, "SIGTERM")) throw new Error("The host could not be signalled")
  return true
}

/** Quit asks hosts to stop; hosts own the PTY and finish escalation independently. */
export async function agentRunsCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (!isValidStopArgs(args)) return err({ code: "bad_args", message: USAGE })
  if ((await readConfig(ctx)).onQuit !== "stop") return ok({ signalled: [], kept: true })
  const signalled: string[] = []
  const failures: { run: string; message: string }[] = []
  for (const run of listRuns(ctx.home)) {
    try {
      if (trySignalRun(ctx.home, run)) signalled.push(run.id)
    } catch (cause) {
      failures.push({
        run: run.id,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  const failurePath = join(ctx.home, "app-quit-failure.json")
  if (failures.length) {
    await ctx.fs.writeFile(
      failurePath,
      `${JSON.stringify({ at: ctx.clock.now(), reason: "app-quit", failures })}\n`,
      { mode: 0o600 },
    )
    return err({
      code: "bad_args",
      message: `Some runs could not be stopped when the App quit: ${failures.map((f) => f.run).join(", ")}`,
    })
  }
  await ctx.fs.remove(failurePath)
  return ok({ signalled })
}
