import { AGENT_NAMES } from "../../agents/ids.ts"
import { NATIVE_KINDS } from "../native.ts"
import { type Args, flag, out } from "./arguments.ts"
import type { Inventory } from "./list.ts"
import { locationText, seenText } from "./session-facts.ts"

function codexLine(t: Inventory["codex"][number]): string {
  const display =
    t.peer_name && t.peer_name !== t.name
      ? `${t.name ?? "(unnamed)"} [peer ${t.peer_name}]`
      : (t.name ?? "(unnamed)")
  return `  ${display.padEnd(24)} ${t.id}  ${t.registered ? "registered" : "not registered"}  ${t.role} / ${t.addressability}${t.coordinator ? `, coordinator ${t.coordinator}` : ""}  codex pid ${t.holder_pid}${t.shim_pid ? `, stand-in ${t.shim_pid}` : ""}  ${locationText(t)}${seenText(t)}`
}

export function printInventory(args: Args, payload: Inventory): void {
  if (flag(args, "json")) {
    out(JSON.stringify(payload, null, 2))
    return
  }
  out(`Claude sessions (${payload.claude.length} live):`)
  for (const c of payload.claude)
    out(
      `  ${(c.name ?? "(unnamed)").padEnd(24)} pid ${String(c.pid).padEnd(7)} ${(c.status ?? "?").padEnd(6)} ${locationText(c)}${seenText(c)}`,
    )
  if (payload.claude_unverified.length > 0) {
    out(
      `Claude sessions (${payload.claude_unverified.length} unverified; process probe unavailable):`,
    )
    for (const c of payload.claude_unverified)
      out(
        `  ${(c.name ?? "(unnamed)").padEnd(24)} pid ${String(c.pid).padEnd(7)} ${locationText(c)}`,
      )
  }
  out(`Codex threads (${payload.codex.length} live):`)
  for (const t of payload.codex) {
    out(codexLine(t))
  }
  if (payload.codex_unverified.length > 0) {
    out(
      `Codex threads (${payload.codex_unverified.length} unverified; file ownership check unavailable):`,
    )
    for (const t of payload.codex_unverified)
      out(`  ${(t.name ?? "(unnamed)").padEnd(24)} ${t.id}  ${locationText(t)}`)
  }
  if (!payload.codex_schema_recognised)
    out("  (thread discovery degraded: unknown state_*.sqlite schema)")
  for (const kind of NATIVE_KINDS) {
    out(`${AGENT_NAMES[kind]} sessions (${payload[kind].length} registered):`)
    for (const row of payload[kind])
      out(
        `  ${row.name.padEnd(24)} ${row.uuid}  ${row.status}  ${locationText(row)}${seenText(row)}`,
      )
  }
}
