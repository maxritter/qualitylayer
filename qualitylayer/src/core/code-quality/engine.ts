import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { realpathSync, statSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
  endWithThisProcess,
  killProcessTree,
  stopOwnedSubprocess,
  windows,
  windowsSystemCommand,
} from "../platform.ts"
import type {
  QualityFinding,
  QualityInput,
  QualityLocation,
  QualityMode,
  QualityResult,
  QualityRunner,
  QualityRunOutput,
} from "./types.ts"

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

export function diagnostic(value: string): string {
  return [...value.slice(0, 4096)]
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159))
    })
    .join("")
}

function stopTree(pid: number): void {
  try {
    if (windows) {
      spawnSync(windowsSystemCommand("taskkill.exe"), ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 2000,
      })
    } else killProcessTree(pid)
  } catch {
    // The leader or its process group may already have exited.
  }
}

export const runQualityProcess: QualityRunner = async (argv, options) => {
  const program = argv[0]
  if (!program) throw new Error("Process executable is missing")
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
  )
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(program, argv.slice(1), {
      cwd: options.cwd,
      detached: !windows,
      windowsHide: true,
      env: {
        ...env,
        ...options.env,
        NO_COLOR: "1",
        RAYON_NUM_THREADS: "2",
        QLTY_TELEMETRY: "off",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    return { exitCode: null, stdout: "", stderr: "", unavailable: true, error: String(error) }
  }
  const output: QualityRunOutput = { exitCode: null, stdout: "", stderr: "" }
  const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] }
  const sizes = { stdout: 0, stderr: 0 }
  let groupStopped = false
  const kill = () => {
    if (!groupStopped && child.pid !== undefined) {
      groupStopped = true
      stopTree(child.pid)
    }
    try {
      child.kill("SIGKILL")
    } catch {
      /* already reaped */
    }
  }
  const forget = endWithThisProcess({ kill })
  const exited = new Promise<number>((done) => {
    child.once("exit", (code) => {
      output.exitCode = code
      kill()
      done(code ?? -1)
    })
    child.once("error", (error: NodeJS.ErrnoException) => {
      output.unavailable = error.code === "ENOENT" || error.code === "EACCES"
      output.error = error.message
      done(-1)
    })
  })
  const closed = new Promise<void>((done) => child.once("close", () => done()))
  for (const name of ["stdout", "stderr"] as const) {
    child[name]?.on("data", (chunk: Buffer) => {
      const limit = name === "stdout" ? options.maxStdoutBytes : options.maxStderrBytes
      sizes[name] += chunk.length
      if (sizes[name] > limit) {
        output.outputExceeded = true
        kill()
      } else chunks[name].push(chunk)
    })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<void>((done) => {
    timer = setTimeout(() => {
      output.timedOut = true
      kill()
      done()
    }, options.timeoutMs)
  })
  try {
    await Promise.race([exited, budget])
    await stopOwnedSubprocess({ kill, exited })
    // Drain buffered output, but do not let a detached descendant keep a pipe open.
    let drainTimer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      closed,
      new Promise<void>((done) => {
        drainTimer = setTimeout(done, 200)
      }),
    ])
    if (drainTimer !== undefined) clearTimeout(drainTimer)
    child.stdout?.destroy()
    child.stderr?.destroy()
    await closed
    output.stdout = Buffer.concat(chunks.stdout).toString("utf8")
    output.stderr = Buffer.concat(chunks.stderr).toString("utf8")
    return output
  } finally {
    clearTimeout(timer)
    kill()
    child.stdout?.destroy()
    child.stderr?.destroy()
    forget()
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid SARIF object")
  return value as Record<string, unknown>
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid SARIF array")
  return value
}

function positive(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("Invalid SARIF region")
  return value
}

function contained(root: string, path: string): boolean {
  const delta = relative(root, path)
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`))
}

function realExistingParent(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    if (parent === path) throw new Error("Unresolvable source path")
    return resolve(realExistingParent(parent), relative(parent, path))
  }
}

function sourcePath(root: string, uri: string): string {
  if (!uri || uri.includes("\0") || uri.includes("\\")) throw new Error("Invalid source path")
  let path: string
  if (uri.startsWith("file:")) path = fileURLToPath(uri)
  else {
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) throw new Error("Non-file SARIF location")
    path = resolve(root, decodeURIComponent(uri))
  }
  if (path.includes("\0")) throw new Error("Invalid source path")
  const canonical = realExistingParent(path)
  if (!contained(root, canonical)) throw new Error("Source path escapes analysis root")
  if (!statSync(canonical).isFile()) throw new Error("SARIF source is not an existing file")
  return relative(root, contained(root, path) ? path : canonical)
    .split(sep)
    .join("/")
}

function pluginRegion(value: Record<string, unknown>): Record<string, unknown> {
  const region = { ...value }
  if (region.startColumn === 0) region.startColumn = 1
  if (region.endLine === 0) delete region.endLine
  if (region.endColumn === 0) delete region.endColumn
  return region
}

function location(
  value: unknown,
  run: Record<string, unknown>,
  root: string,
  coordinates: "strict" | "whole-lines" | "plugin" = "strict",
): QualityLocation {
  const physical = object(object(value).physicalLocation)
  let artifact = object(physical.artifactLocation)
  if (artifact.uri === undefined && artifact.index !== undefined) {
    if (
      typeof artifact.index !== "number" ||
      !Number.isSafeInteger(artifact.index) ||
      artifact.index < 0
    )
      throw new Error("Invalid SARIF artifact index")
    artifact = object(object(list(run.artifacts)[artifact.index]).location)
  }
  if (typeof artifact.uri !== "string") throw new Error("SARIF location has no path")
  let uri: string = artifact.uri
  if (artifact.uriBaseId !== undefined) {
    if (typeof artifact.uriBaseId !== "string") throw new Error("Invalid SARIF URI base")
    const base = object(object(run.originalUriBaseIds)[artifact.uriBaseId]).uri
    if (typeof base !== "string" || !base.startsWith("file:"))
      throw new Error("Invalid SARIF URI base")
    uri = new URL(uri, base).href
  }
  const supplied = object(physical.region === undefined ? {} : physical.region)
  const region = coordinates === "plugin" ? pluginRegion(supplied) : supplied
  const line = positive(region.startLine, 1)
  const endLine = positive(region.endLine, line)
  if (endLine < line) throw new Error("Invalid SARIF line range")
  const result: QualityLocation = { path: sourcePath(root, uri), line, endLine }
  if (coordinates === "whole-lines" && region.startColumn === 0 && region.endColumn === 0) {
    result.startColumn = 0
    result.endColumn = 0
  } else {
    if (region.startColumn !== undefined) result.startColumn = positive(region.startColumn)
    if (region.endColumn !== undefined) result.endColumn = positive(region.endColumn)
  }
  if (
    line === endLine &&
    result.endColumn !== undefined &&
    result.startColumn !== undefined &&
    result.endColumn < result.startColumn
  )
    throw new Error("Invalid SARIF column range")
  if (typeof run.columnKind === "string") result.columnKind = run.columnKind
  return result
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** Strict SARIF parsing; manual lint may normalize plugins' zero coordinate sentinels. */
export function parseSarif(
  stdout: string,
  root: string,
  findings: QualityFinding[],
  pluginRegions = false,
): { version?: string; failed: boolean } {
  const report = object(JSON.parse(stdout))
  if (report.version !== "2.1.0") throw new Error("Unsupported SARIF version")
  const runs = list(report.runs)
  if (!runs.length) throw new Error("SARIF contains no tool run")
  let version: string | undefined
  let failed = false
  for (const value of runs) {
    const run = object(value)
    const driver = object(object(run.tool).driver)
    if (typeof driver.name !== "string" || !driver.name)
      throw new Error("SARIF has no tool identity")
    if (typeof driver.semanticVersion === "string") version = diagnostic(driver.semanticVersion)
    else if (typeof driver.version === "string") version = diagnostic(driver.version)
    for (const invocation of list(run.invocations === undefined ? [] : run.invocations)) {
      const detail = object(invocation)
      if (detail.executionSuccessful === false) failed = true
      for (const field of ["toolExecutionNotifications", "toolConfigurationNotifications"] as const)
        for (const notification of list(detail[field] === undefined ? [] : detail[field]))
          if (object(notification).level === "error") failed = true
    }
    for (const raw of list(run.results === undefined ? [] : run.results)) {
      if (findings.length >= 10000) throw new Error("SARIF finding limit exceeded")
      const result = object(raw)
      let rule = result.ruleId
      if (rule === undefined && typeof result.ruleIndex === "number")
        rule = object(list(driver.rules)[result.ruleIndex]).id
      if (typeof rule !== "string" || !rule || rule.length > 512)
        throw new Error("Invalid SARIF rule")
      const message = object(result.message)
      const text = message.text ?? message.markdown
      if (typeof text !== "string") throw new Error("SARIF finding has no message")
      const coordinates =
        driver.name === "qlty" && rule === "qlty:similar-code"
          ? "whole-lines"
          : pluginRegions && !rule.startsWith("qlty:")
            ? "plugin"
            : "strict"
      const locations = list(result.locations).map((item) => location(item, run, root, coordinates))
      const primary = locations[0]
      if (!primary) throw new Error("SARIF finding has no source location")
      const related = [
        ...locations.slice(1),
        ...list(result.relatedLocations === undefined ? [] : result.relatedLocations).map((item) =>
          location(item, run, root, coordinates),
        ),
      ]
      const finding: QualityFinding = {
        ...primary,
        rule,
        message: diagnostic(text),
        id: hash([rule, primary, related]),
      }
      if (related.length) finding.related = related
      const properties = object(result.properties === undefined ? {} : result.properties)
      for (const key of ["actual", "threshold"] as const) {
        if (properties[key] !== undefined) {
          if (typeof properties[key] !== "number" || !Number.isFinite(properties[key]))
            throw new Error("Invalid SARIF metric")
          finding[key] = properties[key]
        }
      }
      findings.push(finding)
    }
  }
  return { version, failed }
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
    const files = [
      ...new Set(
        input.files.map((file) => {
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
        }),
      ),
    ]
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
    const base = {
      ...evidence(),
      exitCode: output.exitCode,
      stderr: diagnostic(output.stderr),
      version: output.version ? diagnostic(output.version) : undefined,
    }
    if (output.timedOut)
      return { ...base, status: "timed_out", reason: "Qlty exceeded its time budget" }
    if (output.unavailable)
      return {
        ...base,
        status: "unavailable",
        reason: diagnostic(output.error ?? "Qlty executable is unavailable"),
      }
    if (
      output.outputExceeded ||
      Buffer.byteLength(output.stdout) > STDOUT_LIMIT ||
      Buffer.byteLength(output.stderr) > STDERR_LIMIT
    )
      return { ...base, status: "failed", reason: "Qlty output exceeded its byte budget" }
    if (output.error) return { ...base, status: "failed", reason: diagnostic(output.error) }
    if (input.mode === "metrics") {
      if (output.exitCode !== 0 || !output.stdout.trim())
        return { ...base, status: "failed", reason: "Qlty metrics did not complete" }
      return { ...base, status: "complete", metrics: output.stdout }
    }
    const parsed = parseSarif(output.stdout, root, findings, input.mode === "lint")
    base.version = parsed.version ?? base.version
    if (parsed.failed || (output.exitCode !== 0 && !(output.exitCode === 1 && findings.length)))
      return {
        ...base,
        ...evidence(),
        status: "failed",
        reason: "Qlty reported an analysis failure",
      }
    return { ...base, ...evidence(), status: "complete" }
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
