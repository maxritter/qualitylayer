// Short questions asked of other programs ("claude --version", "command -v codex") that must never
// leave a process behind. An agent's command is often a wrapper script that resolves the real
// binary in a subshell; killing only the process we started leaves that subshell running, so every
// probe gets its own process group and a timeout (or a normal end) takes the whole group down.

import { spawn, spawnSync } from "node:child_process"
import { statSync } from "node:fs"
import { windows, windowsSystemCommand } from "./platform.ts"

export type ProbeOptions = {
  timeoutMs?: number
  env?: Record<string, string | undefined>
  cwd?: string
}

export type ProbeResult = {
  /** The exit code, or null when the program could not start or was killed. */
  status: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** Why it could not start, e.g. ENOENT. */
  error?: string
}

const DEFAULT_TIMEOUT_MS = 5_000

/** The first three-part version a tool reports, optionally with its prerelease. */
export function versionFromOutput(text: string | null, includePrerelease = false): string | null {
  const match = /(?<!\d)(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.]+)?/.exec(text ?? "")
  return (includePrerelease ? match?.[0] : match?.[1]) ?? null
}

/** Kills the group `leader` started and everything still in it. Best effort, never throws. */
function killGroup(leader: number): void {
  try {
    if (windows) {
      spawnSync(windowsSystemCommand("taskkill.exe"), ["/T", "/F", "/PID", String(leader)], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5_000,
      })
    } else {
      process.kill(-leader, "SIGKILL")
    }
  } catch {
    // the group is already gone
  }
}

function killChildPid(child: ReturnType<typeof spawn>): void {
  if (child.pid !== undefined) killGroup(child.pid)
}

function collectProbeOutput(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
  resolve: (result: ProbeResult) => void,
): void {
  let stdout = ""
  let stderr = ""
  let timedOut = false
  let settled = false
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk
  })
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk
  })
  const finish = (result: ProbeResult) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    killChildPid(child)
    resolve(result)
  }
  const timer = setTimeout(() => {
    timedOut = true
    killChildPid(child)
  }, timeoutMs)
  // A wrapper that exits while its subshell lives on would keep our pipe open: take it down now.
  child.on("exit", () => killChildPid(child))
  child.on("error", (error) =>
    finish({
      status: null,
      stdout,
      stderr,
      timedOut,
      error: (error as NodeJS.ErrnoException).code,
    }),
  )
  child.on("close", (code) => finish({ status: timedOut ? null : code, stdout, stderr, timedOut }))
}

/** Runs `argv` in its own process group; killed, with everything it started, after the timeout. */
export function probe(argv: string[], options: ProbeOptions = {}): Promise<ProbeResult> {
  const [program, ...args] = argv
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (program === undefined) {
    return Promise.resolve({
      status: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: "no command",
    })
  }
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(program, args, {
      env: options.env as NodeJS.ProcessEnv | undefined,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: !windows,
      windowsHide: true,
    })
  } catch (error) {
    return Promise.resolve({
      status: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: String(error),
    })
  }
  return new Promise((resolve) => collectProbeOutput(child, timeoutMs, resolve))
}

/**
 * Starts "$@" in a group of its own, waits for it, and kills the group when the timer (a second
 * group) fires or when the program is done. `setsid` makes the groups where it exists (Linux);
 * dash, the usual /bin/sh there, turns `set -m` off without a terminal ("can't access tty") and
 * would leave everything in our group. macOS has no `setsid`, and its sh keeps `set -m` without
 * a terminal.
 */
const SUPERVISOR = [
  // job-control notices ("Done", "Killed") go to the shell's own stderr, which is thrown away;
  // the program's stderr is the real one, kept on fd 3
  "exec 3>&2 2>/dev/null",
  // under `set -m` the job is already a group leader, and setsid would fork: one or the other
  "if command -v setsid >/dev/null; then g=setsid; else g=; set -m; fi",
  '$g "$@" 2>&3 & job=$!',
  '$g sh -c \'sleep "$1"; kill -s KILL -- "-$2"\' sh "$QL_PROBE_SECONDS" "$job" >/dev/null 2>&1 & timer=$!',
  'wait "$job"; code=$?',
  'kill -s KILL -- "-$job" "-$timer" 2>/dev/null',
  "exit $code",
].join("\n")

/** `probe`, for callers that cannot wait asynchronously. */
export function probeSync(argv: string[], options: ProbeOptions = {}): ProbeResult {
  const [program, ...args] = argv
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (program === undefined) {
    return { status: null, stdout: "", stderr: "", timedOut: false, error: "no command" }
  }
  const started = Date.now()
  if (windows) {
    const run = spawnSync(program, args, {
      encoding: "utf8",
      env: options.env as NodeJS.ProcessEnv | undefined,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      windowsHide: true,
    })
    const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT"
    if (timedOut && run.pid !== undefined) killGroup(run.pid)
    return {
      status: run.error === undefined ? run.status : null,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      timedOut,
      ...(run.error !== undefined && !timedOut
        ? { error: (run.error as NodeJS.ErrnoException).code }
        : {}),
    }
  }
  const run = spawnSync("/bin/sh", ["-c", SUPERVISOR, "probe", program, ...args], {
    encoding: "utf8",
    env: {
      ...((options.env ?? process.env) as NodeJS.ProcessEnv),
      QL_PROBE_SECONDS: String(Math.max(timeoutMs, 1) / 1000),
    },
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    // The supervisor ends the job itself; this only guards a supervisor that hangs.
    timeout: timeoutMs + 3_000,
    killSignal: "SIGKILL",
  })
  const timedOut =
    (run.status !== null && run.status >= 128 && Date.now() - started >= timeoutMs - 50) ||
    (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT"
  // "$@" that does not exist: the shell says 127 and the caller sees a missing program.
  if (run.status === 127)
    return { status: null, stdout: "", stderr: "", timedOut: false, error: "ENOENT" }
  return {
    status: timedOut ? null : run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    timedOut,
  }
}

const answers = new Map<string, string | null>()

/** What a file is, as far as a cached answer about it goes: its path, size and time. */
function fileKey(path: string): string {
  const info = statSync(path, { throwIfNoEntry: false })
  return `${path}\0${info?.size ?? 0}\0${info?.mtimeMs ?? 0}`
}

/**
 * The first line of `command --version`'s output, asked at most once per process for a program
 * file that has not changed. `null` when it fails, times out or does not exist.
 */
export async function versionTextOf(
  path: string,
  argv: string[],
  options: ProbeOptions = {},
): Promise<string | null> {
  const key = `${fileKey(path)}\0${argv.join(" ")}`
  if (answers.has(key)) return answers.get(key) ?? null
  const result = await probe(argv, options)
  const text = result.status === 0 ? result.stdout || result.stderr : null
  answers.set(key, text)
  return text
}

/** `versionTextOf` for callers that cannot wait. */
export function versionTextOfSync(
  path: string,
  argv: string[],
  options: ProbeOptions = {},
): string | null {
  const key = `${fileKey(path)}\0${argv.join(" ")}`
  if (answers.has(key)) return answers.get(key) ?? null
  const result = probeSync(argv, options)
  const text = result.status === 0 ? result.stdout || result.stderr : null
  answers.set(key, text)
  return text
}
