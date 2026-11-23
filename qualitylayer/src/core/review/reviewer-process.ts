// The process of one review: started in its own process group, fed its brief, its lines seen as they
// arrive, and stopped (with everything it started) at its hard stop or the moment a guard says the
// run broke a rule. Kept apart from `cross.ts`, which decides what to run.

import { spawn } from "node:child_process"
import { killProcessTree, windows } from "../platform.ts"

export type ProcessRun = {
  program: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stdin: string
  hardStop: number
  /** Each line of the process's stdout, as it arrives. */
  seen: (line: string) => void
  /** Checks each line before `seen` and says why the run must stop now, or null. */
  guard: ((line: string) => string | null) | null
}

export type ProcessResult = {
  code: number
  stdout: string[]
  stderr: string
  timedOut: boolean
  /** Why the guard stopped the run; null when it did not. */
  broke: string | null
}

/** Stop the process and everything it started. */
function stopTree(child: ReturnType<typeof spawn>): void {
  try {
    if (child.pid !== undefined) killProcessTree(child.pid)
  } catch {
    child.kill("SIGKILL")
  }
}

/** Split what arrives into lines; the unfinished line waits for the next chunk. */
function lineBuffer(onLine: (line: string) => void) {
  let pending = ""
  return {
    push(chunk: Buffer) {
      pending += chunk.toString()
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) onLine(line)
    },
    rest: () => pending,
  }
}

function killGroupOnExit(child: ReturnType<typeof spawn>, signal: NodeJS.Signals | null): void {
  if (windows || signal !== null || child.pid === undefined) return
  // Workers in this review's group end with its leader, even when process queries are denied.
  try {
    killProcessTree(child.pid)
  } catch {}
}

function attachProcessListeners(
  child: ReturnType<typeof spawn>,
  result: ProcessResult,
  pushStdout: (chunk: Buffer) => void,
  finish: (code: number) => void,
  stdin: string,
): void {
  child.stdout?.on("data", pushStdout)
  child.stderr?.on("data", (chunk: Buffer) => {
    result.stderr += chunk.toString()
  })
  child.on("error", (cause) => {
    result.stderr += String(cause)
    finish(127)
  })
  child.on("exit", (_code, signal) => killGroupOnExit(child, signal))
  child.on("close", (code) => finish(code ?? 1))
  child.stdin?.on("error", () => {})
  child.stdin?.end(stdin)
}

/** Run to the end, to the hard stop, or to the guard's first objection. */
export function runProcess(run: ProcessRun): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve) => {
    const result: ProcessResult = { code: 0, stdout: [], stderr: "", timedOut: false, broke: null }
    let settled = false
    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const rest = lines.rest()
      if (rest !== "") result.stdout.push(rest)
      resolve({ ...result, code })
    }
    const stop = (code: number) => {
      stopTree(child)
      setTimeout(() => finish(code), 500)
    }
    const lines = lineBuffer((line) => {
      result.stdout.push(line)
      run.seen(line)
      const why = result.broke === null ? (run.guard?.(line) ?? null) : null
      if (why === null) return
      result.broke = why
      stop(1)
    })
    // Its own process group, so the stop takes the reviewer's children with it.
    const child = spawn(run.program, run.args, {
      cwd: run.cwd,
      detached: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: run.env,
    })
    const timer = setTimeout(() => {
      result.timedOut = true
      stop(137)
    }, run.hardStop)
    attachProcessListeners(child, result, (chunk) => lines.push(chunk), finish, run.stdin)
  })
}
