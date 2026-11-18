import { envNumber } from "../base.ts"
import { readClaudeRecords, recordLiveness } from "../claude.ts"
import { NATIVE_KINDS, resolveNative } from "../native.ts"
import { type Args, fail, opt, printResult } from "./arguments.ts"
import { expandBuddy } from "./buddy-context.ts"
import { resolveClaudeRecord } from "./claude-targets.ts"
import { WAIT_PREFIXES } from "./delivery.ts"
import { boundedTimeout } from "./request-send.ts"

async function waitNative(
  args: Args,
  target: string,
  kind: (typeof NATIVE_KINDS)[number],
): Promise<number> {
  const state = opt(args, "state") ?? "idle"
  if (state !== "idle" && state !== "busy") return fail("--state is idle or busy", 2)
  const row = resolveNative(kind, target.slice(kind.length + 1))
  const timeout = boundedTimeout(opt(args, "timeout"))
  const deadline = Date.now() + timeout * 1000
  while (Date.now() < deadline) {
    const current = resolveNative(kind, row.uuid)
    if (current.status === state) {
      printResult(
        args,
        { status: state, session_id: current.uuid, session_name: current.name },
        `${current.name} is ${state}`,
      )
      return 0
    }
    await Bun.sleep(1000)
  }
  return fail(`${target} did not become ${state} within ${timeout} seconds`, 124)
}

async function waitClaude(args: Args, target: string): Promise<number> {
  const state = opt(args, "state") ?? "idle"
  if (state !== "idle" && state !== "busy") return fail("--state is idle or busy", 2)
  const timeout = boundedTimeout(opt(args, "timeout"))
  const rec = resolveClaudeRecord(target.slice(3))
  const sid = rec.sessionId
  const deadline = Date.now() + timeout * 1000
  const interval = envNumber("QUALITYLAYER_PEERS_WAIT_POLL_INTERVAL", 1)
  while (Date.now() < deadline) {
    const current = readClaudeRecords().find((r) => r.sessionId === sid)
    if (current !== undefined && recordLiveness(current) === "live" && current.status === state) {
      printResult(
        args,
        { status: state, session_id: sid, session_name: current.name ?? null },
        `${current.name ?? sid} is ${state}`,
      )
      return 0
    }
    await Bun.sleep((interval > 0 ? interval : 1) * 1000)
  }
  return fail(`${target} did not become ${state} within ${timeout} seconds`, 124)
}

export async function cmdWait(args: Args): Promise<number> {
  let target = opt(args, "for")
  if (target === undefined)
    return fail(`--for cc:, ${WAIT_PREFIXES} followed by a name or UUID is required`, 2)
  target = expandBuddy(target, args, "wait")
  for (const kind of NATIVE_KINDS) {
    if (target.startsWith(`${kind}:`)) return waitNative(args, target, kind)
  }
  if (!target.startsWith("cc:")) return fail(`wait --for must start with cc:, ${WAIT_PREFIXES}`, 2)
  return waitClaude(args, target)
}
