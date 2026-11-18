import { writeFileSync } from "node:fs"
import {
  asRecord,
  BUDGET_ALLOW_MAX,
  budgetAllowPath,
  budgetResetPath,
  envNumber,
  isUuid,
  nowIso,
  nowSeconds,
  PeerError,
  type PeerKind,
  parseTime,
  REPLY_BUDGET,
  REPLY_BUDGET_WINDOW_DEFAULT,
  readJson,
  threadStatePath,
  unlinkQuiet,
  writeJsonAtomic,
} from "../base.ts"
import { resolveThreadPreferLive } from "../codex.ts"
import { shimPid, shimSupports } from "../shim.ts"
import { type Args, fail, opt, out } from "./arguments.ts"
import { expandBuddy } from "./buddy-context.ts"
import { callerIdentity } from "./identity.ts"

export function budgetTarget(value: string, args: Args): string {
  let target = expandBuddy(value, args, "budget")
  if (target.startsWith("cc:"))
    throw new PeerError(
      "the reply budget belongs to a Codex thread's stand-in, not a Claude session",
      2,
    )
  if (target.startsWith("codex:")) target = target.slice(6)
  try {
    return resolveThreadPreferLive(target).id
  } catch (cause) {
    if (!isUuid(target)) throw cause
    return target
  }
}

export async function cmdBudget(args: Args): Promise<number> {
  const [sub, target] = args.positional
  if (sub === "allow") return cmdBudgetAllow(args, target)
  if (sub !== "reset" || target === undefined)
    return fail("budget subcommands are `reset <thread>` and `allow <thread> --replies N`", 2)
  const id = budgetTarget(target, args)
  // An explicit reset drops any allowance, consumed or not.
  unlinkQuiet(budgetAllowPath(id))
  writeFileSync(budgetResetPath(id), `${nowIso()}\n`)
  const state = asRecord(readJson(threadStatePath(id), null))
  if (
    state !== null &&
    (Object.keys(asRecord(state.budgets) ?? {}).length > 0 || state.allowance)
  ) {
    writeJsonAtomic(threadStatePath(id), { ...state, budgets: {}, allowance: null })
  }
  out(`reply budget reset for ${id}`)
  return 0
}

function allowanceSession(args: Args) {
  let sid = opt(args, "for-session")
  if (sid === undefined) {
    let caller: { kind: PeerKind; uuid: string } | null = null
    try {
      caller = callerIdentity(args)
    } catch {
      caller = null
    }
    if (caller === null || caller.kind !== "cc")
      return {
        ok: false as const,
        message: "--for-session <uuid> is required when the caller is not a Claude session",
      }
    sid = caller.uuid
  }
  if (!isUuid(sid))
    return { ok: false as const, message: "--for-session must be a Claude session UUID" }
  return { ok: true as const, sid }
}

export async function cmdBudgetAllow(args: Args, target: string | undefined): Promise<number> {
  const replies = Number(opt(args, "replies"))
  if (target === undefined) return fail("budget allow <thread> --replies N", 2)
  if (!Number.isInteger(replies) || replies < 1 || replies > BUDGET_ALLOW_MAX) {
    return fail(`--replies must be between 1 and ${BUDGET_ALLOW_MAX}`, 2)
  }
  const session = allowanceSession(args)
  if (!session.ok) return fail(session.message, 2)
  const { sid } = session
  const id = budgetTarget(target, args)
  const pid = shimPid(id)
  if (pid !== null && !shimSupports(id, pid, "budget_allow")) {
    return fail(
      `cannot verify the running stand-in for ${id} (pid ${pid}) supports allowances. Restart it: \`qualitylayer peers restart ${id}\`, then grant again`,
    )
  }
  const path = budgetAllowPath(id)
  let total = replies
  let grantedAt = nowIso()
  const pending = asRecord(readJson(path, null))
  const window =
    envNumber("QUALITYLAYER_PEERS_REPLY_BUDGET_WINDOW", REPLY_BUDGET_WINDOW_DEFAULT) ||
    REPLY_BUDGET_WINDOW_DEFAULT
  if (pending !== null && pending.sid === sid) {
    // Two grants before the stand-in reads them keep the higher, with its own time.
    const previous = pending.total
    const previousAt = parseTime(pending.at)
    if (
      typeof previous === "number" &&
      previousAt !== null &&
      nowSeconds() - previousAt <= window &&
      Math.min(previous, BUDGET_ALLOW_MAX) >= total
    ) {
      total = Math.min(previous, BUDGET_ALLOW_MAX)
      grantedAt = String(pending.at)
    }
  }
  writeJsonAtomic(path, { sid, total, at: grantedAt })
  out(
    `reply allowance for ${id}: up to ${Math.max(REPLY_BUDGET, total)} consecutive replies to session ${sid} (a total for this sequence; replies already delivered still count)`,
  )
  if (pid === null) out(`no stand-in is running for ${id}; the grant applies once one starts`)
  return 0
}
