// The one output shape: { ok: true, ...data } | { ok: false, error }.
// --json prints the envelope verbatim; text mode renders the same data for
// humans. The exit code mirrors `ok`.

import type { Result, ValidationError } from "../ctx.ts"

function actionFirst(data: Record<string, unknown>): Record<string, unknown> {
  if (data === null || typeof data !== "object") return data
  const actions = ["helper", "helpers", "wait", "slices_running"]
  if (!actions.some((key) => Object.hasOwn(data, key))) return data
  return Object.fromEntries([
    ...actions.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]),
    ...Object.entries(data).filter(([key]) => !actions.includes(key) && key !== "instructions"),
    ...(Object.hasOwn(data, "instructions") ? [["instructions", data.instructions]] : []),
  ])
}

function renderErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => `  line ${e.line} [${e.rule}] ${e.message}\n    fix: ${e.fix_hint}`)
    .join("\n")
}

/** A failed validation's findings, split: what blocks, and the warnings that do not. */
function splitFindings(errors: ValidationError[]): {
  errors: ValidationError[]
  warnings: ValidationError[]
} {
  return {
    errors: errors.filter((e) => e.severity !== "warning"),
    warnings: errors.filter((e) => e.severity === "warning"),
  }
}

function renderFailure(error: Extract<Result<unknown>, { ok: false }>["error"]): string {
  let text = `error (${error.code}): ${error.message}`
  if (error.code === "validation_failed") {
    const { errors, warnings } = splitFindings(error.errors)
    if (errors.length) text += `\n${renderErrors(errors)}`
    if (warnings.length) text += `\nwarnings (they do not block):\n${renderErrors(warnings)}`
  }
  return text
}

function stringItems(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === "string")
    : []
}

function formatEntryLines(
  data: Record<string, unknown>,
  fileKeys: string[],
  summaryFirst: boolean,
): string[] {
  const lines: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (fileKeys.includes(key) || value === undefined) continue
    if (key === "summary" && Array.isArray(value)) {
      if (!summaryFirst) lines.push(...stringItems(value))
      continue
    }
    lines.push(
      typeof value === "string" ? `${key}: ${value}` : `${key}: ${JSON.stringify(value, null, 2)}`,
    )
  }
  return lines
}

export function renderText(result: Result<unknown>): string {
  if (!result.ok) return renderFailure(result.error)
  const data = actionFirst(result.data as Record<string, unknown>)
  const printed = result.terminalText ?? data.printed
  if (typeof printed === "string") return printed
  // A reply may open with one plain line per item (a wait's answers); the details follow as before.
  const summaryFirst = data === result.data
  // A long Verify brief lives on disk. Keep its two working files visible above the helper payload.
  const fileKeys =
    data.phase === "verify" && Array.isArray(data.helpers_pending)
      ? ["instructions_ref", "record_in"].filter((key) => typeof data[key] === "string")
      : []
  const lines: string[] = [
    ...(summaryFirst ? stringItems(data.summary) : []),
    ...fileKeys.map((key) => `${key}: ${data[key]}`),
    ...formatEntryLines(data, fileKeys, summaryFirst),
  ]
  return lines.join("\n")
}

/** Print a result and return the process exit code. */
export function emit(result: Result<unknown>, json: boolean): number {
  if (json) {
    const envelope = result.ok
      ? { ok: true, ...actionFirst(result.data as Record<string, unknown>) }
      : {
          ok: false,
          // Under errors only what blocks; the warnings beside them, so a reader sees what to fix first.
          error:
            result.error.code === "validation_failed"
              ? { ...result.error, ...splitFindings(result.error.errors) }
              : result.error,
        }
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`)
  } else {
    process.stdout.write(`${renderText(result)}\n`)
  }
  return result.ok ? 0 : 1
}
