// heavy hold --reason "<why>" [--until <HH:MM or ISO>] [--holder <name>] [--lease <id>] · heavy release
// --lease <id> · heavy status. Thin parsing over core/heavy-hold: an optional, visible note that heavy
// machine work runs, for people and other heavy holders; normal `check all` and `next` never wait on
// it. The holder's name is display only; `hold` prints the lease, and renewing or releasing needs it.

import {
  defaultHolder,
  HEAVY_LEASE_ENV,
  holdHeavy,
  parseUntil,
  readHeavy,
  releaseHeavy,
  untilText,
} from "../../core/heavy-hold.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"

const USAGE =
  'usage: qualitylayer heavy hold --reason "<why>" [--until <HH:MM or ISO time>] [--holder <name>] [--lease <id> to renew] · heavy release --lease <id> · heavy status [--json]'

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}

async function heavyStatus(ctx: Ctx): Promise<Result<unknown>> {
  const hold = await readHeavy(ctx)
  if (hold === null) return ok({ held: false, message: "The machine is free." })
  return ok({
    held: true,
    holder: hold.holder,
    reason: hold.reason,
    since: hold.since,
    until: hold.until,
    message: `The machine is held by ${hold.holder} for ${hold.reason} ${untilText(hold)}.`,
  })
}

async function heavyRelease(ctx: Ctx, lease: string | undefined): Promise<Result<unknown>> {
  if (lease === undefined)
    return err({
      code: "bad_args",
      message:
        "Release needs the lease that `qualitylayer heavy hold` printed: `qualitylayer heavy release --lease <id>`.",
    })
  const done = await releaseHeavy(ctx, lease)
  if (!done.ok) return done
  return ok({
    released: done.data.released,
    message: done.data.released
      ? "The machine is released."
      : "That lease holds nothing; run `qualitylayer heavy status` to see who holds the machine.",
  })
}

async function heavyHold(
  ctx: Ctx,
  rest: string[],
  holder: string,
  lease: string | undefined,
): Promise<Result<unknown>> {
  const reason = flag(rest, "reason")
  if (reason === undefined || reason.trim() === "") return err({ code: "bad_args", message: USAGE })
  const untilArg = flag(rest, "until")
  const until = untilArg === undefined ? null : parseUntil(untilArg, ctx.clock.now())
  if (untilArg !== undefined && until === null)
    return err({
      code: "bad_args",
      message: `--until wants HH:MM or an ISO time, not "${untilArg}"`,
    })
  // The hold ends with the session that took it (this call's parent), not with this short call.
  const held = await holdHeavy(ctx, { holder, reason, until, pid: process.ppid, lease })
  if (!held.ok) return held
  return ok({
    held: true,
    holder: held.data.holder,
    reason: held.data.reason,
    since: held.data.since,
    until: held.data.until,
    lease: held.data.lease,
    message: `${held.data.holder} holds the machine for ${held.data.reason} ${untilText(held.data)}. Release it with \`qualitylayer heavy release --lease ${held.data.lease}\`.`,
  })
}

export async function heavyCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  const holder = flag(rest, "holder")?.trim() || defaultHolder(ctx)
  // The lease of the caller's own hold: the flag, else the environment of a run its holder started.
  const lease = flag(rest, "lease")?.trim() || ctx.env.get(HEAVY_LEASE_ENV)?.trim() || undefined
  if (sub === "status") return heavyStatus(ctx)
  if (sub === "release") return heavyRelease(ctx, lease)
  if (sub === "hold") return heavyHold(ctx, rest, holder, lease)
  return err({ code: "bad_args", message: USAGE })
}
