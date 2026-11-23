import { endWithThisProcess, stopOwnedSubprocess } from "../platform.ts"

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const OUTPUT_BYTES = 64 * 1024

function collectLineIds(
  text: string,
  ids: Set<string>,
  label: string,
  announced: (id: string) => void,
): void {
  for (const match of text.matchAll(UUID)) ids.add(match[0].toLowerCase())
  if (ids.size > 1) throw new Error(`${label} printed ambiguous session ids`)
  const id = ids.values().next().value
  if (id !== undefined) announced(id)
}

function drainLines(
  pending: string,
  ids: Set<string>,
  label: string,
  announced: (id: string) => void,
): string {
  let rest = pending
  let end = rest.indexOf("\n")
  while (end !== -1) {
    collectLineIds(rest.slice(0, end), ids, label, announced)
    rest = rest.slice(end + 1)
    end = rest.indexOf("\n")
  }
  return rest
}

async function readId(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  label: string,
  announced: (id: string) => void,
): Promise<string | undefined> {
  const decoder = new TextDecoder()
  const ids = new Set<string>()
  let pending = ""
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (value) {
      bytes += value.byteLength
      if (bytes > OUTPUT_BYTES) throw new Error(`${label} output exceeded its byte bound`)
      pending = drainLines(pending + decoder.decode(value, { stream: true }), ids, label, announced)
    }
    if (done) break
  }
  collectLineIds(pending + decoder.decode(), ids, label, announced)
  return ids.values().next().value
}

/**
 * An agent that makes its session ids itself offers a subcommand that prints a new one (Cursor's
 * `create-chat`). It runs once, bounded in time and output, in the checkout the session will work
 * in; the start then resumes the id it printed, so QualityLayer knows the session before the first prompt.
 */
/** How long a creator that printed its session ID may take to end by itself before it is stopped. */
const OWN_EXIT_GRACE_MS = 150

export async function createNativeSession(options: {
  program: string
  create: readonly string[]
  cwd: string
  env: Record<string, string>
  timeoutMs?: number
}): Promise<string> {
  const child = Bun.spawn([options.program, ...options.create], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const forget = endWithThisProcess(child)
  const label = options.create.join(" ")
  const reader = child.stdout.getReader()
  let timedOut = false
  const ownedSignals = new Set<string>()
  const ownedSignalExits = new Set<number>()
  let idAnnounced = false
  let announce: (id: string) => void = () => {}
  const available = new Promise<string>((resolve) => {
    announce = resolve
  })
  const output = readId(reader, label, (id) => {
    idAnnounced = true
    announce(id)
  })
  let expire: (error: Error) => void = () => {}
  const deadline = new Promise<never>((_, reject) => {
    expire = reject
  })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
    expire(new Error(`${label} did not finish in time`))
  }, options.timeoutMs ?? 10_000)
  const stop = () =>
    stopOwnedSubprocess({
      exited: child.exited,
      kill: (signal) => {
        child.kill(signal)
        if (idAnnounced && (signal === undefined || signal === "SIGTERM")) {
          ownedSignals.add("SIGTERM")
          ownedSignalExits.add(143)
        }
        if (idAnnounced && signal === "SIGKILL") {
          ownedSignals.add("SIGKILL")
          ownedSignalExits.add(137)
        }
      },
    })
  try {
    await Promise.race([available, output, deadline])
    // A creator that ends by itself just after printing the ID is judged by its own exit code: stopping
    // it first would make its own 137 or 143 look like ours.
    await Promise.race([child.exited, Bun.sleep(OWN_EXIT_GRACE_MS)])
    // Cursor can leave background work alive after printing the ID. Its owned creator must end
    // before the real session starts; keep draining output to detect ambiguity or overflow.
    if (child.exitCode === null && child.signalCode === null) await stop()
    const id = await Promise.race([output, deadline])
    const code = await child.exited
    if (timedOut) throw new Error(`${label} did not finish in time`)
    const ownTermination =
      child.signalCode === null
        ? ownedSignalExits.has(code)
        : typeof child.signalCode === "string" && ownedSignals.has(child.signalCode)
    if (code !== 0 && !ownTermination) throw new Error(`${label} failed with code ${code}`)
    if (id === undefined) throw new Error(`${label} did not print a session id`)
    return id
  } finally {
    clearTimeout(timer)
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
      await stop()
      forget()
    }
  }
}
