import { join } from "node:path"
import { asRecord, codexHome, readJson } from "../base.ts"
import { readCodexConfig } from "../codex.ts"
import type { AddCheck } from "./doctor.ts"
import { hookCommand } from "./hooks.ts"
export function reportHooks(add: AddCheck): void {
  const hooksPath = join(codexHome(), "hooks.json")
  const hooks = asRecord(readJson(hooksPath, null))
  if (hooks === null) add("ok", `no ${hooksPath} (the SessionStart hook is optional)`)
  else {
    reportCommands(hookCommands(hooks), add)
  }
}

function hookCommands(hooks: Record<string, unknown>): unknown[] {
  const events = (asRecord(hooks.hooks) ?? hooks) as Record<string, unknown>
  const entries = Array.isArray(events.SessionStart) ? events.SessionStart : []
  const commands = entries
    .flatMap((e) => (Array.isArray(asRecord(e)?.hooks) ? (asRecord(e)?.hooks as unknown[]) : []))
    .map((h) => asRecord(h)?.command)
  return commands
}

function reportCommands(commands: unknown[], add: AddCheck): void {
  const ours = commands.filter((c) => c === hookCommand(true) || c === hookCommand(false))
  const legacy = commands.filter(
    (c) => typeof c === "string" && /session-peers\/scripts\/peers\.py/.test(c),
  )
  if (ours.length > 0)
    add(
      "ok",
      `SessionStart entry present (${ours[0] === hookCommand(true) ? "auto-attach" : "reconcile-only"}); trust it with /hooks in Codex`,
    )
  else
    add(
      "ok",
      "no QualityLayer SessionStart entry (optional; `qualitylayer peers install-hook --auto-attach`)",
    )
  if (legacy.length > 0)
    add(
      "warn",
      "the session-peers skill's SessionStart entry is still installed; `qualitylayer peers install-hook --auto-attach` replaces it",
    )
  const features = asRecord(readCodexConfig().features)
  if (features?.hooks === false)
    add("warn", "[features] hooks = false explicitly disables the entry")
}
