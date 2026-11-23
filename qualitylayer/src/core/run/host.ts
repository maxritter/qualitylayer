import { closeSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createHeadlessTerminal } from "restty/headless"
import { acquireHostLock, prepareHostRecord, recordHostCrash } from "./host-lifecycle.ts"
import { HostSession } from "./host-session.ts"
import { launchHooksFolder, removeLaunchOverlays } from "./launch-hooks.ts"
import { LIMITS } from "./protocol.ts"
import { processIdentity, readLaunch, readRun, runDir } from "./registry.ts"
import { releaseOwnWindowsJob } from "./windows.ts"

export type HostOptions = {
  idleTimeoutMs?: number
  /** How long after the last typing a handed-off planner is told (tests shorten it). */
  plannerQuietMs?: number
  turnRecord?: { quietMs?: number; searchMs?: number }
}

export async function runAgentHost(
  home: string,
  id: string,
  options: HostOptions = {},
): Promise<number> {
  const run = readRun(home, id)
  if (!run) throw new Error("missing run record")
  const launch = readLaunch(home, id)
  const identity = processIdentity(process.pid, "host")
  if (!identity) throw new Error("host process identity unavailable")
  const { lock, lockPath } = acquireHostLock(home, id, run.generation, identity)
  let stopWatchers = () => {}
  try {
    const { token, path, ownerSecret, windowsJob, record } = prepareHostRecord(
      home,
      id,
      run,
      launch,
      identity,
    )
    const terminal = await createHeadlessTerminal({
      cols: launch.cols,
      rows: launch.rows,
      maxScrollbackBytes: LIMITS.scrollbackBytes,
      replay: { maxBytes: LIMITS.replayBytes },
    })
    terminal.wasm.setDefaultColors(
      terminal.handle,
      launch.colors.fg,
      launch.colors.bg,
      launch.colors.cursor,
    )
    const session = new HostSession({
      home,
      id,
      run,
      launch,
      identity,
      token,
      path,
      ownerSecret,
      windowsJob,
      record,
      terminal,
      options,
      onRegisterStopWatchers: (fn) => {
        stopWatchers = fn
      },
    })
    return await session.run()
  } catch (cause) {
    stopWatchers()
    await recordHostCrash(home, id, run.generation, identity, cause)
    throw cause
  } finally {
    stopWatchers()
    rmSync(join(runDir(home, id), "token"), { force: true })
    // The launch's hook overlays (`launch-hooks.ts`) live only as long as the agent: on a clean exit,
    // a non-zero one or a crash of the host alike. This host removes its own generation's only; a
    // restart has already prepared the next one's.
    removeLaunchOverlays(launchHooksFolder(home, id, run.generation))
    closeSync(lock)
    rmSync(lockPath, { force: true })
    if (process.platform === "win32") releaseOwnWindowsJob()
  }
}
