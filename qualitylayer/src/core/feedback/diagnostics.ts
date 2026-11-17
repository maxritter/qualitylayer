// What a report may carry as diagnostics, and nothing else: the App and command line version, the
// system, the agents' versions, the page as a kind of page, the licence tier and how many errors the
// page saw in the last hour. No code, plan or document text, task title, repository or branch name,
// or file path ever enters: every value here is built from a fixed word list or a version number,
// and anything the page sends is checked against the same list before it is used.

import { arch, platform, release } from "node:os"
import type { Ctx } from "../../ctx.ts"
import { agentBinary, type Reviewer } from "../agents/binary.ts"
import { NATIVE_AGENTS } from "../agents/ids.ts"
import { loadIdentity as loadState } from "../licence/identity-access.ts"
import { nativeCommand } from "../platform.ts"
import { probe, versionFromOutput, versionTextOf } from "../probe.ts"
import { cleanLaunchDiagnostic, type LaunchDiagnostic } from "../run/launch-diagnostics.ts"
import { listRuns } from "../run/registry.ts"
import { VERSION } from "../version.ts"
import { type Diagnostics, pageKindOf, recentErrorsOf, versionKey } from "./words.ts"

/** The version in a command's `--version` line, or null. */
export function versionIn(line: string): string | null {
  return versionFromOutput(line, true)
}

export type SystemFacts = {
  os: string
  arch: "arm64" | "x64"
  /** The version of an agent's command, or null when it is not installed or does not answer. */
  agentVersion: (ctx: Ctx, agent: Reviewer) => string | null | Promise<string | null>
}

const SPAWN_TIMEOUT_MS = 3000

/** A command's output without blocking the server's event loop; null when it fails or times out. */
async function outputOf(command: string[]): Promise<string | null> {
  const run = await probe(command, { timeoutMs: SPAWN_TIMEOUT_MS })
  return run.status === 0 ? run.stdout : null
}

let macVersionOnce: Promise<string> | null = null

/** The macOS version, asked once per process. */
function macVersion(): Promise<string> {
  macVersionOnce ??= (async () => {
    const out = await outputOf(["sw_vers", "-productVersion"])
    // not macOS or no sw_vers: fall back to the kernel's number
    return (
      /^(\d+(?:\.\d+)?)/.exec((out ?? "").trim())?.[1] ?? /^(\d+\.\d+)/.exec(release())?.[1] ?? "0"
    )
  })()
  return macVersionOnce
}

async function realAgentVersion(ctx: Ctx, agent: Reviewer): Promise<string | null> {
  const binary = await agentBinary(ctx, agent)
  if (binary === null) return null
  // asked once per process for a command file that has not changed
  const out = await versionTextOf(binary, nativeCommand(binary, ["--version"]), {
    timeoutMs: SPAWN_TIMEOUT_MS,
  })
  return out === null ? null : versionIn(out)
}

export async function realFacts(): Promise<SystemFacts> {
  const name = platform() === "darwin" ? "macOS" : platform() === "win32" ? "Windows" : "Linux"
  const version =
    platform() === "darwin" ? await macVersion() : (/^(\d+(?:\.\d+)?)/.exec(release())?.[1] ?? "0")
  return {
    os: `${name} ${version}`,
    arch: arch() === "arm64" ? "arm64" : "x64",
    agentVersion: realAgentVersion,
  }
}

/** Ask for the slow facts once at server start, so the first report finds them cached. */
export async function warmDiagnostics(ctx: Ctx): Promise<void> {
  const facts = await realFacts()
  await Promise.all(NATIVE_AGENTS.map((agent) => facts.agentVersion(ctx, agent)))
}

export type DiagnosticsInput = { page?: unknown; errors?: unknown }

/** Only current failed starts from the last hour; retries and older runs contribute nothing. */
export function recentLaunchDiagnostics(ctx: Ctx): LaunchDiagnostic[] {
  const now = ctx.clock.now()
  return listRuns(ctx.home)
    .filter((run) => {
      const at = Date.parse(run.launchDiagnosticAt ?? "")
      return run.status === "failed" && at <= now && at >= now - 3_600_000
    })
    .sort((a, b) => Date.parse(b.launchDiagnosticAt ?? "") - Date.parse(a.launchDiagnosticAt ?? ""))
    .flatMap((run) => {
      const clean = cleanLaunchDiagnostic(run.launchDiagnostic)
      return clean && clean.agent === run.agent ? [clean] : []
    })
    .slice(0, 3)
}

/** The diagnostics for a report: exactly what the sheet shows before sending. */
export async function buildDiagnostics(
  ctx: Ctx,
  input: DiagnosticsInput,
  given?: SystemFacts,
): Promise<Diagnostics> {
  const facts = given ?? (await realFacts())
  const versions = await Promise.all(
    NATIVE_AGENTS.map(async (agent) => [agent, await facts.agentVersion(ctx, agent)] as const),
  )
  const tier = (await loadState(ctx)).state?.tier
  const page = pageKindOf(input.page)
  const errors = recentErrorsOf(input.errors)
  const agentStarts = recentLaunchDiagnostics(ctx)
  return {
    app: VERSION,
    cli: VERSION,
    ...Object.fromEntries(
      versions.flatMap(([agent, version]) =>
        version !== null ? [[versionKey(agent), version]] : [],
      ),
    ),
    os: facts.os,
    arch: facts.arch,
    ...(page !== undefined ? { page } : {}),
    ...(tier === "solo" || tier === "team" || tier === "trial" ? { tier } : {}),
    ...(errors !== undefined ? { errors } : {}),
    ...(agentStarts.length ? { agentStarts } : {}),
  }
}
