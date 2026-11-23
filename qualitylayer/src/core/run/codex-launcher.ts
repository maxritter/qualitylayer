import { readFileSync, realpathSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"
import type { RunRecord } from "./contracts.ts"
import { nativeExecutable, nativeProcess } from "./processes.ts"

function codexTargetTriple(): string | null {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : ""
  if (!arch) return null
  if (process.platform === "darwin") return `${arch}-apple-darwin`
  if (process.platform === "linux") return `${arch}-unknown-linux-musl`
  return null
}

function resolveCodexBinary(binaryPath: string): string | null {
  const launcher = realpathSync(binaryPath)
  const root = dirname(dirname(launcher))
  if (launcher !== join(root, "bin", "codex.js")) return null
  const metadata = join(root, "package.json")
  const validMeta =
    statSync(metadata).size <= 64 * 1024 &&
    JSON.parse(readFileSync(metadata, "utf8")).name === "@openai/codex"
  const target = validMeta ? codexTargetTriple() : null
  if (!target) return null
  let vendor = join(root, "vendor")
  try {
    const packageName = `@openai/codex-${process.platform}-${process.arch}`
    vendor = join(dirname(createRequire(launcher).resolve(`${packageName}/package.json`)), "vendor")
  } catch {
    // Older npm releases keep the executable in the launcher's own package.
  }
  return realpathSync(join(vendor, target, "bin", "codex"))
}

/** npm's launcher waits for one native child; that child is the lead, not a helper. */
export function codexLauncherChild(run: RunRecord, pid: number): boolean {
  const isNodeLead =
    run.agent === "codex" &&
    Boolean(run.binary && run.lead) &&
    ["node", "nodejs"].includes(basename(nativeExecutable(run.lead?.pid ?? -1) ?? ""))
  if (!isNodeLead || !run.binary || !run.lead) return false
  const expected = resolveCodexBinary(run.binary.path)
  if (!expected) return false
  const child = nativeProcess(pid)
  return Boolean(
    child &&
      child.parent === run.lead.pid &&
      nativeExecutable(pid) === expected &&
      nativeProcess(pid)?.nativeStart === child.nativeStart,
  )
}
