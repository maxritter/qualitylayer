import { asObject } from "./records.ts"

export { endedProc, procOf } from "./process-stop.ts"

/** Shell tools whose call may return while its command runs, unless the result says it ended. */
const YIELDING_TOOLS = new Set(["exec_command", "local_shell", "shell"])

function responseValue(response: unknown): unknown {
  if (typeof response !== "string" || !response.trimStart().startsWith("{")) return response
  try {
    return JSON.parse(response)
  } catch {
    return response
  }
}

function exitCodeStatus(fields: Record<string, unknown>): boolean | undefined {
  for (const key of ["exit_code", "exitCode"])
    if (key in fields) return typeof fields[key] === "number"
  return undefined
}

const statusOf = (result: Record<string, unknown>): string =>
  typeof result.status === "string" ? result.status.toLowerCase() : ""

function statusLines(text: string, headerOnly: boolean): string[] | null {
  const lines = text.split("\n").map((line) => line.trim())
  const output = lines.indexOf("Output:")
  if (output >= 0) return lines.slice(0, output)
  return headerOnly ? null : lines.filter((line) => line !== "").slice(0, 1)
}

function structuredProcessEnd(result: Record<string, unknown>): boolean | undefined {
  const exit = exitCodeStatus(result) ?? exitCodeStatus(asObject(result.metadata) ?? {})
  if (exit !== undefined) return exit
  const status = statusOf(result)
  if (/^(?:running|in_progress|pending)$/.test(status)) return false
  return /^(?:exited|completed|failed|killed|stopped)$/.test(status) ? true : undefined
}

/**
 * Whether a shell result says its process ended (Codex's exec result or its poll). Read off the
 * result's own status, never off what the program printed.
 */
export function processEnded(response: unknown): boolean {
  const value = responseValue(response)
  let lines: string[] | null = null
  const result = asObject(value)
  if (result !== null) {
    const ended = structuredProcessEnd(result)
    if (ended !== undefined) return ended
    // No status field: the client's own header in the text it carries, or nothing.
    lines = typeof result.output === "string" ? statusLines(result.output, true) : null
  } else if (typeof value === "string") lines = statusLines(value, false)
  if (lines === null) return false
  if (lines.some((line) => /^Process running with session ID\b/.test(line))) return false
  return lines.some((line) => /^Process exited with code -?\d+/.test(line))
}

/**
 * Whether a background shell's poll says the shell is over (Claude Code's BashOutput/TaskOutput,
 * Copilot's read_bash). Read off the tool result's own status, as `processEnded` reads Codex's.
 */
export function taskEnded(response: unknown): boolean {
  const value = responseValue(response)
  const over = /^(?:completed|failed|killed|stopped|exited|terminated)$/
  const result = asObject(value)
  if (result !== null) {
    const status = statusOf(result)
    return status !== "" ? over.test(status) : (exitCodeStatus(result) ?? false)
  }
  if (typeof value !== "string") return false
  // Only the result's head, before any of the command's own output.
  const head = value.split(/<(?:stdout|stderr|output)>/)[0] ?? ""
  const mark = head.match(/^\s*<[^<>]*shellId:[^<>]*>/)
  if (mark)
    return (
      /\b(?:completed|exited|killed|stopped)\b/i.test(mark[0]) &&
      !/\b(?:running|not)\b/i.test(mark[0])
    )
  const status = head.match(/^\s*<status>\s*([a-z_]+)\s*<\/status>/i)?.[1]?.toLowerCase()
  return status !== undefined && over.test(status)
}

export function responseText(response: unknown): string {
  try {
    const text = typeof response === "string" ? response : (JSON.stringify(response) ?? "")
    return text.slice(0, 65_536)
  } catch {
    return ""
  }
}

/**
 * Whether a shell call returned while its command still runs, so a commit of it can come later:
 * asked to run in the background (Claude Code's `run_in_background`, Copilot's `mode: "async"`),
 * a result that names a background task or a running process, or a Codex call whose result does
 * not say the process exited.
 */
export function stillRunning(tool: unknown, input: unknown, response: unknown): boolean {
  const given = asObject(input) ?? {}
  if (
    given.run_in_background === true ||
    given.is_background === true ||
    given.background === true ||
    given.mode === "async"
  )
    return true
  const text = responseText(response)
  // Copilot marks a shell's result: started in the background, or how it ended.
  const copilot = text.match(/<[^<>]*shellId:[^<>]*>/)
  if (copilot) return !/completed|exited|killed|stopped/i.test(copilot[0])
  if (/backgroundTaskId|Process running with session ID|running in (?:the )?background/i.test(text))
    return true
  return typeof tool === "string" && YIELDING_TOOLS.has(tool) && !processEnded(response)
}

/** One tool call as its hook carries it: the tool, its input, its id and, at its end, its result. */
export type HookCall = {
  tool: unknown
  input: unknown
  id?: unknown
  response?: unknown
  /** The agent said the call failed (its failure event, or `is_error`). */
  failed?: boolean
}
