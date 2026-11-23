// An optional, visible note that heavy machine work is running. A session that measures (the
// workflow bench) writes who it is, why and until when, and `heavy status` shows it to people. It
// only coordinates heavy holders with each other: a second `heavy hold` is refused while one is in
// force. Normal workflow work never waits on it: `check all` runs and `next` says nothing of it.
// The record is one small file in the QualityLayer home. A hold whose process is gone, or whose
// expected end passed a while ago, reads as free.
//
// A hold belongs to its lease: a random id `holdHeavy` returns to the one who took it. Renewing and
// releasing need that lease; the holder's name is only what other sessions read. Work the holder
// starts may carry the lease in QUALITYLAYER_HEAVY_LEASE, so it can renew or release the hold.

import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { sessionIdentity } from "./agents/detect.ts"
import { pidAlive } from "./self.ts"

export type HeavyHold = {
  holder: string
  reason: string
  since: number
  until: number | null
  pid: number
  /** Opaque key to renew or release this hold. Never shown by `heavy status`, `next` or a refusal. */
  lease: string
}

/** The environment variable a holder sets for the work it starts, so that work is not held back. */
export const HEAVY_LEASE_ENV = "QUALITYLAYER_HEAVY_LEASE"

/** A hold stays in force this long after its expected end (a run that overshoots a little). */
export const HOLD_GRACE_MS = 15 * 60_000
const REASON_MAX = 300
const HOLDER_MAX = 80

export const heavyHoldPath = (ctx: Ctx) => join(ctx.home, "heavy-hold.json")
const lockPath = (ctx: Ctx) => join(ctx.home, "heavy-hold.lock")

/** The name this session holds the machine under: its agent and the start of its id, else a plain default. */
export function defaultHolder(ctx: Ctx): string {
  const identity = sessionIdentity(ctx.env)
  return identity === null ? "this session" : `${identity.agent} ${identity.id.slice(0, 8)}`
}

function isValidHold(value: Partial<HeavyHold>): value is HeavyHold {
  const validStrings =
    typeof value.holder === "string" &&
    typeof value.reason === "string" &&
    typeof value.lease === "string" &&
    value.lease !== ""
  const validUntil = value.until === null || typeof value.until === "number"
  const validPid = typeof value.pid === "number" && Number.isInteger(value.pid)
  return validStrings && typeof value.since === "number" && validUntil && validPid
}

function parseHold(text: string): HeavyHold | null {
  try {
    const value = JSON.parse(text) as Partial<HeavyHold>
    if (!isValidHold(value)) return null
    return {
      holder: value.holder,
      reason: value.reason,
      since: value.since,
      until: value.until,
      pid: value.pid,
      lease: value.lease,
    }
  } catch {
    return null
  }
}

async function readRaw(ctx: Ctx): Promise<HeavyHold | null> {
  const text = await ctx.fs.readFile(heavyHoldPath(ctx)).catch(() => null)
  return text === null ? null : parseHold(text)
}

/** True when nothing keeps this hold in force any more. */
export function holdIsStale(
  hold: HeavyHold,
  now: number,
  alive: (pid: number) => boolean = pidAlive,
): boolean {
  if (hold.until !== null && now > hold.until + HOLD_GRACE_MS) return true
  return !alive(hold.pid)
}

/** The hold in force, or null when the machine is free (no hold, or a stale one). */
export async function readHeavy(ctx: Ctx): Promise<HeavyHold | null> {
  const hold = await readRaw(ctx)
  return hold === null || holdIsStale(hold, ctx.clock.now()) ? null : hold
}

const clockTime = (at: number) => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/** "until 14:30", or "until it is released" when the holder gave no end. */
export const untilText = (hold: HeavyHold) =>
  hold.until === null ? "until it is released" : `until ${clockTime(hold.until)}`

/** The refusal a second `heavy hold` gets while another one is in force. */
export const heldMessage = (hold: HeavyHold) =>
  `Another measuring run holds the machine: ${hold.holder} for ${hold.reason} ${untilText(hold)}. Only a second measuring run waits for it (\`qualitylayer heavy status\`); a build, its checks, tests and real runs never take or wait for a hold.`

/** `HH:MM` (the next such local time) or an ISO date and time, as epoch milliseconds; null if it is neither. */
export function parseUntil(text: string, now: number): number | null {
  const clock = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (clock !== null) {
    const hours = Number(clock[1])
    const minutes = Number(clock[2])
    if (hours > 23 || minutes > 59) return null
    const at = new Date(now)
    at.setHours(hours, minutes, 0, 0)
    if (at.getTime() <= now) at.setDate(at.getDate() + 1)
    return at.getTime()
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(text.trim())) return null
  const at = Date.parse(text.trim())
  return Number.isNaN(at) ? null : at
}

/**
 * Take the machine and return the hold with its new lease. Refused (`held`) while any live hold is in
 * force, whatever its name; only the same `lease` renews it (the hold keeps its lease and start).
 * A stale hold is taken over under a new lease. `pid` is the process whose end frees the hold: the
 * caller's session, not the short CLI call that writes it.
 */
export async function holdHeavy(
  ctx: Ctx,
  input: { holder: string; reason: string; until?: number | null; pid?: number; lease?: string },
): Promise<Result<HeavyHold>> {
  const holder = input.holder.trim().slice(0, HOLDER_MAX)
  const reason = input.reason.trim().replace(/\s+/g, " ").slice(0, REASON_MAX)
  if (holder === "" || reason === "")
    return err({ code: "bad_args", message: "A hold needs a holder and a reason." })
  await ctx.fs.mkdir(ctx.home)
  return ctx.fs.withLock(lockPath(ctx), async () => {
    const current = await readHeavy(ctx)
    const renewing = current !== null && input.lease !== undefined && input.lease === current.lease
    if (current !== null && !renewing) return err({ code: "held", message: heldMessage(current) })
    const now = ctx.clock.now()
    const hold: HeavyHold = {
      holder,
      reason,
      since: current?.since ?? now,
      until: input.until ?? null,
      pid: input.pid ?? process.pid,
      lease: current?.lease ?? randomUUID(),
    }
    await ctx.fs.atomicWrite(heavyHoldPath(ctx), `${JSON.stringify(hold)}\n`)
    return ok(hold)
  })
}

/** Let the machine go. Only the hold with this lease (or a stale one) is removed; `released` says whether one was. */
export async function releaseHeavy(
  ctx: Ctx,
  lease: string,
): Promise<Result<{ released: boolean }>> {
  await ctx.fs.mkdir(ctx.home)
  return ctx.fs.withLock(lockPath(ctx), async () => {
    const hold = await readRaw(ctx)
    if (hold === null) return ok({ released: false })
    if (hold.lease !== lease && !holdIsStale(hold, ctx.clock.now())) return ok({ released: false })
    await ctx.fs.remove(heavyHoldPath(ctx))
    return ok({ released: true })
  })
}
