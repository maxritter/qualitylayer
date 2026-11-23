import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { NATIVE_SESSION_FILES_KEPT } from "../home-caps.ts"
import { hasHookFile } from "../install/agent-hooks.ts"
import { keyOf } from "../task/binding.ts"
import type { ProcessIdentity, RunRecord } from "./contracts.ts"
import { immediateNativeParent, verifiedNativeParent } from "./native-parent.ts"
import { identityState, processIdentity } from "./registry.ts"

export { extraNativeSessionFile } from "./extra-native-session.ts"

const SESSION_EVENTS = new Set(["SessionStart", "SessionEnd", "UserPromptSubmit"])

const folder = (ctx: Ctx) => join(ctx.home, "native-sessions")
const marker = (ctx: Ctx, agent: string, session: string) =>
  join(folder(ctx), `${agent}-${keyOf(session)}.json`)

function isValidWitness(row: unknown): row is ProcessIdentity {
  if (!row || typeof row !== "object") return false
  const r = row as Record<string, unknown>
  const validPid = typeof r.pid === "number" && Number.isSafeInteger(r.pid) && r.pid >= 1
  return validPid && typeof r.processStart === "string" && typeof r.pidDomain === "string"
}

function witnesses(path: string): ProcessIdentity[] {
  if (!existsSync(path)) return []
  try {
    if (statSync(path).size > 16 * 1024) throw new Error("oversize")
    const rows: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (!Array.isArray(rows) || rows.length > 16 || !rows.every(isValidWitness))
      throw new Error("invalid")
    return rows
  } catch {
    throw new Error("Cannot verify native session ownership evidence")
  }
}

async function pruneDeadNativeSessions(ctx: Ctx): Promise<void> {
  const dir = folder(ctx)
  const files = readdirSync(dir).filter((name) => /^[a-z]+-[a-f0-9]+\.json$/.test(name))
  let count = files.length
  for (const name of files) {
    if (count < NATIVE_SESSION_FILES_KEPT) break
    const path = join(dir, name)
    const rows = witnesses(path)
    if (rows.length === 0 || rows.every((row) => identityState(row) === "dead")) {
      await ctx.fs.remove(path)
      count--
    }
  }
  if (count >= NATIVE_SESSION_FILES_KEPT)
    throw new Error("Native session ownership storage is full")
}

async function resolveSessionOwner(
  fromFile: boolean,
  payload: { agent_pid?: unknown },
  caller: number,
  agentPid?: () => number | null,
): Promise<ProcessIdentity | null> {
  const parent = fromFile
    ? (agentPid ?? (await import("../live/record.ts")).ownAgentProcess)()
    : payload.agent_pid === undefined
      ? immediateNativeParent(caller)
      : verifiedNativeParent(payload.agent_pid, caller)
  return parent ? processIdentity(parent, "descendant") : null
}

function sameIdentity(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.pid === b.pid && a.processStart === b.processStart && a.pidDomain === b.pidDomain
}

async function updateWitnessFile(
  ctx: Ctx,
  file: string,
  event: string,
  own: ProcessIdentity,
): Promise<void> {
  const previous = witnesses(file)
  const current = previous.filter((row) => identityState(row) !== "dead")
  const next =
    event === "SessionEnd"
      ? current.filter((row) => !sameIdentity(row, own))
      : current.some((row) => sameIdentity(row, own))
        ? current
        : [...current, own]
  if (JSON.stringify(next) === JSON.stringify(previous)) return
  if (next.length === 0) {
    await ctx.fs.remove(file)
    return
  }
  if (!existsSync(file)) await pruneDeadNativeSessions(ctx)
  if (next.length > 16) throw new Error("Too many processes hold this native session")
  await ctx.fs.atomicWrite(file, JSON.stringify(next))
}

/** The hook's native parent holds this conversation until it exits, including while idle. */
export async function recordNativeSession(
  ctx: Ctx,
  payload: { session_id?: unknown; hook_event_name?: unknown; agent_pid?: unknown },
  fallback: string,
  caller: number,
  agentPid?: () => number | null,
): Promise<void> {
  const agent = ctx.env.get("QUALITYLAYER_AGENT")
  const session = payload.session_id
  const event = String(payload.hook_event_name || fallback)
  // The plugins of Pi and OpenCode run the hook as the agent's own child; the hook files of the others
  // run it under a shell, so the agent is the nearest known agent among its ancestors.
  const fromFile = agent !== undefined && hasHookFile(agent)
  const supportedAgent = agent === "pi" || agent === "opencode" || fromFile
  const validSession = typeof session === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(session)
  if (!supportedAgent || !validSession || !SESSION_EVENTS.has(event)) return
  const own = await resolveSessionOwner(fromFile, payload, caller, agentPid)
  // A hook file's agent that cannot be found leaves no mark; the hook never fails the agent.
  if (!own && fromFile) return
  if (!own) throw new Error("Cannot verify the native session's process")
  const file = marker(ctx, agent, session)
  await ctx.fs.mkdir(folder(ctx))
  await ctx.fs.withLock(join(folder(ctx), ".lock"), () => updateWitnessFile(ctx, file, event, own))
}

export function assertNativeSessionFree(ctx: Ctx, run: RunRecord): void {
  for (const row of witnesses(marker(ctx, run.agent, run.nativeSession ?? ""))) {
    if (identityState(row) !== "dead")
      throw new Error(
        "This native session is alive or its ownership cannot be verified in another terminal.",
      )
  }
}
