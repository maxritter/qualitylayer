// One explicit fresh-conversation transaction per source generation. Nothing here starts a process.
import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { RunRecord } from "./contracts.ts"
import { identityState, listRuns, readHost, readRun, runDir } from "./registry.ts"

export type FreshState = {
  generation: number
  sequence: number
  key: string
  state: "prepared" | "source-stopped" | "started" | "failed"
  destination?: string
}
export type FreshJournal = FreshState & { version: 1; context: string; sourceSession: string }
export const freshKey = (id: string, generation: number) =>
  `fresh:${createHash("sha256").update(`${id}:${generation}`).digest("hex")}`
export const freshPath = (ctx: Pick<Ctx, "home">, run: Pick<RunRecord, "id">) =>
  join(runDir(ctx.home, run.id), "fresh-conversation.json")
const FRESH_STATES = new Set<FreshState["state"]>([
  "prepared",
  "source-stopped",
  "started",
  "failed",
])

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
}

function isValidFreshJournal(value: FreshJournal, runId: string): boolean {
  const validHeader =
    value.version === 1 && isPositiveInt(value.generation) && isPositiveInt(value.sequence)
  const validStrings =
    typeof value.context === "string" &&
    value.context.length <= 2048 &&
    typeof value.sourceSession === "string" &&
    value.sourceSession.length <= 128
  const validDestination =
    value.destination === undefined || /^[a-f0-9-]{1,128}$/.test(value.destination)
  if (!validHeader || !validStrings || !validDestination) return false
  return value.key === freshKey(runId, value.generation) && FRESH_STATES.has(value.state)
}

export async function readFreshJournal(ctx: Ctx, run: RunRecord): Promise<FreshJournal | null> {
  const path = freshPath(ctx, run)
  if (!(await ctx.fs.exists(path))) return null
  const size = await ctx.fs.stat?.(path)
  if (size && size.size > 16 * 1024)
    throw new Error(
      "Fresh conversation state exceeds its limit. The previous conversation is kept.",
    )
  const text = ctx.fs.readRange
    ? await ctx.fs.readRange(path, 0, 16 * 1024 + 1)
    : await ctx.fs.readFile(path)
  if (Buffer.byteLength(text) > 16 * 1024)
    throw new Error(
      "Fresh conversation state exceeds its limit. The previous conversation is kept.",
    )
  const value = JSON.parse(text) as FreshJournal
  if (!isValidFreshJournal(value, run.id))
    throw new Error(
      "Fresh conversation state cannot be verified. The previous conversation is kept.",
    )
  return value
}
export function freshDestination(ctx: Pick<Ctx, "home">, run: RunRecord): RunRecord | undefined {
  const state = run.fresh
  if (!state || state.generation !== run.generation) return undefined
  const found = state.destination
    ? readRun(ctx.home, state.destination)
    : listRuns(ctx.home).find((candidate) => candidate.idempotencyKey === state.key)
  return found?.previousRun?.id === run.id &&
    found.previousRun.generation === run.generation &&
    found.previousRun.nativeSession === run.nativeSession
    ? found
    : undefined
}
/** Resume previous and Retry fresh share the source's bind/control locks. */
export async function assertPreviousMayResume(ctx: Ctx, run: RunRecord): Promise<void> {
  const destination = freshDestination(ctx, run)
  if (!destination) return
  const host = readHost(ctx.home, destination.id)
  const identities = [
    destination.host,
    destination.lead,
    host && {
      pid: host.pid,
      processStart: host.processStart,
      pidDomain: host.pidDomain,
      knownBy: "host" as const,
    },
    ...(host?.descendants ?? []),
  ]
  const cleanStopped =
    ["stopped", "failed"].includes(destination.status) &&
    destination.cleanup?.complete === true &&
    host?.cleanup?.complete !== false
  const hasLiveIdentity = identities.some(
    (identity) => identity && identityState(identity) !== "dead",
  )
  const hasHostLock =
    !host && (await ctx.fs.exists(join(runDir(ctx.home, destination.id), "host.lock")))
  if (!cleanStopped || hasLiveIdentity || hasHostLock)
    throw new Error(
      "A newer conversation is running or its cleanup is unverified. Open or stop it before resuming this one.",
    )
}
