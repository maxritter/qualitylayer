import { existsSync } from "node:fs"
import { BUDDY_USES, nowIso, unlinkQuiet, writeJsonAtomic } from "../base.ts"
import { ResolveAmbiguousKind } from "../codex.ts"
import { type Args, fail, flag, opt, out } from "./arguments.ts"
import { type Buddy, type BuddyRecord, buddyPath, readBuddy } from "./buddy-context.ts"
import { buddyStatus } from "./buddy-status.ts"
import { callerIdentity } from "./identity.ts"
import { resolveTyped } from "./targets.ts"

export function buddyLine(rec: BuddyRecord, status: Record<string, unknown>): string {
  const name = status.name ?? rec.buddy.name ?? "(unnamed)"
  const parts = [
    status.live === true ? "live" : status.live === false ? "not live" : "liveness unknown",
  ]
  if (status.kind === "codex") {
    parts.push(
      `registered=${status.registered === true ? "yes" : status.registered === false ? "no" : "unknown"}`,
    )
    parts.push(`stand-in=${status.shim_pid ?? "none"}`)
  }
  parts.push(String(status.status ?? "status unknown"))
  if (status.paused) parts.push("paused")
  const route = String(status.route ?? "unavailable: unknown")
  return `buddy = ${name} (${status.kind}, ${String(status.uuid).slice(0, 8)}) ${parts.join(", ")}; ${route === "available" ? "route available" : `route ${route}`}; uses: ${rec.uses.join(", ")}`
}

function printBuddy(args: Args, rec: BuddyRecord, status: Record<string, unknown>): void {
  out(flag(args, "json") ? JSON.stringify({ ...rec, status }, null, 2) : buddyLine(rec, status))
}

function clearBuddy(path: string): number {
  if (!existsSync(path)) {
    out("no buddy was set")
    return 0
  }
  unlinkQuiet(path)
  out("buddy cleared")
  return 0
}

function buddyUses(args: Args) {
  const usesRaw = opt(args, "uses")
  const uses =
    usesRaw === undefined
      ? [...BUDDY_USES]
      : [
          ...new Set(
            usesRaw
              .split(",")
              .map((w) => w.trim())
              .filter(Boolean),
          ),
        ]
  const unknown = uses.filter((u) => !(BUDDY_USES as readonly string[]).includes(u))
  if (unknown.length > 0 || uses.length === 0) {
    return {
      ok: false as const,
      message: `unsupported --uses ${unknown.join(", ") || "(empty)"}; supported: ${BUDDY_USES.join(", ")}`,
    }
  }
  return { ok: true as const, uses }
}

async function setBuddy(
  args: Args,
  owner: ReturnType<typeof callerIdentity>,
  path: string,
): Promise<number> {
  const target = args.positional[1]
  if (target === undefined) return fail("buddy set [cc:|codex:|@]<name|uuid>", 2)
  const selected = buddyUses(args)
  if (!selected.ok) return fail(selected.message, 2)
  const { uses } = selected
  let buddy: Buddy
  try {
    buddy = resolveTyped(target)
  } catch (cause) {
    if (cause instanceof ResolveAmbiguousKind) {
      process.stderr.write(`error: ${cause.message}. Retry with one of:\n`)
      for (const choice of cause.choices)
        process.stderr.write(`  qualitylayer peers buddy set ${choice}\n`)
      return 1
    }
    throw cause
  }
  if (buddy.kind === owner.kind && buddy.uuid === owner.uuid)
    return fail("a session cannot be its own buddy", 2)
  const rec: BuddyRecord = { owner, buddy, uses, set_at: nowIso() }
  writeJsonAtomic(path, rec)
  printBuddy(args, rec, await buddyStatus(buddy, true))
  return 0
}

export async function cmdBuddy(args: Args): Promise<number> {
  const action = args.positional[0] ?? "show"
  const owner = callerIdentity(args)
  const path = buddyPath(owner)
  if (action === "clear") return clearBuddy(path)
  if (action === "set") return setBuddy(args, owner, path)
  const rec = readBuddy(owner)
  if (rec === null) return fail("no buddy set; run `qualitylayer peers buddy set <name|uuid>`")
  printBuddy(args, rec, await buddyStatus(rec.buddy, action === "ping"))
  return 0
}
