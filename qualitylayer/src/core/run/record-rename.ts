import { renameSync } from "node:fs"

const WINDOWS_RETRYABLE_CODES = new Set<string | undefined>(["EPERM", "EBUSY", "EACCES"])

/** Keep the old record intact while a Windows reader temporarily blocks replacement. */
export function replaceRunRecord(
  from: string,
  to: string,
  operations: {
    rename?: (from: string, to: string) => void
    sleep?: (milliseconds: number) => void
    windows?: boolean
  } = {},
): void {
  const move = operations.rename ?? renameSync
  const sleep = operations.sleep ?? Bun.sleepSync
  const windows = operations.windows ?? process.platform === "win32"
  let remaining = 5_000
  let delay = 10
  for (;;) {
    try {
      move(from, to)
      return
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (!windows || !WINDOWS_RETRYABLE_CODES.has(code) || remaining === 0) throw cause
      const pause = Math.min(delay, remaining)
      sleep(pause)
      remaining -= pause
      delay = Math.min(delay * 2, 100)
    }
  }
}
