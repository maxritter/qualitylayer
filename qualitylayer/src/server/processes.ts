// Finding and stopping QualityLayer's own `serve` processes. A pid alone proves nothing (the system
// reuses them), and a name alone matches programs that are not ours, so a process is only stopped
// when its command line says it is a QualityLayer server: its program is the one the lock recorded,
// or a `qualitylayer`/`qualitylayer-cli` program (or `main.ts`) started with `serve`.

import { spawnSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { sep } from "node:path"
import { pidAlive } from "../core/self.ts"
import { commandOf, windowsCommand, windowsProcessRows } from "./processes-inspect.ts"

export {
  commandOf,
  parseWindowsRows,
  processStartTime,
  windowsCommand,
} from "./processes-inspect.ts"

export type Sleep = (ms: number) => Promise<void>

/** `/path/qualitylayer[-cli] serve ...`: a compiled QualityLayer started as the server. The path starts the line. */
const SERVE = /^(\/.*?\/qualitylayer(?:-cli)?) serve(?: |$)/

/** The same on Windows: `C:\path\qualitylayer[-cli].exe serve ...`, in any letter case. */
const WINDOWS_SERVE = /^([A-Za-z]:[\\/].*?[\\/]qualitylayer(?:-cli)?\.exe) serve(?: |$)/i

/** A source run: `bun [run] <repo>/src/main.ts serve`. */
const SOURCE_SERVE = /[\\/]main\.ts serve(?: |$)/

function serverArguments(args: string): boolean {
  if (/^serve(?: |$)/.test(args)) return true
  const source = args.startsWith("run ") ? args.slice(4) : args
  return /^(?:\/|[A-Za-z]:[\\/])/.test(source) && SOURCE_SERVE.test(source)
}

/** The program a command line runs when it is a compiled QualityLayer server's, else null. */
export function serverProgram(command: string): string | null {
  return SERVE.exec(command)?.[1] ?? WINDOWS_SERVE.exec(command)?.[1] ?? null
}

/** Whether a command line is a QualityLayer server's. `program` is the executable the lock recorded. */
export function isServerCommand(
  command: string,
  program: string,
  windows = process.platform === "win32",
): boolean {
  // Windows paths are not case-sensitive.
  const same = (line: string) => (windows ? line.toLowerCase() : line)
  const line = same(command)
  const prefix = `${same(program)} `
  if (line.startsWith(prefix) && serverArguments(line.slice(prefix.length))) return true
  if (command.length > 4096) return false
  let canonical: string
  try {
    canonical = realpathSync(program)
  } catch {
    return false
  }
  // ps preserves the launch spelling while the lock's process.execPath can resolve a symlink.
  for (let at = command.indexOf(" "); at !== -1; at = command.indexOf(" ", at + 1)) {
    if (!serverArguments(command.slice(at + 1))) continue
    try {
      if (same(realpathSync(command.slice(0, at))) === same(canonical)) return true
    } catch {
      // An unreadable prefix cannot establish the recorded executable's identity.
    }
  }
  return false
}

/** Every QualityLayer server running as this user: pid and the program it runs. Empty where it cannot be asked. */
export function runningServers(): { pid: number; program: string }[] {
  if (process.platform === "win32") {
    return windowsProcessRows("Name = 'qualitylayer.exe' OR Name = 'qualitylayer-cli.exe'").flatMap(
      (row) => {
        const command = windowsCommand(row)
        const program = command === null ? null : serverProgram(command)
        return program === null ? [] : [{ pid: row.pid, program }]
      },
    )
  }
  const out = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (out.status !== 0) return []
  const found: { pid: number; program: string }[] = []
  for (const line of out.stdout.split("\n")) {
    const match = /^\s*(\d+) (.*)$/.exec(line)
    const program = match?.[2] === undefined ? null : serverProgram(match[2])
    if (match?.[1] !== undefined && program !== null) found.push({ pid: Number(match[1]), program })
  }
  return found
}

/** Ask a server to stop; after `graceMs` end it. True once the process is gone. */
export async function endServer(
  pid: number,
  sleep: Sleep,
  options: { graceMs?: number; program: string },
): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return !pidAlive(pid)
  }
  const grace = options.graceMs ?? 5000
  for (let waited = 0; waited < grace && pidAlive(pid); waited += 100) await sleep(100)
  if (!pidAlive(pid)) return true
  // It ignored the request. Only a process that is still a QualityLayer server is forced.
  const command = commandOf(pid)
  if (command === null || !isServerCommand(command, options.program)) return false
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // gone between the check and the signal
  }
  for (let i = 0; i < 30 && pidAlive(pid); i++) await sleep(100)
  return !pidAlive(pid)
}

/** True when the path is `folder` or lies inside it. */
export function isInside(
  folder: string,
  path: string,
  windows = process.platform === "win32",
): boolean {
  const same = (text: string) => (windows ? text.toLowerCase() : text)
  const base = folder.endsWith(sep) ? folder : `${folder}${sep}`
  return same(path) === same(folder) || same(path).startsWith(same(base))
}

/**
 * The servers an install leaves behind: the ones that run from a program inside `folders` (the App
 * being replaced) and the ones whose program no longer exists. A server of another build in a
 * folder that was not replaced is left alone.
 */
export function leftoverServers(
  folders: string[],
  skip: number[] = [],
): { pid: number; program: string }[] {
  return runningServers().filter(
    ({ pid, program }) =>
      !skip.includes(pid) &&
      pid !== process.pid &&
      (folders.some((folder) => isInside(folder, program)) ||
        // A path with a space may be an interpreter's argument, not a program: only a plain one is
        // judged by whether the file is still there.
        (!/\s/.test(program) && !existsSync(program))),
  )
}
