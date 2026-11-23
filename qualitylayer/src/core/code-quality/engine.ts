import { realpathSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { contained, realExistingParent } from "./engine-location.ts"
import { runQualityProcess } from "./engine-process.ts"
import { parseSarif } from "./engine-sarif.ts"
import type {
  QualityFinding,
  QualityInput,
  QualityMode,
  QualityResult,
  QualityRunner,
  QualityRunOutput,
} from "./types.ts"

export { runQualityProcess } from "./engine-process.ts"
export { parseSarif } from "./engine-sarif.ts"

export function diagnostic(value: string): string {
  return [...value.slice(0, 4096)]
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159))
    })
    .join("")
}

const STDOUT_LIMIT = 8 * 1024 * 1024
const STDERR_LIMIT = 64 * 1024
const MAX_TIMEOUT = 120_000
const commands: Record<QualityMode, readonly string[]> = {
  structure: ["smells", "--no-duplication", "--sarif"],
  duplication: ["smells", "--sarif"],
  metrics: ["metrics", "--functions", "--exclude-tests"],
  lint: [
    "check",
    "--no-fix",
    "--no-formatters",
    "--skip-source-fetch",
    "--trigger",
    "agent",
    "--jobs",
    "2",
    "--sarif",
  ],
}

function normalizeScopeFile(root: string, file: string): string {
  if (file.length > 4096) throw new Error("Source path is too long")
  if (!file || file.includes("\0")) throw new Error("Invalid source path")
  const path = resolve(root, file)
  const canonical = realExistingParent(path)
  if (!contained(root, canonical)) throw new Error("Source path escapes analysis root")
  const normalized = relative(root, contained(root, path) ? path : canonical)
    .split(sep)
    .join("/")
  statSync(resolve(root, normalized))
  return normalized ? `./${normalized}` : "."
}

function validateQualityInput(input: QualityInput): {
  root: string
  timeoutMs: number
  files: string[]
} {
  if (!isAbsolute(input.binary) || !isAbsolute(input.root))
    throw new Error("Qlty binary and analysis root must be absolute")
  const root = realpathSync(input.root)
  if (!statSync(root).isDirectory()) throw new Error("Analysis root must be a directory")
  if (!input.files.length || input.files.length > 256)
    throw new Error("Explicit source scope must contain 1 to 256 paths")
  if (!Object.hasOwn(commands, input.mode)) throw new Error("Unknown Qlty mode")
  const timeoutMs = input.timeoutMs ?? 10_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT)
    throw new Error("Qlty timeout must be between 1 and 120000ms")
  const files = [...new Set(input.files.map((file) => normalizeScopeFile(root, file)))]
  return { root, timeoutMs, files }
}

function outputFailure(
  output: QualityRunOutput,
  base: {
    findings: QualityFinding[]
    elapsedMs: number
    exitCode: number | null
    stderr: string
    version?: string
  },
): QualityResult | null {
  if (output.timedOut)
    return { ...base, status: "timed_out", reason: "Qlty exceeded its time budget" }
  if (output.unavailable)
    return {
      ...base,
      status: "unavailable",
      reason: diagnostic(output.error ?? "Qlty executable is unavailable"),
    }
  const oversized =
    output.outputExceeded ||
    Buffer.byteLength(output.stdout) > STDOUT_LIMIT ||
    Buffer.byteLength(output.stderr) > STDERR_LIMIT
  if (oversized)
    return { ...base, status: "failed", reason: "Qlty output exceeded its byte budget" }
  if (output.error) return { ...base, status: "failed", reason: diagnostic(output.error) }
  return null
}

function interpretQualityOutput(
  input: QualityInput,
  root: string,
  output: QualityRunOutput,
  findings: QualityFinding[],
  evidence: () => { findings: QualityFinding[]; elapsedMs: number },
): QualityResult {
  const base = {
    ...evidence(),
    exitCode: output.exitCode,
    stderr: diagnostic(output.stderr),
    version: output.version ? diagnostic(output.version) : undefined,
  }
  const early = outputFailure(output, base)
  if (early) return early
  if (input.mode === "metrics") {
    return output.exitCode !== 0 || !output.stdout.trim()
      ? { ...base, status: "failed", reason: "Qlty metrics did not complete" }
      : { ...base, status: "complete", metrics: output.stdout }
  }
  const parsed = parseSarif(output.stdout, root, findings, input.mode === "lint")
  base.version = parsed.version ?? base.version
  const badExit = output.exitCode !== 0 && !(output.exitCode === 1 && findings.length)
  return parsed.failed || badExit
    ? { ...base, ...evidence(), status: "failed", reason: "Qlty reported an analysis failure" }
    : { ...base, ...evidence(), status: "complete" }
}

export async function runQuality(
  input: QualityInput,
  run: QualityRunner = runQualityProcess,
): Promise<QualityResult> {
  const started = performance.now()
  const findings: QualityFinding[] = []
  const evidence = () => ({ findings, elapsedMs: Math.round(performance.now() - started) })
  let output: QualityRunOutput | undefined
  try {
    const { root, timeoutMs, files } = validateQualityInput(input)
    output = await run(
      [input.binary, "--no-upgrade-check", ...commands[input.mode], "--", ...files],
      {
        cwd: root,
        timeoutMs,
        maxStdoutBytes: STDOUT_LIMIT,
        maxStderrBytes: STDERR_LIMIT,
        env: input.env,
      },
    )
    return interpretQualityOutput(input, root, output, findings, evidence)
  } catch (error) {
    return {
      ...evidence(),
      status: "failed",
      exitCode: output?.exitCode,
      reason: diagnostic(error instanceof Error ? error.message : String(error)),
      stderr: diagnostic(output?.stderr ?? ""),
    }
  }
}
